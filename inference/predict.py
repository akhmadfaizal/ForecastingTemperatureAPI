"""Inferensi proses lokal A1; stdin/stdout JSON, tanpa server HTTP Python."""
from __future__ import annotations

import argparse
from datetime import datetime
import json
import math
import os
from pathlib import Path
import sys
from zoneinfo import ZoneInfo


def normalize_readings(readings: list[dict], timezone: str) -> list[dict]:
    if not isinstance(readings, list) or not readings:
        raise ValueError("readings wajib berupa daftar pembacaan yang tidak kosong")
    output = []
    for reading in readings:
        if not isinstance(reading, dict) or not isinstance(reading.get("timestamp"), str):
            raise ValueError("timestamp pembacaan wajib berupa teks ISO atau DATETIME MySQL")
        stamp = datetime.fromisoformat(reading["timestamp"].replace("Z", "+00:00"))
        if stamp.tzinfo is None:
            # DATETIME MySQL aplikasi ini disimpan sebagai WIB, bukan UTC.
            stamp = stamp.replace(tzinfo=ZoneInfo(timezone))
        output.append({**reading, "timestamp": stamp.isoformat()})
    return output


def as_a1_result(result: dict, status: str) -> dict:
    predictions = []
    if set(result["models"]) != {"LSTM", "GRU"}:
        raise ValueError("Keluaran wajib memuat LSTM dan GRU")
    for name in ("LSTM", "GRU"):
        items = result["models"][name]
        if len(items) != 3 or {item["horizon_minutes"] for item in items} != {60, 120, 180}:
            raise ValueError("Keluaran wajib memuat horizon 60, 120, 180 untuk setiap model")
        for item in items:
            if item["model"] != name or not math.isfinite(item["predicted_temperature_celsius"]):
                raise ValueError("Identitas model atau nilai prediksi tidak valid")
            predictions.append({**item, "ensemble_size": 1})
    if not isinstance(status, str) or not status or len(status) > 30:
        raise ValueError("Status bundle wajib berupa teks maksimal 30 karakter")
    return {
        "observed_at": result["observed_at"],
        "latest_temperature_celsius": result["latest_temperature_celsius"],
        "threshold_celsius": result["threshold_celsius"],
        "predictions": predictions,
        "bundle_status": status,
        "model_bundle_status": result["bundle_status"],
        "verification_status": result["verification_status"],
    }


def predict(payload: dict, root: Path) -> dict:
    service = json.loads((root / "config" / "service.json").read_text())
    readings = normalize_readings(payload.get("readings"), service["timezone"])
    # Pin CPU deployment independently from the historical GPU evaluation.
    device = service.get("inference_device")
    if device not in (None, "CPU"):
        raise ValueError("inference_device tidak didukung; gunakan CPU")
    if device == "CPU":
        import tensorflow as tf
        tf.config.set_visible_devices([], "GPU")
    # Pemuatan runtime baru dilakukan setelah input dasar dinyatakan valid.
    from engine.runtime import DualModelRuntime

    runtime = DualModelRuntime(root)
    return as_a1_result(runtime.predict(readings), service["output_status"])


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--bundle", type=Path, required=True)
    parser.add_argument("--input", type=Path)
    args = parser.parse_args()
    os.environ.setdefault("TF_CPP_MIN_LOG_LEVEL", "2")
    # Plugin native TensorFlow dapat menulis langsung ke fd 1, termasuk saat
    # proses berhenti. Pertahankan kanal JSON sendiri dan arahkan seluruh log
    # Python/native ke stderr selama sisa umur proses.
    protocol = os.fdopen(os.dup(sys.stdout.fileno()), "w", encoding="utf-8")
    sys.stdout.flush()
    os.dup2(sys.stderr.fileno(), sys.stdout.fileno())
    try:
        payload = json.loads(args.input.read_text()) if args.input else json.load(sys.stdin)
        if not isinstance(payload, dict):
            raise ValueError("Input wajib berupa objek JSON dengan readings")
        result = predict(payload, args.bundle.resolve())
        print(json.dumps(result, ensure_ascii=False, allow_nan=False), file=protocol, flush=True)
    except Exception as exc:
        print(json.dumps({"error": str(exc)}, ensure_ascii=False), file=sys.stderr)
        raise SystemExit(2) from exc
    finally:
        protocol.close()


if __name__ == "__main__":
    main()
