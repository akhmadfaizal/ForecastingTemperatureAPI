const mysql = require("mysql2/promise");
const config = require("./config");

const pool = mysql.createPool(config.mysql);

async function healthCheck() {
  await pool.query("SELECT 1");
}

async function insertReading(reading) {
  const sql = `
    INSERT INTO sensor_readings (recorded_at, temperature, humidity)
    VALUES (?, ?, ?)
    ON DUPLICATE KEY UPDATE
      temperature = VALUES(temperature),
      humidity = VALUES(humidity)
  `;
  await pool.execute(sql, [
    toJakartaMysqlDateTime(reading.timestamp),
    reading.temperature,
    reading.humidity ?? null
  ]);
}

async function latestReadingTimestamp() {
  const [rows] = await pool.query(
    "SELECT MAX(recorded_at) AS recorded_at FROM sensor_readings"
  );
  return rows[0]?.recorded_at || null;
}

async function upsertReadings(readings) {
  if (!readings.length) return 0;
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const sql = `
      INSERT INTO sensor_readings (recorded_at, temperature, humidity)
      VALUES (?, ?, ?)
      ON DUPLICATE KEY UPDATE
        temperature = VALUES(temperature),
        humidity = VALUES(humidity)
    `;
    for (const reading of readings) {
      await connection.execute(sql, [
        toJakartaMysqlDateTime(reading.timestamp),
        reading.temperature,
        reading.humidity ?? null
      ]);
    }
    await connection.commit();
    return readings.length;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

async function recentReadings(limit) {
  const safeLimit = Math.max(1, Math.min(Number(limit) || 2000, 10000));
  const [rows] = await pool.query(
    `SELECT recorded_at AS timestamp, temperature, humidity
     FROM sensor_readings
     ORDER BY recorded_at DESC
     LIMIT ${safeLimit}`
  );
  return rows.reverse();
}

async function saveInfluxSyncLog(log) {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [result] = await connection.execute(
      `INSERT INTO influx_sync_logs
        (synced_at, status, query_start, query_stop, latest_data_at,
         fetched_count, stored_count, error_message)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        toJakartaMysqlDateTime(log.synced_at),
        log.status,
        log.query_start ? toJakartaMysqlDateTime(log.query_start) : null,
        log.query_stop ? toJakartaMysqlDateTime(log.query_stop) : null,
        log.latest_data_at ? toJakartaMysqlDateTime(log.latest_data_at) : null,
        Number(log.fetched_count) || 0,
        Number(log.stored_count) || 0,
        log.error_message ? String(log.error_message).slice(0, 500) : null
      ]
    );
    const itemSql = `
      INSERT INTO influx_sync_log_items
        (sync_log_id, recorded_at, temperature, humidity)
      VALUES (?, ?, ?, ?)
    `;
    for (const reading of log.readings || []) {
      await connection.execute(itemSql, [
        result.insertId,
        toJakartaMysqlDateTime(reading.timestamp),
        reading.temperature,
        reading.humidity ?? null
      ]);
    }
    await connection.commit();
    return result.insertId;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

async function recentInfluxSyncLogs(limit) {
  const safeLimit = Math.max(1, Math.min(Number(limit) || 8, 50));
  const [rows] = await pool.query(
    `SELECT l.id, l.synced_at, l.status, l.query_start, l.query_stop, l.latest_data_at,
            l.fetched_count, l.stored_count, l.error_message,
            (SELECT COUNT(*) FROM influx_sync_log_items i WHERE i.sync_log_id = l.id) AS detail_count
     FROM influx_sync_logs l
     ORDER BY l.synced_at DESC, l.id DESC
     LIMIT ${safeLimit}`
  );
  return rows;
}

async function influxSyncLogSlots(logId) {
  const [rows] = await pool.execute(
    `SELECT recorded_at AS timestamp, temperature, humidity
     FROM influx_sync_log_items
     WHERE sync_log_id = ?
     ORDER BY recorded_at`,
    [logId]
  );
  return rows;
}

async function savePredictions(result) {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const sql = `
      INSERT INTO temperature_predictions
        (observed_at, target_at, horizon_minutes, model_name, ensemble_size,
         predicted_temperature, threshold_celsius, above_threshold, bundle_status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;
    for (const prediction of result.predictions) {
      await connection.execute(sql, [
        toJakartaMysqlDateTime(result.observed_at),
        toJakartaMysqlDateTime(prediction.target_timestamp),
        prediction.horizon_minutes,
        prediction.model,
        prediction.ensemble_size,
        prediction.predicted_temperature_celsius,
        result.threshold_celsius,
        prediction.above_threshold,
        result.bundle_status
      ]);
    }
    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

async function saveSnapshot(snapshot) {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const prediction = snapshot.prediction;
    try {
      await connection.execute(
        `INSERT INTO edge_snapshot_receipts
          (snapshot_key, source_name, observed_at, latest_temperature, humidity,
           threshold_celsius, bundle_status_json, verification_status_json)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          snapshot.snapshot_id,
          snapshot.source,
          toJakartaMysqlDateTime(prediction.observed_at),
          prediction.latest_temperature_celsius,
          snapshot.reading.humidity ?? null,
          prediction.threshold_celsius,
          JSON.stringify(prediction.bundle_status),
          JSON.stringify(prediction.verification_status)
        ]
      );
    } catch (error) {
      if (error.code !== "ER_DUP_ENTRY") throw error;
      await connection.rollback();
      return { stored: false, duplicate: true, snapshot_id: snapshot.snapshot_id };
    }

    await connection.execute(
      `INSERT INTO sensor_readings (recorded_at, temperature, humidity)
       VALUES (?, ?, ?)
       ON DUPLICATE KEY UPDATE
         temperature = VALUES(temperature),
         humidity = VALUES(humidity)`,
      [
        toJakartaMysqlDateTime(snapshot.reading.timestamp),
        snapshot.reading.temperature,
        snapshot.reading.humidity ?? null
      ]
    );

    const sql = `
      INSERT INTO temperature_predictions
        (observed_at, target_at, horizon_minutes, model_name, ensemble_size,
         predicted_temperature, threshold_celsius, above_threshold, bundle_status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;
    for (const [model, items] of Object.entries(prediction.models)) {
      for (const item of items) {
        await connection.execute(sql, [
          toJakartaMysqlDateTime(prediction.observed_at),
          toJakartaMysqlDateTime(item.target_timestamp),
          item.horizon_minutes,
          model,
          1,
          item.predicted_temperature_celsius,
          prediction.threshold_celsius,
          item.above_threshold,
          prediction.bundle_status[model]
        ]);
      }
    }
    await connection.commit();
    return {
      stored: true,
      duplicate: false,
      snapshot_id: snapshot.snapshot_id,
      predictions_stored: Object.values(prediction.models).flat().length
    };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

async function latestPredictions() {
  const [rows] = await pool.query(`
    SELECT p.*
    FROM temperature_predictions p
    INNER JOIN (
      SELECT model_name, horizon_minutes, MAX(id) AS max_id
      FROM temperature_predictions
      GROUP BY model_name, horizon_minutes
    ) latest ON latest.max_id = p.id
    ORDER BY p.horizon_minutes
  `);
  return rows;
}

function toJakartaMysqlDateTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`Timestamp tidak valid: ${value}`);
  }
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Jakarta",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
    hourCycle: "h23"
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day} ${values.hour}:${values.minute}:${values.second}`;
}

module.exports = {
  pool,
  healthCheck,
  insertReading,
  latestReadingTimestamp,
  upsertReadings,
  recentReadings,
  saveInfluxSyncLog,
  recentInfluxSyncLogs,
  influxSyncLogSlots,
  savePredictions,
  saveSnapshot,
  latestPredictions,
  toJakartaMysqlDateTime
};
