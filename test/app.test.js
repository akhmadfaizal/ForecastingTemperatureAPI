const test = require("node:test");
const assert = require("node:assert/strict");
const { createApp } = require("../src/app");

function fixtures() {
  const stored = [];
  const prediction = {
    observed_at: "2026-09-18T08:00:00+07:00",
    threshold_celsius: 27,
    bundle_status: "uji_coba",
    predictions: [
      {
        horizon_minutes: 60,
        model: "NAIVE",
        ensemble_size: 1,
        predicted_temperature_celsius: 26.5,
        target_timestamp: "2026-09-18T09:00:00+07:00",
        above_threshold: false
      }
    ]
  };
  return {
    database: {
      healthCheck: async () => {},
      insertReading: async reading => { stored.push(reading); },
      recentReadings: async () => stored,
      recentInfluxSyncLogs: async () => [{
        id: 1,
        synced_at: "2026-09-19 16:30:00",
        status: "success",
        latest_data_at: "2026-09-19 16:25:00",
        fetched_count: 4,
        stored_count: 4,
        detail_count: 1,
        error_message: null
      }],
      influxSyncLogSlots: async logId => logId === 1 ? [{
        timestamp: "2026-09-19 16:25:00",
        temperature: "27.400",
        humidity: "55.200"
      }] : [],
      savePredictions: async result => { stored.result = result; },
      saveSnapshot: async snapshot => {
        stored.snapshot = snapshot;
        return {
          stored: true,
          duplicate: false,
          snapshot_id: snapshot.snapshot_id,
          predictions_stored: 6
        };
      },
      latestPredictions: async () => prediction.predictions
    },
    predictor: async readings => {
      assert.equal(readings.length, 1);
      return prediction;
    },
    influxStatus: () => ({
      source: "InfluxDB",
      enabled: true,
      connected: true,
      state: "connected",
      last_sync_wib: "2026-09-19T16:30:00+07:00",
      last_data_wib: "2026-09-19T16:25:00+07:00",
      last_fetched: 4,
      last_stored: 4,
      error: null
    }),
    settings: {
      maxRawReadings: 2000,
      snapshotIngestToken: "token-uji",
      enableLegacyArchitecture: true,
      frontendOrigins: ["https://skripsi-temperature-dashboard.vercel.app"],
      predictor: {},
      frontendDist: "Z:/folder-yang-tidak-ada"
    },
    stored,
    prediction
  };
}

async function withServer(run) {
  const deps = fixtures();
  const server = createApp(deps).listen(0);
  await new Promise(resolve => server.once("listening", resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  try {
    await run(baseUrl, deps);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
}

test("health dan alur simpan lalu prediksi", async () => {
  await withServer(async (baseUrl, deps) => {
    let response = await fetch(`${baseUrl}/health`);
    assert.equal(response.status, 200);

    response = await fetch(`${baseUrl}/api/readings`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        timestamp: "2026-09-18T08:00:00+07:00",
        temperature: 26.5
      })
    });
    assert.equal(response.status, 201);

    response = await fetch(`${baseUrl}/api/predictions`, { method: "POST" });
    assert.equal(response.status, 201);
    assert.deepEqual(await response.json(), deps.prediction);
    assert.deepEqual(deps.stored.result, deps.prediction);

    response = await fetch(`${baseUrl}/api/predictions/latest`);
    assert.equal(response.status, 200);
    assert.equal((await response.json()).predictions.length, 1);
  });
});

test("menerima snapshot Node-RED berisi prediksi LSTM dan GRU", async () => {
  await withServer(async (baseUrl, deps) => {
    const response = await fetch(`${baseUrl}/api/snapshots`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: "Bearer token-uji"
      },
      body: JSON.stringify(snapshotFixture())
    });
    assert.equal(response.status, 201);
    const body = await response.json();
    assert.equal(body.stored, true);
    assert.equal(body.predictions_stored, 6);
    assert.equal(deps.stored.snapshot.prediction.models.LSTM.length, 3);
    assert.equal(deps.stored.snapshot.prediction.models.GRU.length, 3);
  });
});

