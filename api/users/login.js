import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
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
    const { email, password } = req.body

    // Validate required fields
    if (!email || !password) {
      return res.status(400).json({
        status: 'error',
        message: 'Missing required fields: email, password'
      })
    }

    // Attempt to sign in with Supabase Auth
    const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
      email,
      password
    })

    if (authError) {
      return res.status(401).json({
        status: 'error',
        message: 'Invalid email or password'
      })
    }

    // Get the user's profile from the users table
    const { data: userProfile, error: profileError } = await supabase
      .from('users')
      .select('*')
      .eq('auth_id', authData.user.id)
      .single()

    if (profileError) {
      console.error('Error fetching user profile:', profileError)
      // User exists in auth but not in users table - might be a new user
      return res.status(200).json({
        status: 'success',
        message: 'Login successful',
        data: {
          user: authData.user,
          session: authData.session,
          profile: null
        }
      })
    }

    // Return the combined auth and profile data
    return res.status(200).json({
      status: 'success',
      message: 'Login successful',
      data: {
        user: authData.user,
        session: authData.session,
        profile: userProfile
      }
    })

  } catch (error) {
    console.error('Error during login:', error)
    return res.status(500).json({
      status: 'error',
      message: 'An error occurred during login',
      error: error.message
    })
  }
}