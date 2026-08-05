import metrics


def test_snapshot_empty_for_unknown_metric():
    assert metrics.snapshot().get("does_not_exist") is None


def test_snapshot_computes_percentiles():
    for ms in [10, 20, 30, 40, 100]:
        metrics.record("test_metric", ms)
    snap = metrics.snapshot()["test_metric"]
    assert snap["count"] == 5
    assert snap["max_ms"] == 100
    assert snap["p50_ms"] == 30
    assert snap["p95_ms"] == 100


def test_record_bounds_sample_count():
    for ms in range(300):
        metrics.record("bounded_metric", ms)
    assert metrics.snapshot()["bounded_metric"]["count"] == 200
