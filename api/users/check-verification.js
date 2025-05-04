import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
)

export default async function handler(req, res) {
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

    // Get user profile with verification status
    const { data: userProfile, error: profileError } = await supabase
      .from('users')
      .select('user_id, verification_status, role')
      .eq('auth_id', user.id)
      .single()

    if (profileError || !userProfile) {
      return res.status(404).json({
        status: 'error',
        message: 'User profile not found'
      })
    }

    // Determine what actions the user can perform based on verification status
    const permissions = {
      can_purchase_tickets: userProfile.verification_status === 'approved',
      can_update_profile: true,
      can_view_events: true,
      is_admin: ['admin', 'super_admin'].includes(userProfile.role),
      is_verified: userProfile.verification_status === 'approved'
    }

    return res.status(200).json({
      status: 'success',
      message: 'Verification status retrieved',
      data: {
        user_id: userProfile.user_id,
        verification_status: userProfile.verification_status,
        role: userProfile.role,
        permissions
      }
    })

  } catch (error) {
    console.error('Error checking verification:', error)
    return res.status(500).json({
      status: 'error',
      message: 'An error occurred while checking verification status',
      error: error.message
    })
  }
}