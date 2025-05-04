<?php
// Database configuration
$host = "sql102.infinityfree.com"; // e.g., sql309.infinityfree.com
$db_name = "if0_38804287_ticketingdb
";
$username = "if0_38804287";
$password = "UvCA8aaKJY";

try {
    $conn = new PDO("mysql:host=$host;dbname=$db_name", $username, $password);
    $conn->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
} catch(PDOException $e) {
    echo json_encode([
        "status" => "error",
        "message" => "Connection failed: " . $e->getMessage()
    ]);
    die();
}
?>