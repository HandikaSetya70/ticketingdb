export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ status: 'error', message: 'Method not allowed' });
  }

  const { qr_data, scanner_info } = req.body;
  
  try {
    // Parse QR data
    const ticketData = JSON.parse(qr_data);
    const { ticket_id, validation_hash, blockchain_token_id } = ticketData;
    
    // 1. Database validation
    const { data: ticket } = await supabase
      .from('tickets')
      .select('*, events(*)')
      .eq('ticket_id', ticket_id)
      .single();
    
    if (!ticket) {
      return res.status(404).json({
        status: 'error',
        validation_result: 'invalid',
        message: 'Ticket not found'
      });
    }
    
    // 2. Blockchain validation
    const blockchainStatus = await validateTicketOnBlockchain(blockchain_token_id);
    
    // 3. Combined validation result
    const isValid = ticket.ticket_status === 'valid' && 
                   blockchainStatus.is_valid && 
                   !blockchainStatus.is_revoked;
    
    // 4. Log validation attempt
    await logValidationAttempt(ticket_id, scanner_info, isValid);
    
    return res.status(200).json({
      status: 'success',
      validation_result: isValid ? 'valid' : 'invalid',
      ticket_info: {
        ticket_number: ticket.ticket_number,
        event_name: ticket.events.event_name,
        holder_name: "User Name", // Get from user table
        entry_type: "General Admission"
      },
      blockchain_status: blockchainStatus,
      ui_feedback: {
        color: isValid ? "green" : "red",
        message: isValid ? "✅ VALID - Allow Entry" : "🚫 INVALID - Entry Denied",
        sound: isValid ? "success_beep" : "error_beep"
      }
    });
    
  } catch (error) {
    return res.status(400).json({
      status: 'error',
      validation_result: 'error',
      message: 'Invalid QR code format'
    });
  }
}

async function validateTicketOnBlockchain(tokenId) {
  // Connect to your TicketRevocationRegistry contract
  const contract = new ethers.Contract(
    BLOCKCHAIN_CONFIG.contractAddress,
    CONTRACT_ABI,
    provider
  );
  
  try {
    const status = await contract.getTicketStatus(tokenId);
    return {
      is_valid: status.toString() === '1', // VALID status
      is_revoked: status.toString() === '2', // REVOKED status
      contract_status: status.toString(),
      last_checked: new Date().toISOString()
    };
  } catch (error) {
    return {
      is_valid: false,
      is_revoked: false,
      error: error.message,
      last_checked: new Date().toISOString()
    };
  }
}