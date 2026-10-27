const test = require("node:test");
const assert = require("node:assert/strict");
const { validateReading, validateSnapshot } = require("../src/validation");

test("menerima data sensor valid", () => {
  assert.deepEqual(
    validateReading({
      timestamp: "2026-09-18T08:00:00+07:00",
      temperature: 26.5,
      humidity: 51
    }),
    {
      timestamp: "2026-09-18T08:00:00+07:00",
      temperature: 26.5,
      humidity: 51
    }
  );
});

test("menolak suhu bukan angka", () => {
  assert.throws(
    () => validateReading({ timestamp: "2026-09-18T08:00:00+07:00", temperature: "x" }),
    /temperature/
  );
});

test("menolak suhu null", () => {
  assert.throws(
    () => validateReading({ timestamp: "2026-09-18T08:00:00+07:00", temperature: null }),
    /temperature/
  );
});

test("snapshot menghasilkan ID deterministik dan enam prediksi", () => {
  const observedAt = "2026-09-29T10:00:00+07:00";
  const predictions = model => [60, 120, 180].map((horizon, index) => ({
    horizon_minutes: horizon,
    model,
    predicted_temperature_celsius: 26.8 + index / 10,
    target_timestamp: new Date(new Date(observedAt).getTime() + horizon * 60_000).toISOString(),
    above_threshold: false
  }));
  const result = validateSnapshot({
    source: "node-red-mini-pc",
    reading: { timestamp: observedAt, temperature: 26.8, humidity: 55.2 },
    prediction: {
      observed_at: observedAt,
      latest_temperature_celsius: 26.8,
      threshold_celsius: 27,
      models: { LSTM: predictions("LSTM"), GRU: predictions("GRU") },
      bundle_status: { LSTM: "kandidat_lstm", GRU: "kandidat_gru" },
      verification_status: { LSTM: "passed", GRU: "failed_reference" }
    }
  });
  assert.equal(result.snapshot_id, "node-red-mini-pc:2026-09-29T03:00:00.000Z");
  assert.equal(result.prediction.models.LSTM.length, 3);
  assert.equal(result.prediction.models.GRU.length, 3);
});

test("ambang prediksi ketat: tepat 27 tidak memicu, di atas 27 memicu", () => {
  const observedAt = "2026-09-29T10:00:00+07:00";
  const predictions = model => [26.999999, 27, 27.000001].map((temperature, index) => ({
    horizon_minutes: (index + 1) * 60,
    model,
    predicted_temperature_celsius: temperature,
    target_timestamp: new Date(new Date(observedAt).getTime() + (index + 1) * 3_600_000).toISOString(),
    above_threshold: temperature > 27
  }));
  const body = {
    reading: { timestamp: observedAt, temperature: 27, humidity: 50 },
    prediction: {
      observed_at: observedAt, latest_temperature_celsius: 27, threshold_celsius: 27,
      models: { LSTM: predictions("LSTM"), GRU: predictions("GRU") },
      bundle_status: { LSTM: "synthetic", GRU: "synthetic" },
      verification_status: { LSTM: "test_only", GRU: "test_only" }
    }
  };
  assert.deepEqual(validateSnapshot(body).prediction.models.LSTM.map(item => item.above_threshold), [false, false, true]);
  body.prediction.models.LSTM[1].above_threshold = true;
  assert.throws(() => validateSnapshot(body), /tidak sesuai dengan nilai ambang/);
});
