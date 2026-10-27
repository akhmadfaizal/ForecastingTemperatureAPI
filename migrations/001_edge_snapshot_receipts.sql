CREATE TABLE IF NOT EXISTS edge_snapshot_receipts (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  snapshot_key VARCHAR(191) NOT NULL,
  source_name VARCHAR(80) NOT NULL,
  received_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  observed_at DATETIME NOT NULL,
  latest_temperature DECIMAL(7,4) NOT NULL,
  humidity DECIMAL(6,3) NULL,
  threshold_celsius DECIMAL(6,3) NOT NULL,
  bundle_status_json TEXT NOT NULL,
  verification_status_json TEXT NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_edge_snapshot_key (snapshot_key),
  KEY idx_edge_snapshot_observed_at (observed_at)
) ENGINE=InnoDB;
