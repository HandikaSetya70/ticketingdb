// /api/payments/paypal-webhook.js
// PayPal webhook handler for payment completion with detailed logging

import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

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

export default async function handler(req, res) {
  console.log('🚀 ============ WEBHOOK HANDLER STARTED ============');
  console.log('⏰ Timestamp:', new Date().toISOString());
  
  if (req.method !== 'POST') {
    console.log('❌ Invalid method:', req.method);
    return res.status(405).json({
      status: 'error',
      message: 'Method not allowed'
    });
  }

  try {
    console.log('🔍 ============ WEBHOOK PAYLOAD ANALYSIS ============');
    console.log('📦 Raw request body:', JSON.stringify(req.body, null, 2));
    console.log('🎣 Event type received:', req.body.event_type);

    // Import PayPal SDK dynamically (fixes ES modules issue)
    console.log('📚 ============ PAYPAL SDK INITIALIZATION ============');
    const paypalModule = await import('@paypal/checkout-server-sdk');
    const paypal = paypalModule.default || paypalModule;
    console.log('✅ PayPal SDK imported successfully');

    // Force sandbox environment for testing
    const environment = new paypal.core.SandboxEnvironment(
      process.env.PAYPAL_CLIENT_ID, 
      process.env.PAYPAL_CLIENT_SECRET
    );
    console.log('🏖️ Using PayPal Sandbox Environment');

    // Verify PayPal webhook signature (important for security)
    console.log('🔐 ============ WEBHOOK VERIFICATION ============');
    const isValid = await verifyPayPalWebhook(req);
    if (!isValid) {
      console.error('❌ Invalid webhook signature - REJECTING REQUEST');
      return res.status(401).json({
        status: 'error',
        message: 'Invalid webhook signature'
      });
    }
    console.log('✅ Webhook signature verified (or bypassed for testing)');

    const { event_type, resource } = req.body;
    console.log('📝 Event type:', event_type);

    // Only handle successful payment captures
    if (event_type !== 'PAYMENT.CAPTURE.COMPLETED') {
      console.log('⏭️ Skipping event type:', event_type, '- Only handling PAYMENT.CAPTURE.COMPLETED');
      return res.status(200).json({
        status: 'success',
        message: 'Event type not handled'
      });
    }

    console.log('🎯 ============ PAYMENT PROCESSING STARTED ============');
    const paypalOrderId = resource.supplementary_data?.related_ids?.order_id;
    const paypalTransactionId = resource.id;
    const capturedAmount = parseFloat(resource.purchase_units[0].amount.value);

    console.log('💰 Payment details extracted:');
    console.log('   📋 PayPal Order ID:', paypalOrderId);
    console.log('   🆔 Transaction ID:', paypalTransactionId);
    console.log('   💵 Captured Amount:', capturedAmount);

    // Find the payment record
    console.log('🔍 ============ DATABASE PAYMENT LOOKUP ============');
    console.log('🔍 Searching for payment with order ID:', paypalOrderId);
    
    const { data: payment, error: paymentError } = await supabase
      .from('payments')
      .select('*')
      .eq('paypal_order_id', paypalOrderId)
      .eq('payment_status', 'pending')
      .single();

    if (paymentError || !payment) {
      console.error('❌ CRITICAL ERROR: Payment not found in database');
      console.error('   🔍 Searched for order ID:', paypalOrderId);
      console.error('   📄 Database error:', paymentError);
      return res.status(404).json({
        status: 'error',
        message: 'Payment record not found'
      });
    }

    console.log('✅ Payment record found in database:');
    console.log('   🆔 Payment ID:', payment.payment_id);
    console.log('   👤 User ID:', payment.user_id);
    console.log('   🎫 Event ID:', payment.event_id);
    console.log('   💰 Database Amount:', payment.amount);
    console.log('   📊 Current Status:', payment.payment_status);

    // Verify amount matches
    console.log('🔍 ============ AMOUNT VERIFICATION ============');
    const amountDifference = Math.abs(capturedAmount - parseFloat(payment.amount));
    console.log('💵 PayPal Amount:', capturedAmount);
    console.log('💾 Database Amount:', parseFloat(payment.amount));
    console.log('📏 Difference:', amountDifference);
    
    if (amountDifference > 0.01) {
      console.error('❌ CRITICAL ERROR: Amount mismatch detected');
      console.error('   💵 PayPal:', capturedAmount);
      console.error('   💾 Database:', payment.amount);
      return res.status(400).json({
        status: 'error',
        message: 'Payment amount mismatch'
      });
    }
    console.log('✅ Amount verification passed');

    // Process payment and create tickets
    console.log('🎫 ============ TICKET CREATION PROCESS ============');
    await processPaymentManually(payment, paypalTransactionId);

    // Send push notification (if you have push notification setup)
    console.log('📱 ============ PUSH NOTIFICATION ============');
    await sendPaymentSuccessNotification(payment.user_id, payment.payment_id);

    console.log('🎉 ============ WEBHOOK PROCESSING COMPLETE ============');
    console.log('✅ All operations completed successfully');
    console.log('⏰ End timestamp:', new Date().toISOString());
    
    return res.status(200).json({
      status: 'success',
      message: 'Payment processed successfully'
    });

  } catch (error) {
    console.error('🔥 ============ CRITICAL WEBHOOK ERROR ============');
    console.error('❌ Error message:', error.message);
    console.error('📊 Error stack:', error.stack);
    console.error('⏰ Error timestamp:', new Date().toISOString());
    
    return res.status(500).json({
      status: 'error',
      message: 'Webhook processing failed',
      error: error.message
    });
  }
}

