"""
Unit tests for the cost-sensitive decision policy.

These pin down the behaviour the dashboard numbers depend on: segment
assignment boundaries, the expected-cost comparison, tie-breaking, and the
monotonic effect of the sensitivity multiplier.
"""
import pytest

from backend.cost_model import (
    CHURN_RATE_AFTER_FALSE_DECLINE,
    SEGMENT_LIFETIME_VALUE,
    VELOCITY_REVIEW_THRESHOLD,
    assign_segment,
    decide_transaction,
    decline_cost,
)


# ── assign_segment ──────────────────────────────────────────────────────────

@pytest.mark.parametrize(
    "card6, amount, expected",
    [
        ("credit", 100.01, "credit_high_value"),
        ("credit", 100.00, "credit_low_value"),   # boundary: > 100, not >= 100
        ("credit", 0.0, "credit_low_value"),
        ("debit", 250.0, "debit_high_value"),
        ("debit", 99.99, "debit_low_value"),
        ("charge card", 5000.0, "unknown"),        # anything not credit/debit
        (None, 5000.0, "unknown"),
        ("", 10.0, "unknown"),
    ],
)
def test_assign_segment(card6, amount, expected):
    assert assign_segment({"card6": card6, "amount": amount}) == expected


def test_unknown_segment_ignores_amount():
    assert assign_segment({"card6": "??", "amount": 1e9}) == "unknown"


# ── decline_cost ────────────────────────────────────────────────────────────

@pytest.mark.parametrize("segment", list(SEGMENT_LIFETIME_VALUE))
def test_decline_cost_is_churn_times_ltv(segment):
    assert decline_cost(segment) == pytest.approx(
        CHURN_RATE_AFTER_FALSE_DECLINE * SEGMENT_LIFETIME_VALUE[segment]
    )


def test_decline_cost_unknown_segment_falls_back():
    assert decline_cost("not_a_segment") == decline_cost("unknown")


def test_decline_cost_ordering():
    # Credit customers cost more to lose than debit; high value more than low.
    assert decline_cost("credit_high_value") > decline_cost("credit_low_value")
    assert decline_cost("debit_high_value") > decline_cost("debit_low_value")
    assert decline_cost("credit_high_value") > decline_cost("debit_high_value")


# ── decide_transaction ──────────────────────────────────────────────────────

def test_high_probability_large_amount_declines():
    decision, c_approve, c_decline = decide_transaction(0.95, 2000.0, "debit_low_value")
    assert decision == "decline"
    assert c_approve == pytest.approx(0.95 * 2000.0)
    assert c_decline == pytest.approx(0.05 * decline_cost("debit_low_value"))
    assert c_decline < c_approve


def test_low_probability_small_amount_approves():
    decision, c_approve, c_decline = decide_transaction(0.02, 15.0, "credit_high_value")
    assert decision == "approve"
    assert c_approve < c_decline


def test_same_probability_different_segments_can_differ():
    # Same model output, but a high-LTV credit customer is more expensive to
    # falsely decline, so the policy approves where it would decline a debit one.
    p, amount = 0.30, 300.0
    debit, *_ = decide_transaction(p, amount, "debit_low_value")
    credit, *_ = decide_transaction(p, amount, "credit_high_value")
    assert debit == "decline"
    assert credit == "approve"


def test_tie_goes_to_approve():
    # Construct exact equality: p*amount == (1-p)*decline_cost
    segment = "debit_low_value"
    p = 0.5
    amount = decline_cost(segment)  # p*amount == (1-p)*decline_cost when p == 0.5
    decision, c_approve, c_decline = decide_transaction(p, amount, segment)
    assert c_approve == pytest.approx(c_decline)
    assert decision == "approve"


def test_zero_probability_never_declines():
    for segment in SEGMENT_LIFETIME_VALUE:
        decision, *_ = decide_transaction(0.0, 1e6, segment)
        assert decision == "approve"


def test_certain_fraud_always_declines_when_amount_positive():
    for segment in SEGMENT_LIFETIME_VALUE:
        decision, *_ = decide_transaction(1.0, 0.01, segment)
        assert decision == "decline"


def test_default_multiplier_matches_explicit_one():
    assert decide_transaction(0.4, 120.0, "debit_high_value") == \
        decide_transaction(0.4, 120.0, "debit_high_value", cost_multiplier=1.0)


@pytest.mark.parametrize("segment", list(SEGMENT_LIFETIME_VALUE))
def test_multiplier_is_monotonic(segment):
    """Raising the assumed cost of a false decline can only move decisions
    from decline toward approve, never the other way (the sensitivity sweep
    relies on this)."""
    p, amount = 0.35, 400.0
    order = ["decline", "approve"]
    last = -1
    for m in [0.25, 0.5, 1.0, 1.5, 2.0]:
        decision, _, c_decline = decide_transaction(p, amount, segment, cost_multiplier=m)
        assert c_decline == pytest.approx((1 - p) * decline_cost(segment) * m)
        idx = order.index(decision)
        assert idx >= last
        last = idx


def test_velocity_threshold_is_documented_constant():
    assert VELOCITY_REVIEW_THRESHOLD == 5
