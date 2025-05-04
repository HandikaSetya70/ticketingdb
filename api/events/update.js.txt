import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
)

export default async function handler(req, res) {
  // Only allow PUT requests
  if (req.method !== 'PUT') {
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

    // Get the request data
    const { event_id, event_name, event_date, venue } = req.body

    // Validate required fields
    if (!event_id) {
      return res.status(400).json({
        status: 'error',
        message: 'Missing required field: event_id'
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

    // Prepare update data
    const updateData = {}
    if (event_name) updateData.event_name = event_name
    if (event_date) {
      // Validate event date format
      const eventDate = new Date(event_date)
      if (isNaN(eventDate.getTime())) {
        return res.status(400).json({
          status: 'error',
          message: 'Invalid date format'
        })
      }
      updateData.event_date = event_date
    }
    if (venue) updateData.venue = venue

    // Update the event
    const { data: updatedEvent, error: updateError } = await supabase
      .from('events')
      .update(updateData)
      .eq('event_id', event_id)
      .select()
      .single()

    if (updateError) {
      throw updateError
    }

    return res.status(200).json({
      status: 'success',
      message: 'Event updated successfully',
      data: updatedEvent
    })

  } catch (error) {
    console.error('Error updating event:', error)
    return res.status(500).json({
      status: 'error',
      message: 'An error occurred while updating the event',
      error: error.message
    })
  }
}