"""In-memory latency sample recording for the voice pipeline.

Process-local and unbounded-by-design in scope (no DB, no external metrics
backend) -- enough to compute p50/p95 for a portfolio/demo deployment without
adding infrastructure. Samples are lost on restart.
"""
from __future__ import annotations

from collections import deque

_MAX_SAMPLES = 200
_samples: dict[str, deque[float]] = {}


def record(metric: str, ms: float) -> None:
    _samples.setdefault(metric, deque(maxlen=_MAX_SAMPLES)).append(ms)


def _percentile(ordered: list[float], pct: float) -> float:
    index = min(len(ordered) - 1, int(round(pct / 100 * (len(ordered) - 1))))
    return ordered[index]


def snapshot() -> dict[str, dict[str, float | int]]:
    out: dict[str, dict[str, float | int]] = {}
    for metric, bucket in _samples.items():
        if not bucket:
            continue
        ordered = sorted(bucket)
        out[metric] = {
            "count": len(ordered),
            "p50_ms": round(_percentile(ordered, 50), 1),
            "p95_ms": round(_percentile(ordered, 95), 1),
            "max_ms": round(ordered[-1], 1),
        }
    return out
