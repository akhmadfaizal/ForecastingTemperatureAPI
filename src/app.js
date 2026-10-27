const express = require("express");
const fs = require("node:fs");
const path = require("node:path");
const config = require("./config");
const db = require("./db");
const { validateReading, validateSnapshot } = require("./validation");

function createApp(dependencies = {}) {
  const database = dependencies.database || db;
  const settings = dependencies.settings || config;
  const legacyEnabled = settings.enableLegacyArchitecture === true;
  const predictor = dependencies.predictor || (
    legacyEnabled ? require("./predictor").runPrediction : null
  );
  const influxStatus = dependencies.influxStatus || (
    legacyEnabled ? require("./influxSync").getInfluxSyncStatus : null
  );
  const app = express();
  app.use(corsForFrontend(settings.frontendOrigins || []));
  app.use(express.json({ limit: "1mb" }));

  app.get("/health", asyncHandler(async (_req, res) => {
    await database.healthCheck();
    res.json({
      status: "ok",
      mode: legacyEnabled ? "legacy-and-edge-ingest" : "edge-ingest",
      server_time: new Date().toISOString()
    });
  }));

  if (legacyEnabled) {
    app.get("/api/influx/status", (_req, res) => {
      res.json(influxStatus());
    });

    app.get("/api/influx/logs", asyncHandler(async (req, res) => {
      const requested = Number(req.query.limit || 8);
      const limit = Math.max(1, Math.min(Number.isFinite(requested) ? requested : 8, 50));
      res.json({ logs: await database.recentInfluxSyncLogs(limit) });
    }));

    app.get("/api/influx/logs/:id/slots", asyncHandler(async (req, res) => {
      const logId = Number(req.params.id);
      if (!Number.isSafeInteger(logId) || logId < 1) {
        throw new Error("ID log sinkronisasi tidak valid.");
      }
      res.json({ slots: await database.influxSyncLogSlots(logId) });
    }));
  }

  if (legacyEnabled) {
    app.post("/api/readings", asyncHandler(async (req, res) => {
      const reading = validateReading(req.body);
      await database.insertReading(reading);
      res.status(201).json({ stored: true, reading });
    }));
  }

  app.get("/api/readings/latest", asyncHandler(async (req, res) => {
    const requested = Number(req.query.limit || 72);
    const limit = Math.max(1, Math.min(Number.isFinite(requested) ? requested : 72, 2000));
    res.json({
      server_time: new Date().toISOString(),
      readings: await database.recentReadings(limit)
    });
  }));

  app.post("/api/snapshots", asyncHandler(async (req, res) => {
    requireBearerToken(req, settings.snapshotIngestToken);
    const snapshot = validateSnapshot(req.body);
    const result = await database.saveSnapshot(snapshot);
    res.status(result.duplicate ? 200 : 201).json(result);
  }));

  if (legacyEnabled) {
    app.post("/api/predictions", asyncHandler(async (_req, res) => {
      const readings = await database.recentReadings(settings.maxRawReadings);
      const result = await predictor(readings, settings.predictor);
      await database.savePredictions(result);
      res.status(201).json(result);
    }));
  }

  app.get("/api/predictions/latest", asyncHandler(async (_req, res) => {
    res.json({
      server_time: new Date().toISOString(),
      predictions: await database.latestPredictions()
    });
  }));

  if (fs.existsSync(settings.frontendDist)) {
    app.use(express.static(settings.frontendDist));
    app.get("*", (req, res, next) => {
      if (req.path.startsWith("/api/")) return next();
      res.sendFile(path.join(settings.frontendDist, "index.html"));
    });
  }

  app.use((error, _req, res, _next) => {
    const status = error.statusCode || (/wajib|harus|belum cukup|tidak valid|tidak boleh|tidak sesuai/i.test(error.message)
      ? 400
      : 500);
    res.status(status).json({ error: error.message });
  });
  return app;
}

function requireBearerToken(req, expectedToken) {
  if (!expectedToken) {
    const error = new Error("SNAPSHOT_INGEST_TOKEN belum dikonfigurasi pada API.");
    error.statusCode = 503;
    throw error;
  }
  const authorization = String(req.headers.authorization || "");
  if (authorization !== `Bearer ${expectedToken}`) {
    const error = new Error("Otorisasi pengiriman snapshot tidak valid.");
    error.statusCode = 401;
    throw error;
  }
}

function corsForFrontend(frontendOrigins) {
  const allowed = new Set(frontendOrigins);
  return (req, res, next) => {
    const origin = String(req.headers.origin || "").replace(/\/$/, "");
    if (origin && allowed.has(origin)) {
      res.setHeader("Access-Control-Allow-Origin", origin);
      res.setHeader("Vary", "Origin");
      res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
      res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    }
    if (req.method === "OPTIONS") {
      return allowed.has(origin) ? res.status(204).end() : res.status(403).end();
    }
    next();
  };
}

function asyncHandler(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}

module.exports = { createApp };
