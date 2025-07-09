// /api/tickets/buy.js
// Updated ticket purchase with bound names support

import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({
      status: 'error',
      message: 'Method not allowed'
    });
  }

  try {
    // Import PayPal SDK using dynamic import
    const paypalModule = await import('@paypal/checkout-server-sdk');
    const paypal = paypalModule.default || paypalModule;

    // Debug logging for PayPal environment variables
    console.log('PayPal Environment Debug:', {
      NODE_ENV: process.env.NODE_ENV,
      PAYPAL_CLIENT_ID: process.env.PAYPAL_CLIENT_ID || 'NOT_SET',
      PAYPAL_CLIENT_SECRET: process.env.PAYPAL_CLIENT_SECRET || 'NOT_SET',
      PAYPAL_WEBHOOK_ID: process.env.PAYPAL_WEBHOOK_ID || 'NOT_SET',
      APP_SCHEME: process.env.APP_SCHEME || 'NOT_SET',
      VERCEL_ENV: process.env.VERCEL_ENV || 'NOT_SET'
    });

    // Force Sandbox environment for testing
    const environment = new paypal.core.SandboxEnvironment(
      process.env.PAYPAL_CLIENT_ID, 
      process.env.PAYPAL_CLIENT_SECRET
    );
    
    console.log('Using PayPal Sandbox Environment for testing');

    const client = new paypal.core.PayPalHttpClient(environment);

    // Supabase Auth verification
    const token = req.headers.authorization?.replace('Bearer ', '');
    if (!token) {
      return res.status(401).json({
        status: 'error',
        message: 'Authentication token required'
      });
    }

    // Verify Supabase Auth token
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    
    if (authError || !user) {
      console.log('Supabase auth error:', authError?.message);
      return res.status(401).json({
        status: 'error',
        message: 'Invalid or expired token'
      });
    }

    const userId = user.id;
    console.log('Authenticated user:', userId);

    // Get user profile from your users table
    const { data: userProfile, error: profileError } = await supabase
      .from('users')
      .select('user_id, auth_id, verification_status, role')
      .eq('auth_id', userId)
      .single();

    if (profileError || !userProfile) {
      return res.status(404).json({
        status: 'error',
        message: 'User profile not found'
      });
    }

    // Check if user is verified
    if (userProfile.verification_status !== 'approved') {
      return res.status(403).json({
        status: 'error',
        message: 'Account not verified. Please complete verification to purchase tickets.'
      });
    }

    // Extract request data - UPDATED to include bound_names
    const {
      event_id,
      quantity = 1,
      bound_names = [], // NEW: Array of names for each ticket
      device_info = {}
    } = req.body;

    console.log('Purchase request data:', {
      event_id,
      quantity,
      bound_names,
      bound_names_count: bound_names.length
    });

    // Validate input
    if (!event_id) {
      return res.status(400).json({
        status: 'error',
        message: 'event_id is required'
      });
    }

    if (quantity < 1 || quantity > 5) {
      return res.status(400).json({
        status: 'error',
        message: 'Quantity must be between 1 and 5'
      });
    }

    // NEW: Validate bound names
    if (!Array.isArray(bound_names)) {
      return res.status(400).json({
        status: 'error',
        message: 'bound_names must be an array'
      });
    }

    if (bound_names.length !== quantity) {
      return res.status(400).json({
        status: 'error',
        message: `bound_names array length (${bound_names.length}) must match quantity (${quantity})`,
        details: {
          required_names: quantity,
          provided_names: bound_names.length,
          example: quantity === 2 ? 
            ['John Doe', 'Jane Smith'] : 
            [`Name for Ticket 1`, `Name for Ticket 2`, `Name for Ticket ${quantity}`]
        }
      });
    }

    // Validate each bound name
    for (let i = 0; i < bound_names.length; i++) {
      const name = bound_names[i];
      
      if (typeof name !== 'string') {
        return res.status(400).json({
          status: 'error',
          message: `bound_names[${i}] must be a string`,
          provided_type: typeof name
        });
      }

      if (name.trim().length === 0) {
        return res.status(400).json({
          status: 'error',
          message: `bound_names[${i}] cannot be empty`,
          ticket_number: i + 1
        });
      }

      if (name.length > 50) {
        return res.status(400).json({
          status: 'error',
          message: `bound_names[${i}] is too long (max 50 characters)`,
          provided_length: name.length,
          ticket_number: i + 1
        });
      }

      // Trim whitespace
      bound_names[i] = name.trim();
    }

    // Check for duplicate names
    const uniqueNames = [...new Set(bound_names)];
    if (uniqueNames.length !== bound_names.length) {
      return res.status(400).json({
        status: 'error',
        message: 'Duplicate bound names are not allowed',
        details: {
          provided_names: bound_names,
          duplicate_detected: true
        }
      });
    }

    console.log('✅ Bound names validation passed:', bound_names);

    // Get event details and check availability
    const { data: event, error: eventError } = await supabase
      .from('events')
      .select('*')
      .eq('event_id', event_id)
      .single();

    if (eventError || !event) {
      return res.status(404).json({
        status: 'error',
        message: 'Event not found'
      });
    }

    // Check if event is in the future
    if (new Date(event.event_date) <= new Date()) {
      return res.status(400).json({
        status: 'error',
        message: 'Cannot purchase tickets for past events'
      });
    }

    // Check availability
    if (event.available_tickets < quantity) {
      return res.status(400).json({
        status: 'error',
        message: `Only ${event.available_tickets} tickets available`,
        data: {
          requested: quantity,
          available: event.available_tickets
        }
      });
    }

    // Calculate total amount
    const unitPrice = parseFloat(event.ticket_price || 0);
    const totalAmount = unitPrice * quantity;

    console.log('Purchase calculation:', {
      unit_price: unitPrice,
      quantity: quantity,
      total_amount: totalAmount,
      event_name: event.event_name
    });

    // Create payment record with metadata containing bound names
    const paymentId = crypto.randomUUID();
    
    // NEW: Prepare metadata with bound names and purchase details
    const metadata = {
      bound_names: bound_names,
      purchase_details: {
        device_info: device_info,
        timestamp: new Date().toISOString(),
        user_agent: req.headers['user-agent'] || '',
        ip_address: req.headers['x-forwarded-for'] || req.connection.remoteAddress || '',
        quantity: quantity,
        unit_price: unitPrice
      }
    };

    console.log('Payment metadata prepared:', {
      bound_names_count: metadata.bound_names.length,
      bound_names: metadata.bound_names,
      has_device_info: !!metadata.purchase_details.device_info
    });

    const { data: payment, error: paymentError } = await supabase
      .from('payments')
      .insert({
        payment_id: paymentId,
        user_id: userProfile.user_id,
        event_id: event_id,
        amount: totalAmount,
        payment_status: 'pending',
        payment_method: 'paypal',
        metadata: metadata, // NEW: Store bound names and purchase details
        created_at: new Date().toISOString()
      })
      .select()
      .single();

    if (paymentError) {
      console.log('Payment creation error:', paymentError);
      throw new Error('Failed to create payment record: ' + paymentError.message);
    }

    console.log('✅ Payment record created successfully:', {
      payment_id: payment.payment_id,
      metadata_stored: !!payment.metadata,
      bound_names_in_metadata: payment.metadata?.bound_names?.length || 0
    });

    // Temporarily reserve tickets (reduce available_tickets)
    const { error: reserveError } = await supabase
      .from('events')
      .update({
        available_tickets: event.available_tickets - quantity
      })
      .eq('event_id', event_id);

    if (reserveError) {
      // Cleanup payment record if reservation fails
      await supabase
        .from('payments')
        .delete()
        .eq('payment_id', paymentId);
      
      throw new Error('Failed to reserve tickets: ' + reserveError.message);
    }

    console.log(`✅ Reserved ${quantity} tickets for event ${event.event_name}`);

    // Create PayPal order with proper request body structure
    const orderPayload = {
      intent: 'CAPTURE',
      purchase_units: [
        {
          reference_id: paymentId,
          amount: {
            currency_code: 'USD',
            value: totalAmount.toFixed(2)
          },
          description: `${quantity} ticket(s) for ${event.event_name}`,
          custom_id: userProfile.user_id.toString()
        }
      ],
      application_context: {
        brand_name: 'Ticketing System',
        user_action: 'PAY_NOW',
        return_url: `${process.env.APP_SCHEME || 'ticketapp'}://payment-success?payment_id=${paymentId}`,
        cancel_url: `${process.env.APP_SCHEME || 'ticketapp'}://payment-cancel?payment_id=${paymentId}`
      }
    };

    console.log('PayPal order payload created for amount:', totalAmount);

    const request = new paypal.orders.OrdersCreateRequest();
    request.prefer('return=representation');
    request.requestBody(orderPayload);

    let paypalOrder;
    try {
      console.log('Creating PayPal order...');
      const response = await client.execute(request);
      paypalOrder = response.result;
      console.log('✅ PayPal order created successfully:', paypalOrder.id);
    } catch (paypalError) {
      console.error('PayPal error details:', {
        message: paypalError.message,
        statusCode: paypalError.statusCode,
        details: paypalError.details
      });
      
      // Cleanup on PayPal error
      await supabase
        .from('events')
        .update({
          available_tickets: event.available_tickets // Restore original count
        })
        .eq('event_id', event_id);

      await supabase
        .from('payments')
        .delete()
        .eq('payment_id', paymentId);

      throw new Error('Failed to create PayPal order: ' + paypalError.message);
    }

    // Update payment record with PayPal order ID
    const { error: updateError } = await supabase
      .from('payments')
      .update({
        paypal_order_id: paypalOrder.id
      })
      .eq('payment_id', paymentId);

    if (updateError) {
      console.error('Failed to update payment with PayPal order ID:', updateError);
    }

    // Find approval URL
    const approvalUrl = paypalOrder.links.find(link => link.rel === 'approve')?.href;

    // Set reservation expiry (15 minutes)
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000);

    // Prepare mobile-friendly response
    const mobileDeepLinks = {
      ios: `paypal://checkout?token=${paypalOrder.id}`,
      android: `intent://checkout?token=${paypalOrder.id}#Intent;scheme=paypal;package=com.paypal.android;end;`,
      fallback: approvalUrl
    };

    // Prepare bound names summary for response
    const boundNamesSummary = bound_names.map((name, index) => ({
      ticket_number: index + 1,
      bound_name: name
    }));

    return res.status(201).json({
      status: 'success',
      message: 'Purchase initiated successfully',
      data: {
        purchase_id: paymentId,
        payment_id: paymentId,
        summary: {
          event_id: event.event_id,
          event_name: event.event_name,
          event_date: event.event_date,
          venue: event.venue,
          quantity: quantity,
          unit_price: unitPrice,
          total_amount: totalAmount,
          currency: 'USD',
          bound_names: boundNamesSummary // NEW: Show bound names in response
        },
        payment: {
          paypal_order_id: paypalOrder.id,
          checkout_url: approvalUrl,
          mobile_deep_links: mobileDeepLinks,
          return_urls: {
            success: `${process.env.APP_SCHEME || 'ticketapp'}://payment-success?payment_id=${paymentId}`,
            cancel: `${process.env.APP_SCHEME || 'ticketapp'}://payment-cancel?payment_id=${paymentId}`
          }
        },
        reservation: {
          expires_at: expiresAt.toISOString(),
          reservation_id: `temp-${paymentId}`,
          tickets_reserved: quantity
        },
        tickets_preview: {
          // NEW: Show what the tickets will look like
          tickets: bound_names.map((name, index) => ({
            ticket_number: index + 1,
            bound_name: name,
            ticket_title: `${event.event_name} Ticket #${index + 1} - ${name}`
          }))
        },
        next_steps: [
          'Complete payment through PayPal',
          'Return to app after payment',
          `${quantity} personalized tickets will be generated automatically`,
          'Each ticket will be bound to the specified name on blockchain'
        ]
      }
    });

  } catch (error) {
    console.error('Error initiating purchase:', error);
    return res.status(500).json({
      status: 'error',
      message: 'An error occurred while initiating purchase',
      error: error.message
    });
  }
}