// /api/payments/paypal-webhook.js
// PayPal webhook handler for payment completion

import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

// PayPal SDK for verification
const paypal = require('@paypal/checkout-server-sdk');

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
    // Verify PayPal webhook signature (important for security)
    const isValid = await verifyPayPalWebhook(req);
    if (!isValid) {
      return res.status(401).json({
        status: 'error',
        message: 'Invalid webhook signature'
      });
    }

    const { event_type, resource } = req.body;

    // Only handle successful payment captures
    if (event_type !== 'PAYMENT.CAPTURE.COMPLETED') {
      return res.status(200).json({
        status: 'success',
        message: 'Event type not handled'
      });
    }

    const paypalOrderId = resource.supplementary_data?.related_ids?.order_id;
    const paypalTransactionId = resource.id;
    const capturedAmount = parseFloat(resource.amount.value);

    // Find the payment record
    const { data: payment, error: paymentError } = await supabase
      .from('payments')
      .select('*')
      .eq('paypal_order_id', paypalOrderId)
      .eq('payment_status', 'pending')
      .single();

    if (paymentError || !payment) {
      console.error('Payment not found:', paypalOrderId);
      return res.status(404).json({
        status: 'error',
        message: 'Payment record not found'
      });
    }

    // Verify amount matches
    if (Math.abs(capturedAmount - parseFloat(payment.amount)) > 0.01) {
      console.error('Amount mismatch:', capturedAmount, payment.amount);
      return res.status(400).json({
        status: 'error',
        message: 'Payment amount mismatch'
      });
    }

    // Start transaction
    const { error: transactionError } = await supabase.rpc('process_successful_payment', {
      p_payment_id: payment.payment_id,
      p_paypal_transaction_id: paypalTransactionId,
      p_user_id: payment.user_id
    });

    if (transactionError) {
      console.error('Transaction processing failed:', transactionError);
      return res.status(500).json({
        status: 'error',
        message: 'Failed to process payment'
      });
    }

    // Alternative: Manual transaction if RPC doesn't work
    await processPaymentManually(payment, paypalTransactionId);

    // Send push notification (if you have push notification setup)
    await sendPaymentSuccessNotification(payment.user_id, payment.payment_id);

    return res.status(200).json({
      status: 'success',
      message: 'Payment processed successfully'
    });

  } catch (error) {
    console.error('Webhook processing error:', error);
    return res.status(500).json({
      status: 'error',
      message: 'Webhook processing failed',
      error: error.message
    });
  }
}

// Manual payment processing function
async function processPaymentManually(payment, paypalTransactionId) {
  try {
    // Get event details to create tickets
    const { data: event, error: eventError } = await supabase
      .from('events')
      .select('*')
      .eq('event_id', payment.event_id)
      .single();

    if (eventError) {
      throw new Error('Event not found');
    }

    // Calculate quantity based on payment amount
    const quantity = Math.round(parseFloat(payment.amount) / parseFloat(event.ticket_price));

    // Update payment status
    const { error: updateError } = await supabase
      .from('payments')
      .update({
        payment_status: 'confirmed',
        paypal_transaction_id: paypalTransactionId,
        updated_at: new Date().toISOString()
      })
      .eq('payment_id', payment.payment_id);

    if (updateError) {
      throw new Error('Failed to update payment status');
    }

    // Create tickets
    const tickets = [];
    for (let i = 1; i <= quantity; i++) {
      const ticketId = crypto.randomUUID();
      const blockchainTicketId = `TOKEN-${Date.now()}-${i}`;
      const qrCodeHash = crypto.createHash('sha256')
        .update(`${ticketId}-${payment.payment_id}-${Date.now()}`)
        .digest('hex');

      tickets.push({
        ticket_id: ticketId,
        user_id: payment.user_id,
        event_id: event.event_id,
        payment_id: payment.payment_id,
        purchase_date: new Date().toISOString(),
        ticket_status: 'valid',
        blockchain_ticket_id: blockchainTicketId,
        qr_code_hash: qrCodeHash,
        ticket_number: i,
        total_tickets_in_group: quantity,
        is_parent_ticket: i === 1,
        parent_ticket_id: i === 1 ? null : tickets[0]?.ticket_id || null,
        // NFT dummy data
        nft_contract_address: '0xC952865c8Caa9b06515A15AD9913F0eD75652A03',
        nft_token_id: generateTokenId(ticketId),
        nft_mint_status: 'minted',
        nft_metadata: {
          name: `${event.event_name} Ticket #${i}`,
          description: `Ticket for ${event.event_name} at ${event.venue}`,
          image: `https://via.placeholder.com/400x600/007bff/ffffff?text=Ticket+${i}`,
          attributes: [
            { trait_type: 'Event', value: event.event_name },
            { trait_type: 'Venue', value: event.venue },
            { trait_type: 'Ticket Number', value: i },
            { trait_type: 'Total in Group', value: quantity }
          ]
        }
      });
    }

    // Insert tickets
    const { error: ticketsError } = await supabase
      .from('tickets')
      .insert(tickets);

    if (ticketsError) {
      throw new Error('Failed to create tickets');
    }

    console.log(`Successfully created ${quantity} tickets for payment ${payment.payment_id}`);

  } catch (error) {
    console.error('Manual payment processing failed:', error);
    throw error;
  }
}

// Generate token ID for NFT mapping
function generateTokenId(ticketUuid) {
  const hash = crypto.createHash('sha256').update(ticketUuid).digest('hex');
  // Take first 15 characters and convert to bigint (to avoid overflow)
  return BigInt('0x' + hash.substring(0, 15)).toString();
}

// Verify PayPal webhook signature
async function verifyPayPalWebhook(req) {
  try {
    // Get webhook verification data from PayPal
    const webhookId = process.env.PAYPAL_WEBHOOK_ID;
    const headers = req.headers;
    const body = JSON.stringify(req.body);

    // PayPal signature verification logic
    // This is simplified - implement proper PayPal webhook verification
    const expectedSignature = headers['paypal-transmission-sig'];
    
    if (!expectedSignature) {
      return false;
    }

    // For demo purposes, return true
    // In production, implement proper PayPal webhook signature verification
    return true;

  } catch (error) {
    console.error('Webhook verification failed:', error);
    return false;
  }
}

// Send push notification for payment success
async function sendPaymentSuccessNotification(userId, paymentId) {
  try {
    // Get user's push tokens
    const { data: user, error } = await supabase
      .from('users')
      .select('push_token, id_name')
      .eq('user_id', userId)
      .single();

    if (error || !user?.push_token) {
      console.log('No push token found for user:', userId);
      return;
    }

    // Send push notification
    // Implementation depends on your push notification service (Firebase, etc.)
    const notificationPayload = {
      title: '🎫 Payment Successful!',
      body: `Your tickets are ready to view`,
      data: {
        type: 'payment_success',
        payment_id: paymentId,
        deep_link: `ticketapp://tickets/${paymentId}`
      }
    };

    console.log('Would send push notification:', notificationPayload);
    // await sendPushNotification(user.push_token, notificationPayload);

  } catch (error) {
    console.error('Failed to send push notification:', error);
  }
}