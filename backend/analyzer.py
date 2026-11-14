"""
Merchant analyzer: "Where should I set my fraud cutoff?"

A merchant uploads their own orders (amount, the risk score their fraud tool
gave each order, whether it was declined, and whether approved orders later
turned out to be fraud). We price every possible cutoff in dollars and find
the cheapest one for *their* margins.

Why thresholds and not the per-transaction cost rule used in the research
section: a third-party risk score (Stripe Radar, Signifyd, etc.) is a ranking,
not a calibrated probability. Choosing a cutoff only needs the ranking, so the
recommendation stays valid whatever tool produced the score.

Selection bias is handled explicitly: orders that were declined never get a
fraud outcome (they were never charged), so for those rows we fall back to the
score itself as the fraud estimate and say so in the warnings.
"""
from __future__ import annotations

import io
import re

import numpy as np
import pandas as pd

DEFAULT_CHURN_RATE = 0.39          # cited industry figure, see docs/cost_model_assumptions.md
DEFAULT_CUSTOMER_VALUE = 300.0     # matches the "unknown" segment in cost_model.py
DEFAULT_CHARGEBACK_FEE = 15.0      # typical card-network dispute fee; user-editable

MAX_ROWS = 500_000
GRID = np.round(np.arange(0.01, 1.0, 0.01), 2)
SENSITIVITY_MULTIPLIERS = [0.5, 0.75, 1.0, 1.5, 2.0]

COLUMN_ALIASES = {
    "amount": ["amount", "order_total", "total", "total_price", "order_amount", "amount_usd",
               "transaction_amount", "transactionamt", "price", "value", "charge_amount"],
    "score": ["risk_score", "score", "fraud_score", "risk", "fraud_probability", "probability",
              "risk_level_score", "radar_risk_score"],
    "declined": ["declined", "blocked", "is_declined", "was_declined", "is_blocked", "rejected",
                 "status", "outcome", "decision"],
    "fraud": ["fraud", "is_fraud", "is_fraud_label", "chargeback", "is_chargeback", "disputed",
              "fraudulent", "fraud_label", "isfraud", "confirmed_fraud"],
    "date": ["date", "created", "created_at", "order_date", "txn_date", "timestamp", "created_utc"],
}

TRUE_WORDS = {"1", "true", "yes", "y", "t", "declined", "blocked", "rejected", "denied",
              "fraud", "fraudulent", "chargeback", "disputed", "lost"}
FALSE_WORDS = {"0", "false", "no", "n", "f", "approved", "accepted", "succeeded", "paid",
               "captured", "legit", "legitimate", "won", "ok"}


class AnalysisError(ValueError):
    """Raised for problems the merchant can fix in their file."""


class ColumnsNotFound(AnalysisError):
    """The file was readable but we could not tell which columns are which.

    Carries the file's column names so the UI can ask the merchant to match
    them (optionally pre-filled by backend/column_mapper.py).
    """

    def __init__(self, message: str, columns: list[str], found: dict[str, str | None]):
        super().__init__(message)
        self.columns = columns
        self.found = found


def _norm(name: str) -> str:
    return re.sub(r"[^a-z0-9]+", "_", str(name).strip().lower()).strip("_")


def _find_column(columns: dict[str, str], role: str) -> str | None:
    for alias in COLUMN_ALIASES[role]:
        if alias in columns:
            return columns[alias]
    return None


def _to_bool(series: pd.Series) -> pd.Series:
    """Map yes/no-style values to 1.0 / 0.0, leaving blanks and unknowns as NaN."""
    def conv(v):
        if pd.isna(v):
            return np.nan
        s = str(v).strip().lower()
        if s == "":
            return np.nan
        if s in TRUE_WORDS:
            return 1.0
        if s in FALSE_WORDS:
            return 0.0
        try:
            return 1.0 if float(s) > 0 else 0.0
        except ValueError:
            return np.nan
    return series.map(conv).astype(float)


