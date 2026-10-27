const test = require('node:test');
const assert = require('node:assert/strict');
const { createA1Cycle } = require('../src/a1Cycle');

function fixture() {
  const calls = [];
  const result = {
    observed_at: '2026-10-13T01:00:00+07:00', bundle_status: 'test_bundle',
    predictions: ['LSTM', 'GRU'].flatMap(model => [60, 120, 180].map(horizon_minutes => ({ model, horizon_minutes })))
  };
  const dependencies = {
    sync: async () => { calls.push('sync'); return { stored: 3 }; },
    database: {
      recentReadings: async () => { calls.push('read'); return [{ temperature: 25 }]; },
      latestPredictions: async () => [],
      savePredictions: async value => { calls.push('save'); assert.equal(value, result); }
    },
    predictor: async () => { calls.push('predict'); return result; },
    settings: { maxRawReadings: 2000, predictor: {} },
    logger: { log() {}, error() {} }
  };
  return { calls, result, dependencies };
}

test('source sync completes before inference and storage', async () => {
  const { calls, dependencies } = fixture();
  const cycle = createA1Cycle(dependencies);
  assert.equal((await cycle.run()).predictions_stored, 6);
  assert.deepEqual(calls, ['sync', 'read', 'predict', 'save']);
  assert.equal(cycle.getStatus().state, 'connected');
});

test('source failure prevents inference and a later cycle can recover', async () => {
  const { calls, dependencies } = fixture();
  const workingSync = dependencies.sync;
  let failed = true;
  dependencies.sync = () => failed ? Promise.reject(new Error('VPN unavailable')) : workingSync();
  const cycle = createA1Cycle(dependencies);
  await assert.rejects(cycle.run(), /VPN unavailable/);
  assert.deepEqual(calls, []);
  assert.equal(cycle.getStatus().state, 'error');
  failed = false;
  assert.equal((await cycle.run()).predictions_stored, 6);
  assert.equal(cycle.getStatus().error, null);
});

test('overlapping cycle is skipped while native inference is pending', async () => {
  const { dependencies, result } = fixture();
  let finish;
  dependencies.predictor = () => new Promise(resolve => { finish = resolve; });
  const cycle = createA1Cycle(dependencies);
  const first = cycle.run();
  assert.deepEqual(await cycle.run(), { skipped: 'cycle_running' });
  await new Promise(resolve => setImmediate(resolve));
  finish(result);
  assert.equal((await first).predictions_stored, 6);
});

test('restart with all six current outputs avoids duplicate database inserts', async () => {
  const { calls, dependencies, result } = fixture();
  dependencies.database.latestPredictions = async () => result.predictions.map(item => ({
    observed_at: '2026-10-13 01:00:00', bundle_status: result.bundle_status,
    model_name: item.model, horizon_minutes: item.horizon_minutes
  }));
  const cycle = createA1Cycle(dependencies);
  assert.equal((await cycle.run()).predictions_stored, 0);
  assert.deepEqual(calls, ['sync', 'read', 'predict']);
});