// Manual payment processing function with detailed logging
async function processPaymentManually(payment, paypalTransactionId) {
  try {
    console.log(`🎫 ============ PAYMENT PROCESSING: ${payment.payment_id} ============`);
    
    // Get event details to create tickets
    console.log('🎪 ============ EVENT LOOKUP ============');
    let event;
    
    if (payment.event_id) {
      console.log('✅ Event ID found in payment:', payment.event_id);
      
      const { data: eventData, error: eventError } = await supabase
        .from('events')
        .select('*')
        .eq('event_id', payment.event_id)
        .single();
        
      if (eventError) {
        console.error('❌ Event lookup failed:', eventError);
        throw new Error('Event not found for payment: ' + payment.event_id);
      }
      
      event = eventData;
      console.log('✅ Event found:');
      console.log('   🎭 Event Name:', event.event_name);
      console.log('   📅 Event Date:', event.event_date);
      console.log('   📍 Venue:', event.venue);
      console.log('   💰 Ticket Price:', event.ticket_price);
      
    } else {
      console.log('⚠️ No event_id in payment, attempting fallback search...');
      
      const { data: events, error: eventsError } = await supabase
        .from('events')
        .select('*')
        .gte('event_date', new Date().toISOString())
        .order('created_at', { ascending: false });
        
      if (eventsError || !events.length) {
        console.error('❌ No events found for fallback search');
        throw new Error('No events found to match payment amount');
      }
      
      console.log(`🔍 Found ${events.length} future events, searching for price match...`);
      
      const paymentAmount = parseFloat(payment.amount);
      event = events.find(e => {
        const ticketPrice = parseFloat(e.ticket_price);
        const quantity = paymentAmount / ticketPrice;
        const isMatch = Number.isInteger(quantity) && quantity > 0 && quantity <= 10;
        console.log(`   🎫 ${e.event_name}: $${ticketPrice} → ${quantity} tickets (${isMatch ? 'MATCH' : 'no match'})`);
        return isMatch;
      });
      
      if (!event) {
        console.error(`❌ No event found with matching ticket price for amount: $${paymentAmount}`);
        throw new Error(`No event found with ticket price that matches payment amount: $${paymentAmount}`);
      }
      
      console.log(`✅ Found matching event: ${event.event_name} (price: $${event.ticket_price})`);
    }

    // Calculate quantity based on payment amount
    console.log('📊 ============ QUANTITY CALCULATION ============');
    const quantity = Math.round(parseFloat(payment.amount) / parseFloat(event.ticket_price));
    console.log('💰 Payment Amount:', parseFloat(payment.amount));
    console.log('🎫 Ticket Price:', parseFloat(event.ticket_price));
    console.log('📊 Calculated Quantity:', quantity);
    console.log(`🎯 Creating ${quantity} tickets for event: ${event.event_name}`);

    // Update payment status first
    console.log('💾 ============ PAYMENT STATUS UPDATE ============');
    const { error: updateError } = await supabase
      .from('payments')
      .update({
        payment_status: 'confirmed',
        paypal_transaction_id: paypalTransactionId
      })
      .eq('payment_id', payment.payment_id);

    if (updateError) {
      console.error('❌ Failed to update payment status:', updateError);
      throw new Error('Failed to update payment status: ' + updateError.message);
    }
    console.log('✅ Payment status updated to "confirmed"');
    console.log('✅ PayPal transaction ID saved:', paypalTransactionId);

    // Create tickets with blockchain token IDs
    console.log('🎫 ============ TICKET GENERATION ============');
    const tickets = [];
    const tokenIds = [];
    
    console.log(`🔄 Generating ${quantity} individual tickets...`);
    
    for (let i = 1; i <= quantity; i++) {
      console.log(`🎫 ---- Generating Ticket ${i}/${quantity} ----`);
      
      const ticketId = crypto.randomUUID();
      console.log('   🆔 Ticket ID:', ticketId);
      
      const tokenId = generateTokenId(ticketId);
      console.log('   🔗 Blockchain Token ID:', tokenId);
      
      const blockchainTicketId = `TOKEN-${tokenId}`;
      console.log('   🏷️ Blockchain Ticket ID:', blockchainTicketId);
      
      const qrCodeHash = crypto.createHash('sha256')
        .update(`${ticketId}-${payment.payment_id}-${Date.now()}`)
        .digest('hex');
      console.log('   📱 QR Code Hash:', qrCodeHash);

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
        nft_contract_address: BLOCKCHAIN_CONFIG.contractAddress,
        nft_token_id: tokenId,
        nft_mint_status: 'pending',
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

      console.log('   👥 Parent/Child Info:');
      console.log('      🎫 Is Parent:', ticket.is_parent_ticket);
      console.log('      👪 Parent ID:', ticket.parent_ticket_id || 'N/A (this is parent)');

      tickets.push(ticket);
      tokenIds.push(tokenId);
      
      console.log(`   ✅ Ticket ${i} prepared successfully`);
    }

    // Insert tickets into database
    console.log('💾 ============ DATABASE INSERTION ============');
    console.log(`📝 Inserting ${tickets.length} tickets into database...`);
    
    const { error: ticketsError } = await supabase
      .from('tickets')
      .insert(tickets);

    if (ticketsError) {
      console.error('❌ CRITICAL ERROR: Failed to insert tickets into database');
      console.error('📄 Database error:', ticketsError);
      throw new Error('Failed to create tickets: ' + ticketsError.message);
    }
    
    console.log('✅ All tickets successfully inserted into database');
    tickets.forEach((ticket, index) => {
      console.log(`   🎫 Ticket ${index + 1}: ${ticket.ticket_id}`);
    });

    // Register tickets in blockchain
    console.log('🔗 ============ BLOCKCHAIN REGISTRATION ============');
    console.log(`⛓️ Attempting to register ${tokenIds.length} tickets on blockchain...`);
    
    const blockchainResult = await registerTicketsInBlockchain(tokenIds, tickets);

    if (blockchainResult.success) {
      console.log('✅ ============ BLOCKCHAIN SUCCESS ============');
      console.log('🔗 Transaction Hash:', blockchainResult.transactionHash);
      console.log('⛽ Gas Used:', blockchainResult.gasUsed);
      console.log('📦 Block Number:', blockchainResult.blockNumber);
      
      // Update tickets as blockchain-registered
      console.log('💾 Updating ticket NFT status to "minted"...');
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
      console.error('❌ ============ BLOCKCHAIN FAILURE ============');
      console.error('🔥 Error:', blockchainResult.error);
      console.error('⏰ Failed at:', blockchainResult.timestamp);
      
      // Update tickets with failed status but keep them valid in database
      console.log('💾 Updating ticket NFT status to "failed"...');
      await supabase
        .from('tickets')
        .update({ 
          nft_mint_status: 'failed',
          blockchain_registered: false,
          blockchain_error: blockchainResult.error
        })
        .in('ticket_id', tickets.map(t => t.ticket_id));
        
      console.log('⚠️ Tickets remain valid in database despite blockchain failure');
    }

    console.log('🎉 ============ PAYMENT PROCESSING COMPLETE ============');
    console.log(`✅ Successfully processed payment: ${payment.payment_id}`);
    console.log(`🎫 Created ${quantity} tickets for user: ${payment.user_id}`);
    console.log(`🎭 Event: ${event.event_name}`);
    console.log(`💰 Amount: $${payment.amount}`);

  } catch (error) {
    console.error('❌ ============ PAYMENT PROCESSING FAILED ============');
    console.error('🔥 Error in processPaymentManually:', error.message);
    console.error('📊 Error stack:', error.stack);
    throw error;
  }
}

