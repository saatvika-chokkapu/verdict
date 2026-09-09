# Verdict

**Real-time payment risk and cost-optimized transaction decisioning.**

Live demo: https://riskflow-five.vercel.app

Verdict scores incoming transactions for fraud risk with a LightGBM model, then makes an approve/decline decision based on *expected cost* — not a fixed probability threshold. Declining a legitimate transaction has a real cost (customer churn); approving a fraudulent one has a real cost (the transaction amount). Verdict compares both and picks the cheaper outcome, in real time.

## Why cost-based decisioning, not just a fraud score

A model that outputs "87% fraud probability" doesn't tell you what to actually do. Naively declining everything above 0.5 ignores that a $12 transaction and a $1,200 transaction carry very different risk, and that falsely declining a legitimate customer has a real, measurable cost (estimated churn × customer lifetime value). Verdict's `cost_model.py` computes the expected cost of approving vs. declining each transaction and decides based on that comparison. The assumptions that aren't derivable from the dataset itself (churn rate, lifetime value by segment) are explicitly documented and separated from what *is* real, in [`docs/cost_model_assumptions.md`](docs/cost_model_assumptions.md) — and exposed as a tunable `cost_multiplier` so the sensitivity of the decision to those assumptions can be stress-tested directly, rather than baked in silently.

## Architecture
Kafka (streaming ingestion)
→ S3 + Apache Iceberg lakehouse (via AWS Glue Catalog)
→ Airflow (orchestration)
→ Snowflake + dbt (warehouse modeling)
→ LightGBM (fraud classifier)
→ FastAPI (real-time decisioning API, + DynamoDB card-velocity lookups)
→ React frontend (Vercel)
Infrastructure is provisioned with Terraform. GitHub Actions runs two workflows on every push: `dbt run` + `dbt test` (10 data tests) against Snowflake, and `pytest` (49 unit and API tests) followed by the latency benchmark.

## Testing

```
python -m pytest tests -q            # 49 tests: cost policy boundaries, PSI drift bands, API contract, snapshot fallback
python backend/benchmark_latency.py  # p50/p95/p99 -> backend/latency_report.json
cd riskflow_dbt && dbt test          # 10 schema + singular tests
```

`tests/test_cost_model.py` pins the decision policy: the `amount > 100` segment boundary, tie-breaking to approve, zero-probability never declines, and the cost multiplier being monotonic (raising the assumed churn cost can only move decisions toward approve). `tests/test_drift.py` checks PSI is ~0 for identical distributions, grows with shift, and lands in the documented 0.1 / 0.25 bands. `tests/test_api.py` covers the response contract, 422s on bad input, unseen-category encoding to -1, velocity escalation to `review`, and the snapshot fallback when Snowflake is unreachable.

## Real data, real scale

- **Dataset:** IEEE-CIS Fraud Detection (Kaggle) — 590,540 real transactions, 20,663 labeled fraud (3.499% fraud rate)
- **Model:** LightGBM classifier, versioned (`lightgbm_v1`)
- **Model quality:** 0.872 ROC-AUC on a stratified 118,108-row hold-out (20%); PR-AUC 0.394
- **Decision policy:** $126,129 (4.80%) lower total realized cost than a fixed 0.5 threshold, with 1.75x higher average value per fraud caught ($405 vs $231)
- **API latency:** measured by `backend/benchmark_latency.py`, which writes `backend/latency_report.json` and feeds `/api/pipeline/health`. In-process (inference + policy, DynamoDB stubbed): p50 1.45 ms, p95 1.61 ms, p99 1.72 ms over 2,000 requests, ~680 req/s sequential. Run with `--url http://localhost:8000` to measure the full HTTP path including the DynamoDB velocity lookup.

## What the API actually does

- `POST /api/decision` — scores a transaction, checks real-time card velocity (DynamoDB) to catch card-testing patterns, and returns an approve/decline/review decision with the expected cost of each option
- `GET /api/threshold-simulator` — replays historical decisions at any probability threshold, so you can see the fraud-caught vs. false-decline tradeoff before changing anything in production
- `GET /api/sensitivity-analysis` — shows how total cost changes as the cost-model assumptions are scaled, rather than treating them as fixed truth
- `GET /api/pipeline/health` — lakehouse, warehouse, and model drift status

## Model tracking and governance
`backend/train_model.py` logs each training run to Databricks-hosted MLflow (params, metrics, the
model artifact) and registers the model in Unity Catalog (`verdict_catalog.fraud_detection.lightgbm_fraud_model`),
replacing what used to be no experiment tracking or versioning at all. Requires `DATABRICKS_HOST`
and `DATABRICKS_TOKEN` in `.env`; training still runs and saves locally without them, just skips
the registry step. `/api/pipeline/health` also reports real drift status (PSI-based, computed by
`backend/check_model_drift.py`) and the current model version, both previously hardcoded strings.

## Stack

Kafka · AWS S3 / Iceberg / Glue · Airflow · Snowflake · dbt · LightGBM · Databricks · MLflow · Unity Catalog · FastAPI · DynamoDB · Terraform · GitHub Actions · React · Vercel · Render

## Running locally
docker-compose up # Kafka, Zookeeper, Airflow
cd backend && uvicorn main:app --reload
cd frontend && npm install && npm run dev
Requires a `.env` file (see `.env.example`) with Snowflake and AWS credentials.
