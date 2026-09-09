"""
API contract tests for /api/decision. The model and encoders are loaded from
disk; DynamoDB and Snowflake are not reachable in CI, and the endpoint is
designed to degrade gracefully when they are not.
"""
import pytest
from fastapi.testclient import TestClient

import backend.main as main

client = TestClient(main.app)

SAMPLE_TXN = {
    "txn_id": 1,
    "amount": 49.99,
    "card1": 13926,
    "card4": "visa",
    "card6": "debit",
    "addr1": 315.0,
    "ProductCD": "W",
    "P_emaildomain": "gmail.com",
    "DeviceType": "desktop",
    "DeviceInfo": "Windows",
}


@pytest.fixture(autouse=True)
def no_dynamodb(monkeypatch):
    # Deterministic velocity in tests; the real lookup already falls back to 0/0.
    monkeypatch.setattr(main, "get_card_velocity", lambda card_id: {"txn_count_1h": 0, "txn_count_24h": 0})


def test_decision_response_contract():
    r = client.post("/api/decision", json=SAMPLE_TXN)
    assert r.status_code == 200
    body = r.json()
    for key in [
        "txn_id", "decision", "fraud_probability", "segment",
        "expected_cost_approve", "expected_cost_decline",
        "card_velocity_1h", "card_velocity_24h", "latency_ms",
    ]:
        assert key in body, key
    assert body["decision"] in {"approve", "decline", "review"}
    assert 0.0 <= body["fraud_probability"] <= 1.0
    assert body["segment"] == "debit_low_value"
    assert body["latency_ms"] >= 0


def test_decision_is_deterministic():
    a = client.post("/api/decision", json=SAMPLE_TXN).json()
    b = client.post("/api/decision", json=SAMPLE_TXN).json()
    assert a["fraud_probability"] == b["fraud_probability"]
    assert a["decision"] == b["decision"]


def test_unseen_category_is_encoded_as_minus_one():
    assert main.encode_value("P_emaildomain", "definitely-not-a-real-domain.xyz") == -1


def test_unseen_category_still_scores():
    txn = {**SAMPLE_TXN, "P_emaildomain": "definitely-not-a-real-domain.xyz", "DeviceInfo": "??"}
    r = client.post("/api/decision", json=txn)
    assert r.status_code == 200


def test_missing_field_is_rejected_with_422():
    bad = {k: v for k, v in SAMPLE_TXN.items() if k != "amount"}
    r = client.post("/api/decision", json=bad)
    assert r.status_code == 422


def test_wrong_type_is_rejected_with_422():
    r = client.post("/api/decision", json={**SAMPLE_TXN, "amount": "fifty dollars"})
    assert r.status_code == 422


def test_velocity_escalates_approve_to_review(monkeypatch):
    monkeypatch.setattr(main, "get_card_velocity", lambda card_id: {"txn_count_1h": 6, "txn_count_24h": 9})
    r = client.post("/api/decision", json=SAMPLE_TXN).json()
    if r["decision"] != "decline":  # a decline is never softened by velocity
        assert r["decision"] == "review"
    assert r["card_velocity_1h"] == 6


def test_snapshot_fallback_serves_cost_analysis(monkeypatch):
    def boom():
        raise RuntimeError("warehouse unreachable")
    monkeypatch.setattr(main, "get_snowflake_connection", boom)
    r = client.get("/api/cost-analysis")
    assert r.status_code == 200
    assert len(r.json()) > 0


def test_pipeline_health_reports_measured_latency_or_none():
    r = client.get("/api/pipeline/health")
    assert r.status_code == 200
    body = r.json()
    assert "api_latency_ms_p50" in body and "latency_mode" in body
    if body["api_latency_ms_p50"] is not None:
        assert body["latency_sample_size"] > 0
        assert body["api_latency_ms_p50"] <= body["api_latency_ms_p95"] <= body["api_latency_ms_p99"]
