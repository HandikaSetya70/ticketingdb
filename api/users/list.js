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

    // Get query parameters for filtering
    const { 
      verification_status, 
      role, 
      sort = 'created_at', 
      order = 'desc',
      page = 1,
      limit = 50
    } = req.query

    // Calculate offset for pagination
    const offset = (parseInt(page) - 1) * parseInt(limit)

    // Build query
    let query = supabase
      .from('users')
      .select('*', { count: 'exact' })

    // Apply filters
    if (verification_status) {
      query = query.eq('verification_status', verification_status)
    }
    if (role) {
      query = query.eq('role', role)
    }

    // Apply sorting
    query = query.order(sort, { ascending: order === 'asc' })

    // Apply pagination
    query = query.range(offset, offset + parseInt(limit) - 1)

    // Execute query
    const { data: users, error: fetchError, count } = await query

    if (fetchError) {
      throw fetchError
    }

    // Calculate pagination info
    const totalPages = Math.ceil(count / parseInt(limit))
    const hasNextPage = parseInt(page) < totalPages
    const hasPrevPage = parseInt(page) > 1

    return res.status(200).json({
      status: 'success',
      message: 'Users retrieved successfully',
      data: {
        users,
        pagination: {
          total: count,
          page: parseInt(page),
          limit: parseInt(limit),
          totalPages,
          hasNextPage,
          hasPrevPage
        }
      }
    })

  } catch (error) {
    console.error('Error fetching users:', error)
    return res.status(500).json({
      status: 'error',
      message: 'An error occurred while fetching users',
      error: error.message
    })
  }
}