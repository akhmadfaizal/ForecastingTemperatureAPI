"""Boundary contract checks; fake models, no final-model portability claim."""
import unittest
from unittest.mock import Mock

import numpy as np
import pandas as pd

from engine.runtime import BundleRuntime


class RuntimeContractTests(unittest.TestCase):
    def runtime_for_input(self):
        runtime = BundleRuntime.__new__(BundleRuntime)
        runtime.manifest = {'sensor_columns': ['temperature', 'humidity'], 'target': 'temperature',
                            'timezone': 'Asia/Jakarta', 'resample': '5min', 'resample_minutes': 5,
                            'max_gap_interpolation_minutes': 15, 'lookback_slots': 144,
                            'features': ['temperature', 'humidity', 'jam_sin', 'jam_cos', 'hari_sin', 'hari_cos', 'akhir_pekan']}
        runtime.scaler = {'columns': ['temperature', 'humidity'], 'min': [0., 0.], 'max': [100., 100.]}
        times = pd.date_range('2026-09-24', periods=144, freq='5min', tz='Asia/Jakarta')
        readings = [{'timestamp': t.isoformat(), 'temperature': 25., 'humidity': 50.} for t in times]
        return runtime, readings

    def test_duplicate_keeps_first_instead_of_averaging(self):
        runtime, readings = self.runtime_for_input()
        readings.insert(1, dict(readings[0], temperature=35.))
        tensor, _, _ = runtime.prepare(readings)
        self.assertEqual(float(tensor[0, 0, 0]), .25)

    def test_out_of_bounds_reading_dropped_before_bin_average(self):
        runtime, readings = self.runtime_for_input()
        readings.insert(1, dict(readings[0], timestamp='2026-09-24T00:01:00+07:00', temperature=100.))
        tensor, _, _ = runtime.prepare(readings)
        self.assertEqual(float(tensor[0, 0, 0]), .25)

    def test_unsupported_bundle_duplicate_policy_is_rejected(self):
        runtime, readings = self.runtime_for_input()
        runtime.manifest['raw_preprocessing'] = {'duplicate_timestamps': 'average'}
        with self.assertRaisesRegex(ValueError, 'tidak didukung'):
            runtime.prepare(readings)

    def test_missing_sensor_row_dropped_jointly_before_aggregation(self):
        runtime, readings = self.runtime_for_input()
        readings.insert(1, dict(readings[0], timestamp='2026-09-24T00:01:00+07:00', temperature=None, humidity=100.))
        tensor, _, _ = runtime.prepare(readings)
        self.assertEqual(float(tensor[0, 0, 1]), .5)

    def test_manifest_artifact_range_is_exclusive(self):
        runtime, readings = self.runtime_for_input()
        runtime.manifest['raw_preprocessing'] = {'artifact_ranges': [
            {'mulai_eksklusif': '2026-09-24T00:00:00+07:00',
             'selesai_eksklusif': '2026-09-24T00:02:00+07:00'}]}
        readings.insert(1, dict(readings[0], timestamp='2026-09-24T00:01:00+07:00', temperature=35.))
        tensor, _, _ = runtime.prepare(readings)
        self.assertEqual(float(tensor[0, 0, 0]), .25)

    def test_unfinished_last_bin_excluded_until_its_end(self):
        runtime, readings = self.runtime_for_input()
        readings.append({'timestamp': '2026-09-24T12:00:00+07:00', 'temperature': 35., 'humidity': 50.})
        tensor, observed, _ = runtime.prepare(readings, as_of=pd.Timestamp('2026-09-24T12:03:00+07:00'))
        self.assertEqual(observed, pd.Timestamp('2026-09-24T11:55:00+07:00'))
        self.assertEqual(float(tensor[0, -1, 0]), .25)
        _, completed_observed, _ = runtime.prepare(readings, as_of=pd.Timestamp('2026-09-24T12:05:00+07:00'))
        self.assertEqual(completed_observed, pd.Timestamp('2026-09-24T12:00:00+07:00'))

    def test_forecast_threshold_is_strict_on_serialized_temperature(self):
        runtime = BundleRuntime.__new__(BundleRuntime)
        runtime.name, runtime.verification_status = 'LSTM', 'synthetic_test_only'
        runtime.manifest = {'target': 'temperature', 'threshold_celsius': 27., 'status': 'synthetic'}
        runtime.scaler = {'columns': ['temperature'], 'min': [0.], 'max': [1.]}
        runtime.prepare = Mock(return_value=(np.zeros((1, 144, 7)), pd.Timestamp('2026-09-24', tz='Asia/Jakarta'), 27.))
        for value, expected in [(26.999999, False), (27., False), (27.000001, True), (27.0000001, False)]:
            model = Mock()
            model.return_value.numpy.return_value = np.array([[value]])
            runtime.models = {60: model}
            item = runtime.predict([{'synthetic': True}])['predictions'][0]
            self.assertEqual(item['above_threshold'], expected)
            self.assertEqual(item['above_threshold'], item['predicted_temperature_celsius'] > 27.)
            self.assertEqual(item['target_timestamp'], '2026-09-24T01:00:00+07:00')


if __name__ == '__main__':
    unittest.main()
