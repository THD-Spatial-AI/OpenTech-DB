from __future__ import annotations
import math
from .base import ProfileDraft


def normalise(draft: ProfileDraft) -> tuple[ProfileDraft, list[str]]:
    warnings: list[str] = []
    points = draft.points

    if not points:
        warnings.append("No data points")
        return draft, warnings

    if draft.resolution == "hourly" and len(points) < 8000:
        warnings.append(f"Only {len(points)} hourly points (expected ~8760)")

    if draft.type == "capacity_factor":
        new_points = []
        clipped = 0
        for p in points:
            v = p["value"]
            if v < 0.0:
                v = 0.0
                clipped += 1
            elif v > 1.0:
                v = 1.0
                clipped += 1
            new_points.append({"timestamp": p["timestamp"], "value": round(v, 6)})
        if clipped:
            warnings.append(f"Clipped {clipped} values to [0, 1]")
        draft.points = new_points

    if draft.type == "load":
        negatives = sum(1 for p in points if p["value"] < 0)
        if negatives:
            warnings.append(f"{negatives} negative load values")

    return draft, warnings


def compute_stats(points: list[dict]) -> dict:
    vals = [p["value"] for p in points if isinstance(p.get("value"), (int, float))]
    if not vals:
        return {}
    s = sorted(vals)
    n = len(s)
    mean = sum(s) / n
    var = sum((v - mean) ** 2 for v in s) / n

    def pct(p: float) -> float:
        idx = (p / 100) * (n - 1)
        lo, hi = int(idx), min(int(idx) + 1, n - 1)
        return s[lo] + (s[hi] - s[lo]) * (idx - lo)

    return {
        "v_min": round(s[0], 6),
        "v_max": round(s[-1], 6),
        "v_mean": round(mean, 6),
        "v_std": round(math.sqrt(var), 6),
        "v_p10": round(pct(10), 6),
        "v_p90": round(pct(90), 6),
        "first_ts": points[0]["timestamp"] if points else "",
        "last_ts": points[-1]["timestamp"] if points else "",
    }
