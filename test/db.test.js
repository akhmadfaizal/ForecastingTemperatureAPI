const test = require("node:test");
const assert = require("node:assert/strict");
const { toJakartaMysqlDateTime, pool } = require("../src/db");

test.after(async () => {
  await pool.end();
});

test("timestamp disimpan sebagai waktu Jakarta", () => {
  assert.equal(
    toJakartaMysqlDateTime("2026-09-18T08:00:00+07:00"),
    "2026-09-18 08:00:00"
  );
  assert.equal(
    toJakartaMysqlDateTime("2026-09-18T01:00:00Z"),
    "2026-09-18 08:00:00"
  );
});
