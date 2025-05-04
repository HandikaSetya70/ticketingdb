import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
)

export default async function handler(req, res) {
  // Only allow DELETE requests
  if (req.method !== 'DELETE') {
    return res.status(405).json({ 
      status: 'error', 
      message: 'Method not allowed' 
    })
  }

  try {
    // Get the authorization header
    const authHeader = req.headers.authorization
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        status: 'error',
        message: 'Missing or invalid authorization header'
      })
    }

    const token = authHeader.split(' ')[1]
    
    // Verify the admin token and get user details
    const { data: { user }, error: authError } = await supabase.auth.getUser(token)
    
    if (authError || !user) {
      return res.status(401).json({
        status: 'error',
        message: 'Invalid or expired token'
      })
    }

    // Check if the user has admin role
    const { data: adminUser, error: adminError } = await supabase
      .from('users')
      .select('role')
      .eq('auth_id', user.id)
      .single()

    if (adminError || !adminUser || !['admin', 'super_admin'].includes(adminUser.role)) {
      return res.status(403).json({
        status: 'error',
        message: 'Unauthorized. Admin access required.'
      })
    }

    // Get event_id from query parameters
    const { event_id } = req.query

    // Validate required field
    if (!event_id) {
      return res.status(400).json({
        status: 'error',
        message: 'Missing required parameter: event_id'
      })
    }

    // Check if event exists
    const { data: existingEvent, error: fetchError } = await supabase
      .from('events')
      .select('*')
      .eq('event_id', event_id)
      .single()

    if (fetchError || !existingEvent) {
      return res.status(404).json({
        status: 'error',
        message: 'Event not found'
      })
    }

    // Check if there are any tickets associated with this event
    const { data: tickets, error: ticketsError } = await supabase
      .from('tickets')
      .select('ticket_id')
      .eq('event_id', event_id)
      .limit(1)

    if (!ticketsError && tickets && tickets.length > 0) {
      return res.status(400).json({
        status: 'error',
        message: 'Cannot delete event with existing tickets. Please handle tickets first.'
      })
    }

    // Delete the event
    const { error: deleteError } = await supabase
      .from('events')
      .delete()
      .eq('event_id', event_id)

    if (deleteError) {
      throw deleteError
    }

    return res.status(200).json({
      status: 'success',
      message: 'Event deleted successfully'
    })

  } catch (error) {
    console.error('Error deleting event:', error)
    return res.status(500).json({
      status: 'error',
      message: 'An error occurred while deleting the event',
      error: error.message
    })
  }
}