def load_orders(raw: bytes, mapping: dict[str, str] | None = None) -> tuple[pd.DataFrame, list[str]]:
    """Parse an uploaded CSV into a clean frame with amount, score, declined, fraud, date.

    `mapping` lets the merchant say which of their columns plays each role
    (e.g. {"amount": "Grand Total", "score": "Fraud Rating"}); it overrides
    the automatic name matching.
    """
    warnings: list[str] = []
    try:
        df = pd.read_csv(io.BytesIO(raw))
    except Exception as exc:  # noqa: BLE001 — any parse failure is a user-fixable file problem
        raise AnalysisError(f"Could not read the file as CSV ({exc.__class__.__name__}).") from exc

    if df.empty:
        raise AnalysisError("The file has no rows.")
    if len(df) > MAX_ROWS:
        raise AnalysisError(f"The file has {len(df):,} rows; the limit is {MAX_ROWS:,}.")

    columns = {_norm(c): c for c in df.columns}
    found = {role: _find_column(columns, role) for role in COLUMN_ALIASES}
    for role, col in (mapping or {}).items():
        if role in COLUMN_ALIASES and col in df.columns:
            found[role] = col

    missing = [role for role in ("amount", "score") if found[role] is None]
    if missing:
        names = {"amount": "order amount", "score": "risk score"}
        raise ColumnsNotFound(
            "Missing required column(s): " + ", ".join(names[m] for m in missing)
            + ". Expected something like 'amount' and 'risk_score'. Download the template to see the format.",
            columns=[str(c) for c in df.columns], found=found,
        )

    out = pd.DataFrame({
        "amount": pd.to_numeric(df[found["amount"]].astype(str).str.replace(r"[$,\s]", "", regex=True),
                                errors="coerce"),
        "score": pd.to_numeric(df[found["score"]], errors="coerce"),
    })
    out["declined"] = _to_bool(df[found["declined"]]) if found["declined"] else np.nan
    out["fraud"] = _to_bool(df[found["fraud"]]) if found["fraud"] else np.nan
    if found["date"]:
        out["date"] = pd.to_datetime(df[found["date"]], errors="coerce", utc=True)

    bad = out["amount"].isna() | out["score"].isna() | (out["amount"] < 0)
    if bad.any():
        warnings.append(f"Skipped {int(bad.sum()):,} rows with a missing or invalid amount or risk score.")
        out = out[~bad].copy()
    if out.empty:
        raise AnalysisError("No usable rows after removing invalid amounts and risk scores.")

    # Scores may arrive as 0-1 probabilities or 0-100 (Stripe Radar style).
    max_score = float(out["score"].max())
    if out["score"].min() < 0 or max_score > 100:
        raise AnalysisError("Risk scores must be between 0 and 1 or between 0 and 100.")
    scale = 100.0 if max_score > 1.0 else 1.0
    out["score"] = out["score"] / scale
    out.attrs["score_scale"] = scale
    out.attrs["columns_used"] = {k: v for k, v in found.items() if v is not None}

    if found["declined"] is None:
        warnings.append("No 'declined' column found, so your current setup is compared as "
                        "'decline nothing'. Add one to measure your real current cost.")
    if found["fraud"] is None:
        warnings.append("No fraud/chargeback column found. Fraud is estimated from the risk scores alone, "
                        "which is only accurate if your scores behave like probabilities.")
    else:
        unlabeled_declines = int((out["declined"].eq(1) & out["fraud"].isna()).sum())
        if unlabeled_declines:
            warnings.append(f"{unlabeled_declines:,} declined orders have no fraud outcome, because they were "
                            "never charged and so can't charge back. Their fraud risk is estimated.")

    return out, warnings


def _policy_cost(decline: np.ndarray, p_fraud: np.ndarray, amount: np.ndarray,
                 customer_cost: float, fee: float) -> dict:
    """Expected dollar cost of a decline/approve decision for every order."""
    fraud_loss = p_fraud * (amount + fee)                 # approved fraud: refund + dispute fee
    decline_loss = (1.0 - p_fraud) * customer_cost        # declined good customer: churned value
    cost = np.where(decline, decline_loss, fraud_loss)
    return {
        "cost": float(cost.sum()),
        "fraud_loss": float(fraud_loss[~decline].sum()),
        "decline_loss": float(decline_loss[decline].sum()),
        "declined": int(decline.sum()),
        "good_declined": float((1.0 - p_fraud)[decline].sum()),
        "fraud_missed": float(p_fraud[~decline].sum()),
        "fraud_caught": float(p_fraud[decline].sum()),
    }


