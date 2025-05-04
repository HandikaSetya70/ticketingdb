<?php
// Simple API documentation page
?>
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Ticketing System API</title>
    <style>
        body {
            font-family: Arial, sans-serif;
            line-height: 1.6;
            margin: 0;
            padding: 20px;
            color: #333;
        }
        h1, h2, h3 {
            color: #2c3e50;
        }
        pre {
            background: #f4f4f4;
            border: 1px solid #ddd;
            border-radius: 4px;
            padding: 10px;
            overflow-x: auto;
        }
        code {
            background: #f4f4f4;
            padding: 2px 5px;
            border-radius: 3px;
        }
        .container {
            max-width: 800px;
            margin: 0 auto;
        }
        .endpoint {
            margin-bottom: 30px;
            border-bottom: 1px solid #eee;
            padding-bottom: 20px;
        }
    </style>
</head>
<body>
    <div class="container">
        <h1>Ticketing System API</h1>
        <p>Welcome to the Ticketing System API documentation.</p>
        
        <div class="endpoint">
            <h2>Add User</h2>
            <p><strong>URL:</strong> <code>/api/add_user</code></p>
            <p><strong>Method:</strong> POST</p>
            <p><strong>Description:</strong> Creates a new user in the system</p>
            
            <h3>Request Parameters:</h3>
            <pre>
{
    "id_number": "ID12345678",
    "id_name": "John Doe",
    "dob": "1990-01-01",
    "id_picture_url": "https://example.com/path/to/picture.jpg"
}
            </pre>
            
            <h3>Success Response:</h3>
            <pre>
{
    "status": "success",
    "message": "User created successfully",
    "user_id": "generated-uuid-here"
}
            </pre>
            
            <h3>Error Response:</h3>
            <pre>
{
    "status": "error",
    "message": "Missing required fields: id_number, id_name"
}
            </pre>
            
            <h3>Example CURL Request:</h3>
            <pre>
curl -X POST \
  -H "Content-Type: application/json" \
  -d '{"id_number":"ID12345678","id_name":"John Doe","dob":"1990-01-01","id_picture_url":"https://example.com/path/to/picture.jpg"}' \
  https://your-domain.com/api/add_user
            </pre>
        </div>
        
        <!-- More endpoints can be added here as they are developed -->
    </div>
</body>
</html>