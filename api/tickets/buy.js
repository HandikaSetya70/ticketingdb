// /api/tickets/buy.js
// Ticket purchase with Supabase Auth

import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const paypal = require('@paypal/checkout-server-sdk');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

// PayPal environment setup
const environment = process.env.NODE_ENV === 'production' 
  ? new paypal.core.LiveEnvironment(process.env.PAYPAL_CLIENT_ID, process.env.PAYPAL_CLIENT_SECRET)
  : new paypal.core.SandboxEnvironment(process.env.PAYPAL_CLIENT_ID, process.env.PAYPAL_CLIENT_SECRET);

const client = new paypal.core.PayPalHttpClient(environment);

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({
      status: 'error',
      message: 'Method not allowed'
    });
  }

  try {
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

    // Create PayPal order
    const request = new paypal.orders.OrdersCreateRequest();
    request.prefer('return=representation');
    request.requestBody({
      intent: 'CAPTURE',
      purchase_units: [
        {
          reference_id: paymentId,
          amount: {
            currency_code: 'USD',
            value: totalAmount.toFixed(2)
          },
          description: `${quantity} ticket(s) for ${event.event_name}`,
          custom_id: userProfile.user_id // Your internal user ID for tracking
        }
      ],
      application_context: {
        brand_name: 'Ticketing System',
        user_action: 'PAY_NOW',
        return_url: `${process.env.APP_SCHEME || 'ticketapp'}://payment-success?payment_id=${paymentId}`,
        cancel_url: `${process.env.APP_SCHEME || 'ticketapp'}://payment-cancel?payment_id=${paymentId}`
      }
    });

    let paypalOrder;
    try {
      console.log('Creating PayPal order for amount:', totalAmount);
      const response = await client.execute(request);
      paypalOrder = response.result;
      console.log('PayPal order created:', paypalOrder.id);
    } catch (paypalError) {
      console.log('PayPal error:', paypalError);
      
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
      error: error.message
    });
  }
}