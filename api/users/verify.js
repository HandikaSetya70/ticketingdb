import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
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

    // Rest of your existing code remains the same
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
    const { user_id, status, comments } = req.body

    // Validate required fields
    if (!user_id || !status || !comments) {
      return res.status(400).json({
        status: 'error',
        message: 'Missing required fields: user_id, status, comments'
      })
    }

    // Validate status value
    if (!['approved', 'rejected'].includes(status)) {
      return res.status(400).json({
        status: 'error',
        message: 'Invalid status. Must be "approved" or "rejected"'
      })
    }

    // Start a transaction to update user and create verification record
    // First, update the user's verification status
    const { data: updatedUser, error: updateError } = await supabase
      .from('users')
      .update({ verification_status: status })
      .eq('user_id', user_id)
      .select()
      .single()

    if (updateError) {
      throw updateError
    }

    // Create verification record
    const { data: verificationRecord, error: verificationError } = await supabase
      .from('admin_verification_requests')
      .insert([
        {
          user_id,
          admin_id: user.id,
          status,
          comments
        }
      ])
      .select()
      .single()

    if (verificationError) {
      throw verificationError
    }

    return res.status(200).json({
      status: 'success',
      message: 'User verification completed',
      data: {
        user: updatedUser,
        verification: verificationRecord
      }
    })

  } catch (error) {
    console.error('Error verifying user:', error)
    return res.status(500).json({
      status: 'error',
      message: 'An error occurred while verifying the user',
      error: error.message
    })
  }
}