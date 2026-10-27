-- Jalankan pada koneksi MySQL Aiven yang sudah tersedia.
-- Hanya membaca data; zona waktu diatur untuk sesi koneksi ini.
SET time_zone = '+07:00';

WITH receipts AS (
  SELECT snapshot_key, observed_at, received_at,
         LAG(received_at) OVER (ORDER BY received_at, id) AS previous_received_at
  FROM edge_snapshot_receipts
  WHERE source_name = 'node-red-mini-pc'
    AND received_at >= '2026-10-04 15:30:00'
    AND received_at < '2026-10-04 17:00:00'
), prediction_counts AS (
  SELECT observed_at,
         COUNT(*) AS prediction_rows,
         COUNT(DISTINCT CASE
           WHEN model_name IN ('LSTM', 'GRU')
             AND horizon_minutes IN (60, 120, 180)
           THEN CONCAT(model_name, ':', horizon_minutes)
         END) AS valid_model_horizon_combinations
  FROM temperature_predictions
  GROUP BY observed_at
)
SELECT r.snapshot_key, r.observed_at AS observed_at_wib,
       r.received_at AS received_at_wib,
       TIMESTAMPDIFF(SECOND, r.previous_received_at, r.received_at) AS receipt_interval_seconds,
       COALESCE(p.prediction_rows, 0) AS prediction_rows,
       COALESCE(p.valid_model_horizon_combinations, 0) AS valid_model_horizon_combinations
FROM receipts r
LEFT JOIN prediction_counts p ON p.observed_at = r.observed_at
ORDER BY r.received_at, r.snapshot_key;
