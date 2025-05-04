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
$required_fields = ['payment_id', 'admin_id', 'status'];
validate_required_fields($data, $required_fields);

try {
    // Check if payment exists
    $payment_check = $conn->prepare("SELECT payment_id, user_id, payment_status FROM payments WHERE payment_id = :payment_id");
    $payment_check->bindParam(':payment_id', $data['payment_id']);
    $payment_check->execute();
    
    if ($payment_check->rowCount() === 0) {
        error_response("Payment not found", 404);
    }
    
    $payment = $payment_check->fetch(PDO::FETCH_ASSOC);
    
    // Validate status value
    if (!in_array($data['status'], ['confirmed', 'failed'])) {
        error_response("Invalid status value. Must be 'confirmed' or 'failed'", 400);
    }
    
    // Update payment status
    $query = "UPDATE payments SET payment_status = :status WHERE payment_id = :payment_id";
    $stmt = $conn->prepare($query);
    $stmt->bindParam(':status', $data['status']);
    $stmt->bindParam(':payment_id', $data['payment_id']);
    
    if ($stmt->execute()) {
        // If payment is confirmed, you might want to proceed with next steps
        if ($data['status'] === 'confirmed') {
            // Additional logic for confirmed payments can go here
            success_response("Payment verified successfully", [
                "payment_id" => $data['payment_id'],
                "user_id" => $payment['user_id'],
                "status" => $data['status']
            ]);
        } else {
            success_response("Payment marked as failed", [
                "payment_id" => $data['payment_id'],
                "user_id" => $payment['user_id'],
                "status" => $data['status']
            ]);
        }
    } else {
        error_response("Unable to update payment status", 503);
    }
} catch (PDOException $e) {
    error_response("Database error: " . $e->getMessage(), 503);
}
?>