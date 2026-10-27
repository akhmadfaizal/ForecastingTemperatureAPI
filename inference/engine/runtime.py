from __future__ import annotations

import json
from pathlib import Path
from typing import Iterable

import numpy as np
import pandas as pd
from tensorflow import keras

from . import common


class PredictionInputError(ValueError):
    pass


class BundleRuntime:
    def __init__(self, name: str, bundle_path: Path, verification_status: str) -> None:
        self.name = name.upper()
        self.bundle_path = bundle_path.resolve()
        self.verification_status = verification_status
        self.manifest = json.loads((self.bundle_path / "manifest.json").read_text())
        self.scaler = json.loads((self.bundle_path / "scaler.json").read_text())
        for relative, expected in self.manifest["checksums_sha256"].items():
            actual = common.sha256_file(self.bundle_path / relative)
            if actual != expected:
                raise RuntimeError(f"Checksum {self.name} tidak cocok: {relative}")
        self.models = {
            int(minutes): keras.models.load_model(self.bundle_path / entry["file"])
            for minutes, entry in self.manifest["models"].items()
        }

    def prepare(self, readings: list[dict], as_of: pd.Timestamp | None = None) -> tuple[np.ndarray, pd.Timestamp, float]:
        if not readings:
            raise PredictionInputError("readings kosong")
        frame = pd.DataFrame(readings)
        required = {"timestamp", *self.manifest["sensor_columns"]}
        if not required.issubset(frame.columns):
            raise PredictionInputError("Kolom wajib: " + ", ".join(sorted(required)))
        timestamps = pd.to_datetime(frame.pop("timestamp"), format="mixed", errors="raise", utc=True)
        frame.index = timestamps.dt.tz_convert(self.manifest["timezone"])
        frame = frame[self.manifest["sensor_columns"]].apply(pd.to_numeric, errors="coerce")
        # Canonical raw rules of the active 42-day training pipeline. Future
        # bundles should store this contract explicitly in their manifest.
        policy = self.manifest.get("raw_preprocessing", {})
        if policy.get("duplicate_timestamps", "keep_first") != "keep_first":
            raise PredictionInputError("Kebijakan duplikat bundle tidak didukung; wajib keep_first")
        bounds = policy.get("temperature_bounds_celsius", [-10., 60.])
        if len(bounds) != 2 or not np.isfinite(bounds).all() or bounds[0] >= bounds[1]:
            raise PredictionInputError("Batas suhu bundle tidak valid")
        frame = frame.dropna(subset=self.manifest["sensor_columns"]).sort_index()
        for interval in policy.get("artifact_ranges", []):
            left, right = pd.Timestamp(interval["mulai_eksklusif"]), pd.Timestamp(interval["selesai_eksklusif"])
            frame = frame.loc[~((frame.index > left) & (frame.index < right))]
        frame = frame.loc[frame[self.manifest["target"]].between(*bounds)]
        frame = frame.loc[~frame.index.duplicated(keep="first")]
        frame = frame.resample(self.manifest["resample"]).mean()
        if as_of is not None:
            cutoff = pd.Timestamp(as_of)
            if cutoff.tzinfo is None:
                raise PredictionInputError("as_of wajib menyertakan zona waktu")
            # Filter before interpolation so an unfinished future bin cannot
            # act as a right anchor for an input that is not yet available.
            bin_end = frame.index + pd.Timedelta(minutes=self.manifest["resample_minutes"])
            frame = frame.loc[bin_end <= cutoff]
        max_slots = self.manifest["max_gap_interpolation_minutes"] // self.manifest["resample_minutes"]
        frame = common.interpolate_short(frame, max_slots)
        valid = frame.notna().all(axis=1)
        groups = (valid != valid.shift()).cumsum()
        segments = [part for _, part in frame.groupby(groups) if valid.loc[part.index[0]]]
        lookback = self.manifest["lookback_slots"]
        if not segments or len(segments[-1]) < lookback:
            available = len(segments[-1]) if segments else 0
            raise PredictionInputError(f"Riwayat kontinu kurang: {available}/{lookback} slot")
        latest = segments[-1].iloc[-lookback:].copy()
        last_temperature = float(latest[self.manifest["target"]].iloc[-1])
        lo = np.asarray(self.scaler["min"])
        hi = np.asarray(self.scaler["max"])
        latest[self.manifest["sensor_columns"]] = (
            latest[self.manifest["sensor_columns"]].to_numpy() - lo
        ) / (hi - lo)
        enriched = common.add_features(latest)
        x = enriched[self.manifest["features"]].to_numpy(dtype="float32")[None, :, :]
        return x, latest.index[-1], last_temperature

    def predict(self, readings: list[dict]) -> dict:
        x, observed_at, latest_temperature = self.prepare(readings, as_of=pd.Timestamp.now(tz="UTC"))
        target_index = self.scaler["columns"].index(self.manifest["target"])
        target_min = float(self.scaler["min"][target_index])
        target_max = float(self.scaler["max"][target_index])
        threshold = float(self.manifest["threshold_celsius"])
        predictions = []
        for minutes, model in sorted(self.models.items()):
            scaled = float(model(x, training=False).numpy().reshape(-1)[0])
            predicted = round(scaled * (target_max - target_min) + target_min, 6)
            predictions.append(
                {
                    "horizon_minutes": minutes,
                    "model": self.name,
                    "predicted_temperature_celsius": predicted,
                    "target_timestamp": (observed_at + pd.Timedelta(minutes=minutes)).isoformat(),
                    "above_threshold": bool(predicted > threshold),
                }
            )
        return {
            "model": self.name,
            "bundle_status": self.manifest["status"],
            "verification_status": self.verification_status,
            "observed_at": observed_at.isoformat(),
            "latest_temperature_celsius": latest_temperature,
            "threshold_celsius": threshold,
            "predictions": predictions,
        }

    def info(self) -> dict:
        return {
            "model": self.name,
            "bundle_status": self.manifest["status"],
            "verification_status": self.verification_status,
            "lookback_slots": self.manifest["lookback_slots"],
            "resample_minutes": self.manifest["resample_minutes"],
            "features": self.manifest["features"],
            "horizons_minutes": sorted(self.models),
            "seeds": sorted({entry["seed"] for entry in self.manifest["models"].values()}),
        }


