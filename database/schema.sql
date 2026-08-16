CREATE DATABASE IF NOT EXISTS wifi_access_demo;
USE wifi_access_demo;

CREATE TABLE IF NOT EXISTS admins (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  email VARCHAR(255) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS qr_codes (
  id INT AUTO_INCREMENT PRIMARY KEY,
  token VARCHAR(512) NOT NULL UNIQUE,
  access_type ENUM('one_time', 'time_based') NOT NULL,
  duration_minutes INT NOT NULL,
  created_by INT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  expires_at DATETIME NOT NULL,
  status ENUM('active', 'expired', 'revoked', 'used') NOT NULL DEFAULT 'active',
  granted_at DATETIME NULL,
  revoked_at DATETIME NULL,
  used_at DATETIME NULL,
  INDEX idx_qr_status (status),
  INDEX idx_qr_expires_at (expires_at),
  CONSTRAINT fk_qr_created_by FOREIGN KEY (created_by) REFERENCES admins(id)
);

CREATE TABLE IF NOT EXISTS access_logs (
  id INT AUTO_INCREMENT PRIMARY KEY,
  qr_code_id INT NOT NULL,
  guest_identifier VARCHAR(255) NOT NULL,
  action ENUM('granted', 'denied', 'expired', 'revoked') NOT NULL,
  timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  reason VARCHAR(255) NULL,
  INDEX idx_logs_qr_code_id (qr_code_id),
  INDEX idx_logs_action (action),
  INDEX idx_logs_guest (guest_identifier),
  CONSTRAINT fk_logs_qr_code FOREIGN KEY (qr_code_id) REFERENCES qr_codes(id)
);

CREATE TABLE IF NOT EXISTS settings (
  id INT AUTO_INCREMENT PRIMARY KEY,
  setting_key VARCHAR(100) NOT NULL UNIQUE,
  setting_value VARCHAR(255) NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO settings (setting_key, setting_value)
VALUES ('default_duration', '60'),
       ('branding_text', 'Guest WiFi Access Demo')
ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value);
