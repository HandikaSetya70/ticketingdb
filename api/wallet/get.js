import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
)

export default async function handler(req, res) {
  // Set CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
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
    });
  }

  try {
    // Get the authorization header
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        status: 'error',
        message: 'Missing or invalid authorization header'
      });
    }

    const token = authHeader.split(' ')[1];
    
    // Verify the token and get user details
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    
    if (authError || !user) {
      return res.status(401).json({
        status: 'error',
        message: 'Invalid or expired token'
      });
    }

    // Get the user's profile from the users table
    const { data: userProfile, error: profileError } = await supabase
      .from('users')
      .select('user_id, role')
      .eq('auth_id', user.id)
      .single();

    if (profileError || !userProfile) {
      return res.status(404).json({
        status: 'error',
        message: 'User profile not found'
      });
    }

    // Get user_id from query parameters (for admin access) or use authenticated user's ID
    const { user_id, wallet_id } = req.query;
    let targetUserId = user_id || userProfile.user_id;
    
    // If trying to access another user's wallet, check for admin permissions
    if (targetUserId !== userProfile.user_id && 
        !['admin', 'super_admin'].includes(userProfile.role)) {
      return res.status(403).json({
        status: 'error',
        message: 'Unauthorized access to wallet data'
      });
    }

    // Build query for wallet information
    let query = supabase
      .from('user_wallets')
      .select(`
        wallet_id,
        wallet_address,
        linked_at,
        expires_at,
        is_active
      `)
      .eq('user_id', targetUserId)
      .eq('is_active', true);
    
    // If a specific wallet_id is requested
    if (wallet_id) {
      query = query.eq('wallet_id', wallet_id);
    }

    // Execute the query
    const { data: wallets, error: walletsError } = await query;

    if (walletsError) {
      return res.status(500).json({
        status: 'error',
        message: 'Error retrieving wallet information',
        error: walletsError.message
      });
    }

    // If requesting a specific wallet that doesn't exist
    if (wallet_id && (!wallets || wallets.length === 0)) {
      return res.status(404).json({
        status: 'error',
        message: 'Wallet not found'
      });
    }

    // Format the response
    let responseData = wallet_id ? (wallets[0] || null) : wallets;

    // If detailed view is requested and there's at least one wallet
    const { detailed } = req.query;
    if (detailed === 'true' && responseData && (Array.isArray(responseData) ? responseData.length > 0 : responseData)) {
      let walletIds = Array.isArray(responseData) 
        ? responseData.map(w => w.wallet_id) 
        : [responseData.wallet_id];
      
      // Get the latest signature for each wallet
      const { data: signatures, error: signaturesError } = await supabase
        .from('wallet_signatures')
        .select('wallet_id, created_at')
        .in('wallet_id', walletIds)
        .order('created_at', { ascending: false });

      if (!signaturesError && signatures) {
        // Group signatures by wallet_id and get the most recent
        const latestSignatures = {};
        signatures.forEach(sig => {
          if (!latestSignatures[sig.wallet_id] || 
              new Date(sig.created_at) > new Date(latestSignatures[sig.wallet_id].created_at)) {
            latestSignatures[sig.wallet_id] = sig;
          }
        });
        
        // Add last_signed information to each wallet
        if (Array.isArray(responseData)) {
          responseData = responseData.map(wallet => ({
            ...wallet,
            last_signed: latestSignatures[wallet.wallet_id]?.created_at || null
          }));
        } else {
          responseData.last_signed = latestSignatures[responseData.wallet_id]?.created_at || null;
        }
      }
    }

    // Get the total count of NFTs owned by this wallet (optional enhancement)
    const includeNftCount = req.query.include_nft_count === 'true';
    if (includeNftCount) {
      let walletAddresses = Array.isArray(responseData) 
        ? responseData.map(w => w.wallet_address) 
        : [responseData.wallet_address];
        
      // Get NFT counts from tickets table
      const { data: nftCounts, error: nftCountError } = await supabase
        .from('tickets')
        .select('nft_contract_address, nft_token_id, blockchain_ticket_id')
        .in('user_id', [targetUserId])
        .eq('nft_mint_status', 'transferred')
        .eq('ticket_status', 'valid');
        
      if (!nftCountError && nftCounts) {
        if (Array.isArray(responseData)) {
          // For multiple wallets, we'd need blockchain data to determine ownership
          // Simplifying here by just giving total NFTs for the user
          responseData = responseData.map(wallet => ({
            ...wallet,
            nft_count: nftCounts.length
          }));
        } else {
          responseData.nft_count = nftCounts.length;
        }
      }
    }

    return res.status(200).json({
      status: 'success',
      message: 'Wallet information retrieved successfully',
      data: responseData
    });

  } catch (error) {
    console.error('Error retrieving wallet information:', error);
    return res.status(500).json({
      status: 'error',
      message: 'An error occurred while retrieving wallet information',
      error: error.message
    });
  }
}