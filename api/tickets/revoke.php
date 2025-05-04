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
$required_fields = ['ticket_id', 'admin_id', 'reason'];
validate_required_fields($data, $required_fields);

try {
    // Check if ticket exists
    $ticket_check = $conn->prepare("SELECT ticket_id, user_id, blockchain_ticket_id, ticket_status FROM tickets WHERE ticket_id = :ticket_id");
    $ticket_check->bindParam(':ticket_id', $data['ticket_id']);
    $ticket_check->execute();
    
    if ($ticket_check->rowCount() === 0) {
        error_response("Ticket not found", 404);
    }
    
    $ticket = $ticket_check->fetch(PDO::FETCH_ASSOC);
    
    // Check if ticket is already revoked
    if ($ticket['ticket_status'] === 'revoked') {
        error_response("Ticket is already revoked", 409);
    }
    
    // Update ticket status in database
    $query = "UPDATE tickets SET ticket_status = 'revoked' WHERE ticket_id = :ticket_id";
    $stmt = $conn->prepare($query);
    $stmt->bindParam(':ticket_id', $data['ticket_id']);
    
    if ($stmt->execute()) {
        // Here you would typically make a call to the blockchain to mark the ticket as revoked
        // This is a placeholder for where you would add your blockchain integration
        // blockchain_revoke_ticket($ticket['blockchain_ticket_id']);
        
        // Log the revocation
        $log_query = "INSERT INTO revocation_log (ticket_id, admin_id, reason, revoked_at) 
                     VALUES (:ticket_id, :admin_id, :reason, NOW())";
                     
        $log_stmt = $conn->prepare($log_query);
        $log_stmt->bindParam(':ticket_id', $data['ticket_id']);
        $log_stmt->bindParam(':admin_id', $data['admin_id']);
        $log_stmt->bindParam(':reason', $data['reason']);
        $log_stmt->execute();
        
        success_response("Ticket revoked successfully", [
            "ticket_id" => $data['ticket_id'],
            "blockchain_ticket_id" => $ticket['blockchain_ticket_id'],
            "user_id" => $ticket['user_id']
        ]);
    } else {
        error_response("Unable to revoke ticket", 503);
    }
    
} catch (PDOException $e) {
    error_response("Database error: " . $e->getMessage(), 503);
}
?>