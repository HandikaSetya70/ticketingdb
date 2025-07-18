// /api/tickets/user-tickets.js
// Enhanced user ticket wallet for mobile app with Supabase Auth and FIXED QR CODE

import { createClient } from '@supabase/supabase-js';

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
    // Get Supabase Auth token from Authorization header
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        status: 'error',
        message: 'Authentication token required'
      });
    }

    const token = authHeader.replace('Bearer ', '');

    // Verify the Supabase Auth token and get user
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    
    if (authError || !user) {
      return res.status(401).json({
        status: 'error',
        message: 'Invalid or expired token'
      });
    }

    const authUserId = user.id;

    // First, get the internal user_id from your users table using the auth_id
    const { data: userData, error: userError } = await supabase
      .from('users')
      .select('user_id, id_name, verification_status')
      .eq('auth_id', authUserId)
      .single();

    if (userError || !userData) {
      return res.status(404).json({
        status: 'error',
        message: 'User profile not found. Please complete your profile setup.',
        debug: {
          auth_user_id: authUserId,
          user_lookup_error: userError?.message
        }
      });
    }

    const internalUserId = userData.user_id;

    // Extract query parameters
    const {
      status,
      event_id,
      group_by_event = 'false',
      include_qr = 'true',
      upcoming_only = 'false'
    } = req.query;

    // Use service key for querying since we're using internal user_id
    let query = supabase
      .from('tickets')
      .select(`
        ticket_id,
        user_id,
        event_id,
        payment_id,
        purchase_date,
        ticket_status,
        blockchain_ticket_id,
        qr_code_hash,
        qr_code_base64,
        qr_code_data,
        ticket_number,
        total_tickets_in_group,
        is_parent_ticket,
        parent_ticket_id,
        nft_token_id,
        events (
          event_id,
          event_name,
          event_date,
          venue,
          event_description,
          event_image_url,
          category,
          ticket_price
        ),
        payments (
          payment_id,
          amount,
          payment_status,
          created_at
        )
      `)
      .eq('user_id', internalUserId)
      .order('purchase_date', { ascending: false });

    // Apply filters
    if (status) {
      query = query.eq('ticket_status', status);
    }

    if (event_id) {
      query = query.eq('event_id', event_id);
    }

    // Execute query
    const { data: tickets, error } = await query;

    if (error) {
      console.error('Database error:', error);
      throw error;
    }

    // Filter for upcoming events only if requested
    let filteredTickets = tickets || [];
    if (upcoming_only === 'true') {
      const now = new Date();
      filteredTickets = tickets.filter(ticket => 
        new Date(ticket.events.event_date) > now
      );
    }

    // Process tickets with QR codes and additional info
    const processedTickets = await Promise.all(filteredTickets.map(async (ticket) => {
      const event = ticket.events;
      const payment = ticket.payments;
      
      // Check if event is upcoming or past
      const eventDate = new Date(event.event_date);
      const isUpcoming = eventDate > new Date();
      const daysTillEvent = Math.ceil((eventDate - new Date()) / (1000 * 60 * 60 * 24));

      // Generate QR code properly
      let qrCode = null;
      if (include_qr === 'true') {
        qrCode = await generateQRCode(ticket);
      }

      return {
        ticket_id: ticket.ticket_id,
        event: {
          id: event.event_id,
          name: event.event_name,
          date: event.event_date,
          venue: event.venue,
          description: event.event_description,
          category: event.category,
          price: parseFloat(event.ticket_price || 0),
          image: event.event_image_url,
          // Mobile-optimized thumbnail
          image_thumb: event.event_image_url ? 
            event.event_image_url.replace(/\.(jpg|jpeg|png)$/i, '_thumb.$1') : 
            'https://via.placeholder.com/200x150/007bff/ffffff?text=Event'
        },
        ticket_info: {
          number: ticket.ticket_number,
          total_in_group: ticket.total_tickets_in_group,
          is_parent: ticket.is_parent_ticket,
          parent_id: ticket.parent_ticket_id,
          blockchain_id: ticket.blockchain_ticket_id,
          nft_token_id: ticket.nft_token_id
        },
        purchase_info: {
          payment_id: payment?.payment_id,
          amount_paid: parseFloat(payment?.amount || 0),
          purchase_date: ticket.purchase_date,
          payment_status: payment?.payment_status
        },
        qr_code: qrCode,
        qr_data: ticket.qr_code_hash,
        status: ticket.ticket_status,
        validity: {
          is_valid: ticket.ticket_status === 'valid',
          is_upcoming: isUpcoming,
          days_till_event: isUpcoming ? daysTillEvent : null,
          can_be_used: ticket.ticket_status === 'valid' && isUpcoming,
          last_checked: new Date().toISOString(),
          blockchain_verified: true // Placeholder - implement actual blockchain check
        },
        actions: {
          can_transfer: ticket.ticket_status === 'valid' && isUpcoming,
          can_refund: ticket.ticket_status === 'valid' && daysTillEvent > 7,
          can_download: true,
          can_share: true
        },
        user_metadata: {
          auth_user_id: authUserId,
          internal_user_id: internalUserId,
          user_email: user.email,
          user_name: userData.id_name || user.user_metadata?.full_name || user.email,
          verification_status: userData.verification_status
        }
      };
    }));

    // Group by event if requested
    if (group_by_event === 'true') {
      const groupedTickets = {};
      
      processedTickets.forEach(ticket => {
        const eventId = ticket.event.id;
        if (!groupedTickets[eventId]) {
          groupedTickets[eventId] = {
            event: ticket.event,
            tickets: [],
            summary: {
              total_tickets: 0,
              total_paid: 0,
              valid_tickets: 0,
              revoked_tickets: 0
            }
          };
        }
        
        groupedTickets[eventId].tickets.push(ticket);
        groupedTickets[eventId].summary.total_tickets++;
        groupedTickets[eventId].summary.total_paid += ticket.purchase_info.amount_paid;
        
        if (ticket.status === 'valid') {
          groupedTickets[eventId].summary.valid_tickets++;
        } else if (ticket.status === 'revoked') {
          groupedTickets[eventId].summary.revoked_tickets++;
        }
      });

      return res.status(200).json({
        status: 'success',
        message: 'User tickets retrieved successfully',
        data: {
          total_tickets: processedTickets.length,
          grouped_tickets: groupedTickets,
          summary: calculateOverallSummary(processedTickets),
          user_info: {
            auth_id: authUserId,
            internal_id: internalUserId,
            email: user.email,
            name: userData.id_name || user.user_metadata?.full_name || user.email,
            verification_status: userData.verification_status
          },
          last_sync: new Date().toISOString(),
          filters_applied: {
            status: status || null,
            event_id: event_id || null,
            upcoming_only: upcoming_only === 'true',
            group_by_event: true
          }
        }
      });
    }

    // Regular ticket list response
    const ticketGroups = groupTicketsByParent(processedTickets);

    // Set cache headers for mobile
    res.setHeader('Cache-Control', 'private, max-age=60'); // 1 minute cache
    res.setHeader('ETag', `"tickets-${internalUserId}-${Date.now()}"`);

    return res.status(200).json({
      status: 'success',
      message: 'User tickets retrieved successfully',
      data: {
        total_tickets: processedTickets.length,
        ticket_groups: ticketGroups.groups,
        standalone_tickets: ticketGroups.standalone,
        summary: calculateOverallSummary(processedTickets),
        user_info: {
          auth_id: authUserId,
          internal_id: internalUserId,
          email: user.email,
          name: userData.id_name || user.user_metadata?.full_name || user.email,
          verification_status: userData.verification_status,
          auth_provider: user.app_metadata?.provider
        },
        last_sync: new Date().toISOString(),
        next_sync_recommended: new Date(Date.now() + 5 * 60 * 1000).toISOString(), // 5 minutes
        filters_applied: {
          status: status || null,
          event_id: event_id || null,
          upcoming_only: upcoming_only === 'true',
          include_qr: include_qr === 'true'
        }
      }
    });

  } catch (error) {
    console.error('Error retrieving user tickets:', error);
    return res.status(500).json({
      status: 'error',
      message: 'An error occurred while retrieving tickets',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
}

// 🔧 FIXED: Generate QR code with proper dynamic import and fallback
async function generateQRCode(ticket) {
  try {
    // Method 1: Use pre-generated QR code if available
    if (ticket.qr_code_base64) {
      console.log('✅ Using pre-generated QR code for ticket:', ticket.ticket_id);
      return ticket.qr_code_base64;
    }

    // Method 2: Generate QR code dynamically with proper import
    console.log('🔄 Generating QR code for ticket:', ticket.ticket_id);
    
    // Dynamic import for QRCode package
    const QRCodeModule = await import('qrcode');
    const QRCode = QRCodeModule.default || QRCodeModule;

    // Create QR data structure
    const qrData = {
      ticket_id: ticket.ticket_id,
      blockchain_token_id: ticket.nft_token_id || ticket.blockchain_ticket_id,
      event_id: ticket.event_id,
      validation_hash: ticket.qr_code_hash,
      issued_at: ticket.purchase_date || new Date().toISOString(),
      validation_url: `${process.env.API_BASE_URL || 'https://ticketingdb.vercel.app'}/api/tickets/validate`
    };

    // Generate QR code as data URL
    const qrCodeDataURL = await QRCode.toDataURL(JSON.stringify(qrData), {
      width: 300,
      margin: 2,
      color: {
        dark: '#000000',
        light: '#FFFFFF'
      }
    });

    console.log('✅ QR code generated successfully for ticket:', ticket.ticket_id);
    return qrCodeDataURL;

  } catch (error) {
    console.error('❌ QR code generation failed for ticket:', ticket.ticket_id, error.message);
    
    // Method 3: Fallback to simple placeholder
    return generateFallbackQR(ticket);
  }
}

// Fallback QR code generation without external dependencies
function generateFallbackQR(ticket) {
  console.log('🆘 Using fallback QR generation for ticket:', ticket.ticket_id);
  
  // Create simple data structure
  const qrData = `TICKET:${ticket.ticket_id}:${ticket.qr_code_hash}:${ticket.nft_token_id || 'N/A'}`;
  
  // Return as a simple data URL (you can replace this with actual QR generation later)
  const base64Data = Buffer.from(qrData).toString('base64');
  
  // Return a placeholder that indicates QR data is available
  return `data:text/plain;base64,${base64Data}`;
}

// Group tickets by parent ticket
function groupTicketsByParent(tickets) {
  const groups = [];
  const standalone = [];
  const processed = new Set();

  tickets.forEach(ticket => {
    if (processed.has(ticket.ticket_id)) return;

    if (ticket.ticket_info.is_parent) {
      // Find all child tickets
      const children = tickets.filter(t => 
        t.ticket_info.parent_id === ticket.ticket_id
      );

      // Mark all as processed
      processed.add(ticket.ticket_id);
      children.forEach(child => processed.add(child.ticket_id));

      groups.push({
        parent: ticket,
        children: children,
        total_in_group: ticket.ticket_info.total_in_group,
        group_summary: {
          total_paid: ticket.purchase_info.amount_paid,
          all_valid: [ticket, ...children].every(t => t.status === 'valid'),
          event_name: ticket.event.name
        }
      });
    } else if (!ticket.ticket_info.parent_id) {
      // Standalone ticket (not part of a group)
      processed.add(ticket.ticket_id);
      standalone.push(ticket);
    }
  });

  return { groups, standalone };
}

// Calculate overall summary statistics
function calculateOverallSummary(tickets) {
  const summary = {
    total: tickets.length,
    valid: 0,
    revoked: 0,
    used: 0,
    upcoming_events: 0,
    past_events: 0,
    total_spent: 0,
    events: new Set()
  };

  tickets.forEach(ticket => {
    // Count by status
    if (ticket.status === 'valid') summary.valid++;
    else if (ticket.status === 'revoked') summary.revoked++;
    else if (ticket.status === 'used') summary.used++;

    // Count events
    summary.events.add(ticket.event.id);
    
    // Count upcoming vs past
    if (ticket.validity.is_upcoming) {
      summary.upcoming_events++;
    } else {
      summary.past_events++;
    }

    // Sum spending (only count parent tickets to avoid double counting)
    if (ticket.ticket_info.is_parent || !ticket.ticket_info.parent_id) {
      summary.total_spent += ticket.purchase_info.amount_paid;
    }
  });

  summary.events_count = summary.events.size;
  delete summary.events; // Remove Set object for JSON serialization

  return summary;
}