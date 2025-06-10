// /api/tickets/buy.js
// Ticket purchase with Supabase Auth

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
    // Import PayPal SDK using dynamic import (this works based on debug results!)
    const paypalModule = await import('@paypal/checkout-server-sdk');
    const paypal = paypalModule.default || paypalModule;

    // Debug logging for ALL PayPal environment variables
    console.log('PayPal Environment Debug - ALL VARIABLES:', {
      NODE_ENV: process.env.NODE_ENV,
      // PayPal credentials
      PAYPAL_CLIENT_ID: process.env.PAYPAL_CLIENT_ID || 'NOT_SET',
      PAYPAL_CLIENT_SECRET: process.env.PAYPAL_CLIENT_SECRET || 'NOT_SET',
      PAYPAL_WEBHOOK_ID: process.env.PAYPAL_WEBHOOK_ID || 'NOT_SET',
      // App configuration
      APP_SCHEME: process.env.APP_SCHEME || 'NOT_SET',
      // Supabase (for reference)
      SUPABASE_URL: process.env.SUPABASE_URL || 'NOT_SET',
      SUPABASE_SERVICE_KEY: process.env.SUPABASE_SERVICE_KEY ? 'SET (length: ' + process.env.SUPABASE_SERVICE_KEY.length + ')' : 'NOT_SET',
      // Other potential PayPal vars
      PAYPAL_ENVIRONMENT: process.env.PAYPAL_ENVIRONMENT || 'NOT_SET',
      PAYPAL_MODE: process.env.PAYPAL_MODE || 'NOT_SET',
      PAYPAL_SANDBOX_CLIENT_ID: process.env.PAYPAL_SANDBOX_CLIENT_ID || 'NOT_SET',
      PAYPAL_SANDBOX_CLIENT_SECRET: process.env.PAYPAL_SANDBOX_CLIENT_SECRET || 'NOT_SET',
      PAYPAL_LIVE_CLIENT_ID: process.env.PAYPAL_LIVE_CLIENT_ID || 'NOT_SET',
      PAYPAL_LIVE_CLIENT_SECRET: process.env.PAYPAL_LIVE_CLIENT_SECRET || 'NOT_SET',
      // Vercel specific
      VERCEL: process.env.VERCEL || 'NOT_SET',
      VERCEL_ENV: process.env.VERCEL_ENV || 'NOT_SET',
      VERCEL_URL: process.env.VERCEL_URL || 'NOT_SET'
    });

    // PayPal environment setup
    const environment = process.env.NODE_ENV === 'production' 
      ? new paypal.core.LiveEnvironment(process.env.PAYPAL_CLIENT_ID, process.env.PAYPAL_CLIENT_SECRET)
      : new paypal.core.SandboxEnvironment(process.env.PAYPAL_CLIENT_ID, process.env.PAYPAL_CLIENT_SECRET);

    const client = new paypal.core.PayPalHttpClient(environment);

    // 🔧 FIXED: Supabase Auth verification
    const token = req.headers.authorization?.replace('Bearer ', '');
    if (!token) {
      return res.status(401).json({
        status: 'error',
        message: 'Authentication token required'
      });
    }

    // ✅ PROPER: Verify Supabase Auth token
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

    // Extract request data
    const {
      event_id,
      quantity = 1,
      device_info = {}
    } = req.body;

    // Validate input
    if (!event_id) {
      return res.status(400).json({
        status: 'error',
        message: 'event_id is required'
      });
    }

    if (quantity < 1 || quantity > 10) {
      return res.status(400).json({
        status: 'error',
        message: 'Quantity must be between 1 and 10'
      });
    }

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

    // Create payment record - use userProfile.user_id (your internal user ID)
    const paymentId = crypto.randomUUID();
    const { data: payment, error: paymentError } = await supabase
      .from('payments')
      .insert({
        payment_id: paymentId,
        user_id: userProfile.user_id, // Use your internal user_id
        amount: totalAmount,
        payment_status: 'pending',
        payment_method: 'paypal',
        created_at: new Date().toISOString()
      })
      .select()
      .single();

    if (paymentError) {
      console.log('Payment creation error:', paymentError);
      throw new Error('Failed to create payment record');
    }

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
      
      throw new Error('Failed to reserve tickets');
    }

    console.log(`Reserved ${quantity} tickets for event ${event.event_name}`);

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
          custom_id: userProfile.user_id.toString() // Ensure it's a string
        }
      ],
      application_context: {
        brand_name: 'Ticketing System',
        user_action: 'PAY_NOW',
        return_url: `${process.env.APP_SCHEME || 'ticketapp'}://payment-success?payment_id=${paymentId}`,
        cancel_url: `${process.env.APP_SCHEME || 'ticketapp'}://payment-cancel?payment_id=${paymentId}`
      }
    };

    console.log('PayPal order payload:', JSON.stringify(orderPayload, null, 2));

    const request = new paypal.orders.OrdersCreateRequest();
    request.prefer('return=representation');
    request.requestBody(orderPayload);

    let paypalOrder;
    try {
      console.log('Creating PayPal order for amount:', totalAmount);
      console.log('PayPal SDK version info:', {
        hasOrdersCreateRequest: !!paypal.orders?.OrdersCreateRequest,
        hasCore: !!paypal.core,
        requestMethods: Object.getOwnPropertyNames(request)
      });
      
      const response = await client.execute(request);
      paypalOrder = response.result;
      console.log('PayPal order created successfully:', paypalOrder.id);
    } catch (paypalError) {
      console.log('PayPal error details:', {
        message: paypalError.message,
        statusCode: paypalError.statusCode,
        details: paypalError.details,
        stack: paypalError.stack,
        // Complete environment debug
        all_env_vars: {
          NODE_ENV: process.env.NODE_ENV,
          PAYPAL_CLIENT_ID: process.env.PAYPAL_CLIENT_ID,
          PAYPAL_CLIENT_SECRET: process.env.PAYPAL_CLIENT_SECRET,
          PAYPAL_WEBHOOK_ID: process.env.PAYPAL_WEBHOOK_ID,
          APP_SCHEME: process.env.APP_SCHEME,
          VERCEL_ENV: process.env.VERCEL_ENV,
          environment_type: process.env.NODE_ENV === 'production' ? 'Live' : 'Sandbox'
        }
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
    await supabase
      .from('payments')
      .update({
        paypal_order_id: paypalOrder.id
      })
      .eq('payment_id', paymentId);

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
          currency: 'USD'
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
        next_steps: [
          'Complete payment through PayPal',
          'Return to app after payment',
          'Tickets will be generated automatically'
        ]
      }
    });

  } catch (error) {
    console.error('Error initiating purchase:', error);
    return res.status(500).json({
      status: 'error',
      message: 'An error occurred while initiating purchase',
      error: error.message,
      // Add debug info to response for troubleshooting
      debug: {
        all_environment_variables: {
          NODE_ENV: process.env.NODE_ENV,
          PAYPAL_CLIENT_ID: process.env.PAYPAL_CLIENT_ID,
          PAYPAL_CLIENT_SECRET: process.env.PAYPAL_CLIENT_SECRET,
          PAYPAL_WEBHOOK_ID: process.env.PAYPAL_WEBHOOK_ID,
          APP_SCHEME: process.env.APP_SCHEME,
          SUPABASE_URL: process.env.SUPABASE_URL,
          VERCEL: process.env.VERCEL,
          VERCEL_ENV: process.env.VERCEL_ENV,
          VERCEL_URL: process.env.VERCEL_URL
        }
      }
    });
  }
}