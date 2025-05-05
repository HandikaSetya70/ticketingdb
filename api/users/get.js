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

  // Only allow GET requests
  if (req.method !== 'GET') {
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
    
    // Verify the token and get user details
    const { data: { user }, error: authError } = await supabase.auth.getUser(token)
    
    if (authError || !user) {
      return res.status(401).json({
        status: 'error',
        message: 'Invalid or expired token'
      })
    }

    // Get user_id from query parameters (for admin access) or use authenticated user's ID
    const { user_id } = req.query
    let targetUserId = user_id

    // If no user_id provided, return the authenticated user's own data
    if (!targetUserId) {
      const { data: ownProfile, error: ownProfileError } = await supabase
        .from('users')
        .select('*')
        .eq('auth_id', user.id)
        .single()

      if (ownProfileError || !ownProfile) {
        return res.status(404).json({
          status: 'error',
          message: 'User profile not found'
        })
      }

      return res.status(200).json({
        status: 'success',
        message: 'User profile retrieved successfully',
        data: ownProfile
      })
    }

    // If user_id is provided, check if the requester has permission
    // First, get the requester's profile to check their role
    const { data: requesterProfile, error: requesterError } = await supabase
      .from('users')
      .select('user_id, role')
      .eq('auth_id', user.id)
      .single()

    if (requesterError || !requesterProfile) {
      return res.status(403).json({
        status: 'error',
        message: 'Unauthorized access'
      })
    }

    // Check if requester is trying to access their own data or is an admin
    if (requesterProfile.user_id !== targetUserId && 
        !['admin', 'super_admin'].includes(requesterProfile.role)) {
      return res.status(403).json({
        status: 'error',
        message: 'Unauthorized access to user data'
      })
    }

    // Get the requested user's profile
    const { data: userProfile, error: profileError } = await supabase
      .from('users')
      .select('*')
      .eq('user_id', targetUserId)
      .single()

    if (profileError || !userProfile) {
      return res.status(404).json({
        status: 'error',
        message: 'User not found'
      })
    }

    return res.status(200).json({
      status: 'success',
      message: 'User profile retrieved successfully',
      data: userProfile
    })

  } catch (error) {
    console.error('Error fetching user:', error)
    return res.status(500).json({
      status: 'error',
      message: 'An error occurred while fetching user data',
      error: error.message
    })
  }
}