test("menolak snapshot tanpa bearer token", async () => {
  await withServer(async baseUrl => {
    const response = await fetch(`${baseUrl}/api/snapshots`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(snapshotFixture())
    });
    assert.equal(response.status, 401);
  });
});

function snapshotFixture() {
  const observedAt = "2026-09-29T10:00:00+07:00";
  const predictions = model => [60, 120, 180].map((horizon, index) => ({
    horizon_minutes: horizon,
    model,
    predicted_temperature_celsius: 26.8 + index / 10,
    target_timestamp: new Date(new Date(observedAt).getTime() + horizon * 60_000).toISOString(),
    above_threshold: false
  }));
  return {
    source: "node-red-mini-pc",
    reading: { timestamp: observedAt, temperature: 26.8, humidity: 55.2 },
    prediction: {
      observed_at: observedAt,
      latest_temperature_celsius: 26.8,
      threshold_celsius: 27,
      models: { LSTM: predictions("LSTM"), GRU: predictions("GRU") },
      bundle_status: { LSTM: "kandidat_lstm", GRU: "kandidat_gru" },
      verification_status: { LSTM: "passed_cpu_mini_pc", GRU: "failed_reference" }
    }
  };
}

test("reading tidak valid menghasilkan 400", async () => {
  await withServer(async baseUrl => {
    const response = await fetch(`${baseUrl}/api/readings`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ timestamp: "salah", temperature: null })
    });
    assert.equal(response.status, 400);
  });
});

test("mengambil pembacaan terbaru", async () => {
  await withServer(async (baseUrl, deps) => {
    deps.stored.push({ timestamp: "2026-09-18 08:00:00", temperature: "26.500" });
    const response = await fetch(`${baseUrl}/api/readings/latest?limit=72`);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.readings.length, 1);
    assert.match(body.server_time, /^\d{4}-\d{2}-\d{2}T/);
  });
});

test("mode edge-ingest menutup endpoint penulisan pembacaan lama", async () => {
  const deps = fixtures();
  deps.settings.enableLegacyArchitecture = false;
  const server = createApp(deps).listen(0, "127.0.0.1");
  await new Promise(resolve => server.once("listening", resolve));
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/readings`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ timestamp: "2026-09-18T08:00:00+07:00", temperature: 26.5 })
    });
    assert.equal(response.status, 404);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});

test("CORS hanya mengizinkan domain frontend production", async () => {
  await withServer(async baseUrl => {
    let response = await fetch(`${baseUrl}/health`, {
      headers: { origin: "https://skripsi-temperature-dashboard.vercel.app" }
    });
    assert.equal(response.headers.get("access-control-allow-origin"), "https://skripsi-temperature-dashboard.vercel.app");

    response = await fetch(`${baseUrl}/health`, {
      headers: { origin: "https://contoh-tidak-diizinkan.invalid" }
    });
    assert.equal(response.headers.get("access-control-allow-origin"), null);
  });
});

test("menampilkan status sumber data InfluxDB", async () => {
  await withServer(async baseUrl => {
    const response = await fetch(`${baseUrl}/api/influx/status`);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.source, "InfluxDB");
    assert.equal(body.connected, true);
    assert.equal(body.last_fetched, 4);
  });
});

test("menampilkan log sinkronisasi InfluxDB terbaru", async () => {
  await withServer(async baseUrl => {
    const response = await fetch(`${baseUrl}/api/influx/logs?limit=8`);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.logs.length, 1);
    assert.equal(body.logs[0].status, "success");
    assert.equal(body.logs[0].fetched_count, 4);
    assert.equal(body.logs[0].detail_count, 1);
  });
});

test("menampilkan slot yang diterima pada satu log sinkronisasi", async () => {
  await withServer(async baseUrl => {
    const response = await fetch(`${baseUrl}/api/influx/logs/1/slots`);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.slots.length, 1);
    assert.equal(body.slots[0].timestamp, "2026-09-19 16:25:00");
    assert.equal(body.slots[0].temperature, "27.400");
  });
});

test("menolak ID log sinkronisasi yang tidak valid", async () => {
  await withServer(async baseUrl => {
    const response = await fetch(`${baseUrl}/api/influx/logs/salah/slots`);
    assert.equal(response.status, 400);
  });
});