def _fraud_estimate(score: np.ndarray, fraud: np.ndarray, labeled: np.ndarray) -> tuple[np.ndarray, str]:
    """
    Estimate P(fraud) for orders with no known outcome.

    Third-party scores are rankings, not probabilities: a Radar score of 60 does not
    mean a 60% chance of fraud. When there are enough labeled orders we fit a
    logistic curve from score to real chargebacks and use it to extrapolate into
    the declined (unlabeled) range. Otherwise we fall back to the raw score.
    """
    y = fraud[labeled]
    if labeled.sum() >= 200 and y.sum() >= 10 and (y == 0).sum() >= 10:
        from sklearn.linear_model import LogisticRegression
        model = LogisticRegression(C=1e6, max_iter=1000)
        model.fit(score[labeled].reshape(-1, 1), y.astype(int))
        return model.predict_proba(score.reshape(-1, 1))[:, 1], "calibrated"
    return score.copy(), "raw_score"


MIN_FRAUD_PER_BAND = 15.0   # expected fraud cases needed before a band gets its own cutoff
MIN_ORDERS_PER_BAND = 300


def _nice(x: float) -> float:
    """Round a dollar boundary to something a person would say out loud."""
    step = 5 if x < 100 else 25 if x < 500 else 100
    return float(max(step, round(x / step) * step))


def _size_bands(amount, score, p_fraud, customer_cost, fee, scale, overall_threshold, overall_cost):
    """
    Find a separate cutoff for small, medium and large orders.

    A $400 order and a $25 order with the same risk score are not the same bet:
    the fraud loss scales with the amount while the cost of losing the customer
    does not. Each band only gets its own cutoff when it has enough orders and
    enough (expected) fraud to choose one reliably; otherwise it keeps the
    overall cutoff, and the response says so.
    """
    if len(amount) < 3 * MIN_ORDERS_PER_BAND:
        return None
    lo, hi = _nice(np.quantile(amount, 1 / 3)), _nice(np.quantile(amount, 2 / 3))
    if not lo < hi:
        return None
    edges = [(0.0, lo, f"Under ${lo:,.0f}"), (lo, hi, f"${lo:,.0f} to ${hi:,.0f}"), (hi, np.inf, f"${hi:,.0f} and up")]

    bands, total = [], 0.0
    for low, high, label in edges:
        mask = (amount >= low) & (amount < high)
        n = int(mask.sum())
        if n == 0:
            return None
        a, sc, pf = amount[mask], score[mask], p_fraud[mask]
        at_overall = _policy_cost(sc >= overall_threshold, pf, a, customer_cost, fee)
        own = n >= MIN_ORDERS_PER_BAND and pf.sum() >= MIN_FRAUD_PER_BAND
        best_t, best = overall_threshold, at_overall
        if own:
            for t in GRID:
                c = _policy_cost(sc >= t, pf, a, customer_cost, fee)
                if c["cost"] < best["cost"] - 1e-9:
                    best_t, best = float(t), c
        total += best["cost"]
        bands.append({
            "label": label, "orders": n,
            "threshold": round(best_t * scale, 2),
            "own_cutoff": bool(own),
            "cost": round(best["cost"], 2),
            "cost_at_overall_cutoff": round(at_overall["cost"], 2),
            "declined": best["declined"],
        })
    return {
        "bands": bands,
        "cost": round(total, 2),
        "extra_savings": round(overall_cost - total, 2),
    }


MIN_BACKTEST_ORDERS = 600
MIN_BACKTEST_DAYS = 14.0
BACKTEST_TRAIN_SHARE = 2 / 3


