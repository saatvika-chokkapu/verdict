"""
Generate the sample merchant file used by "Try sample data" on the dashboard.

This is a SYNTHETIC online store (clearly labeled as such in the UI), shaped like a
typical order export: amounts, a 0-100 risk score from a fraud tool, whether the
store's current rule declined the order, and whether approved orders later charged
back. Declined orders have no fraud outcome, exactly as in real data.

Run from repo root:  python backend/make_sample_orders.py
"""
import os

import numpy as np
import pandas as pd

rng = np.random.default_rng(42)
N = 25_000
FRAUD_RATE = 0.018
CURRENT_CUTOFF = 55  # the store's existing rule; slightly too strict for its margins

is_fraud = rng.random(N) < FRAUD_RATE
amount = np.round(np.exp(rng.normal(4.2, 0.7, N)), 2)          # median ~ $67
amount[is_fraud] *= rng.uniform(1.2, 2.5, is_fraud.sum())       # fraudsters buy bigger baskets
score = np.where(is_fraud, rng.beta(4.0, 2.2, N), rng.beta(1.4, 7.0, N)) * 100
score = np.clip(np.round(score), 0, 99).astype(int)

start = pd.Timestamp("2026-06-01")
created = start + pd.to_timedelta(np.sort(rng.uniform(0, 90, N)), unit="D")

declined = score >= CURRENT_CUTOFF
fraud_outcome = np.where(declined, "", np.where(is_fraud, "yes", "no"))

df = pd.DataFrame({
    "order_id": [f"ORD-{100000 + i}" for i in range(N)],
    "created_at": created.strftime("%Y-%m-%d %H:%M"),
    "amount": np.round(amount, 2),
    "risk_score": score,
    "declined": np.where(declined, "yes", "no"),
    "chargeback": fraud_outcome,
})

out_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), "sample_data")
os.makedirs(out_dir, exist_ok=True)
df.to_csv(os.path.join(out_dir, "sample_orders.csv"), index=False)
# Template: a few rows showing every case (approved, approved-then-charged-back, declined).
example = pd.concat([
    df[df["chargeback"] == "no"].head(4),
    df[df["chargeback"] == "yes"].head(1),
    df[df["declined"] == "yes"].head(2),
]).sort_values("created_at")
example.to_csv(os.path.join(out_dir, "template.csv"), index=False)
print(f"Wrote {len(df):,} orders; {declined.mean():.1%} declined; {is_fraud.mean():.2%} fraud")