// Register tickets in blockchain with detailed logging
async function registerTicketsInBlockchain(tokenIds, tickets) {
  try {
    console.log('🔗 ============ BLOCKCHAIN REGISTRATION DETAILS ============');
    
    // Import ethers dynamically
    const ethersModule = await import('ethers');
    const ethers = ethersModule.default || ethersModule;
    console.log('✅ Ethers.js imported successfully');

    if (!BLOCKCHAIN_CONFIG.privateKey || !BLOCKCHAIN_CONFIG.rpcUrl) {
      console.error('❌ Blockchain configuration missing:');
      console.error('   🔑 Private Key:', BLOCKCHAIN_CONFIG.privateKey ? 'SET' : 'MISSING');
      console.error('   🌐 RPC URL:', BLOCKCHAIN_CONFIG.rpcUrl ? 'SET' : 'MISSING');
      throw new Error('Blockchain configuration missing');
    }

    console.log('🔧 Blockchain Configuration:');
    console.log('   🌐 RPC URL:', BLOCKCHAIN_CONFIG.rpcUrl);
    console.log('   📋 Contract Address:', BLOCKCHAIN_CONFIG.contractAddress);
    console.log('   🌊 Network:', BLOCKCHAIN_CONFIG.network);
    console.log(`   🎫 Registering ${tokenIds.length} tokens:`, tokenIds);
    
    // Initialize blockchain provider and contract
    console.log('🔄 Initializing blockchain connection...');
    const blockchainProvider = new ethers.providers.JsonRpcProvider(BLOCKCHAIN_CONFIG.rpcUrl);
    const wallet = new ethers.Wallet(BLOCKCHAIN_CONFIG.privateKey, blockchainProvider);
    const contract = new ethers.Contract(BLOCKCHAIN_CONFIG.contractAddress, CONTRACT_ABI, wallet);
    
    console.log('👛 Wallet Address:', wallet.address);

    // Check if we have gas
    console.log('⛽ Checking wallet balance...');
    const balance = await wallet.getBalance();
    const balanceEth = ethers.utils.formatEther(balance);
    console.log(`💰 Wallet balance: ${balanceEth} ETH`);

    if (balance.lt(ethers.utils.parseEther('0.001'))) {
      console.error('❌ Insufficient gas for blockchain transaction');
      console.error(`   💰 Current: ${balanceEth} ETH`);
      console.error('   🎯 Required: 0.001 ETH minimum');
      throw new Error('Insufficient gas for blockchain transaction');
    }
    console.log('✅ Sufficient gas available');

    // Use batch registration for efficiency
    console.log('📝 Preparing blockchain transaction...');
    let transaction;
    if (tokenIds.length === 1) {
      console.log(`📝 Using single ticket registration for token: ${tokenIds[0]}`);
      transaction = await contract.registerTicket(tokenIds[0]);
    } else {
      console.log(`📝 Using batch registration for ${tokenIds.length} tokens`);
      transaction = await contract.batchRegisterTickets(tokenIds);
    }

    console.log(`⏳ Transaction sent to blockchain: ${transaction.hash}`);
    console.log('⏱️ Waiting for confirmation (max 2 minutes)...');
    
    // Wait for confirmation with timeout
    const receipt = await Promise.race([
      transaction.wait(2), // Wait for 2 confirmations
      new Promise((_, reject) => 
        setTimeout(() => reject(new Error('Transaction timeout after 2 minutes')), 120000)
      )
    ]);

    console.log('✅ ============ BLOCKCHAIN TRANSACTION CONFIRMED ============');
    console.log('🔗 Transaction Hash:', receipt.transactionHash);
    console.log('📦 Block Number:', receipt.blockNumber);
    console.log('⛽ Gas Used:', receipt.gasUsed.toString());
    console.log('🔴 Status:', receipt.status === 1 ? 'SUCCESS' : 'FAILED');

    // Verify registration for first ticket
    console.log('🔍 Verifying ticket registration...');
    const firstTokenStatus = await contract.getTicketStatus(tokenIds[0]);
    console.log('📊 First token status:', firstTokenStatus.toString());
    
    if (firstTokenStatus.toString() !== '1') {
      console.error('❌ Ticket registration verification failed');
      console.error('   📊 Expected status: 1 (registered)');
      console.error('   📊 Actual status:', firstTokenStatus.toString());
      throw new Error('Ticket registration verification failed');
    }
    console.log('✅ Ticket registration verified successfully');

    return {
      success: true,
      transactionHash: transaction.hash,
      gasUsed: receipt.gasUsed.toString(),
      blockNumber: receipt.blockNumber
    };

  } catch (error) {
    console.error('🔥 ============ BLOCKCHAIN REGISTRATION FAILED ============');
    console.error('❌ Error message:', error.message);
    console.error('📊 Error details:', error);
    
    return {
      success: false,
      error: error.message,
      timestamp: new Date().toISOString()
    };
  }
}