def _backtest(orders, amount, score, current_decline, customer_cost, fee, scale):
    """
    Check the recommendation on orders it has not seen.

    Choosing a cutoff and measuring its savings on the same orders flatters the
    result: the cutoff is tuned to exactly those orders. Here the cutoff is
    chosen using only the earlier two thirds of orders (by date), then scored
    on the most recent third, which played no part in choosing it. Nothing from
    the later period leaks backwards: the score-to-fraud curve is also fitted
    on the earlier orders alone.

    Returns None when there is no date column or too little data to split.
    """
    if "date" not in orders:
        return None
    dates = orders["date"]
    if dates.isna().any() or len(orders) < MIN_BACKTEST_ORDERS:
        return None
    order = np.argsort(dates.to_numpy(), kind="stable")
    split = int(len(order) * BACKTEST_TRAIN_SHARE)
    train = np.zeros(len(orders), dtype=bool)
    train[order[:split]] = True
    test = ~train

    def days(mask):
        d = dates[mask]
        return (d.max() - d.min()).total_seconds() / 86400

    train_days, test_days = days(train), days(test)
    if train_days + test_days < MIN_BACKTEST_DAYS or test_days < 1:
        return None

    fraud = orders["fraud"].to_numpy(float)
    labeled = orders["fraud"].notna().to_numpy()
    estimate, _ = _fraud_estimate(score, fraud, labeled & train)
    p_fraud = np.where(labeled, np.nan_to_num(fraud), estimate)

    def cost(mask, decline):
        return _policy_cost(decline[mask], p_fraud[mask], amount[mask], customer_cost, fee)

    def best_cutoff(mask):
        return min(GRID, key=lambda t: cost(mask, score >= t)["cost"])

    chosen = float(best_cutoff(train))
    hindsight = float(best_cutoff(test))
    today = cost(test, current_decline)
    with_chosen = cost(test, score >= chosen)
    with_hindsight = cost(test, score >= hindsight)
    savings = today["cost"] - with_chosen["cost"]

    return {
        "train_orders": int(train.sum()), "test_orders": int(test.sum()),
        "train_days": round(train_days, 1), "test_days": round(test_days, 1),
        "cutoff": round(chosen * scale, 2),
        "cost_today": round(today["cost"], 2),
        "cost_at_cutoff": round(with_chosen["cost"], 2),
        "savings": round(savings, 2),
        "savings_pct": round(savings / today["cost"] * 100, 2) if today["cost"] else 0.0,
        "monthly_savings": round(savings / test_days * 30, 2),
        # What the best cutoff for the later period turned out to be, known only in hindsight.
        "hindsight_cutoff": round(hindsight * scale, 2),
        "hindsight_savings": round(today["cost"] - with_hindsight["cost"], 2),
        "holds": bool(savings > 0),
    }


def _round_policy(d: dict) -> dict:
    return {k: (round(v, 2) if isinstance(v, float) else v) for k, v in d.items()}


