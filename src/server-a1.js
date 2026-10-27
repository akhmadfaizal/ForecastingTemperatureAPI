// Local Mac entrypoint for A1. Keep this service bound to loopback.
const config = require('./config');
const { createApp } = require('./app');
const { syncInfluxOnce } = require('./influxSync');
const database = require('./db');
const { runPrediction } = require('./predictor');
const { createA1Cycle } = require('./a1Cycle');

if (!config.enableLegacyArchitecture || config.predictor.runtime !== 'native') {
  throw new Error('A1 requires development configuration with native inference.');
}
const cycle = createA1Cycle({ sync: syncInfluxOnce, database, predictor: runPrediction, settings: config });
const app = createApp({ influxStatus: () => ({ enabled: config.influx.enabled, source: 'InfluxDB', ...cycle.getStatus() }) });
app.listen(config.port, '127.0.0.1', () => {
  console.log(`Arsitektur 1: http://localhost:${config.port}`);
  if (config.influx.enabled) cycle.start(config.influx.intervalMs);
});
