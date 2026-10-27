const test = require("node:test");
const assert = require("node:assert/strict");
const {
  buildFluxQuery,
  completedBoundary,
  jakartaMysqlTimestampToDate,
  toJakartaIso,
  syncInfluxOnce
} = require("../src/influxSync");

test("query Influx memakai mean 5 menit dan label awal slot", () => {
  const query = buildFluxQuery({
    bucket: "Zigbee",
    measurement: "sensor_ruang",
    start: new Date("2026-09-19T08:00:00.000Z"),
    stop: new Date("2026-09-19T09:00:00.000Z")
  });
  assert.match(query, /from\(bucket: "Zigbee"\)/);
  assert.match(query, /aggregateWindow\(every: 5m, fn: mean, createEmpty: false, timeSrc: "_start"\)/);
  assert.match(query, /temperature.*humidity/);
});

test("batas sinkron hanya memasukkan slot 5 menit yang sudah selesai", () => {
  assert.equal(
    completedBoundary(new Date("2026-09-19T09:03:44.000Z")).toISOString(),
    "2026-09-19T09:00:00.000Z"
  );
});

test("timestamp MySQL dibaca sebagai WIB", () => {
  assert.equal(
    jakartaMysqlTimestampToDate("2026-09-19 16:05:00").toISOString(),
    "2026-09-19T09:05:00.000Z"
  );
});

test("ringkasan waktu ditampilkan dalam WIB", () => {
  assert.equal(
    toJakartaIso("2026-09-19T09:25:00.000Z"),
    "2026-09-19T16:25:00+07:00"
  );
});

test("sinkron melanjutkan dari data terakhir dengan overlap lalu upsert", async () => {
  let queryText = "";
  let stored = [];
  let syncLog = null;
  const queryApi = {
    queryRows(query, observer) {
      queryText = query;
      observer.next([], {
        toObject: () => ({
          _time: "2026-09-19T09:05:00.000Z",
          temperature: 27.4,
          humidity: 55.2
        })
      });
      observer.complete();
    }
  };
  const database = {
    latestReadingTimestamp: async () => "2026-09-19 16:05:00",
    upsertReadings: async readings => {
      stored = readings;
      return readings.length;
    },
    saveInfluxSyncLog: async log => { syncLog = log; }
  };

  const result = await syncInfluxOnce({
    settings: {
      url: "http://example:8086",
      token: "test-token",
      org: "BINUS",
      bucket: "Zigbee",
      measurement: "sensor_ruang",
      overlapMinutes: 10,
      initialLookbackHours: 24
    },
    database,
    queryApi,
    now: new Date("2026-09-19T09:12:00.000Z")
  });

  assert.match(queryText, /2026-09-19T08:55:00\.000Z/);
  assert.match(queryText, /2026-09-19T09:10:00\.000Z/);
  assert.deepEqual(stored, [{
    timestamp: "2026-09-19T09:05:00.000Z",
    temperature: 27.4,
    humidity: 55.2
  }]);
  assert.equal(result.stored, 1);
  assert.equal(result.timezone, "Asia/Jakarta");
  assert.equal(result.start_wib, "2026-09-19T15:55:00+07:00");
  assert.equal(result.stop_wib, "2026-09-19T16:10:00+07:00");
  assert.equal(result.latest_data_wib, "2026-09-19T16:05:00+07:00");
  assert.equal(syncLog.status, "success");
  assert.equal(syncLog.fetched_count, 1);
  assert.equal(syncLog.stored_count, 1);
  assert.deepEqual(syncLog.readings, stored);
});

test("kegagalan sinkronisasi dicatat lalu tetap diteruskan", async () => {
  let syncLog = null;
  const database = {
    latestReadingTimestamp: async () => null,
    saveInfluxSyncLog: async log => { syncLog = log; }
  };
  const queryApi = {
    queryRows(_query, observer) {
      observer.error(new Error("Influx tidak dapat dijangkau"));
    }
  };

  await assert.rejects(
    syncInfluxOnce({
      settings: {
        url: "http://example:8086",
        token: "test-token",
        org: "BINUS",
        bucket: "Zigbee",
        measurement: "sensor_ruang",
        overlapMinutes: 10,
        initialLookbackHours: 24
      },
      database,
      queryApi,
      now: new Date("2026-09-19T09:12:00.000Z")
    }),
    /Influx tidak dapat dijangkau/
  );
  assert.equal(syncLog.status, "error");
  assert.equal(syncLog.error_message, "Influx tidak dapat dijangkau");
});
