// /api/debug/paypal.js
// Debug endpoint to check PayPal configuration

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({
      status: 'error',
      message: 'Method not allowed'
    });
  }

  try {
    // Check environment variables
    const paypalConfig = {
      CLIENT_ID: process.env.PAYPAL_CLIENT_ID ? 
        `${process.env.PAYPAL_CLIENT_ID.substring(0, 10)}...` : 
        'NOT SET',
      CLIENT_SECRET: process.env.PAYPAL_CLIENT_SECRET ? 
        `${process.env.PAYPAL_CLIENT_SECRET.substring(0, 10)}...` : 
        'NOT SET',
      WEBHOOK_ID: process.env.PAYPAL_WEBHOOK_ID ? 
        `${process.env.PAYPAL_WEBHOOK_ID.substring(0, 10)}...` : 
        'NOT SET',
      NODE_ENV: process.env.NODE_ENV || 'development'
    };

    // Test PayPal SDK initialization
    let sdkTest = 'NOT TESTED';
    try {
      const { createRequire } = await import('module');
      const require = createRequire(import.meta.url);
      const paypal = require('@paypal/checkout-server-sdk');
      
      const environment = process.env.NODE_ENV === 'production' 
        ? new paypal.core.LiveEnvironment(process.env.PAYPAL_CLIENT_ID, process.env.PAYPAL_CLIENT_SECRET)
        : new paypal.core.SandboxEnvironment(process.env.PAYPAL_CLIENT_ID, process.env.PAYPAL_CLIENT_SECRET);

      const client = new paypal.core.PayPalHttpClient(environment);
      
      sdkTest = 'SDK_INITIALIZED';
      
      // Test a simple API call
      const request = new paypal.orders.OrdersCreateRequest();
      request.requestBody({
        intent: 'CAPTURE',
        purchase_units: [{
          amount: {
            currency_code: 'USD',
            value: '1.00'
          }
        }]
      });
      
      // This will fail if credentials are wrong
      const response = await client.execute(request);
      sdkTest = 'API_CALL_SUCCESS';
      
    } catch (paypalError) {
      sdkTest = `API_ERROR: ${paypalError.message}`;
    }

    return res.status(200).json({
      status: 'success',
      message: 'PayPal configuration debug info',
      data: {
        environment_variables: paypalConfig,
        sdk_test: sdkTest,
        expected_format: {
          CLIENT_ID: 'Should start with: AafPUUpZMCBwsvSv0jc5szbLVQQnaZVRy...',
          CLIENT_SECRET: 'Should start with: EMRNxzHEqUUcoQ5YuozQLcvXGI...',
          WEBHOOK_ID: 'Should be: 1JC02950JB9376148'
        },
        troubleshooting: [
          'Check if environment variables are set in Vercel dashboard',
          'Ensure you redeploy after setting environment variables',
          'Verify credentials are from PayPal Sandbox, not Live',
          'Make sure CLIENT_ID and CLIENT_SECRET match your PayPal app'
        ]
      }
    });

  } catch (error) {
    return res.status(500).json({
      status: 'error',
      message: 'Debug failed',
      error: error.message
    });
  }
}