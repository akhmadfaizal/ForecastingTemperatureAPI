import copy
import json
from pathlib import Path
import subprocess
import sys
import unittest

from predict import as_a1_result, normalize_readings


class AdapterTests(unittest.TestCase):
    def test_invalid_input_uses_error_channel_and_nonzero_exit(self):
        root = Path(__file__).resolve().parent
        completed = subprocess.run(
            [sys.executable, str(root / "predict.py"), "--bundle", str(root / "pilot_mac")],
            input=json.dumps({"readings": []}), capture_output=True, text=True,
        )
        self.assertEqual(completed.returncode, 2)
        self.assertEqual(completed.stdout, "")
        self.assertIn("readings", json.loads(completed.stderr)["error"])

    def test_mysql_wib_and_iso_refer_to_same_instant(self):
        from datetime import datetime

        rows = normalize_readings([
            {"timestamp": "2026-09-21 11:55:00", "temperature": 27.1},
            {"timestamp": "2026-09-21T04:55:00Z", "temperature": 27.1},
        ], "Asia/Jakarta")
        self.assertEqual(datetime.fromisoformat(rows[0]["timestamp"]),
                         datetime.fromisoformat(rows[1]["timestamp"]))
        self.assertEqual(rows[0]["timestamp"], "2026-09-21T11:55:00+07:00")

    def test_dual_result_satisfies_database_contract_and_rejects_missing_horizon(self):
        result = {
            "observed_at": "2026-09-21T11:55:00+07:00",
            "latest_temperature_celsius": 27.1,
            "threshold_celsius": 27,
            "models": {name: [{"model": name, "horizon_minutes": h,
                               "predicted_temperature_celsius": 26.5,
                               "target_timestamp": "2026-09-21T12:55:00+07:00",
                               "above_threshold": False}
                              for h in [60, 120, 180]] for name in ["LSTM", "GRU"]},
            "bundle_status": {"LSTM": "candidate", "GRU": "candidate"},
            "verification_status": {"LSTM": "pending", "GRU": "pending"},
        }
        output = as_a1_result(result, "pilot_model_arsip")
        self.assertEqual(len(output["predictions"]), 6)
        self.assertTrue(all(item["ensemble_size"] == 1 for item in output["predictions"]))
        self.assertIsInstance(output["bundle_status"], str)
        broken = copy.deepcopy(result)
        broken["models"]["GRU"].pop()
        with self.assertRaises(ValueError):
            as_a1_result(broken, "pilot_model_arsip")


if __name__ == "__main__":
    unittest.main()
