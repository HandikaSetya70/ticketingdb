<?php
// Include database configuration
require_once '../config.php';

// Set response headers
header("Access-Control-Allow-Origin: *");
header("Content-Type: application/json; charset=UTF-8");
header("Access-Control-Allow-Methods: POST");
header("Access-Control-Allow-Headers: Content-Type, Access-Control-Allow-Headers, Authorization, X-Requested-With");

// Only allow POST requests
if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    http_response_code(405); // Method Not Allowed
    echo json_encode([
        "status" => "error",
        "message" => "Only POST method is allowed"
    ]);
    exit;
}

// Get posted data
$data = json_decode(file_get_contents("php://input"), true);

// Validate required fields
$required_fields = ['id_number', 'id_name', 'dob', 'id_picture_url'];
$missing_fields = [];

foreach ($required_fields as $field) {
    if (!isset($data[$field]) || empty($data[$field])) {
        $missing_fields[] = $field;
    }
}

if (!empty($missing_fields)) {
    http_response_code(400); // Bad Request
    echo json_encode([
        "status" => "error",
        "message" => "Missing required fields: " . implode(', ', $missing_fields)
    ]);
    exit;
}

try {
    // Generate a UUID for the user
    $user_id = generate_uuid();
    
    // Format date correctly for MySQL
    $dob = date('Y-m-d', strtotime($data['dob']));
    
    // Prepare SQL query
    $query = "INSERT INTO users (user_id, id_number, id_name, dob, id_picture_url) 
              VALUES (:user_id, :id_number, :id_name, :dob, :id_picture_url)";
    
    $stmt = $conn->prepare($query);
    
    // Bind parameters
    $stmt->bindParam(':user_id', $user_id);
    $stmt->bindParam(':id_number', $data['id_number']);
    $stmt->bindParam(':id_name', $data['id_name']);
    $stmt->bindParam(':dob', $dob);
    $stmt->bindParam(':id_picture_url', $data['id_picture_url']);
    
    // Execute query
    if ($stmt->execute()) {
        http_response_code(201); // Created
        echo json_encode([
            "status" => "success",
            "message" => "User created successfully",
            "user_id" => $user_id
        ]);
    } else {
        http_response_code(503); // Service Unavailable
        echo json_encode([
            "status" => "error",
            "message" => "Unable to create user"
        ]);
    }
} catch (PDOException $e) {
    http_response_code(503); // Service Unavailable
    
    // Check for duplicate entry error
    if ($e->getCode() == 23000) {
        echo json_encode([
            "status" => "error",
            "message" => "User with this ID number already exists"
        ]);
    } else {
        echo json_encode([
            "status" => "error",
            "message" => "Database error: " . $e->getMessage()
        ]);
    }
}

// Function to generate UUID v4
function generate_uuid() {
    return sprintf('%04x%04x-%04x-%04x-%04x-%04x%04x%04x',
        mt_rand(0, 0xffff), mt_rand(0, 0xffff),
        mt_rand(0, 0xffff),
        mt_rand(0, 0x0fff) | 0x4000,
        mt_rand(0, 0x3fff) | 0x8000,
        mt_rand(0, 0xffff), mt_rand(0, 0xffff), mt_rand(0, 0xffff)
    );
}
?>