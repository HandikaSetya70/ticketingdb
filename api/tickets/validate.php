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
$required_fields = ['ticket_id', 'user_id'];
validate_required_fields($data, $required_fields);

try {
    // Check if ticket exists and belongs to the user
    $ticket_check = $conn->prepare("
        SELECT t.ticket_id, t.user_id, t.ticket_status, t.blockchain_ticket_id, t.qr_code_hash, 
               e.event_name, e.event_date, e.venue 
        FROM tickets t
        LEFT JOIN events e ON t.event_id = e.event_id
        WHERE t.ticket_id = :ticket_id AND t.user_id = :user_id
    ");
    
    $ticket_check->bindParam(':ticket_id', $data['ticket_id']);
    $ticket_check->bindParam(':user_id', $data['user_id']);
    $ticket_check->execute();
    
    if ($ticket_check->rowCount() === 0) {
        error_response("Ticket not found or doesn't belong to this user", 404);
    }
    
    $ticket = $ticket_check->fetch(PDO::FETCH_ASSOC);
    
    // Check if ticket is valid
    if ($ticket['ticket_status'] !== 'valid') {
        error_response("Ticket has been revoked", 403);
    }
    
    // Here you would typically make a call to the blockchain to check if the ticket is valid
    // This is a placeholder for where you would add your blockchain integration
    // $blockchain_valid = blockchain_check_valid($ticket['blockchain_ticket_id']);
    
    // For now, let's assume it's valid if we get to this point
    $blockchain_valid = true;
    
    if ($blockchain_valid) {
        success_response("Ticket is valid", [
            "ticket_id" => $ticket['ticket_id'],
            "blockchain_ticket_id" => $ticket['blockchain_ticket_id'],
            "event_name" => $ticket['event_name'] ?? "General Event",
            "event_date" => $ticket['event_date'] ?? null,
            "venue" => $ticket['venue'] ?? null,
            "status" => "valid"
        ]);
    } else {
        error_response("Ticket has been revoked on the blockchain", 403);
    }
    
} catch (PDOException $e) {
    error_response("Database error: " . $e->getMessage(), 503);
}
?>