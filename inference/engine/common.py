from __future__ import annotations

import hashlib
from pathlib import Path

import numpy as np
import pandas as pd


def sha256_file(path: str | Path) -> str:
    digest = hashlib.sha256()
    with Path(path).open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def interpolate_short(frame: pd.DataFrame, max_slots: int) -> pd.DataFrame:
    result = frame.copy()
    for column in result.columns:
        missing = result[column].isna()
        groups = (missing != missing.shift()).cumsum()
        lengths = missing.groupby(groups).transform("size")
        eligible = missing & (lengths <= max_slots)
        interpolated = result[column].interpolate(
            method="linear", limit=max_slots, limit_area="inside"
        )
        can_fill = eligible & interpolated.notna()
        result.loc[can_fill, column] = interpolated.loc[can_fill]
    return result


def add_features(frame: pd.DataFrame) -> pd.DataFrame:
    result = frame.copy()
    hour = result.index.hour + result.index.minute / 60.0
    day = result.index.dayofweek.astype(float)
    result["jam_sin"] = np.sin(2 * np.pi * hour / 24)
    result["jam_cos"] = np.cos(2 * np.pi * hour / 24)
    result["hari_sin"] = np.sin(2 * np.pi * day / 7)
    result["hari_cos"] = np.cos(2 * np.pi * day / 7)
    result["akhir_pekan"] = (result.index.dayofweek >= 5).astype(float)
    return result
