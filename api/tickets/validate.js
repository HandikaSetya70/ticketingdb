// /api/tickets/validate.js
// QR Code ticket validation endpoint for scanner app with bound names support

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

// Blockchain configuration - UPDATED CONTRACT ADDRESS
const BLOCKCHAIN_CONFIG = {
  rpcUrl: process.env.ETHEREUM_RPC_URL || 'https://sepolia.infura.io/v3/' + process.env.INFURA_PROJECT_ID,
  contractAddress: process.env.REVOCATION_CONTRACT_ADDRESS || '0x8d968bCA279E3d981A072e8E72591bf8424DbC1f', // NEW CONTRACT
  privateKey: process.env.ADMIN_PRIVATE_KEY,
  network: 'sepolia'
};

// UPDATED Contract ABI for ticket validation with bound names
const CONTRACT_ABI = [
  "function getTicketStatus(uint256 tokenId) external view returns (uint8)",
  "function isValidForEntry(uint256 tokenId) external view returns (bool)",
  "function isRevoked(uint256 tokenId) external view returns (bool)",
  "function getBoundName(uint256 tokenId) external view returns (string memory)" // NEW
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
      // Try to parse as JSON first (new format with bound names)
      ticketData = JSON.parse(qr_data);
      console.log('✅ QR data parsed as JSON:');
      console.log('   🎫 Ticket ID:', ticketData.ticket_id);
      console.log('   🔗 Blockchain Token ID:', ticketData.blockchain_token_id);
      console.log('   📝 Bound Name (QR):', ticketData.bound_name); // NEW
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
          blockchain_token_id: parts[3] || null,
          bound_name: parts[4] || null // NEW: bound name might be in position 4
        };
        console.log('✅ QR data parsed as simple format:');
        console.log('   🎫 Ticket ID:', ticketData.ticket_id);
        console.log('   🔐 Validation Hash:', ticketData.validation_hash);
        console.log('   📝 Bound Name (QR):', ticketData.bound_name);
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

    const { ticket_id, blockchain_token_id, validation_hash, event_id, bound_name: qr_bound_name } = ticketData;

    if (!ticket_id) {
      return res.status(400).json({
        status: 'error',
        validation_result: 'invalid',
        message: 'Ticket ID not found in QR code'
      });
    }

    // 1. DATABASE VALIDATION - NOW INCLUDES BOUND_NAME
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
    console.log('   📊 Database Status:', ticket.ticket_status);
    console.log('   📝 Database Bound Name:', ticket.bound_name); // NEW
    console.log('   🎭 Event:', ticket.events?.event_name);
    console.log('   👤 Holder:', ticket.users?.id_name);
    console.log('   ⛓️ Blockchain Registered:', ticket.blockchain_registered);
    console.log('   🔗 NFT Token ID:', ticket.nft_token_id);

    // Check if event has passed
    const eventDate = new Date(ticket.events?.event_date);
    const now = new Date();
    const eventHasPassed = eventDate < now;
    
    console.log('📅 Event date check:');
    console.log('   📅 Event Date:', eventDate.toISOString());
    console.log('   ⏰ Current Time:', now.toISOString());
    console.log('   ⏳ Event has passed:', eventHasPassed);

    // 2. BLOCKCHAIN VALIDATION WITH BOUND NAMES
    console.log('🔗 ============ BLOCKCHAIN VALIDATION ============');
    let blockchainStatus = {
        is_revoked: false,
        is_valid: false,
        contract_status: 0,
        bound_name: null, // NEW
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
        console.log('   🎫 Is Valid:', blockchainStatus.is_valid);
        console.log('   🚫 Is Revoked:', blockchainStatus.is_revoked);
        console.log('   📝 Blockchain Bound Name:', blockchainStatus.bound_name); // NEW
        console.log('   ❌ Error:', blockchainStatus.error || 'None');
    } else {
        console.log('⚠️ No blockchain token ID found, skipping blockchain validation');
    }

    // 3. BOUND NAME VERIFICATION
    console.log('📝 ============ BOUND NAME VERIFICATION ============');
    let boundNameVerification = {
        database_bound_name: ticket.bound_name || null,
        blockchain_bound_name: blockchainStatus.bound_name || null,
        qr_bound_name: qr_bound_name || null,
        names_match: false,
        verification_status: 'unknown'
    };

    // Check if bound names match across sources
    const dbName = boundNameVerification.database_bound_name;
    const bcName = boundNameVerification.blockchain_bound_name;
    const qrName = boundNameVerification.qr_bound_name;

    console.log('📝 Bound name comparison:');
    console.log('   💾 Database:', dbName || 'Not set');
    console.log('   🔗 Blockchain:', bcName || 'Not available');
    console.log('   📱 QR Code:', qrName || 'Not in QR');

    if (dbName && bcName) {
        // Both database and blockchain have names
        boundNameVerification.names_match = dbName === bcName;
        boundNameVerification.verification_status = boundNameVerification.names_match ? 'verified' : 'mismatch';
        console.log('   🔍 DB vs Blockchain match:', boundNameVerification.names_match);
    } else if (dbName && !bcName) {
        // Only database has name (blockchain verification failed or not registered)
        boundNameVerification.verification_status = 'database_only';
        console.log('   ⚠️ Only database has bound name');
    } else if (!dbName && !bcName) {
        // No bound names available (legacy ticket)
        boundNameVerification.verification_status = 'legacy_ticket';
        console.log('   📜 Legacy ticket without bound names');
    } else {
        // Only blockchain has name (unusual case)
        boundNameVerification.verification_status = 'blockchain_only';
        console.log('   🔗 Only blockchain has bound name');
    }

    // 4. COMBINED VALIDATION LOGIC (UPDATED WITH BOUND NAME CHECKS)
    console.log('🎯 ============ FINAL VALIDATION DECISION ============');
    
    let validationResult;
    let statusMessage;
    let uiFeedback;
    
    // Priority 1: Check blockchain revocation status (most authoritative)
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
    // Priority 2: Check database revocation status
    else if (ticket.ticket_status === 'revoked') {
        console.log('❌ DECISION: Ticket revoked in database');
        validationResult = 'revoked';
        statusMessage = 'Ticket revoked in database';
        uiFeedback = {
            color: "red",
            message: "🚫 REVOKED (DATABASE)",
            sound: "error_beep"
        };
    }
    // Priority 3: Check if blockchain shows invalid but database shows valid
    else if (blockchainStatus.contract_verified && !blockchainStatus.is_valid && blockchainStatus.contract_status === 0) {
        console.log('❌ DECISION: Ticket not registered on blockchain');
        validationResult = 'invalid';
        statusMessage = 'Ticket not found on blockchain';
        uiFeedback = {
            color: "orange",
            message: "⚠️ NOT ON BLOCKCHAIN",
            sound: "error_beep"
        };
    }
    // Priority 4: Check database status
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
    // Priority 5: Check if event has passed (allow 1 hour grace period)
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
    // NEW: Priority 6: Check bound name mismatch (warning level)
    else if (boundNameVerification.verification_status === 'mismatch') {
        console.log('⚠️ DECISION: Valid ticket but bound name mismatch detected');
        validationResult = 'valid_with_warning';
        statusMessage = 'Valid ticket - but bound name mismatch detected';
        uiFeedback = {
            color: "yellow",
            message: "✅ VALID ⚠️ NAME MISMATCH",
            sound: "warning_beep"
        };
    }
    // All checks passed - ticket is valid
    else {
        console.log('✅ DECISION: Ticket is valid for entry');
        
        // Additional check: warn if blockchain verification failed but database is valid
        const warningMessage = !blockchainStatus.contract_verified && ticket.blockchain_registered ? 
            ' (⚠️ Blockchain verification failed)' : '';
        
        validationResult = 'valid';
        statusMessage = 'Ticket is valid for entry' + warningMessage;
        uiFeedback = {
            color: "green",
            message: "✅ VALID - ALLOW ENTRY",
            sound: "success_beep"
        };
    }

    // 5. LOG VALIDATION ATTEMPT
    console.log('📝 ============ LOGGING VALIDATION ============');
    await logValidationAttempt(ticket_id, scanner_info, validationResult, statusMessage);

    // 6. RETURN VALIDATION RESULT WITH BOUND NAMES
    console.log('📤 ============ SENDING RESPONSE ============');
    console.log('   📊 Result:', validationResult);
    console.log('   💬 Message:', statusMessage);
    console.log('   📝 Primary Bound Name:', boundNameVerification.database_bound_name || boundNameVerification.blockchain_bound_name);
    
    const response = {
      status: 'success',
      validation_result: validationResult,
      message: statusMessage,
      ticket_info: {
        ticket_number: ticket.ticket_number,
        event_name: ticket.events?.event_name || 'Unknown Event',
        holder_name: ticket.users?.id_name || 'Unknown',
        bound_name: boundNameVerification.database_bound_name || boundNameVerification.blockchain_bound_name, // NEW: Primary bound name
        entry_type: ticket.ticket_status === 'valid' ? 'General Admission' : ticket.ticket_status,
        event_date: ticket.events?.event_date,
        venue: ticket.events?.venue
      },
      bound_name_verification: boundNameVerification, // NEW: Detailed bound name info
      blockchain_status: blockchainStatus,
      ui_feedback: uiFeedback,
      validation_details: {
        validated_at: new Date().toISOString(),
        validated_by: scanner_info.admin_id,
        location: scanner_info.location,
        device_id: scanner_info.device_id,
        database_status: ticket.ticket_status,
        blockchain_checked: blockchainStatus.contract_verified,
        blockchain_verified: blockchainStatus.contract_verified,
        ticket_exists_on_blockchain: blockchainStatus.is_valid || blockchainStatus.is_revoked,
        bound_name_status: boundNameVerification.verification_status // NEW
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

// UPDATED: Enhanced blockchain validation function with bound names
async function validateTicketOnBlockchain(tokenId) {
  try {
    console.log('🔗 ============ BLOCKCHAIN CONNECTION ============');
    
    // Import ethers dynamically
    const ethersModule = await import('ethers');
    const ethers = ethersModule.default || ethersModule;

    if (!BLOCKCHAIN_CONFIG.rpcUrl || !BLOCKCHAIN_CONFIG.contractAddress) {
      console.log('⚠️ Blockchain configuration missing, skipping validation');
      return {
        is_revoked: false,
        is_valid: false,
        contract_status: 0,
        bound_name: null,
        last_checked: new Date().toISOString(),
        contract_verified: false,
        error: 'Blockchain configuration missing'
      };
    }

    console.log('🌐 Blockchain configuration:');
    console.log('   🌐 RPC URL:', BLOCKCHAIN_CONFIG.rpcUrl);
    console.log('   📋 Contract:', BLOCKCHAIN_CONFIG.contractAddress);
    console.log('   🎫 Token ID:', tokenId);

    // Initialize provider and contract
    const provider = new ethers.providers.JsonRpcProvider(BLOCKCHAIN_CONFIG.rpcUrl);
    const contract = new ethers.Contract(BLOCKCHAIN_CONFIG.contractAddress, CONTRACT_ABI, provider);

    // Test contract connection first
    console.log('🔍 Testing contract connection...');
    
    // Get ticket status from contract with timeout
    console.log('📞 Calling contract.getTicketStatus...');
    const statusPromise = contract.getTicketStatus(tokenId);
    const timeoutPromise = new Promise((_, reject) => 
      setTimeout(() => reject(new Error('Blockchain call timeout after 10 seconds')), 10000)
    );
    
    const status = await Promise.race([statusPromise, timeoutPromise]);
    const statusNumber = parseInt(status.toString());
    
    console.log('📊 Blockchain response:');
    console.log('   📊 Raw status:', status.toString());
    console.log('   📊 Status number:', statusNumber);
    console.log('   ❌ Invalid (0):', statusNumber === 0);
    console.log('   ✅ Valid (1):', statusNumber === 1);
    console.log('   🚫 Revoked (2):', statusNumber === 2);

    // NEW: Get bound name from blockchain
    let boundName = null;
    try {
      if (statusNumber === 1 || statusNumber === 2) { // Only get bound name if ticket exists
        console.log('📞 Calling contract.getBoundName...');
        const boundNamePromise = contract.getBoundName(tokenId);
        const boundNameTimeout = new Promise((_, reject) => 
          setTimeout(() => reject(new Error('getBoundName timeout')), 5000)
        );
        
        boundName = await Promise.race([boundNamePromise, boundNameTimeout]);
        console.log('   📝 Blockchain bound name:', boundName || 'Empty');
      }
    } catch (boundNameError) {
      console.log('⚠️ Failed to get bound name from blockchain:', boundNameError.message);
      // Continue without bound name
    }

    // Additional verification calls
    let isValidForEntry = false;
    let isRevoked = false;
    
    try {
      console.log('🔍 Additional verification checks...');
      const validPromise = contract.isValidForEntry(tokenId);
      const revokedPromise = contract.isRevoked(tokenId);
      
      const validTimeout = new Promise((_, reject) => 
        setTimeout(() => reject(new Error('isValidForEntry timeout')), 5000)
      );
      const revokedTimeout = new Promise((_, reject) => 
        setTimeout(() => reject(new Error('isRevoked timeout')), 5000)
      );
      
      isValidForEntry = await Promise.race([validPromise, validTimeout]);
      isRevoked = await Promise.race([revokedPromise, revokedTimeout]);
      
      console.log('   🎫 isValidForEntry:', isValidForEntry);
      console.log('   🚫 isRevoked:', isRevoked);
      
    } catch (verifyError) {
      console.log('⚠️ Additional verification failed:', verifyError.message);
      // Continue with basic status check
    }

    // Cross-validate the results
    const expectedValid = statusNumber === 1;
    const expectedRevoked = statusNumber === 2;
    
    if (isValidForEntry !== undefined && isValidForEntry !== expectedValid) {
      console.log('⚠️ Status mismatch: getTicketStatus vs isValidForEntry');
    }
    
    if (isRevoked !== undefined && isRevoked !== expectedRevoked) {
      console.log('⚠️ Status mismatch: getTicketStatus vs isRevoked');
    }

    return {
      is_revoked: statusNumber === 2,
      is_valid: statusNumber === 1,
      contract_status: statusNumber,
      bound_name: boundName, // NEW: Include bound name from blockchain
      last_checked: new Date().toISOString(),
      contract_verified: true,
      error: null,
      additional_checks: {
        isValidForEntry: isValidForEntry,
        isRevoked: isRevoked
      }
    };

  } catch (error) {
    console.error('❌ ============ BLOCKCHAIN VALIDATION FAILED ============');
    console.error('❌ Error message:', error.message);
    console.error('❌ Error type:', error.code || 'Unknown');
    
    // Categorize error types
    let errorCategory = 'unknown';
    if (error.message.includes('timeout')) {
      errorCategory = 'timeout';
    } else if (error.message.includes('network')) {
      errorCategory = 'network';
    } else if (error.message.includes('revert')) {
      errorCategory = 'contract_revert';
    } else if (error.message.includes('gas')) {
      errorCategory = 'gas_error';
    }
    
    console.error('❌ Error category:', errorCategory);
    
    return {
      is_revoked: false,
      is_valid: false,
      contract_status: 0,
      bound_name: null, // NEW
      last_checked: new Date().toISOString(),
      contract_verified: false,
      error: error.message,
      error_category: errorCategory
    };
  }
}

// Enhanced validation logging
async function logValidationAttempt(ticketId, scannerInfo, result, message) {
  try {
    console.log('📝 ============ LOGGING VALIDATION ATTEMPT ============');
    console.log('   🎫 Ticket ID:', ticketId);
    console.log('   👤 Admin ID:', scannerInfo.admin_id);
    console.log('   📊 Result:', result);
    console.log('   📍 Location:', scannerInfo.location);
    console.log('   📱 Device:', scannerInfo.device_id);
    console.log('   💬 Message:', message);
    
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
    console.error('❌ Logging exception:', error.message);
    // Don't throw - logging failure shouldn't break validation
  }
}