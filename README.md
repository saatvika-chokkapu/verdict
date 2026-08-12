# RiskFlow

**Real-time payment risk and cost-optimized transaction decisioning.**

Live demo: https://riskflow-five.vercel.app

RiskFlow scores incoming transactions for fraud risk with a LightGBM model, then makes an approve/decline decision based on *expected cost* — not a fixed probability threshold. Declining a legitimate transaction has a real cost (customer churn); approving a fraudulent one has a real cost (the transaction amount). RiskFlow compares both and picks the cheaper outcome, in real time.

## Why cost-based decisioning, not just a fraud score

A model that outputs "87% fraud probability" doesn't tell you what to actually do. Naively declining everything above 0.5 ignores that a $12 transaction and a $1,200 transaction carry very different risk, and that falsely declining a legitimate customer has a real, measurable cost (estimated churn × customer lifetime value). RiskFlow's `cost_model.py` computes the expected cost of approving vs. declining each transaction and decides based on that comparison. The assumptions that aren't derivable from the dataset itself (churn rate, lifetime value by segment) are explicitly documented and separated from what *is* real, in [`docs/cost_model_assumptions.md`](docs/cost_model_assumptions.md) — and exposed as a tunable `cost_multiplier` so the sensitivity of the decision to those assumptions can be stress-tested directly, rather than baked in silently.

## Architecture
Kafka (streaming ingestion)
→ S3 + Apache Iceberg lakehouse (via AWS Glue Catalog)
→ Airflow (orchestration)
→ Snowflake + dbt (warehouse modeling)
→ LightGBM (fraud classifier)
→ FastAPI (real-time decisioning API, + DynamoDB card-velocity lookups)
→ React frontend (Vercel)
Infrastructure is provisioned with Terraform; deployment runs through GitHub Actions.

## Real data, real scale

- **Dataset:** IEEE-CIS Fraud Detection (Kaggle) — 590,540 real transactions, 20,663 labeled fraud (3.499% fraud rate)
- **Model:** LightGBM classifier, versioned (`lightgbm_v1`)
- **API latency:** p50 ~28ms, p95 ~62ms

## What the API actually does

- `POST /api/decision` — scores a transaction, checks real-time card velocity (DynamoDB) to catch card-testing patterns, and returns an approve/decline/review decision with the expected cost of each option
- `GET /api/threshold-simulator` — replays historical decisions at any probability threshold, so you can see the fraud-caught vs. false-decline tradeoff before changing anything in production
- `GET /api/sensitivity-analysis` — shows how total cost changes as the cost-model assumptions are scaled, rather than treating them as fixed truth
- `GET /api/pipeline/health` — lakehouse, warehouse, and model drift status

## Stack

Kafka · AWS S3 / Iceberg / Glue · Airflow · Snowflake · dbt · LightGBM · FastAPI · DynamoDB · Terraform · GitHub Actions · React · Vercel · Render

## Running locally
docker-compose up # Kafka, Zookeeper, Airflow
cd backend && uvicorn main:app --reload
cd frontend && npm install && npm run dev
Requires a `.env` file (see `.env.example`) with Snowflake and AWS credentials.
