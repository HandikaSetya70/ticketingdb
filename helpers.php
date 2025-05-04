<?php
/**
 * Common helper functions for the API
 */

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

// Function to validate request method
function validate_method($allowed_methods = ['POST']) {
    if (!in_array($_SERVER['REQUEST_METHOD'], $allowed_methods)) {
        http_response_code(405); // Method Not Allowed
        echo json_encode([
            "status" => "error",
            "message" => "Method not allowed. Allowed methods: " . implode(', ', $allowed_methods)
        ]);
        exit;
    }
}

// Function to validate required fields
function validate_required_fields($data, $required_fields) {
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
    
    return true;
}

// Function to check if a user exists
function check_user_exists($conn, $user_id) {
    $user_check = $conn->prepare("SELECT user_id FROM users WHERE user_id = :user_id");
    $user_check->bindParam(':user_id', $user_id);
    $user_check->execute();
    
    if ($user_check->rowCount() === 0) {
        http_response_code(404); // Not Found
        echo json_encode([
            "status" => "error",
            "message" => "User not found"
        ]);
        exit;
    }
    
    return true;
}

// Check if user is verified
function check_user_verified($conn, $user_id) {
    $user_check = $conn->prepare("SELECT verification_status FROM users WHERE user_id = :user_id");
    $user_check->bindParam(':user_id', $user_id);
    $user_check->execute();
    
    if ($user_check->rowCount() === 0) {
        http_response_code(404); // Not Found
        echo json_encode([
            "status" => "error",
            "message" => "User not found"
        ]);
        exit;
    }
    
    $user = $user_check->fetch(PDO::FETCH_ASSOC);
    if ($user['verification_status'] !== 'approved') {
        http_response_code(403); // Forbidden
        echo json_encode([
            "status" => "error",
            "message" => "User is not verified"
        ]);
        exit;
    }
    
    return true;
}

// Check if payment is confirmed
function check_payment_confirmed($conn, $payment_id, $user_id = null) {
    $query = "SELECT payment_status FROM payments WHERE payment_id = :payment_id";
    $params = [':payment_id' => $payment_id];
    
    if ($user_id) {
        $query .= " AND user_id = :user_id";
        $params[':user_id'] = $user_id;
    }
    
    $payment_check = $conn->prepare($query);
    foreach ($params as $key => $value) {
        $payment_check->bindParam($key, $value);
    }
    $payment_check->execute();
    
    if ($payment_check->rowCount() === 0) {
        http_response_code(404); // Not Found
        echo json_encode([
            "status" => "error",
            "message" => "Payment not found"
        ]);
        exit;
    }
    
    $payment = $payment_check->fetch(PDO::FETCH_ASSOC);
    if ($payment['payment_status'] !== 'confirmed') {
        http_response_code(403); // Forbidden
        echo json_encode([
            "status" => "error",
            "message" => "Payment is not confirmed"
        ]);
        exit;
    }
    
    return true;
}

// Generate QR code hash for a ticket
function generate_qr_code_hash($ticket_data) {
    return hash('sha256', json_encode($ticket_data) . time());
}

// Common response format for success
function success_response($message