/**
 * CORS middleware for Vercel Serverless Functions
 * Handles preflight OPTIONS requests and sets proper CORS headers
 * @param {Object} req - Request object
 * @param {Object} res - Response object
 * @returns {boolean} - Returns true if the request was handled (OPTIONS), false otherwise
 */
export function applyCors(req, res) {
  // Add detailed logging if needed
  // console.log('CORS middleware processing request:', {
  //   method: req.method,
  //   path: req.url,
  //   origin: req.headers.origin
  // });

  // Set CORS headers
  res.setHeader('Access-Control-Allow-Origin', 'http://setya.fwh.is');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  
  // Handle OPTIONS preflight request
  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return true; // Request was handled
  }
  
  // Request not handled, continue with route handler
  return false;
}

/**
 * Utility function to handle error responses consistently
 * @param {Object} res - Response object
 * @param {number} statusCode - HTTP status code
 * @param {string} message - Error message
 * @param {Object} error - Optional error details
 */
export function sendErrorResponse(res, statusCode, message, error = null) {
  const response = {
    status: 'error',
    message
  };
  
  if (error && process.env.NODE_ENV !== 'production') {
    response.error = error.message || String(error);
  }
  
  return res.status(statusCode).json(response);
}

/**
 * Utility function to handle success responses consistently
 * @param {Object} res - Response object
 * @param {string} message - Success message
 * @param {Object} data - Response data
 */
export function sendSuccessResponse(res, message, data = null) {
  return res.status(200).json({
    status: 'success',
    message,
    data
  });
}