// One local A1 cycle: source sync, native inference, then transactional storage.
function createA1Cycle({ sync, database, predictor, settings, logger = console }) {
  let running = false;
  const state = { state: 'waiting', last_success_at: null, observed_at: null, error: null };

  async function run() {
    if (running) return { skipped: 'cycle_running' };
    running = true;
    state.state = 'running';
    state.error = null;
    try {
      const synced = await sync();
      const readings = await database.recentReadings(settings.maxRawReadings);
      if (!readings.length) throw new Error('Belum ada pembacaan sensor untuk A1.');
      const result = await predictor(readings, settings.predictor);
      // On restart or unchanged source data, do not append the same six outputs again.
      const previous = await database.latestPredictions();
      const observed = result.observed_at.replace('T', ' ').slice(0, 19);
      const alreadyStored = result.predictions.length === 6 && result.predictions.every(item =>
        previous.some(row => row.observed_at === observed &&
          row.bundle_status === result.bundle_status && row.model_name === item.model &&
          Number(row.horizon_minutes) === item.horizon_minutes));
      if (!alreadyStored) await database.savePredictions(result);
      Object.assign(state, { state: 'connected', last_success_at: new Date().toISOString(), observed_at: result.observed_at });
      logger.log(`Siklus A1 selesai: ${synced.stored} slot sensor; ${alreadyStored ? 'prediksi sudah tersedia' : 'enam prediksi disimpan'}; ${result.observed_at}`);
      return { sync: synced, observed_at: result.observed_at, predictions_stored: alreadyStored ? 0 : result.predictions.length };
    } catch (error) {
      Object.assign(state, { state: 'error', error: error.message });
      logger.error(`Siklus A1 gagal: ${error.message}`);
      throw error;
    } finally {
      running = false;
    }
  }

  function start(intervalMs) {
    const tick = () => { void run().catch(() => {}); }; // Error is recorded above; next tick retries.
    tick();
    return setInterval(tick, intervalMs);
  }

  return { run, start, getStatus: () => ({ ...state }) };
}

module.exports = { createA1Cycle };