// Generate token ID for blockchain (convert UUID to uint256) with logging
function generateTokenId(ticketUuid) {
  try {
    console.log('🔢 Generating blockchain token ID...');
    console.log('   🎫 Input UUID:', ticketUuid);
    
    // Create deterministic hash from UUID
    const hash = crypto.createHash('sha256').update(ticketUuid).digest('hex');
    console.log('   🔐 SHA256 Hash:', hash);
    
    // For PostgreSQL bigint compatibility, use only first 15 hex characters (60 bits)
    const truncatedHash = hash.substring(0, 15);
    console.log('   ✂️ Truncated Hash (15 chars):', truncatedHash);
    
    // Convert to BigInt then to string
    const tokenId = BigInt('0x' + truncatedHash);
    const tokenIdString = tokenId.toString();
    console.log('   🔢 Final Token ID:', tokenIdString);
    
    return tokenIdString;
  } catch (error) {
    console.error('❌ Token ID generation failed:', error);
    
    // Fallback: use timestamp + random
    const timestamp = Date.now();
    const random = Math.floor(Math.random() * 1000);
    const fallbackId = (timestamp * 1000 + random).toString();
    console.log('🆘 Using fallback token ID:', fallbackId);
    
    return fallbackId;
  }
}

// Verify PayPal webhook signature with logging
async function verifyPayPalWebhook(req) {
  try {
    console.log('🔐 Verifying PayPal webhook signature...');
    
    const webhookId = process.env.PAYPAL_WEBHOOK_ID;
    const headers = req.headers;
    const body = JSON.stringify(req.body);

    console.log('📋 Webhook verification details:');
    console.log('   🆔 Webhook ID:', webhookId || 'NOT SET');
    console.log('   📝 Headers present:', Object.keys(headers));
    
    const expectedSignature = headers['paypal-transmission-sig'];
    
    if (!expectedSignature) {
      console.log('⚠️ No PayPal signature found in headers');
      console.log('🧪 Allowing for testing purposes');
      return true;
    }

    console.log('✅ PayPal signature found:', expectedSignature?.substring(0, 20) + '...');
    console.log('⚠️ Webhook signature verification skipped for testing');
    return true;

  } catch (error) {
    console.error('❌ Webhook verification failed:', error);
    return false;
  }
}

