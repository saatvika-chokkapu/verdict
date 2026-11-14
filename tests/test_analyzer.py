"""Tests for the merchant analyzer (backend/analyzer.py) and its /api/analyze endpoint."""
import io

import numpy as np
import pandas as pd
import pytest
from fastapi.testclient import TestClient

import backend.main as main
from backend.analyzer import AnalysisError, analyze, load_orders

client = TestClient(main.app)


def to_csv(df: pd.DataFrame) -> bytes:
    buf = io.StringIO()
    df.to_csv(buf, index=False)
    return buf.getvalue().encode()


def tiny_store(n=2000, seed=0):
    rng = np.random.default_rng(seed)
    fraud = rng.random(n) < 0.05
    score = np.where(fraud, rng.beta(5, 2, n), rng.beta(1.5, 6, n)) * 100
    return pd.DataFrame({
        "Order Total": np.round(rng.uniform(10, 200, n), 2),
        "Risk Score": np.round(score),
        "Chargeback": np.where(fraud, "yes", "no"),
    })


def test_flexible_column_names_and_0_to_100_scores_are_understood():
    orders, _ = load_orders(to_csv(tiny_store()))
    assert orders.attrs["score_scale"] == 100.0
    assert orders["score"].between(0, 1).all()
    assert set(orders.attrs["columns_used"]) >= {"amount", "score", "fraud"}


def test_missing_required_column_gives_a_clear_error():
    df = tiny_store().drop(columns=["Risk Score"])
    with pytest.raises(AnalysisError, match="risk score"):
        load_orders(to_csv(df))


def test_invalid_rows_are_skipped_with_a_warning():
    df = tiny_store(200)
    df["Order Total"] = df["Order Total"].astype(object)
    df.loc[0, "Order Total"] = "not a number"
    orders, warnings = load_orders(to_csv(df))
    assert len(orders) == 199
    assert any("Skipped 1" in w for w in warnings)


def test_recommended_cutoff_is_never_worse_than_any_point_on_the_curve():
    orders, w = load_orders(to_csv(tiny_store()))
    r = analyze(orders, warnings=w)
    assert r["recommended"]["cost"] <= min(p["cost"] for p in r["curve"]) + 0.01


def test_declining_nothing_baseline_when_no_declined_column():
    orders, w = load_orders(to_csv(tiny_store()))
    r = analyze(orders, warnings=w)
    assert r["baseline_label"] == "declining nothing"
    assert r["current"]["declined"] == 0
    assert r["savings"] >= 0


def test_higher_customer_value_never_lowers_the_recommended_cutoff():
    # If losing a good customer costs more, the best rule should decline less (cutoff same or higher).
    orders, w = load_orders(to_csv(tiny_store()))
    low = analyze(orders, customer_value=100, warnings=w)["recommended"]["threshold"]
    high = analyze(orders, customer_value=1000, warnings=w)["recommended"]["threshold"]
    assert high >= low


def test_declined_orders_without_outcome_are_estimated_not_assumed_fraud():
    df = tiny_store()
    df["declined"] = np.where(df["Risk Score"] >= 70, "yes", "no")
    df.loc[df["declined"] == "yes", "Chargeback"] = ""
    orders, w = load_orders(to_csv(df))
    r = analyze(orders, warnings=w)
    assert r["fraud_estimate_method"] == "calibrated"
    assert r["current"]["declined"] == int((df["declined"] == "yes").sum())
    assert any("no fraud outcome" in x for x in r["warnings"])


def test_bad_assumptions_are_rejected():
    orders, w = load_orders(to_csv(tiny_store()))
    with pytest.raises(AnalysisError):
        analyze(orders, churn_rate=1.5, warnings=w)


def test_api_sample_analysis():
    r = client.post("/api/analyze", data={"use_sample": "true"})
    assert r.status_code == 200
    body = r.json()
    assert body["source"] == "sample"
    assert body["rows"] > 1000
    assert len(body["curve"]) == 99
    assert body["recommended"]["threshold"] > 0


def test_api_upload_and_bad_file():
    ok = client.post("/api/analyze", files={"file": ("orders.csv", to_csv(tiny_store()), "text/csv")})
    assert ok.status_code == 200
    bad = client.post("/api/analyze", files={"file": ("orders.csv", b"foo,bar\n1,2\n", "text/csv")})
    assert bad.status_code == 422
    assert "Missing required" in bad.json()["detail"]


def test_api_requires_file_or_sample():
    assert client.post("/api/analyze", data={}).status_code == 400


def test_template_download():
    r = client.get("/api/template.csv")
    assert r.status_code == 200
    assert "risk_score" in r.text.splitlines()[0]
