<?php
/**
 * Admin authentication helper functions
 */

/**
 * Verify admin authentication token
 * 
 * @param PDO $conn Database connection
 * @param string $token Authentication token from request
 * @return array|false Admin data if authenticated, false otherwise
 */
function verify_admin_token($conn, $token) {
    try {
        // Check if token exists and is valid
        $token_check = $conn->prepare("
            SELECT a.admin_id, a.username, a.role, a.status
            FROM admin_sessions s
            JOIN admins a ON s.admin_id = a.admin_id
            WHERE s.token = :token
            AND s.expiry > NOW()
            AND a.status = 'active'
        ");
        $token_check->bindParam(':token', $token);
        $token_check->execute();
        
        if ($token_check->rowCount() === 0) {
            return false;
        }
        
        return $token_check->fetch(PDO::FETCH_ASSOC);
    } catch (PDOException $e) {
        error_log("Token verification error: " . $e->getMessage());
        return false;
    }
}

/**
 * Get token from Authorization header
 * 
 * @return string|false Token if found, false otherwise
 */
function get_token_from_header() {
    $headers = getallheaders();
    
    if (!isset($headers['Authorization'])) {
        return false;
    }
    
    $auth_header = $headers['Authorization'];
    
    // Check if it's a Bearer token
    if (preg_match('/Bearer\s(\S+)/', $auth_header, $matches)) {
        return $matches[1];
    }
    
    return false;
}

/**
 * Require admin authentication
 * 
 * @param PDO $conn Database connection
 * @param array $required_roles Optional array of required roles
 * @return array Admin data
 */
function require_admin_auth($conn, $required_roles = []) {
    $token = get_token_from_header();
    
    if (!$token) {
        http_response_code(401);
        echo json_encode([
            'status' => 'error',
            'message' => 'Authentication required'
        ]);
        exit;
    }
    
    $admin = verify_admin_token($conn, $token);
    
    if (!$admin) {
        http_response_code(401);
        echo json_encode([
            'status' => 'error',
            'message' => 'Invalid or expired token'
        ]);
        exit;
    }
    
    // Check if admin has required role
    if (!empty($required_roles) && !in_array($admin['role'], $required_roles)) {
        http_response_code(403);
        echo json_encode([
            'status' => 'error',
            'message' => 'Insufficient permissions'
        ]);
        exit;
    }
    
    return $admin;
}

/**
 * Create admin account
 * 
 * @param PDO $conn Database connection
 * @param array $data Admin data
 * @return array Created admin data
 */
function create_admin($conn, $data) {
    try {
        // Generate UUID
        $admin_id = generate_uuid();
        
        // Hash password
        $hashed_password = password_hash($data['password'], PASSWORD_BCRYPT);
        
        // Insert admin
        $stmt = $conn->prepare("
            INSERT INTO admins (admin_id, username, password, role, status)
            VALUES (:admin_id, :username, :password, :role, :status)
        ");
        
        $role = isset($data['role']) ? $data['role'] : 'admin';
        $status = isset($data['status']) ? $data['status'] : 'active';
        
        $stmt->bindParam(':admin_id', $admin_id);
        $stmt->bindParam(':username', $data['username']);
        $stmt->bindParam(':password', $hashed_password);
        $stmt->bindParam(':role', $role);
        $stmt->bindParam(':status', $status);
        
        if (!$stmt->execute()) {
            return false;
        }
        
        return [
            'admin_id' => $admin_id,
            'username' => $data['username'],
            'role' => $role,
            'status' => $status
        ];
    } catch (PDOException $e) {
        error_log("Admin creation error: " . $e->getMessage());
        return false;
    }
}
?>