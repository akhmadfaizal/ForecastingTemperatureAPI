const path = require("node:path");
const root = path.resolve(__dirname, "..");
const dotenv = require("dotenv");

const environment = process.env.NODE_ENV || "development";
dotenv.config({ path: path.join(root, `.env.${environment}`) });
dotenv.config({ path: path.join(root, ".env") });

const mysqlSslCa = (process.env.MYSQL_SSL_CA || "").replace(/\\n/g, "\n").trim();
const frontendOrigins = (process.env.FRONTEND_ORIGINS || "https://skripsi-temperature-dashboard.vercel.app")
  .split(",")
  .map(origin => origin.trim().replace(/\/$/, ""))
  .filter(Boolean);

module.exports = {
  port: Number(process.env.PORT || 3000),
  mysql: {
    host: process.env.MYSQL_HOST || "127.0.0.1",
    port: Number(process.env.MYSQL_PORT || 3306),
    user: process.env.MYSQL_USER || "root",
    password: process.env.MYSQL_PASSWORD || "",
    database: process.env.MYSQL_DATABASE || "skripsi_suhu",
    waitForConnections: true,
    connectionLimit: Number(process.env.MYSQL_CONNECTION_LIMIT || 2),
    dateStrings: true,
    timezone: "+07:00",
    ...(mysqlSslCa ? { ssl: { ca: mysqlSslCa, rejectUnauthorized: true } } : {})
  },
  predictor: {
    runtime: process.env.PREDICT_RUNTIME || "native",
    python: process.env.PYTHON_COMMAND || "python",
    script: path.resolve(root, process.env.PREDICT_SCRIPT || "../07_predict.py"),
    bundle: path.resolve(root, process.env.MODEL_BUNDLE || "../deployment_bundle"),
    wslDistro: process.env.WSL_DISTRO || "Ubuntu",
    wslRunner: process.env.WSL_RUNNER || "/mnt/d/Binus/Skripsi/pipeline_training_colab/run_python_wsl.sh",
    wslScript: process.env.PREDICT_SCRIPT_WSL || "07_predict.py",
    wslBundle: process.env.MODEL_BUNDLE_WSL || "deployment_bundle",
    timeoutMs: Number(process.env.PREDICT_TIMEOUT_MS || 120000)
  },
  influx: {
    enabled: process.env.INFLUX_SYNC_ENABLED === "true",
    url: process.env.INFLUX_URL || "http://192.168.11.202:8086",
    org: process.env.INFLUX_ORG || "BINUS",
    bucket: process.env.INFLUX_BUCKET || "Zigbee",
    token: process.env.INFLUX_TOKEN || "",
    measurement: process.env.INFLUX_MEASUREMENT || "sensor_ruang",
    intervalMs: Number(process.env.INFLUX_SYNC_INTERVAL_MS || 300000),
    overlapMinutes: Number(process.env.INFLUX_SYNC_OVERLAP_MINUTES || 10),
    initialLookbackHours: Number(process.env.INFLUX_INITIAL_LOOKBACK_HOURS || 24)
  },
  maxRawReadings: Number(process.env.MAX_RAW_READINGS || 2000),
  enableLegacyArchitecture: process.env.ENABLE_LEGACY_ARCHITECTURE === "true",
  snapshotIngestToken: process.env.SNAPSHOT_INGEST_TOKEN || "",
  frontendOrigins,
  frontendDist: path.resolve(root, process.env.FRONTEND_DIST || "../web_frontend/dist")
};
