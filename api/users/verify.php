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
$required_fields = ['user_id', 'admin_id', 'status', 'comments'];
validate_required_fields($data, $required_fields);

try {
    // Check if user exists
    $user_check = $conn->prepare("SELECT user_id FROM users WHERE user_id = :user_id");
    $user_check->bindParam(':user_id', $data['user_id']);
    $user_check->execute();
    
    if ($user_check->rowCount() === 0) {
        error_response("User not found", 404);
    }
    
    // Validate status value
    if (!in_array($data['status'], ['approved', 'rejected'])) {
        error_response("Invalid status value. Must be 'approved' or 'rejected'", 400);
    }
    
    // Begin transaction
    $conn->beginTransaction();
    
    // Create verification record
    $verification_id = generate_uuid();
    $query = "INSERT INTO admin_verification_requests (verification_id, user_id, admin_id, status, comments) 
              VALUES (:verification_id, :user_id, :admin_id, :status, :comments)";
    
    $stmt = $conn->prepare($query);
    $stmt->bindParam(':verification_id', $verification_id);
    $stmt->bindParam(':user_id', $data['user_id']);
    $stmt->bindParam(':admin_id', $data['admin_id']);
    $stmt->bindParam(':status', $data['status']);
    $stmt->bindParam(':comments', $data['comments']);
    
    if (!$stmt->execute()) {
        $conn->rollBack();
        error_response("Unable to create verification record", 503);
    }
    
    // Update user verification status
    $update_query = "UPDATE users SET verification_status = :status WHERE user_id = :user_id";
    $update_stmt = $conn->prepare($update_query);
    $update_stmt->bindParam(':status', $data['status']);
    $update_stmt->bindParam(':user_id', $data['user_id']);
    
    if (!$update_stmt->execute()) {
        $conn->rollBack();
        error_response("Unable to update user verification status", 503);
    }
    
    // Commit transaction
    $conn->commit();
    
    success_response("User verification completed", [
        "verification_id" => $verification_id,
        "user_id" => $data['user_id'],
        "status" => $data['status']
    ]);
    
} catch (PDOException $e) {
    if ($conn->inTransaction()) {
        $conn->rollBack();
    }
    error_response("Database error: " . $e->getMessage(), 503);
}
?>