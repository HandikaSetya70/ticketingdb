// /api/payments/verify.js
// Payment verification endpoint for mobile app after PayPal return

import { createClient } from '@supabase/supabase-js';
import jwt from 'jsonwebtoken';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({
      status: 'error',
      message: 'Method not allowed'
    });
  }

  try {
    // Get user from token
    const token = req.headers.authorization?.replace('Bearer ', '');
    if (!token) {
      return res.status(401).json({
        status: 'error',
        message: 'Authentication token required'
      });
    }

    // Verify JWT token
    let userId;
    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      userId = decoded.sub || decoded.user_id;
    } catch (error) {
      return res.status(401).json({
        status: 'error',
        message: 'Invalid or expired token'
      });
    }

    // Extract query parameters
    const { payment_id, paypal_order_id } = req.query;

    if (!payment_id) {
      return res.status(400).json({
        status: 'error',
        message: 'payment_id parameter is required'
      });
    }

    // Get payment details
    const { data: payment, error: paymentError } = await supabase
      .from('payments')
      .select('*')
      .eq('payment_id', payment_id)
      .eq('user_id', userId) // Ensure user owns this payment
      .single();

    if (paymentError || !payment) {
      return res.status(404).json({
        status: 'error',
        message: 'Payment not found'
      });
    }

    // Verify PayPal order ID matches if provided
    if (paypal_order_id && payment.paypal_order_id !== paypal_order_id) {
      return res.status(400).json({
        status: 'error',
        message: 'PayPal order ID mismatch'
      });
    }

    // Check payment status
    let responseData = {
      payment_id: payment.payment_id,
      payment_status: payment.payment_status,
      total_amount: parseFloat(payment.amount),
      currency: 'USD',
      created_at: payment.created_at,
      paypal_order_id: payment.paypal_order_id,
      paypal_transaction_id: payment.paypal_transaction_id
    };

    if (payment.payment_status === 'confirmed') {
      // Get associated tickets
      const { data: tickets, error: ticketsError } = await supabase
        .from('tickets')
        .select(`
          ticket_id,
          ticket_number,
          qr_code_hash,
          blockchain_ticket_id,
          ticket_status,
          nft_token_id,
          events (
            event_name,
            event_date,
            venue,
            event_image_url
          )
        `)
        .eq('payment_id', payment_id)
        .order('ticket_number');

      if (ticketsError) {
        console.error('Error fetching tickets:', ticketsError);
      }

      // Generate QR codes (base64) for mobile app
      const ticketsWithQR = (tickets || []).map(ticket => ({
        ticket_id: ticket.ticket_id,
        ticket_number: ticket.ticket_number,
        ticket_status: ticket.ticket_status,
        qr_code: generateQRCode(ticket.qr_code_hash),
        qr_data: ticket.qr_code_hash,
        blockchain_ticket_id: ticket.blockchain_ticket_id,
        nft_token_id: ticket.nft_token_id,
        download_url: `${process.env.API_BASE_URL}/tickets/download/${ticket.ticket_id}`,
        event: ticket.events
      }));

      responseData = {
        ...responseData,
        tickets_ready: true,
        tickets_count: ticketsWithQR.length,
        tickets: ticketsWithQR,
        event_info: ticketsWithQR.length > 0 ? ticketsWithQR[0].event : null,
        receipt: {
          receipt_id: payment.payment_id,
          download_url: `${process.env.API_BASE_URL}/receipts/${payment.payment_id}.pdf`
        },
        push_notification: {
          title: '🎫 Tickets Ready!',
          body: `Your ${ticketsWithQR.length} ticket(s) are ready to view`,
          data: {
            type: 'tickets_ready',
            payment_id: payment.payment_id,
            tickets_count: ticketsWithQR.length
          }
        }
      };

    } else if (payment.payment_status === 'pending') {
      responseData = {
        ...responseData,
        tickets_ready: false,
        message: 'Payment is still being processed',
        estimated_completion: new Date(Date.now() + 5 * 60 * 1000).toISOString(), // 5 minutes
        retry_after: 30 // seconds
      };

    } else if (payment.payment_status === 'failed') {
      // If payment failed, restore ticket availability
      await restoreTicketAvailability(payment);

      responseData = {
        ...responseData,
        tickets_ready: false,
        message: 'Payment failed',
        error_details: 'Payment could not be processed',
        next_steps: [
          'Try purchasing again',
          'Check your PayPal account',
          'Contact support if issue persists'
        ]
      };
    }

    return res.status(200).json({
      status: 'success',
      message: 'Payment verification completed',
      data: responseData
    });

  } catch (error) {
    console.error('Error verifying payment:', error);
    return res.status(500).json({
      status: 'error',
      message: 'An error occurred while verifying payment',
      error: error.message
    });
  }
}

// Generate QR code as base64 for mobile app
function generateQRCode(qrData) {
  // This is a placeholder - you'll need to implement actual QR code generation
  // Using a library like 'qrcode' npm package
  
  // For now, return a data URL placeholder
  // In production, use: const QRCode = require('qrcode');
  // return await QRCode.toDataURL(qrData);
  
  return `data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==`;
}

// Restore ticket availability if payment failed
async function restoreTicketAvailability(payment) {
  try {
    // Calculate quantity from payment amount and event price
    const { data: event } = await supabase
      .from('events')
      .select('ticket_price, available_tickets')
      .eq('event_id', payment.event_id)
      .single();

    if (event) {
      const quantity = Math.round(parseFloat(payment.amount) / parseFloat(event.ticket_price));
      
      // Restore availability
      await supabase
        .from('events')
        .update({
          available_tickets: event.available_tickets + quantity
        })
        .eq('event_id', payment.event_id);

      console.log(`Restored ${quantity} tickets for failed payment ${payment.payment_id}`);
    }
  } catch (error) {
    console.error('Failed to restore ticket availability:', error);
  }
}