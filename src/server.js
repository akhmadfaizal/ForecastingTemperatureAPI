const config = require("./config");
const { createApp } = require("./app");
const { startInfluxSync } = require("./influxSync");

createApp().listen(config.port, () => {
  console.log(`API prediksi berjalan di http://localhost:${config.port}`);
  if (config.enableLegacyArchitecture && config.influx.enabled) {
    console.log(`Sinkron InfluxDB aktif setiap ${config.influx.intervalMs / 1000} detik.`);
    startInfluxSync();
  }
});
