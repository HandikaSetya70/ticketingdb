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
    const { email, password, id_number, id_name, dob, id_picture_url } = req.body

    // Validate required fields
    if (!email || !password || !id_number || !id_name || !dob || !id_picture_url) {
      return res.status(400).json({
        status: 'error',
        message: 'Missing required fields'
      })
    }

    // Check if user with this ID number already exists
    const { data: existingUser, error: checkError } = await supabase
      .from('users')
      .select('id_number')
      .eq('id_number', id_number)
      .single()

    if (existingUser) {
      return res.status(409).json({
        status: 'error',
        message: 'User with this ID number already exists'
      })
    }

    // Create auth user first
    const { data: authData, error: authError } = await supabase.auth.admin.createUser({
      email: email,
      password: password,
      email_confirm: true // Auto-confirm email
    })

    if (authError) {
      return res.status(400).json({
        status: 'error',
        message: 'Failed to create auth account',
        error: authError.message
      })
    }

    // Create user profile
    const { data: userProfile, error: profileError } = await supabase
      .from('users')
      .insert([
        {
          auth_id: authData.user.id,
          id_number,
          id_name,
          dob,
          id_picture_url,
          verification_status: 'pending',
          role: 'user'
        }
      ])
      .select()
      .single()

    if (profileError) {
      // If profile creation fails, we should ideally delete the auth user
      // But for now, we'll just return an error
      console.error('Failed to create user profile:', profileError)
      return res.status(500).json({
        status: 'error',
        message: 'Account created but profile creation failed',
        error: profileError.message
      })
    }

    return res.status(201).json({
      status: 'success',
      message: 'User registered successfully',
      data: {
        auth: {
          id: authData.user.id,
          email: authData.user.email
        },
        profile: userProfile
      }
    })

  } catch (error) {
    console.error('Error during registration:', error)
    return res.status(500).json({
      status: 'error',
      message: 'An error occurred during registration',
      error: error.message
    })
  }
}