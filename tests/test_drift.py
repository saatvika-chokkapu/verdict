"""
Unit tests for the PSI drift detector used by the weekly Airflow check.
"""
import numpy as np
import pandas as pd
import pytest

from backend.check_model_drift import _status_for_psi, calculate_psi


def test_identical_distributions_have_near_zero_psi():
    rng = np.random.default_rng(0)
    base = pd.Series(rng.normal(100, 20, 20_000))
    assert calculate_psi(base, base.copy()) == pytest.approx(0.0, abs=1e-9)


def test_same_distribution_new_sample_is_stable():
    rng = np.random.default_rng(1)
    base = pd.Series(rng.normal(100, 20, 20_000))
    curr = pd.Series(rng.normal(100, 20, 20_000))
    psi = calculate_psi(base, curr)
    assert psi < 0.1
    assert _status_for_psi(psi) == "STABLE"


def test_shifted_distribution_is_flagged():
    rng = np.random.default_rng(2)
    base = pd.Series(rng.normal(100, 20, 20_000))
    curr = pd.Series(rng.normal(160, 20, 20_000))  # 3-sigma mean shift
    psi = calculate_psi(base, curr)
    assert psi >= 0.25
    assert _status_for_psi(psi) == "SIGNIFICANT DRIFT"


def test_psi_is_non_negative_and_grows_with_shift():
    rng = np.random.default_rng(3)
    base = pd.Series(rng.normal(0, 1, 20_000))
    last = -1.0
    for shift in [0.0, 0.25, 0.5, 1.0, 2.0]:
        psi = calculate_psi(base, base + shift)
        assert psi >= 0
        assert psi >= last
        last = psi


def test_psi_handles_nans_in_baseline():
    rng = np.random.default_rng(4)
    base = pd.Series(rng.normal(0, 1, 5_000))
    base.iloc[:100] = np.nan
    curr = pd.Series(rng.normal(0, 1, 5_000))
    psi = calculate_psi(base, curr)
    assert np.isfinite(psi)


@pytest.mark.parametrize(
    "psi, status",
    [
        (0.0, "STABLE"),
        (0.0999, "STABLE"),
        (0.1, "MODERATE SHIFT"),
        (0.2499, "MODERATE SHIFT"),
        (0.25, "SIGNIFICANT DRIFT"),
        (5.0, "SIGNIFICANT DRIFT"),
    ],
)
def test_status_bands(psi, status):
    assert _status_for_psi(psi) == status