class DualModelRuntime:
    def __init__(self, root: Path) -> None:
        self.root = root.resolve()
        service = json.loads((self.root / "config" / "service.json").read_text())
        self.runtimes = {}
        for name, item in service["models"].items():
            if item.get("enabled", True):
                self.runtimes[name.upper()] = BundleRuntime(
                    name=name,
                    bundle_path=self.root / item["bundle"],
                    verification_status=item["verification_status"],
                )

    def predict(self, readings: list[dict], requested: Iterable[str] | None = None) -> dict:
        names = list(dict.fromkeys(name.upper() for name in (requested or self.runtimes)))
        invalid = sorted(set(names) - set(self.runtimes))
        if invalid:
            raise PredictionInputError("Model tidak dikenal: " + ", ".join(invalid))
        outputs = [self.runtimes[name].predict(readings) for name in names]
        observed = {item["observed_at"] for item in outputs}
        if len(observed) != 1:
            raise RuntimeError("Waktu observasi antarbundle tidak konsisten")
        return {
            "observed_at": outputs[0]["observed_at"],
            "latest_temperature_celsius": outputs[0]["latest_temperature_celsius"],
            "threshold_celsius": outputs[0]["threshold_celsius"],
            "models": {item["model"]: item["predictions"] for item in outputs},
            "bundle_status": {item["model"]: item["bundle_status"] for item in outputs},
            "verification_status": {
                item["model"]: item["verification_status"] for item in outputs
            },
        }

    def info(self) -> dict:
        return {name: runtime.info() for name, runtime in self.runtimes.items()}
