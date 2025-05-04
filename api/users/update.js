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
    
    // Verify the token and get user details
    const { data: { user }, error: authError } = await supabase.auth.getUser(token)
    
    if (authError || !user) {
      return res.status(401).json({
        status: 'error',
        message: 'Invalid or expired token'
      })
    }

    // Get the authenticated user's profile
    const { data: userProfile, error: profileError } = await supabase
      .from('users')
      .select('user_id, role')
      .eq('auth_id', user.id)
      .single()

    if (profileError || !userProfile) {
      return res.status(404).json({
        status: 'error',
        message: 'User profile not found'
      })
    }

    const { user_id, id_name, dob, id_picture_url } = req.body

    // If user_id is provided, check if the user has permission to update
    let targetUserId = user_id || userProfile.user_id

    // Check if user is trying to update their own profile or is an admin
    if (targetUserId !== userProfile.user_id && 
        !['admin', 'super_admin'].includes(userProfile.role)) {
      return res.status(403).json({
        status: 'error',
        message: 'Unauthorized to update this user'
      })
    }

    // Prepare update data
    const updateData = {}
    if (id_name) updateData.id_name = id_name
    if (dob) updateData.dob = dob
    if (id_picture_url) updateData.id_picture_url = id_picture_url

    // Don't allow regular users to update certain fields
    if (!['admin', 'super_admin'].includes(userProfile.role)) {
      // Regular users cannot change their verification status or role
      delete updateData.verification_status
      delete updateData.role
      delete updateData.id_number // ID number should not be changeable
    }

    // Update the user
    const { data: updatedUser, error: updateError } = await supabase
      .from('users')
      .update(updateData)
      .eq('user_id', targetUserId)
      .select()
      .single()

    if (updateError) {
      throw updateError
    }

    return res.status(200).json({
      status: 'success',
      message: 'User updated successfully',
      data: updatedUser
    })

  } catch (error) {
    console.error('Error updating user:', error)
    return res.status(500).json({
      status: 'error',
      message: 'An error occurred while updating user data',
      error: error.message
    })
  }
}