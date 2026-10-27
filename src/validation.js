function validateReading(body) {
  if (!body || typeof body !== "object") {
    throw new Error("Body JSON wajib diisi.");
  }
  const timestamp = String(body.timestamp || "").trim();
  const temperature = body.temperature === null || body.temperature === ""
    ? Number.NaN
    : Number(body.temperature);
  const humidity = body.humidity === undefined || body.humidity === null
    ? null
    : body.humidity === "" ? Number.NaN : Number(body.humidity);
  if (!timestamp || Number.isNaN(Date.parse(timestamp))) {
    throw new Error("timestamp harus berupa tanggal dan waktu yang valid.");
  }
  if (!Number.isFinite(temperature)) {
    throw new Error("temperature harus berupa angka.");
  }
  if (humidity !== null && !Number.isFinite(humidity)) {
    throw new Error("humidity harus berupa angka atau null.");
  }
  return { timestamp, temperature, humidity };
}

function validateSnapshot(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new Error("Body snapshot JSON wajib diisi.");
  }

  const source = String(body.source || "node-red-mini-pc").trim();
  if (!source || source.length > 80) {
    throw new Error("source wajib berisi 1 sampai 80 karakter.");
  }

  const reading = validateReading(body.reading);
  const prediction = body.prediction;
  if (!prediction || typeof prediction !== "object" || Array.isArray(prediction)) {
    throw new Error("prediction wajib berupa objek hasil Python API.");
  }

  const observedAt = validTimestamp(prediction.observed_at, "prediction.observed_at");
  if (new Date(reading.timestamp).getTime() !== new Date(observedAt).getTime()) {
    throw new Error("reading.timestamp harus sama dengan prediction.observed_at.");
  }

  const latestTemperature = finiteNumber(
    prediction.latest_temperature_celsius,
    "prediction.latest_temperature_celsius"
  );
  if (Math.abs(reading.temperature - latestTemperature) > 0.01) {
    throw new Error("reading.temperature harus sesuai dengan suhu terakhir hasil inferensi.");
  }
  const threshold = finiteNumber(prediction.threshold_celsius, "prediction.threshold_celsius");

  const models = prediction.models;
  const bundleStatus = prediction.bundle_status;
  const verificationStatus = prediction.verification_status;
  for (const [value, name] of [
    [models, "prediction.models"],
    [bundleStatus, "prediction.bundle_status"],
    [verificationStatus, "prediction.verification_status"]
  ]) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error(`${name} wajib berupa objek.`);
    }
  }

  const normalizedModels = {};
  for (const model of ["LSTM", "GRU"]) {
    const items = models[model];
    if (!Array.isArray(items)) {
      throw new Error(`prediction.models.${model} wajib berupa array.`);
    }
    if (!bundleStatus[model] || !verificationStatus[model]) {
      throw new Error(`Status bundle dan verifikasi ${model} wajib diisi.`);
    }
    normalizedModels[model] = validateModelPredictions(items, model, observedAt, threshold);
  }

  const snapshotId = String(
    body.snapshot_id || `${source}:${new Date(observedAt).toISOString()}`
  ).trim();
  if (!snapshotId || snapshotId.length > 191) {
    throw new Error("snapshot_id wajib berisi 1 sampai 191 karakter.");
  }

  return {
    snapshot_id: snapshotId,
    source,
    reading,
    prediction: {
      observed_at: observedAt,
      latest_temperature_celsius: latestTemperature,
      threshold_celsius: threshold,
      models: normalizedModels,
      bundle_status: {
        LSTM: String(bundleStatus.LSTM),
        GRU: String(bundleStatus.GRU)
      },
      verification_status: {
        LSTM: String(verificationStatus.LSTM),
        GRU: String(verificationStatus.GRU)
      }
    }
  };
}

function validateModelPredictions(items, model, observedAt, threshold) {
  const expectedHorizons = [60, 120, 180];
  const normalized = items.map((item, index) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw new Error(`Prediksi ${model} indeks ${index} wajib berupa objek.`);
    }
    const horizon = Number(item.horizon_minutes);
    if (!Number.isSafeInteger(horizon)) {
      throw new Error(`horizon_minutes ${model} wajib berupa bilangan bulat.`);
    }
    if (String(item.model || "").toUpperCase() !== model) {
      throw new Error(`Nama model pada prediksi ${model} tidak sesuai.`);
    }
    const temperature = finiteNumber(
      item.predicted_temperature_celsius,
      `predicted_temperature_celsius ${model}`
    );
    const targetTimestamp = validTimestamp(item.target_timestamp, `target_timestamp ${model}`);
    const expectedTarget = new Date(new Date(observedAt).getTime() + horizon * 60_000).getTime();
    if (new Date(targetTimestamp).getTime() !== expectedTarget) {
      throw new Error(`target_timestamp ${model} horizon ${horizon} tidak sesuai.`);
    }
    if (typeof item.above_threshold !== "boolean") {
      throw new Error(`above_threshold ${model} wajib berupa boolean.`);
    }
    if (item.above_threshold !== (temperature > threshold)) {
      throw new Error(`above_threshold ${model} tidak sesuai dengan nilai ambang.`);
    }
    return {
      horizon_minutes: horizon,
      model,
      predicted_temperature_celsius: temperature,
      target_timestamp: targetTimestamp,
      above_threshold: item.above_threshold
    };
  });

  const horizons = normalized.map(item => item.horizon_minutes).sort((a, b) => a - b);
  if (JSON.stringify(horizons) !== JSON.stringify(expectedHorizons)) {
    throw new Error(`Prediksi ${model} wajib memuat horizon 60, 120, dan 180 menit.`);
  }
  return normalized.sort((a, b) => a.horizon_minutes - b.horizon_minutes);
}

function finiteNumber(value, name) {
  const number = value === null || value === "" ? Number.NaN : Number(value);
  if (!Number.isFinite(number)) throw new Error(`${name} wajib berupa angka.`);
  return number;
}

function validTimestamp(value, name) {
  const timestamp = String(value || "").trim();
  if (!timestamp || Number.isNaN(Date.parse(timestamp))) {
    throw new Error(`${name} harus berupa tanggal dan waktu yang valid.`);
  }
  return timestamp;
}

module.exports = { validateReading, validateSnapshot };
