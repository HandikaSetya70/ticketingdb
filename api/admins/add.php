<?php
// Include database configuration and helpers
require_once '../../config.php';
require_once '../../helpers.php';
require_once '../../admin_auth.php';

// Set response headers
header("Access-Control-Allow-Origin: *");
header("Content-Type: application/json; charset=UTF-8");
header("Access-Control-Allow-Methods: POST");
header("Access-Control-Allow-Headers: Content-Type, Access-Control-Allow-Headers, Authorization, X-Requested-With");

// Validate request method
validate_method(['POST']);

// Require authentication with super_admin role
$authenticated_admin = require_admin_auth($conn, ['super_admin']);

// Get posted data
$data = json_decode(file_get_contents("php://input"), true);

// Validate required fields
$required_fields = ['username', 'password', 'role'];
validate_required_fields($data, $required_fields);

// Validate role
$valid_roles = ['super_admin', 'admin', 'moderator'];
if (!in_array($data['role'], $valid_roles)) {
    error_response("Invalid role. Must be one of: " . implode(', ', $valid_roles), 400);
}

try {
    // Check if username already exists
    $username_check = $conn->prepare("SELECT admin_id FROM admins WHERE username = :username");
    $username_check->bindParam(':username', $data['username']);
    $username_check->execute();
    
    if ($username_check->rowCount() > 0) {
        error_response("Username already exists", 409);
    }
    
    // Create admin
    $admin = create_admin($conn, $data);
    
    if (!$admin) {
        error_response("Failed to create admin", 503);
    }
    
    // Return success
    success_response("Admin created successfully", [
        "admin_id" => $admin['admin_id'],
        "username" => $admin['username'],
        "role" => $admin['role'],
        "status" => $admin['status']
    ], 201);
    
} catch (PDOException $e) {
    error_response("Database error: " . $e->getMessage(), 503);
}
?>