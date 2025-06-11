// /api/tickets/validate.js
// QR Code ticket validation endpoint for scanner app

import { createClient } from '@supabase/supabase-js';

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

// Contract ABI for ticket validation
const CONTRACT_ABI = [
  "function getTicketStatus(uint256 tokenId) external view returns (uint8)",
  "function isValidForEntry(uint256 tokenId) external view returns (bool)",
  "function isRevoked(uint256 tokenId) external view returns (bool)"
];

export default async function handler(req, res) {
  console.log('🎫 ============ TICKET VALIDATION REQUEST ============');
  console.log('⏰ Timestamp:', new Date().toISOString());
  
  if (req.method !== 'POST') {
    return res.status(405).json({
      status: 'error',
      message: 'Method not allowed'
    });
  }

  try {
    // Extract request data
    const { qr_data, scanner_info } = req.body;
    
    console.log('📦 Request payload:');
    console.log('   📱 QR Data length:', qr_data?.length || 0);
    console.log('   👤 Scanner Admin ID:', scanner_info?.admin_id);
    console.log('   📍 Location:', scanner_info?.location);
    console.log('   📱 Device ID:', scanner_info?.device_id);

    if (!qr_data) {
      return res.status(400).json({
        status: 'error',
        validation_result: 'error',
        message: 'QR data is required'
      });
    }

    if (!scanner_info?.admin_id) {
      return res.status(400).json({
        status: 'error',
        validation_result: 'error',
        message: 'Scanner admin ID is required'
      });
    }

    // Parse QR data
    console.log('🔍 ============ QR DATA PARSING ============');
    let ticketData;
    
    try {
      // Try to parse as JSON first (new format)
      ticketData = JSON.parse(qr_data);
      console.log('✅ QR data parsed as JSON:');
      console.log('   🎫 Ticket ID:', ticketData.ticket_id);
      console.log('   🔗 Blockchain Token ID:', ticketData.blockchain_token_id);
      console.log('   🎭 Event ID:', ticketData.event_id);
      console.log('   🔐 Validation Hash:', ticketData.validation_hash);
      
    } catch (parseError) {
      // Try simple format: "TICKET:uuid:hash:token_id"
      console.log('⚠️ JSON parse failed, trying simple format...');
      const parts = qr_data.split(':');
      
      if (parts.length >= 3 && parts[0] === 'TICKET') {
        ticketData = {
          ticket_id: parts[1],
          validation_hash: parts[2],
          blockchain_token_id: parts[3] || null
        };
        console.log('✅ QR data parsed as simple format:');
        console.log('   🎫 Ticket ID:', ticketData.ticket_id);
        console.log('   🔐 Validation Hash:', ticketData.validation_hash);
      } else {
        console.error('❌ Invalid QR code format');
        return res.status(400).json({
          status: 'error',
          validation_result: 'invalid',
          message: 'Invalid QR code format',
          ui_feedback: {
            color: "red",
            message: "🚫 INVALID QR CODE",
            sound: "error_beep"
          }
        });
      }
    }

    const { ticket_id, blockchain_token_id, validation_hash, event_id } = ticketData;

    if (!ticket_id) {
      return res.status(400).json({
        status: 'error',
        validation_result: 'invalid',
        message: 'Ticket ID not found in QR code'
      });
    }

    // 1. DATABASE VALIDATION
    console.log('💾 ============ DATABASE VALIDATION ============');
    console.log('🔍 Looking up ticket in database:', ticket_id);
    
    const { data: ticket, error: ticketError } = await supabase
      .from('tickets')
      .select(`
        *,
        events (
          event_id,
          event_name,
          event_date,
          venue
        ),
        users (
          user_id,
          id_name,
          verification_status
        )
      `)
      .eq('ticket_id', ticket_id)
      .single();

    if (ticketError || !ticket) {
      console.error('❌ Ticket not found in database:', ticketError?.message);
      await logValidationAttempt(ticket_id, scanner_info, 'invalid', 'Ticket not found');
      
      return res.status(404).json({
        status: 'error',
        validation_result: 'invalid',
        message: 'Ticket not found in database',
        ui_feedback: {
          color: "red",
          message: "🚫 TICKET NOT FOUND",
          sound: "error_beep"
        }
      });
    }

    console.log('✅ Ticket found in database:');
    console.log('   🎫 Ticket Number:', ticket.ticket_number);
    console.log('   📊 Status:', ticket.ticket_status);
    console.log('   🎭 Event:', ticket.events?.event_name);
    console.log('   👤 Holder:', ticket.users?.id_name);

    // Check if ticket is already revoked in database
    if (ticket.ticket_status === 'revoked') {
      console.log('❌ Ticket is revoked in database');
      await logValidationAttempt(ticket_id, scanner_info, 'revoked', 'Ticket revoked in database');
      
      return res.status(200).json({
        status: 'error',
        validation_result: 'revoked',
        message: 'Ticket has been revoked',
        ticket_info: {
          ticket_number: ticket.ticket_number,
          event_name: ticket.events?.event_name || 'Unknown Event',
          holder_name: ticket.users?.id_name || 'Unknown',
          entry_type: 'Revoked'
        },
        ui_feedback: {
          color: "red",
          message: "🚫 REVOKED TICKET",
          sound: "error_beep"
        }
      });
    }

    // Check if event has passed
    const eventDate = new Date(ticket.events?.event_date);
    const now = new Date();
    const eventHasPassed = eventDate < now;
    
    console.log('📅 Event date check:');
    console.log('   📅 Event Date:', eventDate.toISOString());
    console.log('   ⏰ Current Time:', now.toISOString());
    console.log('   ⏳ Event has passed:', eventHasPassed);

    // 2. BLOCKCHAIN VALIDATION
    console.log('🔗 ============ BLOCKCHAIN VALIDATION ============');
    let blockchainStatus = {
      is_revoked: false,
      contract_status: 1,
      last_checked: new Date().toISOString(),
      contract_verified: false,
      error: null
    };

    if (blockchain_token_id || ticket.nft_token_id) {
      const tokenId = blockchain_token_id || ticket.nft_token_id;
      console.log('🔍 Checking blockchain status for token:', tokenId);
      
      blockchainStatus = await validateTicketOnBlockchain(tokenId);
      console.log('📊 Blockchain validation result:');
      console.log('   ✅ Contract Verified:', blockchainStatus.contract_verified);
      console.log('   📊 Status:', blockchainStatus.contract_status);
      console.log('   🚫 Is Revoked:', blockchainStatus.is_revoked);
    } else {
      console.log('⚠️ No blockchain token ID found, skipping blockchain validation');
    }

    // 3. COMBINED VALIDATION LOGIC
    console.log('🎯 ============ FINAL VALIDATION DECISION ============');
    
    let validationResult;
    let statusMessage;
    let uiFeedback;
    
    // Check if ticket is revoked on blockchain
    if (blockchainStatus.contract_verified && blockchainStatus.is_revoked) {
      console.log('❌ DECISION: Ticket revoked on blockchain');
      validationResult = 'revoked';
      statusMessage = 'Ticket revoked on blockchain';
      uiFeedback = {
        color: "red",
        message: "🚫 REVOKED (BLOCKCHAIN)",
        sound: "error_beep"
      };
    }
    // Check if database status is not valid
    else if (ticket.ticket_status !== 'valid') {
      console.log('❌ DECISION: Ticket not valid in database');
      validationResult = 'invalid';
      statusMessage = `Ticket status: ${ticket.ticket_status}`;
      uiFeedback = {
        color: "red",
        message: "🚫 INVALID STATUS",
        sound: "error_beep"
      };
    }
    // Check if event has passed (but allow within 1 hour after event)
    else if (eventHasPassed && (now.getTime() - eventDate.getTime()) > (60 * 60 * 1000)) {
      console.log('❌ DECISION: Event has passed (more than 1 hour ago)');
      validationResult = 'invalid';
      statusMessage = 'Event has already ended';
      uiFeedback = {
        color: "orange",
        message: "⏰ EVENT ENDED",
        sound: "error_beep"
      };
    }
    // All checks passed - ticket is valid
    else {
      console.log('✅ DECISION: Ticket is valid for entry');
      validationResult = 'valid';
      statusMessage = 'Ticket is valid for entry';
      uiFeedback = {
        color: "green",
        message: "✅ VALID - ALLOW ENTRY",
        sound: "success_beep"
      };
    }

    // 4. LOG VALIDATION ATTEMPT
    console.log('📝 ============ LOGGING VALIDATION ============');
    await logValidationAttempt(ticket_id, scanner_info, validationResult, statusMessage);

    // 5. RETURN VALIDATION RESULT
    console.log('📤 ============ SENDING RESPONSE ============');
    console.log('   📊 Result:', validationResult);
    console.log('   💬 Message:', statusMessage);
    
    const response = {
      status: 'success',
      validation_result: validationResult,
      message: statusMessage,
      ticket_info: {
        ticket_number: ticket.ticket_number,
        event_name: ticket.events?.event_name || 'Unknown Event',
        holder_name: ticket.users?.id_name || 'Unknown',
        entry_type: ticket.ticket_status === 'valid' ? 'General Admission' : ticket.ticket_status,
        event_date: ticket.events?.event_date,
        venue: ticket.events?.venue
      },
      blockchain_status: blockchainStatus,
      ui_feedback: uiFeedback,
      validation_details: {
        validated_at: new Date().toISOString(),
        validated_by: scanner_info.admin_id,
        location: scanner_info.location,
        device_id: scanner_info.device_id,
        database_status: ticket.ticket_status,
        blockchain_checked: blockchainStatus.contract_verified
      }
    };

    console.log('✅ Validation completed successfully');
    return res.status(200).json(response);

  } catch (error) {
    console.error('🔥 ============ VALIDATION ERROR ============');
    console.error('❌ Error message:', error.message);
    console.error('📊 Error stack:', error.stack);
    
    return res.status(500).json({
      status: 'error',
      validation_result: 'error',
      message: 'Validation service error',
      ui_feedback: {
        color: "gray",
        message: "⚠️ SYSTEM ERROR",
        sound: "error_beep"
      },
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
}

// Validate ticket on blockchain
async function validateTicketOnBlockchain(tokenId) {
  try {
    console.log('🔗 Connecting to blockchain...');
    
    // Import ethers dynamically
    const ethersModule = await import('ethers');
    const ethers = ethersModule.default || ethersModule;

    if (!BLOCKCHAIN_CONFIG.rpcUrl || !BLOCKCHAIN_CONFIG.contractAddress) {
      console.log('⚠️ Blockchain configuration missing, skipping validation');
      return {
        is_revoked: false,
        contract_status: 0,
        last_checked: new Date().toISOString(),
        contract_verified: false,
        error: 'Blockchain configuration missing'
      };
    }

    console.log('🌐 RPC URL:', BLOCKCHAIN_CONFIG.rpcUrl);
    console.log('📋 Contract:', BLOCKCHAIN_CONFIG.contractAddress);
    console.log('🎫 Token ID:', tokenId);

    // Initialize provider and contract
    const provider = new ethers.providers.JsonRpcProvider(BLOCKCHAIN_CONFIG.rpcUrl);
    const contract = new ethers.Contract(BLOCKCHAIN_CONFIG.contractAddress, CONTRACT_ABI, provider);

    // Get ticket status from contract
    console.log('📞 Calling contract.getTicketStatus...');
    const status = await contract.getTicketStatus(tokenId);
    const statusNumber = parseInt(status.toString());
    
    console.log('📊 Blockchain response:');
    console.log('   📊 Raw status:', status.toString());
    console.log('   📊 Status number:', statusNumber);
    console.log('   ✅ Valid (1):', statusNumber === 1);
    console.log('   🚫 Revoked (2):', statusNumber === 2);

    return {
      is_revoked: statusNumber === 2,
      is_valid: statusNumber === 1,
      contract_status: statusNumber,
      last_checked: new Date().toISOString(),
      contract_verified: true,
      error: null
    };

  } catch (error) {
    console.error('❌ Blockchain validation failed:', error.message);
    
    return {
      is_revoked: false,
      is_valid: false,
      contract_status: 0,
      last_checked: new Date().toISOString(),
      contract_verified: false,
      error: error.message
    };
  }
}

// Log validation attempt
async function logValidationAttempt(ticketId, scannerInfo, result, message) {
  try {
    console.log('📝 Logging validation attempt...');
    
    const { error } = await supabase
      .from('ticket_validation_log')
      .insert({
        ticket_id: ticketId,
        admin_id: scannerInfo.admin_id,
        validation_status: result,
        validation_method: 'qr_code',
        validated_at: new Date().toISOString(),
        location: scannerInfo.location,
        device_info: scannerInfo.device_id,
        notes: message
      });

    if (error) {
      console.error('❌ Failed to log validation:', error.message);
    } else {
      console.log('✅ Validation logged successfully');
    }
  } catch (error) {
    console.error('❌ Logging error:', error.message);
  }
}