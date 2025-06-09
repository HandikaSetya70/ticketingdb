import pkg from 'uuid';
const { v4: uuidv4 } = pkg;
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

  // Only allow POST requests
  if (req.method !== 'POST') {
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
      .select('user_id')
      .eq('auth_id', user.id)
      .single();

    if (profileError || !userProfile) {
      return res.status(404).json({
        status: 'error',
        message: 'User profile not found'
      });
    }

    // Extract wallet details from request body
    const { wallet_address, signature, message } = req.body;

    // Validate required fields
    if (!wallet_address || !signature) {
      return res.status(400).json({
        status: 'error',
        message: 'Wallet address and signature are required'
      });
    }

    // Check if this wallet address is already linked to another user
    const { data: existingWallet, error: walletCheckError } = await supabase
      .from('user_wallets')
      .select('user_id')
      .eq('wallet_address', wallet_address)
      .eq('is_active', true);

    if (walletCheckError) {
      return res.status(500).json({
        status: 'error',
        message: 'Error checking wallet availability',
        error: walletCheckError.message
      });
    }

    if (existingWallet && existingWallet.length > 0 && existingWallet[0].user_id !== userProfile.user_id) {
      return res.status(409).json({
        status: 'error',
        message: 'This wallet address is already connected to another account'
      });
    }

    // Check if user already has a wallet with this address
    const { data: userExistingWallet, error: userWalletError } = await supabase
      .from('user_wallets')
      .select('wallet_id')
      .eq('user_id', userProfile.user_id)
      .eq('wallet_address', wallet_address)
      .eq('is_active', true);

    // If user already has this wallet, update the signature
    if (userExistingWallet && userExistingWallet.length > 0) {
      const { error: updateError } = await supabase
        .from('user_wallets')
        .update({
          signature: signature,
          linked_at: new Date().toISOString()
        })
        .eq('wallet_id', userExistingWallet[0].wallet_id);

      if (updateError) {
        return res.status(500).json({
          status: 'error',
          message: 'Error updating wallet signature',
          error: updateError.message
        });
      }

      // Add new entry to wallet_signatures table
      if (message) {
        const { error: signatureError } = await supabase
          .from('wallet_signatures')
          .insert({
            signature_id: uuidv4(),
            wallet_id: userExistingWallet[0].wallet_id,
            message: message,
            signature: signature,
            created_at: new Date().toISOString()
          });

        if (signatureError) {
          console.error('Error recording signature history:', signatureError);
          // Continue despite signature history error
        }
      }

      return res.status(200).json({
        status: 'success',
        message: 'Wallet signature updated successfully',
        data: {
          wallet_id: userExistingWallet[0].wallet_id,
          wallet_address: wallet_address
        }
      });
    }

    // Create a new wallet entry
    const newWalletId = uuidv4();
    const { error: insertError } = await supabase
      .from('user_wallets')
      .insert({
        wallet_id: newWalletId,
        user_id: userProfile.user_id,
        wallet_address: wallet_address,
        signature: signature,
        linked_at: new Date().toISOString(),
        is_active: true
      });

    if (insertError) {
      return res.status(500).json({
        status: 'error',
        message: 'Error connecting wallet',
        error: insertError.message
      });
    }

    // Add entry to wallet_signatures table if message is provided
    if (message) {
      const { error: signatureError } = await supabase
        .from('wallet_signatures')
        .insert({
          signature_id: uuidv4(),
          wallet_id: newWalletId,
          message: message,
          signature: signature,
          created_at: new Date().toISOString()
        });

      if (signatureError) {
        console.error('Error recording signature history:', signatureError);
        // Continue despite signature history error
      }
    }

    // Update has_wallet flag in users table
    const { error: updateUserError } = await supabase
      .from('users')
      .update({ has_wallet: true })
      .eq('user_id', userProfile.user_id);

    if (updateUserError) {
      console.error('Error updating user wallet status:', updateUserError);
      // Continue despite user update error
    }

    return res.status(201).json({
      status: 'success',
      message: 'Wallet connected successfully',
      data: {
        wallet_id: newWalletId,
        wallet_address: wallet_address
      }
    });

  } catch (error) {
    console.error('Error connecting wallet:', error);
    return res.status(500).json({
      status: 'error',
      message: 'An error occurred while connecting wallet',
      error: error.message
    });
  }
}