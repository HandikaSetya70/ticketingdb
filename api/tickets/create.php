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
$required_fields = ['user_id', 'payment_id', 'blockchain_ticket_id'];
if (isset($data['event_id'])) {
    // If events are being used
    validate_required_fields($data, $required_fields);
} else {
    validate_required_fields($data, $required_fields);
}

try {
    // Check if user exists and is verified
    $user_check = $conn->prepare("SELECT user_id, verification_status FROM users WHERE user_id = :user_id");
    $user_check->bindParam(':user_id', $data['user_id']);
    $user_check->execute();
    
    if ($user_check->rowCount() === 0) {
        error_response("User not found", 404);
    }
    
    $user = $user_check->fetch(PDO::FETCH_ASSOC);
    if ($user['verification_status'] !== 'approved') {
        error_response("User is not verified", 403);
    }
    
    // Check if payment exists and is confirmed
    $payment_check = $conn->prepare("SELECT payment_id, payment_status FROM payments WHERE payment_id = :payment_id AND user_id = :user_id");
    $payment_check->bindParam(':payment_id', $data['payment_id']);
    $payment_check->bindParam(':user_id', $data['user_id']);
    $payment_check->execute();
    
    if ($payment_check->rowCount() === 0) {
        error_response("Payment not found or doesn't belong to this user", 404);
    }
    
    $payment = $payment_check->fetch(PDO::FETCH_ASSOC);
    if ($payment['payment_status'] !== 'confirmed') {
        error_response("Payment is not confirmed", 403);
    }
    
    // Generate a UUID for the ticket
    $ticket_id = generate_uuid();
    
    // Generate QR code hash
    $qr_data = [
        'ticket_id' => $ticket_id,
        'user_id' => $data['user_id'],
        'timestamp' => time()
    ];
    $qr_code_hash = generate_qr_code_hash($qr_data);
    
    // Prepare SQL query
    if (isset($data['event_id'])) {
        // Check if event exists
        $event_check = $conn->prepare("SELECT event_id FROM events WHERE event_id = :event_id");
        $event_check->bindParam(':event_id', $data['event_id']);
        $event_check->execute();
        
        if ($event_check->rowCount() === 0) {
            error_response("Event not found", 404);
        }
        
        $query = "INSERT INTO tickets (ticket_id, user_id, event_id, blockchain_ticket_id, qr_code_hash, payment_id) 
                VALUES (:ticket_id, :user_id, :event_id, :blockchain_ticket_id, :qr_code_hash, :payment_id)";
    } else {
        $query = "INSERT INTO tickets (ticket_id, user_id, blockchain_ticket_id, qr_code_hash, payment_id) 
                VALUES (:ticket_id, :user_id, :blockchain_ticket_id, :qr_code_hash, :payment_id)";
    }
    
    $stmt = $conn->prepare($query);
    
    // Bind parameters
    $stmt->bindParam(':ticket_id', $ticket_id);
    $stmt->bindParam(':user_id', $data['user_id']);
    $stmt->bindParam(':blockchain_ticket_id', $data['blockchain_ticket_id']);
    $stmt->bindParam(':qr_code_hash', $qr_code_hash);
    $stmt->bindParam(':payment_id', $data['payment_id']);
    
    if (isset($data['event_id'])) {
        $stmt->bindParam(':event_id', $data['event_id']);
    }
    
    // Execute query
    if ($stmt->execute()) {
        // Here you would typically make a call to the blockchain to mark the ticket as valid
        // This is a placeholder for where you would add your blockchain integration
        // blockchain_mark_valid($data['blockchain_ticket_id']);
        
        success_response("Ticket created successfully", [
            "ticket_id" => $ticket_id,
            "qr_code_hash" => $qr_code_hash
        ], 201);
    } else {
        error_response("Unable to create ticket", 503);
    }
} catch (PDOException $e) {
    error_response("Database error: " . $e->getMessage(), 503);
}
?>