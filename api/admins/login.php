<?php
// Include database configuration and helpers
require_once '../../config.php';
require_once '../../helpers.php';

// Set response headers
header("Access-Control-Allow-Origin: *");
header("Content-Type: application/json; charset=UTF-8");
header("Access-Control-Allow-Methods: POST");
header("Access-Control-Allow-Headers: Content-Type, Access-Control-Allow-Headers, Authorization, X-Requested-With");

// Validate request method
validate_method(['POST']);

// Get posted data
$data = json_decode(file_get_contents("php://input"), true);

// Validate required fields
$required_fields = ['username', 'password'];
validate_required_fields($data, $required_fields);

try {
    // Check if admin exists
    $admin_check = $conn->prepare("SELECT admin_id, username, password, role, status FROM admins WHERE username = :username");
    $admin_check->bindParam(':username', $data['username']);
    $admin_check->execute();
    
    if ($admin_check->rowCount() === 0) {
        error_response("Invalid username or password", 401);
    }
    
    $admin = $admin_check->fetch(PDO::FETCH_ASSOC);
    
    // Check if admin is active
    if ($admin['status'] !== 'active') {
        error_response("Account is inactive", 403);
    }
    
    // Verify password
    if (!password_verify($data['password'], $admin['password'])) {
        error_response("Invalid username or password", 401);
    }
    
    // Generate session token
    $token = bin2hex(random_bytes(32));
    $expiry = date('Y-m-d H:i:s', strtotime('+24 hours'));
    
    // Check if admin_sessions table exists
    $table_check = $conn->query("SHOW TABLES LIKE 'admin_sessions'");
    if ($table_check->rowCount() == 0) {
        // Create the table if it doesn't exist
        $conn->exec("CREATE TABLE IF NOT EXISTS `admin_sessions` (
            `session_id` CHAR(64) NOT NULL,
            `admin_id` CHAR(36) NOT NULL,
            `token` VARCHAR(255) NOT NULL,
            `expiry` DATETIME NOT NULL,
            `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (`session_id`),
            FOREIGN KEY (`admin_id`) REFERENCES `admins`(`admin_id`) ON DELETE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;");
    }
    
    // Store token in database
    $session_id = generate_uuid();
    $store_token = $conn->prepare("INSERT INTO admin_sessions (session_id, admin_id, token, expiry) VALUES (:session_id, :admin_id, :token, :expiry)");
    $store_token->bindParam(':session_id', $session_id);
    $store_token->bindParam(':admin_id', $admin['admin_id']);
    $store_token->bindParam(':token', $token);
    $store_token->bindParam(':expiry', $expiry);
    $store_token->execute();
    
    // Return session token and admin info
    success_response("Login successful", [
        "admin_id" => $admin['admin_id'],
        "username" => $admin['username'],
        "role" => $admin['role'],
        "token" => $token,
        "expiry" => $expiry
    ]);
    
} catch (PDOException $e) {
    error_response("Database error: " . $e->getMessage(), 503);
}
?>