const { spawn } = require("node:child_process");

function buildPredictionCommand(config) {
  if (config.runtime === "wsl") {
    return {
      command: "wsl.exe",
      args: [
        "-d", config.wslDistro,
        "--", "bash", config.wslRunner,
        config.wslScript,
        "--bundle", config.wslBundle
      ]
    };
  }
  return {
    command: config.python,
    args: [config.script, "--bundle", config.bundle]
  };
}

function runPrediction(readings, config) {
  return new Promise((resolve, reject) => {
    const invocation = buildPredictionCommand(config);
    const child = spawn(invocation.command, invocation.args, {
      stdio: ["pipe", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    let settled = false;

    const timer = setTimeout(() => {
      child.kill();
      finish(new Error("Prediksi melewati batas waktu."));
    }, config.timeoutMs);

    function finish(error, value) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error);
      else resolve(value);
    }

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", chunk => { stdout += chunk; });
    child.stderr.on("data", chunk => { stderr += chunk; });
    child.on("error", finish);
    child.on("close", code => {
      if (code !== 0) {
        let message = stderr.trim() || `Proses prediksi berhenti dengan kode ${code}.`;
        try { message = JSON.parse(message).error || message; } catch {}
        finish(new Error(message));
        return;
      }
      try {
        finish(null, JSON.parse(stdout));
      } catch {
        finish(new Error("Keluaran prediksi bukan JSON yang valid."));
      }
    });
    child.stdin.end(JSON.stringify({ readings }));
  });
}

module.exports = { buildPredictionCommand, runPrediction };
