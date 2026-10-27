const test = require("node:test");
const assert = require("node:assert/strict");
const { buildPredictionCommand } = require("../src/predictor");

test("runtime WSL memanggil runner dan path Linux", () => {
  const invocation = buildPredictionCommand({
    runtime: "wsl",
    wslDistro: "Ubuntu",
    wslRunner: "/mnt/d/project/run_python_wsl.sh",
    wslScript: "07_predict.py",
    wslBundle: "deployment_bundle"
  });

  assert.equal(invocation.command, "wsl.exe");
  assert.deepEqual(invocation.args, [
    "-d", "Ubuntu", "--", "bash", "/mnt/d/project/run_python_wsl.sh",
    "07_predict.py", "--bundle", "deployment_bundle"
  ]);
});

test("runtime native tetap memakai executable Python langsung", () => {
  const invocation = buildPredictionCommand({
    runtime: "native",
    python: "python",
    script: "C:\\project\\07_predict.py",
    bundle: "C:\\project\\deployment_bundle"
  });

  assert.equal(invocation.command, "python");
  assert.deepEqual(invocation.args, [
    "C:\\project\\07_predict.py",
    "--bundle",
    "C:\\project\\deployment_bundle"
  ]);
});
