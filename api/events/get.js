import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY  // Using anon key for public access
)

export default async function handler(req, res) {
  // Set CORS headers
  res.setHeader('Access-Control-Allow-Origin', 'http://setya.fwh.is'); // Use '*' during testing, later restrict to your domain
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  // Handle OPTIONS preflight request
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // Only allow GET requests
  if (req.method !== 'GET') {
    return res.status(405).json({ 
      status: 'error', 
      message: 'Method not allowed' 
    })
  }

  try {
    // Get event_id from query parameters
    const { event_id } = req.query

    // Validate required parameter
    if (!event_id) {
      return res.status(400).json({
        status: 'error',
        message: 'Missing required parameter: event_id'
      })
    }

    // Fetch the event details
    const { data: event, error: fetchError } = await supabase
      .from('events')
      .select('*')
      .eq('event_id', event_id)
      .single()

    if (fetchError) {
      if (fetchError.code === 'PGRST116') {
        return res.status(404).json({
          status: 'error',
          message: 'Event not found'
        })
      }
      throw fetchError
    }

    // Optionally, get ticket availability information
    const { data: tickets, error: ticketsError } = await supabase
      .from('tickets')
      .select('ticket_id, ticket_status')
      .eq('event_id', event_id)

    let availability = null
    if (!ticketsError && tickets) {
      availability = {
        total_tickets: tickets.length,
        available_tickets: tickets.filter(t => t.ticket_status === 'valid').length,
        sold_tickets: tickets.length,
        revoked_tickets: tickets.filter(t => t.ticket_status === 'revoked').length
      }
    }

    return res.status(200).json({
      status: 'success',
      message: 'Event retrieved successfully',
      data: {
        ...event,
        availability
      }
    })

  } catch (error) {
    console.error('Error fetching event:', error)
    return res.status(500).json({
      status: 'error',
      message: 'An error occurred while fetching the event',
      error: error.message
    })
  }
}