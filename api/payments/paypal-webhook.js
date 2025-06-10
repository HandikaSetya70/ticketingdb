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

// Blockchain integration
const { ethers } = require('ethers');

// Blockchain configuration
const BLOCKCHAIN_CONFIG = {
  rpcUrl: process.env.ETHEREUM_RPC_URL || 'https://sepolia.infura.io/v3/' + process.env.INFURA_PROJECT_ID,
  contractAddress: process.env.REVOCATION_CONTRACT_ADDRESS || '0x86d22947cE0D2908eC0CAC78f7EC405f15cB9e50',
  privateKey: process.env.ADMIN_PRIVATE_KEY,
  network: 'sepolia'
};

// Contract ABI for ticket registration
const CONTRACT_ABI = [
  "function registerTicket(uint256 tokenId) external",
  "function batchRegisterTickets(uint256[] calldata tokenIds) external", 
  "function getTicketStatus(uint256 tokenId) external view returns (uint8)",
  "function owner() external view returns (address)"
];

// Initialize blockchain provider and contract
let blockchainProvider, contract;
try {
  blockchainProvider = new ethers.providers.JsonRpcProvider(BLOCKCHAIN_CONFIG.rpcUrl);
  const wallet = new ethers.Wallet(BLOCKCHAIN_CONFIG.privateKey, blockchainProvider);
  contract = new ethers.Contract(BLOCKCHAIN_CONFIG.contractAddress, CONTRACT_ABI, wallet);
} catch (error) {
  console.error('Blockchain initialization failed:', error.message);
}

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
    console.log(`🎫 Processing payment: ${payment.payment_id}`);
    
    // Get event details to create tickets
    const { data: event, error: eventError } = await supabase
      .from('events')
      .select('*')
      .eq('event_id', payment.event_id)
      .single();

    if (eventError) {
      throw new Error('Event not found for payment: ' + payment.event_id);
    }

    // Calculate quantity based on payment amount
    const quantity = Math.round(parseFloat(payment.amount) / parseFloat(event.ticket_price));
    console.log(`📊 Creating ${quantity} tickets for event: ${event.event_name}`);

    // Update payment status first
    const { error: updateError } = await supabase
      .from('payments')
      .update({
        payment_status: 'confirmed',
        paypal_transaction_id: paypalTransactionId,
        updated_at: new Date().toISOString()
      })
      .eq('payment_id', payment.payment_id);

    if (updateError) {
      throw new Error('Failed to update payment status: ' + updateError.message);
    }

    // Create tickets with blockchain token IDs
    const tickets = [];
    const tokenIds = []; // For blockchain registration
    
    for (let i = 1; i <= quantity; i++) {
      const ticketId = crypto.randomUUID();
      const tokenId = generateTokenId(ticketId); // Convert UUID to uint256
      const blockchainTicketId = `TOKEN-${tokenId}`;
      const qrCodeHash = crypto.createHash('sha256')
        .update(`${ticketId}-${payment.payment_id}-${Date.now()}`)
        .digest('hex');

      const ticket = {
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
        nft_contract_address: BLOCKCHAIN_CONFIG.contractAddress,
        nft_token_id: tokenId,
        nft_mint_status: 'pending', // Will update after blockchain registration
        nft_metadata: {
          name: `${event.event_name} Ticket #${i}`,
          description: `Ticket for ${event.event_name} at ${event.venue}`,
          image: `https://via.placeholder.com/400x600/007bff/ffffff?text=Ticket+${i}`,
          attributes: [
            { trait_type: 'Event', value: event.event_name },
            { trait_type: 'Venue', value: event.venue },
            { trait_type: 'Ticket Number', value: i },
            { trait_type: 'Total in Group', value: quantity },
            { trait_type: 'Network', value: BLOCKCHAIN_CONFIG.network }
          ]
        }
      };

      tickets.push(ticket);
      tokenIds.push(tokenId);
    }

    // Insert tickets into database
    console.log('💾 Inserting tickets into database...');
    const { error: ticketsError } = await supabase
      .from('tickets')
      .insert(tickets);

    if (ticketsError) {
      throw new Error('Failed to create tickets: ' + ticketsError.message);
    }

    // 🆕 Register tickets in blockchain
    console.log('🔗 Registering tickets in blockchain...');
    const blockchainResult = await registerTicketsInBlockchain(tokenIds, tickets);

    if (blockchainResult.success) {
      // Update tickets as blockchain-registered
      await supabase
        .from('tickets')
        .update({ 
          nft_mint_status: 'minted',
          blockchain_registered: true,
          blockchain_tx_hash: blockchainResult.transactionHash
        })
        .in('ticket_id', tickets.map(t => t.ticket_id));
        
      console.log(`✅ Successfully registered ${quantity} tickets in blockchain`);
    } else {
      console.error('❌ Blockchain registration failed:', blockchainResult.error);
      
      // Update tickets with failed status but keep them valid in database
      await supabase
        .from('tickets')
        .update({ 
          nft_mint_status: 'failed',
          blockchain_registered: false,
          blockchain_error: blockchainResult.error
        })
        .in('ticket_id', tickets.map(t => t.ticket_id));
    }

    console.log(`🎉 Payment processing complete for ${payment.payment_id}`);

  } catch (error) {
    console.error('❌ Manual payment processing failed:', error);
    throw error;
  }
}

