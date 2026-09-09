"""
Generate local JSON snapshots of the three Snowflake-backed API payloads,
computed from the raw dataset and the trained model with the exact same
logic as the ingestion + scoring + dbt pipeline. Used as a fallback so the
live demo keeps working when the Snowflake warehouse is unavailable.

Run from repo root:  python backend/generate_snapshots.py
"""
import json
import os
import sys
from datetime import datetime, timedelta

import joblib
import numpy as np
import pandas as pd

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from cost_model import CHURN_RATE_AFTER_FALSE_DECLINE, SEGMENT_LIFETIME_VALUE

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(BASE_DIR)
OUT_DIR = os.path.join(BASE_DIR, "snapshots")
NAIVE_THRESHOLD = 0.5
MULTIPLIERS = [0.25, 0.5, 1.0, 1.5, 2.0]

# --- 1. Load and prepare, mirroring ingestion/load_to_lakehouse.py ---
print("Loading raw data...")
txn_cols = ["TransactionID", "TransactionDT", "TransactionAmt", "ProductCD",
            "card1", "card4", "card6", "addr1", "P_emaildomain", "isFraud"]
transactions = pd.read_csv(os.path.join(ROOT, "data/raw/train_transaction.csv"), usecols=txn_cols)
identity = pd.read_csv(os.path.join(ROOT, "data/raw/train_identity.csv"),
                       usecols=["TransactionID", "DeviceType", "DeviceInfo"])
df = transactions.merge(identity, on="TransactionID", how="left")

reference_start = datetime(2017, 12, 1)
df["txn_date"] = df["TransactionDT"].apply(
    lambda s: (reference_start + timedelta(seconds=int(s))).date().isoformat()
)
df = df.rename(columns={"TransactionID": "txn_id", "TransactionAmt": "amount",
                        "isFraud": "is_fraud_label"})

# --- 2. Score, mirroring backend/score_and_load_decisions.py ---
print("Scoring", len(df), "transactions...")
model = joblib.load(os.path.join(BASE_DIR, "fraud_model.pkl"))
categorical_cols = ["ProductCD", "card4", "card6", "P_emaildomain", "DeviceType", "DeviceInfo"]
df_encoded = df.copy()
for col in categorical_cols:
    df_encoded[col] = df_encoded[col].astype("category").cat.codes
feature_cols = ["amount", "card1", "addr1"] + categorical_cols
df["fraud_probability"] = model.predict_proba(df_encoded[feature_cols])[:, 1]

# --- 3. Vectorized segment + decision logic, identical math to cost_model.py ---
card_type = np.where(df["card6"] == "credit", "credit",
             np.where(df["card6"] == "debit", "debit", "unknown"))
tier = np.where(df["amount"] > 100, "high_value", "low_value")
segment = np.where(card_type == "unknown", "unknown",
                   pd.Series(card_type).str.cat(pd.Series(tier), sep="_"))
ltv = pd.Series(segment).map(SEGMENT_LIFETIME_VALUE).fillna(SEGMENT_LIFETIME_VALUE["unknown"]).to_numpy()
decline_cost_arr = CHURN_RATE_AFTER_FALSE_DECLINE * ltv

p = df["fraud_probability"].to_numpy()
amount = df["amount"].to_numpy()
label = df["is_fraud_label"].to_numpy()
cost_approve = p * amount

def realized(decision_is_decline):
    out = np.zeros(len(df))
    out[(label == 1) & (~decision_is_decline)] = amount[(label == 1) & (~decision_is_decline)]
    fd = (label == 0) & decision_is_decline
    out[fd] = decline_cost_arr[fd]
    return out

naive_decline = p > NAIVE_THRESHOLD
naive_cost = realized(naive_decline)

rf_decline_1x = ((1 - p) * decline_cost_arr * 1.0) < cost_approve
rf_cost_1x = realized(rf_decline_1x)

# --- 4. cost_outcomes snapshot (dbt marts/cost_outcomes.sql) ---
print("Building cost_outcomes snapshot...")
g = pd.DataFrame({
    "txn_date": df["txn_date"], "label": label,
    "rf_decline": rf_decline_1x, "rf_cost": rf_cost_1x,
    "nv_decline": naive_decline, "nv_cost": naive_cost,
})
rows = []
for d, grp in g.groupby("txn_date", sort=True):
    rows.append({
        "txn_date": d,
        "total_transactions": int(len(grp)),
        "riskflow_fraud_caught": int(((grp["label"] == 1) & grp["rf_decline"]).sum()),
        "riskflow_false_declines": int(((grp["label"] == 0) & grp["rf_decline"]).sum()),
        "riskflow_total_cost": round(float(grp["rf_cost"].sum()), 2),
        "naive_fraud_caught": int(((grp["label"] == 1) & grp["nv_decline"]).sum()),
        "naive_false_declines": int(((grp["label"] == 0) & grp["nv_decline"]).sum()),
        "naive_total_cost": round(float(grp["nv_cost"].sum()), 2),
        "net_cost_vs_naive_baseline": round(float(grp["nv_cost"].sum() - grp["rf_cost"].sum()), 2),
    })
cost_outcomes = rows

# --- 5. sensitivity_results snapshot (backend/sensitivity_analysis.py) ---
print("Building sensitivity snapshot...")
naive_total = float(naive_cost.sum())
sens = []
for mult in MULTIPLIERS:
    dec = ((1 - p) * decline_cost_arr * mult) < cost_approve
    cost = np.zeros(len(df))
    cost[(label == 1) & (~dec)] = amount[(label == 1) & (~dec)]
    fd = (label == 0) & dec
    cost[fd] = decline_cost_arr[fd] * mult
    total = float(cost.sum())
    sens.append({
        "cost_multiplier": mult,
        "riskflow_total_cost": round(total, 2),
        "naive_total_cost": round(naive_total, 2),
        "savings_vs_naive": round(naive_total - total, 2),
        "savings_pct": round((naive_total - total) / naive_total * 100, 2),
        "fraud_caught_count": int(((label == 1) & dec).sum()),
        "false_declines_count": int(((label == 0) & dec).sum()),
    })

# --- 6. threshold_simulator snapshot (main.py query, 0.05 grid) ---
print("Building threshold snapshot...")
thresholds = {}
for t in [round(0.05 * i, 2) for i in range(1, 20)]:
    caught = (p > t) & (label == 1)
    missed = (p <= t) & (label == 1)
    fd = (p > t) & (label == 0)
    thresholds[f"{t:.2f}"] = {
        "threshold": t,
        "fraud_caught_value": round(float(amount[caught].sum()), 2),
        "fraud_caught_count": int(caught.sum()),
        "fraud_missed_value": round(float(amount[missed].sum()), 2),
        "false_declines": int(fd.sum()),
    }

os.makedirs(OUT_DIR, exist_ok=True)
for name, payload in [("cost_outcomes", cost_outcomes),
                      ("sensitivity_results", sens),
                      ("threshold_simulator", thresholds)]:
    with open(os.path.join(OUT_DIR, f"{name}.json"), "w") as f:
        json.dump(payload, f)
    print("wrote", name, "->", len(payload), "entries")

print("Sanity: total savings at 1.0x =", sens[2]["savings_vs_naive"], f"({sens[2]['savings_pct']}%)")
