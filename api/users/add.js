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
    const { id_number, id_name, dob, id_picture_url } = req.body

    // Validate required fields
    if (!id_number || !id_name || !dob || !id_picture_url) {
      return res.status(400).json({
        status: 'error',
        message: 'Missing required fields: id_number, id_name, dob, id_picture_url'
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

    // Create the user
    const { data: newUser, error: insertError } = await supabase
      .from('users')
      .insert([
        {
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

    if (insertError) {
      throw insertError
    }

    return res.status(201).json({
      status: 'success',
      message: 'User created successfully',
      data: newUser
    })

  } catch (error) {
    console.error('Error creating user:', error)
    return res.status(500).json({
      status: 'error',
      message: 'An error occurred while creating the user',
      error: error.message
    })
  }
}