// Register tickets in blockchain
async function registerTicketsInBlockchain(tokenIds, tickets) {
  try {
    if (!contract || !blockchainProvider) {
      throw new Error('Blockchain not initialized');
    }

    console.log(`🔗 Registering ${tokenIds.length} tickets in blockchain...`);
    
    // Check if we have gas
    const wallet = contract.signer;
    const balance = await wallet.getBalance();
    console.log(`💰 Wallet balance: ${ethers.utils.formatEther(balance)} ETH`);

    if (balance.lt(ethers.utils.parseEther('0.001'))) {
      throw new Error('Insufficient gas for blockchain transaction');
    }

    // Use batch registration for efficiency
    let transaction;
    if (tokenIds.length === 1) {
      console.log(`📝 Registering single ticket: ${tokenIds[0]}`);
      transaction = await contract.registerTicket(tokenIds[0]);
    } else {
      console.log(`📝 Batch registering ${tokenIds.length} tickets`);
      transaction = await contract.batchRegisterTickets(tokenIds);
    }

    console.log(`⏳ Transaction sent: ${transaction.hash}`);
    
    // Wait for confirmation with timeout
    const receipt = await Promise.race([
      transaction.wait(2), // Wait for 2 confirmations
      new Promise((_, reject) => 
        setTimeout(() => reject(new Error('Transaction timeout')), 120000) // 2 minute timeout
      )
    ]);

    console.log(`✅ Transaction confirmed! Gas used: ${receipt.gasUsed.toString()}`);

    // Verify registration for first ticket
    const firstTokenStatus = await contract.getTicketStatus(tokenIds[0]);
    if (firstTokenStatus.toString() !== '1') {
      throw new Error('Ticket registration verification failed');
    }

    return {
      success: true,
      transactionHash: transaction.hash,
      gasUsed: receipt.gasUsed.toString(),
      blockNumber: receipt.blockNumber
    };

  } catch (error) {
    console.error('🔥 Blockchain registration error:', error.message);
    
    return {
      success: false,
      error: error.message,
      timestamp: new Date().toISOString()
    };
  }
}

// Generate token ID for blockchain (convert UUID to uint256)
function generateTokenId(ticketUuid) {
  try {
    // Create deterministic hash from UUID
    const hash = crypto.createHash('sha256').update(ticketUuid).digest('hex');
    
    // Take first 32 characters (64 hex chars = 32 bytes = 256 bits)
    // But reduce to 31 characters to avoid overflow in uint256
    const truncatedHash = hash.substring(0, 62); // 31 bytes = 248 bits
    
    // Convert to BigInt then to string
    const tokenId = BigInt('0x' + truncatedHash);
    
    return tokenId.toString();
  } catch (error) {
    console.error('Token ID generation failed:', error);
    // Fallback: use timestamp + random
    return (Date.now() * 1000 + Math.floor(Math.random() * 1000)).toString();
  }
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

// Add database field for blockchain tracking
async function addBlockchainFieldsToTickets() {
  try {
    // This would be run as a migration
    await supabase.rpc('add_blockchain_fields_if_not_exists');
  } catch (error) {
    console.log('Blockchain fields might already exist:', error.message);
  }
}