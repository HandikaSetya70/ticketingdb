import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
)

export default async function handler(req, res) {
  // Only allow POST requests
  if (req.method !== 'POST') {
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
    const { event_name, event_date, venue } = req.body

    // Validate required fields
    if (!event_name || !event_date || !venue) {
      return res.status(400).json({
        status: 'error',
        message: 'Missing required fields: event_name, event_date, venue'
      })
    }

    // Validate event date format and ensure it's in the future
    const eventDate = new Date(event_date)
    if (isNaN(eventDate.getTime())) {
      return res.status(400).json({
        status: 'error',
        message: 'Invalid date format'
      })
    }

    if (eventDate < new Date()) {
      return res.status(400).json({
        status: 'error',
        message: 'Event date must be in the future'
      })
    }

    // Create the event
    const { data: newEvent, error: createError } = await supabase
      .from('events')
      .insert([
        {
          event_name,
          event_date,
          venue
        }
      ])
      .select()
      .single()

    if (createError) {
      throw createError
    }

    return res.status(201).json({
      status: 'success',
      message: 'Event created successfully',
      data: newEvent
    })

  } catch (error) {
    console.error('Error creating event:', error)
    return res.status(500).json({
      status: 'error',
      message: 'An error occurred while creating the event',
      error: error.message
    })
  }
}