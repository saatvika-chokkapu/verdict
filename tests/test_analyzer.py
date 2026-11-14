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
    assert body["current_cutoff"] == 55  # the sample store declines everything scoring 55+


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


# --- column mapping, order-size bands, rate limit ---

def odd_names_store():
    return tiny_store().rename(columns={"Order Total": "Grand Sum", "Risk Score": "Danger Level"})


def test_unrecognized_columns_ask_for_a_mapping_instead_of_failing(monkeypatch):
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    r = client.post("/api/analyze", files={"file": ("o.csv", to_csv(odd_names_store()), "text/csv")})
    assert r.status_code == 422
    body = r.json()
    assert body["needs_mapping"] is True
    assert "Grand Sum" in body["columns"] and "Danger Level" in body["columns"]
    assert body["suggestion"] is None          # no API key, so no AI suggestion
    assert body["matched"]["fraud"] == "Chargeback"


def test_supplied_mapping_is_used():
    import json
    mapping = json.dumps({"amount": "Grand Sum", "score": "Danger Level"})
    r = client.post("/api/analyze", data={"mapping": mapping},
                    files={"file": ("o.csv", to_csv(odd_names_store()), "text/csv")})
    assert r.status_code == 200
    assert r.json()["columns_used"]["amount"] == "Grand Sum"


def test_ai_suggestion_is_filtered_to_real_columns(monkeypatch):
    import backend.column_mapper as cm

    class FakeBlock:
        type = "text"
        text = 'Here you go: {"amount": "Grand Sum", "score": "Not A Column", "bogus_role": "Grand Sum"}'

    class FakeClient:
        def __init__(self, **kwargs): pass
        class messages:  # noqa: N801
            @staticmethod
            def create(**kwargs):
                assert "Grand Sum" in kwargs["messages"][0]["content"]
                return type("M", (), {"content": [FakeBlock()]})()

    import sys, types
    monkeypatch.setenv("ANTHROPIC_API_KEY", "test")
    monkeypatch.setitem(sys.modules, "anthropic", types.SimpleNamespace(Anthropic=FakeClient))
    assert cm.suggest_mapping(["Grand Sum", "Danger Level"]) == {"amount": "Grand Sum"}


def test_ai_suggestion_never_breaks_the_request(monkeypatch):
    import backend.column_mapper as cm
    import sys, types

    def boom(**kwargs):
        raise RuntimeError("network down")

    monkeypatch.setenv("ANTHROPIC_API_KEY", "test")
    monkeypatch.setitem(sys.modules, "anthropic", types.SimpleNamespace(Anthropic=boom))
    assert cm.suggest_mapping(["a", "b"]) is None


def test_order_size_bands_never_cost_more_than_one_cutoff():
    orders, w = load_orders(open("backend/sample_data/sample_orders.csv", "rb").read())
    r = analyze(orders, warnings=w)
    bands = r["by_order_size"]
    assert bands is not None and len(bands["bands"]) == 3
    assert sum(b["orders"] for b in bands["bands"]) == r["rows"]
    assert bands["extra_savings"] >= -0.01
    assert abs(bands["cost"] - sum(b["cost"] for b in bands["bands"])) < 0.05


def test_small_files_get_no_order_size_bands():
    orders, w = load_orders(to_csv(tiny_store(400)))
    assert analyze(orders, warnings=w)["by_order_size"] is None


def test_band_without_enough_fraud_keeps_the_overall_cutoff():
    df = tiny_store(3000)
    # Make every small order clean, so the smallest band has no fraud to learn from.
    small = df["Order Total"] < df["Order Total"].quantile(0.33)
    df.loc[small, "Chargeback"] = "no"
    df.loc[small, "Risk Score"] = 5
    orders, w = load_orders(to_csv(df))
    r = analyze(orders, warnings=w)
    first = r["by_order_size"]["bands"][0]
    assert first["own_cutoff"] is False
    assert first["threshold"] == r["recommended"]["threshold"]


def test_rate_limit_returns_429(monkeypatch):
    monkeypatch.setattr(main, "RATE_LIMIT", 2)
    main._recent.clear()
    codes = [client.post("/api/analyze", data={"use_sample": "true"}).status_code for _ in range(3)]
    main._recent.clear()
    assert codes == [200, 200, 429]