// Capture PayPal order function
async function capturePayPalOrder(paypal, environment, orderId) {
  try {
    console.log('🔄 ============ CAPTURING PAYPAL ORDER ============');
    console.log('   📋 Order ID to capture:', orderId);
    
    const client = new paypal.core.PayPalHttpClient(environment);
    const request = new paypal.orders.OrdersCaptureRequest(orderId);
    request.requestBody({});
    
    const response = await client.execute(request);
    const captureResponse = response.result;
    
    console.log('✅ PayPal capture response received');
    console.log('   📊 Status:', captureResponse.status);
    console.log('   🆔 Order ID:', captureResponse.id);
    
    if (captureResponse.status === 'COMPLETED') {
      const captureId = captureResponse.purchase_units[0].payments.captures[0].id;
      console.log('✅ Payment captured successfully');
      console.log('   🆔 Capture ID:', captureId);
      
      return {
        success: true,
        captureId: captureId,
        orderId: captureResponse.id
      };
    } else {
      console.error('❌ Payment capture failed with status:', captureResponse.status);
      return {
        success: false,
        error: `Capture failed with status: ${captureResponse.status}`
      };
    }
    
  } catch (error) {
    console.error('❌ PayPal capture error:', error.message);
    return {
      success: false,
      error: error.message
    };
  }
}

