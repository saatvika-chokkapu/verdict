
import pandas as pd
import numpy as np
import json
import os
from datetime import datetime, timezone
from pyiceberg.catalog import load_catalog

BUCKET_NAME = "riskflow-lakehouse-7d75d72b"
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
FEATURES = ["amount", "card1", "addr1"]


def calculate_psi(baseline_col, current_col, bins=10):
    breakpoints = np.quantile(baseline_col.dropna(), np.linspace(0, 1, bins + 1))
    breakpoints[0] = -np.inf
    breakpoints[-1] = np.inf

    baseline_counts = pd.cut(baseline_col, breakpoints).value_counts(normalize=True).sort_index()
    current_counts = pd.cut(current_col, breakpoints).value_counts(normalize=True).sort_index()

    baseline_pct = baseline_counts.replace(0, 0.0001)
    current_pct = current_counts.reindex(baseline_pct.index, fill_value=0.0001).replace(0, 0.0001)

    psi = np.sum((current_pct - baseline_pct) * np.log(current_pct / baseline_pct))
    return psi


def _status_for_psi(psi):
    if psi < 0.1:
        return "STABLE"
    elif psi < 0.25:
        return "MODERATE SHIFT"
    return "SIGNIFICANT DRIFT"


def compute_drift_report():
    """Computes PSI-based drift per feature and returns a structured report.
    This is the function main.py's /api/pipeline/health imports and calls on a
    cadence -- it is NOT called on every request, since it scans the full
    lakehouse table, which is too slow to run per-API-call."""
    catalog = load_catalog("riskflow", **{"type": "glue", "warehouse": f"s3://{BUCKET_NAME}/"})
    table = catalog.load_table("riskflow_lakehouse.raw_transactions")
    df = table.scan().to_pandas()
    df["txn_date"] = pd.to_datetime(df["txn_date"])
    df = df.sort_values("txn_date")

    split_point = df["txn_date"].quantile(0.7)
    baseline = df[df["txn_date"] <= split_point]
    current = df[df["txn_date"] > split_point]

    feature_results = {}
    worst_status = "STABLE"
    for feature in FEATURES:
        psi = float(calculate_psi(baseline[feature], current[feature]))
        status = _status_for_psi(psi)
        feature_results[feature] = {"psi": round(psi, 4), "status": status}
        if status == "SIGNIFICANT DRIFT":
            worst_status = "SIGNIFICANT DRIFT"
        elif status == "MODERATE SHIFT" and worst_status != "SIGNIFICANT DRIFT":
            worst_status = "MODERATE SHIFT"

    return {
        "checked_at": datetime.now(timezone.utc).isoformat(),
        "baseline_rows": int(len(baseline)),
        "current_rows": int(len(current)),
        "split_date": str(split_point.date()),
        "overall_status": worst_status,
        "features": feature_results,
    }


if __name__ == "__main__":
    report = compute_drift_report()
    print(f"Baseline: {report['baseline_rows']} rows | Current: {report['current_rows']} rows")
    print(f"Split date: {report['split_date']}")
    print("\nDrift Report (PSI per feature):")
    for feature, result in report["features"].items():
        print(f"  {feature}: PSI={result['psi']} [{result['status']}]")
    print(f"\nOverall status: {report['overall_status']}")

    out_path = os.path.join(BASE_DIR, "drift_report.json")
    with open(out_path, "w") as f:
        json.dump(report, f, indent=2)
    print(f"\nReport written to {out_path}")
