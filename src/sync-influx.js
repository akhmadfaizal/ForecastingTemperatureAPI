const { syncInfluxOnce } = require("./influxSync");

syncInfluxOnce()
  .then(result => {
    console.log(JSON.stringify(result, null, 2));
    process.exitCode = 0;
  })
  .catch(error => {
    console.error(error.message);
    process.exitCode = 1;
  });
