const { InfluxDB } = require("@influxdata/influxdb-client");
const db = require("./db");
const config = require("./config");

const FIVE_MINUTES_MS = 5 * 60 * 1000;
const syncStatus = {
  state: config.influx.enabled ? "waiting" : "disabled",
  lastSyncWib: null,
  lastDataWib: null,
  lastFetched: 0,
  lastStored: 0,
  error: null
};

function fluxString(value) {
  return JSON.stringify(String(value));
}

function buildFluxQuery({ bucket, measurement, start, stop }) {
  return `
from(bucket: ${fluxString(bucket)})
  |> range(start: time(v: ${fluxString(start.toISOString())}), stop: time(v: ${fluxString(stop.toISOString())}))
  |> filter(fn: (r) => r["_measurement"] == ${fluxString(measurement)})
  |> filter(fn: (r) => r["_field"] == "temperature" or r["_field"] == "humidity")
  |> aggregateWindow(every: 5m, fn: mean, createEmpty: false, timeSrc: "_start")
  |> pivot(rowKey: ["_time"], columnKey: ["_field"], valueColumn: "_value")
  |> keep(columns: ["_time", "temperature", "humidity"])
  |> sort(columns: ["_time"])
`.trim();
}

function jakartaMysqlTimestampToDate(value) {
  if (value instanceof Date) return value;
  const text = String(value).trim().replace(" ", "T");
  const date = new Date(`${text}+07:00`);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`Timestamp MySQL tidak valid: ${value}`);
  }
  return date;
}

function completedBoundary(now = new Date()) {
  return new Date(Math.floor(now.getTime() / FIVE_MINUTES_MS) * FIVE_MINUTES_MS);
}

function toJakartaIso(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`Timestamp tidak valid: ${value}`);
  }
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Jakarta",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23"
  }).formatToParts(date);
  const item = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${item.year}-${item.month}-${item.day}T${item.hour}:${item.minute}:${item.second}+07:00`;
}

async function queryInfluxReadings(settings, start, stop, dependencies = {}) {
  const client = dependencies.client || new InfluxDB({
    url: settings.url,
    token: settings.token
  });
  const queryApi = dependencies.queryApi || client.getQueryApi(settings.org);
  const query = buildFluxQuery({
    bucket: settings.bucket,
    measurement: settings.measurement,
    start,
    stop
  });

  const readings = [];
  await new Promise((resolve, reject) => {
    queryApi.queryRows(query, {
      next(row, tableMeta) {
        const item = tableMeta.toObject(row);
        const temperature = Number(item.temperature);
        if (!item._time || !Number.isFinite(temperature)) return;
        const humidity = item.humidity == null ? null : Number(item.humidity);
        readings.push({
          timestamp: item._time,
          temperature,
          humidity: Number.isFinite(humidity) ? humidity : null
        });
      },
      error: reject,
      complete: resolve
    });
  });
  return { readings, query };
}

async function syncInfluxOnce(options = {}) {
  const settings = options.settings || config.influx;
  const database = options.database || db;
  const now = options.now || new Date();
  const syncedAt = options.syncedAt || new Date();
  let start = null;
  let stop = null;

  try {
    if (!settings.token) {
      throw new Error("INFLUX_TOKEN belum diisi di web_api/.env.");
    }

    const latest = await database.latestReadingTimestamp();
    stop = completedBoundary(now);
    start = latest
      ? new Date(jakartaMysqlTimestampToDate(latest).getTime() - settings.overlapMinutes * 60 * 1000)
      : new Date(stop.getTime() - settings.initialLookbackHours * 60 * 60 * 1000);

    const { readings } = await queryInfluxReadings(settings, start, stop, options);
    const stored = await database.upsertReadings(readings);
    const latestData = readings.length ? readings.at(-1).timestamp : null;
    const result = {
      timezone: "Asia/Jakarta",
      start_wib: toJakartaIso(start),
      stop_wib: toJakartaIso(stop),
      latest_data_wib: latestData ? toJakartaIso(latestData) : null,
      fetched: readings.length,
      stored
    };
    await persistSyncLog(database, {
      synced_at: syncedAt,
      status: "success",
      query_start: start,
      query_stop: stop,
      latest_data_at: latestData,
      fetched_count: readings.length,
      stored_count: stored,
      error_message: null,
      readings
    });
    return result;
  } catch (error) {
    await persistSyncLog(database, {
      synced_at: syncedAt,
      status: "error",
      query_start: start,
      query_stop: stop,
      latest_data_at: null,
      fetched_count: 0,
      stored_count: 0,
      error_message: error.message
    });
    throw error;
  }
}

async function persistSyncLog(database, log) {
  if (typeof database.saveInfluxSyncLog !== "function") return;
  try {
    await database.saveInfluxSyncLog(log);
  } catch (error) {
    console.error(`Log sinkronisasi tidak dapat disimpan: ${error.message}`);
  }
}

function getInfluxSyncStatus(settings = config.influx) {
  return {
    source: "InfluxDB",
    organization: settings.org,
    bucket: settings.bucket,
    measurement: settings.measurement,
    enabled: settings.enabled,
    connected: syncStatus.state === "connected",
    state: settings.enabled ? syncStatus.state : "disabled",
    last_sync_wib: syncStatus.lastSyncWib,
    last_data_wib: syncStatus.lastDataWib,
    last_fetched: syncStatus.lastFetched,
    last_stored: syncStatus.lastStored,
    error: syncStatus.error
  };
}

function startInfluxSync(options = {}) {
  const settings = options.settings || config.influx;
  if (!settings.enabled) {
    syncStatus.state = "disabled";
    return null;
  }

  let running = false;
  const run = async () => {
    if (running) return;
    running = true;
    syncStatus.state = "connecting";
    syncStatus.error = null;
    try {
      const result = await syncInfluxOnce(options);
      syncStatus.state = "connected";
      syncStatus.lastSyncWib = toJakartaIso(new Date());
      syncStatus.lastDataWib = result.latest_data_wib || syncStatus.lastDataWib;
      syncStatus.lastFetched = result.fetched;
      syncStatus.lastStored = result.stored;
      console.log(`Sinkron InfluxDB selesai: ${result.stored} slot, sampai ${result.stop_wib}`);
    } catch (error) {
      syncStatus.state = "error";
      syncStatus.error = error.message;
      console.error(`Sinkron InfluxDB gagal: ${error.message}`);
    } finally {
      running = false;
    }
  };

  void run();
  return setInterval(run, settings.intervalMs);
}

module.exports = {
  buildFluxQuery,
  completedBoundary,
  jakartaMysqlTimestampToDate,
  toJakartaIso,
  queryInfluxReadings,
  syncInfluxOnce,
  getInfluxSyncStatus,
  startInfluxSync
};
