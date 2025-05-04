<?php
/**
 * Test script for ticketing system API
 * 
 * This script tests all API endpoints and prints the results.
 * Note: You may need to update the base URL to match your host.
 */

// Configuration
$base_url = 'http://setya.fwh.is';  // Update this to your domain

// Function to make API calls
function call_api($endpoint, $data) {
    global $base_url;
    
    $url = $base_url . $endpoint;
    $json_data = json_encode($data);
    
    $ch = curl_init($url);
    curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
    curl_setopt($ch, CURLOPT_POST, true);
    curl_setopt($ch, CURLOPT_POSTFIELDS, $json_data);
    curl_setopt($ch, CURLOPT_HTTPHEADER, [
        'Content-Type: application/json',
        'Content-Length: ' . strlen($json_data)
    ]);
    
    $response = curl_exec($ch);
    $http_code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);
    
    return [
        'code' => $http_code,
        'response' => json_decode($response, true)
    ];
}

// Function to print test results
function print_result($test_name, $result) {
    echo "=== Test: $test_name ===\n";
    echo "Status Code: " . $result['code'] . "\n";
    echo "Response: " . json_encode($result['response'], JSON_PRETTY_PRINT) . "\n\n";
}

// Store IDs for use in subsequent tests
$user_id = null;
$payment_id = null;
$ticket_id = null;
$admin_id = 'admin-' . rand(1000, 9999); // Simulated admin ID

// Test 1: Create a new user
$user_data = [
    'id_number' => 'ID' . rand(10000, 99999),
    'id_name' => 'Test User',
    'dob' => '1990-01-01',
    'id_picture_url' => 'https://example.com/id_picture.jpg'
];

$result = call_api('/api/users/add_user', $user_data);
print_result('Create User', $result);

if ($result['code'] == 201 && isset($result['response']['data']['user_id'])) {
    $user_id = $result['response']['data']['user_id'];
    echo "User ID: $user_id\n\n";
} else {
    echo "Failed to create user. Stopping tests.\n";
    exit;
}

// Test 2: Verify the user
$verify_data = [
    'user_id' => $user_id,
    'admin_id' => $admin_id,
    'status' => 'approved',
    'comments' => 'ID verified successfully'
];

$result = call_api('/api/users/verify', $verify_data);
print_result('Verify User', $result);

// Test 3: Add a payment
$payment_data = [
    'user_id' => $user_id,
    'amount' => 100.00,
    'payment_proof_url' => 'https://example.com/payment_proof.jpg'
];

$result = call_api('/api/payments/add_payment', $payment_data);
print_result('Add Payment', $result);

if ($result['code'] == 201 && isset($result['response']['data']['payment_id'])) {
    $payment_id = $result['response']['data']['payment_id'];
    echo "Payment ID: $payment_id\n\n";
} else {
    echo "Failed to create payment. Stopping tests.\n";
    exit;
}

// Test 4: Verify the payment
$verify_payment_data = [
    'payment_id' => $payment_id,
    'admin_id' => $admin_id,
    'status' => 'confirmed'
];

$result = call_api('/api/payments/verify', $verify_payment_data);
print_result('Verify Payment', $result);

// Test 5: Create a ticket
$ticket_data = [
    'user_id' => $user_id,
    'payment_id' => $payment_id
    // blockchain_ticket_id will be auto-generated
];

$result = call_api('/api/tickets/create', $ticket_data);
print_result('Create Ticket', $result);

if ($result['code'] == 201 && isset($result['response']['data']['ticket_id'])) {
    $ticket_id = $result['response']['data']['ticket_id'];
    echo "Ticket ID: $ticket_id\n\n";
} else {
    echo "Failed to create ticket. Stopping tests.\n";
    exit;
}

// Test 6: Validate the ticket
$validate_data = [
    'ticket_id' => $ticket_id,
    'user_id' => $user_id
];

$result = call_api('/api/tickets/validate', $validate_data);
print_result('Validate Ticket', $result);

// Test 7: Revoke the ticket
$revoke_data = [
    'ticket_id' => $ticket_id,
    'admin_id' => $admin_id,
    'reason' => 'Testing ticket revocation'
];

$result = call_api('/api/tickets/revoke', $revoke_data);
print_result('Revoke Ticket', $result);

// Test 8: Validate the revoked ticket (should fail)
$result = call_api('/api/tickets/validate', $validate_data);
print_result('Validate Revoked Ticket', $result);

echo "All tests completed.\n";
?>