// Send push notification with logging
async function sendPaymentSuccessNotification(userId, paymentId) {
  try {
    console.log('📱 ============ PUSH NOTIFICATION PROCESS ============');
    console.log('👤 Looking up user for push notification...');
    console.log('   🆔 User ID:', userId);
    
    const { data: user, error } = await supabase
      .from('users')
      .select('push_token, id_name')
      .eq('user_id', userId)
      .single();

    if (error || !user?.push_token) {
      console.log('⚠️ No push token found for user:', userId);
      console.log('   📄 Database error:', error?.message || 'None');
      console.log('   🔑 Push token available:', !!user?.push_token);
      return;
    }

    console.log('✅ User found for push notification:');
    console.log('   👤 Name:', user.id_name);
    console.log('   📱 Has push token:', !!user.push_token);

    const notificationPayload = {
      title: '🎫 Payment Successful!',
      body: `Your tickets are ready to view`,
      data: {
        type: 'payment_success',
        payment_id: paymentId,
        deep_link: `ticketapp://tickets/${paymentId}`
      }
    };

    console.log('📬 Push notification payload prepared:');
    console.log('   📝 Title:', notificationPayload.title);
    console.log('   📝 Body:', notificationPayload.body);
    console.log('   🔗 Deep link:', notificationPayload.data.deep_link);
    console.log('⚠️ Push notification simulation (not actually sent)');

  } catch (error) {
    console.error('❌ Failed to send push notification:', error);
  }
}