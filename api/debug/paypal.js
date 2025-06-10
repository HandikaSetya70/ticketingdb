// /api/debug/paypal.js
// Debug endpoint to check PayPal configuration with multiple import methods

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

    // Test multiple import methods
    const importTests = {};

    // Method 1: createRequire (your current method)
    try {
      const { createRequire } = await import('module');
      const require = createRequire(import.meta.url);
      const paypal = require('@paypal/checkout-server-sdk');
      importTests.method1_createRequire = 'SUCCESS';
    } catch (error) {
      importTests.method1_createRequire = `FAILED: ${error.message}`;
    }

    // Method 2: Dynamic import
    try {
      const paypalModule = await import('@paypal/checkout-server-sdk');
      const paypal = paypalModule.default || paypalModule;
      importTests.method2_dynamicImport = 'SUCCESS';
    } catch (error) {
      importTests.method2_dynamicImport = `FAILED: ${error.message}`;
    }

    // Method 3: Try direct require (should fail in ES modules)
    try {
      // This will likely fail, but let's test it
      eval('const paypal = require("@paypal/checkout-server-sdk")');
      importTests.method3_directRequire = 'SUCCESS';
    } catch (error) {
      importTests.method3_directRequire = `FAILED: ${error.message}`;
    }

    // Method 4: Check if module exists in node_modules
    let moduleExists = 'UNKNOWN';
    try {
      const fs = await import('fs');
      const path = await import('path');
      
      // Check various possible paths
      const possiblePaths = [
        '/var/task/node_modules/@paypal/checkout-server-sdk',
        './node_modules/@paypal/checkout-server-sdk',
        '../node_modules/@paypal/checkout-server-sdk'
      ];
      
      for (const testPath of possiblePaths) {
        try {
          await fs.promises.access(testPath);
          moduleExists = `FOUND at ${testPath}`;
          break;
        } catch (e) {
          // Continue checking
        }
      }
      
      if (moduleExists === 'UNKNOWN') {
        moduleExists = 'NOT FOUND in any checked paths';
      }
    } catch (error) {
      moduleExists = `ERROR checking: ${error.message}`;
    }

    // Test actual PayPal SDK functionality if any method worked
    let sdkTest = 'NOT TESTED';
    let workingMethod = null;

    // Try method 2 (dynamic import) for actual test
    try {
      const paypalModule = await import('@paypal/checkout-server-sdk');
      const paypal = paypalModule.default || paypalModule;
      
      if (paypal && paypal.core) {
        workingMethod = 'dynamic_import';
        
        const environment = process.env.NODE_ENV === 'production' 
          ? new paypal.core.LiveEnvironment(process.env.PAYPAL_CLIENT_ID, process.env.PAYPAL_CLIENT_SECRET)
          : new paypal.core.SandboxEnvironment(process.env.PAYPAL_CLIENT_ID, process.env.PAYPAL_CLIENT_SECRET);

        const client = new paypal.core.PayPalHttpClient(environment);
        sdkTest = 'SDK_INITIALIZED_WITH_DYNAMIC_IMPORT';
        
        // Test a simple API call (this might fail due to credentials, but that's OK)
        try {
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
          
          const response = await client.execute(request);
          sdkTest = 'API_CALL_SUCCESS_WITH_DYNAMIC_IMPORT';
        } catch (apiError) {
          sdkTest = `API_ERROR_WITH_DYNAMIC_IMPORT: ${apiError.message}`;
        }
      } else {
        sdkTest = 'DYNAMIC_IMPORT_SUCCESS_BUT_INVALID_MODULE_STRUCTURE';
      }
      
    } catch (dynamicError) {
      // Fallback to createRequire method
      try {
        const { createRequire } = await import('module');
        const require = createRequire(import.meta.url);
        const paypal = require('@paypal/checkout-server-sdk');
        
        workingMethod = 'createRequire';
        
        const environment = process.env.NODE_ENV === 'production' 
          ? new paypal.core.LiveEnvironment(process.env.PAYPAL_CLIENT_ID, process.env.PAYPAL_CLIENT_SECRET)
          : new paypal.core.SandboxEnvironment(process.env.PAYPAL_CLIENT_ID, process.env.PAYPAL_CLIENT_SECRET);

        const client = new paypal.core.PayPalHttpClient(environment);
        sdkTest = 'SDK_INITIALIZED_WITH_CREATE_REQUIRE';
        
      } catch (createRequireError) {
        sdkTest = `BOTH_METHODS_FAILED: Dynamic(${dynamicError.message}) CreateRequire(${createRequireError.message})`;
      }
    }

    return res.status(200).json({
      status: 'success',
      message: 'PayPal configuration debug info',
      data: {
        environment_variables: paypalConfig,
        import_tests: importTests,
        module_existence: moduleExists,
        sdk_test: sdkTest,
        working_method: workingMethod,
        runtime_info: {
          node_version: process.version,
          platform: process.platform,
          cwd: process.cwd(),
          env_type: process.env.VERCEL ? 'vercel' : 'local'
        },
        expected_format: {
          CLIENT_ID: 'Should start with: AafPUUpZMCBwsvSv0jc5szbLVQQnaZVRy...',
          CLIENT_SECRET: 'Should start with: EMRNxzHEqUUcoQ5YuozQLcvXGI...',
          WEBHOOK_ID: 'Should be: 1JC02950JB9376148'
        },
        troubleshooting: [
          'Check if environment variables are set in Vercel dashboard',
          'Ensure you redeploy after setting environment variables', 
          'Verify credentials are from PayPal Sandbox, not Live',
          'Make sure CLIENT_ID and CLIENT_SECRET match your PayPal app',
          'Try different import methods if module loading fails'
        ]
      }
    });

  } catch (error) {
    return res.status(500).json({
      status: 'error',
      message: 'Debug failed',
      error: error.message,
      stack: error.stack
    });
  }
}