def analyze(orders: pd.DataFrame,
            customer_value: float = DEFAULT_CUSTOMER_VALUE,
            churn_rate: float = DEFAULT_CHURN_RATE,
            chargeback_fee: float = DEFAULT_CHARGEBACK_FEE,
            current_threshold: float | None = None,
            warnings: list[str] | None = None) -> dict:
    if customer_value < 0 or chargeback_fee < 0 or not (0 <= churn_rate <= 1):
        raise AnalysisError("Customer value and dispute fee must be positive, and the churn rate between 0% and 100%.")

    warnings = list(warnings or [])
    scale = orders.attrs.get("score_scale", 1.0)
    amount = orders["amount"].to_numpy(float)
    score = orders["score"].to_numpy(float)
    labeled = orders["fraud"].notna().to_numpy()
    # Known outcome where we have one; otherwise an estimate from the score.
    estimate, calibration = _fraud_estimate(score, orders["fraud"].to_numpy(float), labeled)
    if calibration == "raw_score" and (~labeled).any() and labeled.any():
        warnings.append("Not enough labeled chargebacks to learn how your scores map to real fraud, so the raw "
                        "score is used as the fraud probability for unlabeled orders. Treat results as rough.")
    if calibration == "calibrated" and (~labeled).any():
        warnings.append("Fraud on unlabeled orders is estimated by learning how your scores map to real "
                        "chargebacks on the orders you approved, then extending that pattern to higher scores.")
    p_fraud = np.where(labeled, orders["fraud"].fillna(0).to_numpy(float), estimate)

    def run(threshold: float, cust_cost: float) -> dict:
        return _policy_cost(score >= threshold, p_fraud, amount, cust_cost, chargeback_fee)

    customer_cost = customer_value * churn_rate

    # Baseline: what the merchant does today.
    if orders["declined"].notna().any():
        current_decline = orders["declined"].fillna(0).to_numpy(bool)
        baseline_label = "your current setup"
    elif current_threshold is not None:
        current_decline = score >= (current_threshold / scale)
        baseline_label = f"your current cutoff of {current_threshold:g}"
    else:
        current_decline = np.zeros(len(orders), dtype=bool)
        baseline_label = "declining nothing"
    current = _policy_cost(current_decline, p_fraud, amount, customer_cost, chargeback_fee)

    # If today's declines look like a simple "score >= X" rule, report X so the
    # result can say "move your cutoff from X to Y". Left as None when they don't.
    current_cutoff = None
    if current_threshold is not None and not orders["declined"].notna().any():
        current_cutoff = float(current_threshold)
    elif current_decline.any():
        lowest = float(score[current_decline].min())
        above = score >= lowest
        if current_decline[above].mean() >= 0.95:
            current_cutoff = round(lowest * scale, 2)

    curve = [{"threshold": round(float(t) * scale, 2), **_round_policy(run(t, customer_cost))} for t in GRID]
    best_point = min(curve, key=lambda c: c["cost"])
    best_t = best_point["threshold"] / scale
    best = run(best_t, customer_cost)

    savings = current["cost"] - best["cost"]
    by_size = _size_bands(amount, score, p_fraud, customer_cost, chargeback_fee, scale, best_t, best["cost"])

    sensitivity = []
    for m in SENSITIVITY_MULTIPLIERS:
        cc = customer_cost * m
        cur_m = _policy_cost(current_decline, p_fraud, amount, cc, chargeback_fee)["cost"]
        # Keep the threshold recommended at the stated assumptions; ask how it holds up.
        rec_m = run(best_t, cc)["cost"]
        sensitivity.append({
            "multiplier": m,
            "savings": round(cur_m - rec_m, 2),
            "savings_pct": round((cur_m - rec_m) / cur_m * 100, 2) if cur_m else 0.0,
        })

    backtest = _backtest(orders, amount, score, current_decline, customer_cost, chargeback_fee, scale)

    period_days = None
    monthly_savings = None
    if "date" in orders and orders["date"].notna().sum() > 1:
        span = (orders["date"].max() - orders["date"].min()).total_seconds() / 86400
        if span >= 1:
            period_days = round(span, 1)
            monthly_savings = round(savings / span * 30, 2)

    labeled = orders["fraud"].notna()
    return {
        "fraud_estimate_method": calibration,
        "rows": int(len(orders)),
        "score_scale": scale,
        "columns_used": orders.attrs.get("columns_used", {}),
        "labeled_orders": int(labeled.sum()),
        "observed_fraud_rate": round(float(orders.loc[labeled, "fraud"].mean()), 4) if labeled.any() else None,
        "total_volume": round(float(amount.sum()), 2),
        "assumptions": {
            "customer_value": customer_value,
            "churn_rate": churn_rate,
            "chargeback_fee": chargeback_fee,
            "cost_per_wrongly_declined_customer": round(customer_cost, 2),
        },
        "baseline_label": baseline_label,
        "current_cutoff": current_cutoff,
        "current": _round_policy(current),
        "recommended": {"threshold": best_point["threshold"], **_round_policy(best)},
        "savings": round(savings, 2),
        "savings_pct": round(savings / current["cost"] * 100, 2) if current["cost"] else 0.0,
        "period_days": period_days,
        "monthly_savings": monthly_savings,
        "curve": curve,
        "by_order_size": by_size,
        "backtest": backtest,
        "sensitivity": sensitivity,
        "warnings": warnings,
    }
