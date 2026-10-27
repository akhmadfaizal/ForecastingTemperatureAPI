CREATE TABLE IF NOT EXISTS sensor_readings (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  recorded_at DATETIME NOT NULL,
  temperature DECIMAL(6,3) NOT NULL,
  humidity DECIMAL(6,3) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_sensor_readings_recorded_at (recorded_at),
  KEY idx_sensor_readings_recorded_at (recorded_at)
) ENGINE=InnoDB;

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

CREATE TABLE IF NOT EXISTS temperature_predictions (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  requested_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  observed_at DATETIME NOT NULL,
  target_at DATETIME NOT NULL,
  horizon_minutes SMALLINT UNSIGNED NOT NULL,
  model_name VARCHAR(20) NOT NULL,
  ensemble_size SMALLINT UNSIGNED NOT NULL,
  predicted_temperature DECIMAL(7,4) NOT NULL,
  threshold_celsius DECIMAL(6,3) NOT NULL,
  above_threshold BOOLEAN NOT NULL,
  bundle_status VARCHAR(30) NOT NULL,
  PRIMARY KEY (id),
  KEY idx_predictions_target (target_at),
  KEY idx_predictions_horizon_requested (horizon_minutes, requested_at)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS influx_sync_logs (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  synced_at DATETIME NOT NULL,
  status VARCHAR(20) NOT NULL,
  query_start DATETIME NULL,
  query_stop DATETIME NULL,
  latest_data_at DATETIME NULL,
  fetched_count INT UNSIGNED NOT NULL DEFAULT 0,
  stored_count INT UNSIGNED NOT NULL DEFAULT 0,
  error_message VARCHAR(500) NULL,
  PRIMARY KEY (id),
  KEY idx_influx_sync_logs_synced_at (synced_at)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS influx_sync_log_items (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  sync_log_id BIGINT UNSIGNED NOT NULL,
  recorded_at DATETIME NOT NULL,
  temperature DECIMAL(6,3) NOT NULL,
  humidity DECIMAL(6,3) NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_influx_sync_log_item (sync_log_id, recorded_at),
  KEY idx_influx_sync_log_items_recorded_at (recorded_at),
  CONSTRAINT fk_influx_sync_log_items_log
    FOREIGN KEY (sync_log_id) REFERENCES influx_sync_logs(id)
    ON DELETE CASCADE
) ENGINE=InnoDB;
