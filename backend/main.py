import os
import time
import joblib
import pandas as pd
from fastapi import FastAPI, File, Form, HTTPException, Request, UploadFile
from fastapi.responses import FileResponse, JSONResponse
from pydantic import BaseModel
from backend.cost_model import assign_segment, decide_transaction, VELOCITY_REVIEW_THRESHOLD

from fastapi.middleware.cors import CORSMiddleware

# Error reporting is on only when a DSN is configured, so local runs and CI need nothing.
if os.getenv("SENTRY_DSN"):
    import sentry_sdk
    sentry_sdk.init(dsn=os.getenv("SENTRY_DSN"), traces_sample_rate=0.0, send_default_pii=False)

app = FastAPI(title="Verdict API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://localhost:4173"],
    allow_origin_regex=r"https://.*\.vercel\.app",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
import snowflake.connector
from dotenv import load_dotenv

load_dotenv()

SNAPSHOT_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "snapshots")
SAMPLE_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "sample_data")

# "snapshot" (default) serves the precomputed research results straight from disk.
# "snowflake" queries the live warehouse first and falls back to the snapshot on error.
# The default skips Snowflake entirely, so a suspended warehouse never slows a request.
DATA_SOURCE = os.getenv("DATA_SOURCE", "snapshot").lower()

def load_snapshot(name):
    """Serve results computed by backend/generate_snapshots.py (same pipeline
    logic, same data) when the live Snowflake warehouse is unreachable."""
    import json
    with open(os.path.join(SNAPSHOT_DIR, f"{name}.json")) as f:
        return json.load(f)

def get_snowflake_connection():
    return snowflake.connector.connect(
        account=os.getenv("SNOWFLAKE_ACCOUNT"),
        user=os.getenv("SNOWFLAKE_USER"),
        password=os.getenv("SNOWFLAKE_PASSWORD"),
        role="ACCOUNTADMIN",
        warehouse=os.getenv("SNOWFLAKE_WAREHOUSE"),
        database=os.getenv("SNOWFLAKE_DATABASE"),
        schema=os.getenv("SNOWFLAKE_SCHEMA"),
    )
import boto3

dynamodb_resource = boto3.resource("dynamodb", region_name="us-east-1")
velocity_table = dynamodb_resource.Table("riskflow-card-velocity")

# Documented assumption, not derived from this dataset:
# more than 5 transactions/hour from one card resembles card-testing fraud patterns

def get_card_velocity(card_id: str):
    try:
        response = velocity_table.get_item(Key={"card_id": card_id})
        item = response.get("Item")
        if item:
            return {
                "txn_count_1h": int(item.get("txn_count_1h", 0)),
                "txn_count_24h": int(item.get("txn_count_24h", 0)),
            }
    except Exception:
        pass
    # Graceful degradation: new card, or DynamoDB temporarily unreachable —
    # default to "no known velocity" rather than failing the whole request
    return {"txn_count_1h": 0, "txn_count_24h": 0}

# Loaded once at startup — not per-request
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
model = joblib.load(os.path.join(BASE_DIR, "fraud_model.pkl"))
encoders = joblib.load(os.path.join(BASE_DIR, "encoders.pkl"))

CATEGORICAL_COLS = ["ProductCD", "card4", "card6", "P_emaildomain", "DeviceType", "DeviceInfo"]
FEATURE_COLS = ["amount", "card1", "addr1"] + CATEGORICAL_COLS

class Transaction(BaseModel):
    txn_id: int
    amount: float
    card1: int
    card4: str
    card6: str
    addr1: float
    ProductCD: str
    P_emaildomain: str
    DeviceType: str
    DeviceInfo: str

def encode_value(col, value):
    # Use the exact mapping learned during training.
    # Fall back to -1 for any category never seen in training data —
    # an honest, explicit signal to the model rather than a silent guess.
    return encoders[col].get(value, -1)

@app.post("/api/decision")
def decide(txn: Transaction):
    start_time = time.perf_counter()

    row = {
        "amount": txn.amount,
        "card1": txn.card1,
        "addr1": txn.addr1,
        "ProductCD": encode_value("ProductCD", txn.ProductCD),
        "card4": encode_value("card4", txn.card4),
        "card6": encode_value("card6", txn.card6),
        "P_emaildomain": encode_value("P_emaildomain", txn.P_emaildomain),
        "DeviceType": encode_value("DeviceType", txn.DeviceType),
        "DeviceInfo": encode_value("DeviceInfo", txn.DeviceInfo),
    }
    X = pd.DataFrame([row])[FEATURE_COLS]

    fraud_probability = model.predict_proba(X)[0][1]

    segment = assign_segment({"card6": txn.card6, "amount": txn.amount})
    decision, cost_approve, cost_decline = decide_transaction(fraud_probability, txn.amount, segment)

    velocity = get_card_velocity(str(txn.card1))
    if decision == "approve" and velocity["txn_count_1h"] > VELOCITY_REVIEW_THRESHOLD:
        decision = "review"

    latency_ms = (time.perf_counter() - start_time) * 1000

    return {
        "txn_id": txn.txn_id,
        "decision": decision,
        "fraud_probability": round(float(fraud_probability), 4),
        "segment": segment,
        "expected_cost_approve": round(cost_approve, 2),
        "expected_cost_decline": round(cost_decline, 2),
        "card_velocity_1h": velocity["txn_count_1h"],
        "card_velocity_24h": velocity["txn_count_24h"],
        "latency_ms": round(latency_ms, 2),
    }

@app.get("/api/cost-analysis")
def cost_analysis():
    if DATA_SOURCE != "snowflake":
        return load_snapshot("cost_outcomes")
    try:
        return _cost_analysis_live()
    except Exception:
        return load_snapshot("cost_outcomes")

def _cost_analysis_live():
    conn = get_snowflake_connection()
    cursor = conn.cursor()
    cursor.execute("""
        SELECT txn_date, total_transactions, riskflow_fraud_caught, riskflow_false_declines,
               riskflow_total_cost, naive_fraud_caught, naive_false_declines, naive_total_cost,
               net_cost_vs_naive_baseline
        FROM cost_outcomes ORDER BY txn_date
    """)
    cols = [c[0].lower() for c in cursor.description]
    rows = [dict(zip(cols, row)) for row in cursor.fetchall()]
    conn.close()
    return rows

@app.get("/api/threshold-simulator")
def threshold_simulator(threshold: float = 0.5):
    def from_snapshot():
        grid = load_snapshot("threshold_simulator")
        key = f"{max(0.05, min(0.95, round(threshold / 0.05) * 0.05)):.2f}"
        return grid[key]
    if DATA_SOURCE != "snowflake":
        return from_snapshot()
    try:
        return _threshold_simulator_live(threshold)
    except Exception:
        return from_snapshot()

def _threshold_simulator_live(threshold: float):
    conn = get_snowflake_connection()
    cursor = conn.cursor()
    cursor.execute("""
        SELECT
            SUM(CASE WHEN fraud_probability > %s AND is_fraud_label = 1 THEN amount ELSE 0 END) as fraud_caught_value,
            SUM(CASE WHEN fraud_probability > %s AND is_fraud_label = 1 THEN 1 ELSE 0 END) as fraud_caught_count,
            SUM(CASE WHEN fraud_probability <= %s AND is_fraud_label = 1 THEN amount ELSE 0 END) as fraud_missed_value,
            SUM(CASE WHEN fraud_probability > %s AND is_fraud_label = 0 THEN 1 ELSE 0 END) as false_declines
        FROM decision_results
    """, (threshold, threshold, threshold, threshold))
    row = cursor.fetchone()
    conn.close()
    return {
        "threshold": threshold,
        "fraud_caught_value": float(row[0] or 0),
        "fraud_caught_count": int(row[1] or 0),
        "fraud_missed_value": float(row[2] or 0),
        "false_declines": int(row[3] or 0),
    }

@app.get("/api/pipeline/health")
def pipeline_health():
    # Previously this returned hardcoded strings ("STABLE", "lightgbm_v1") regardless
    # of what was actually happening. Now it reads real, generated reports and is
    # honest when they don't exist yet rather than faking a status.
    import json

    drift_path = os.path.join(BASE_DIR, "drift_report.json")
    try:
        with open(drift_path) as f:
            drift = json.load(f)
        drift_status = drift["overall_status"]
        drift_checked_at = drift["checked_at"]
    except FileNotFoundError:
        drift_status = "NOT YET CHECKED"
        drift_checked_at = None

    version_path = os.path.join(BASE_DIR, "model_version.json")
    try:
        with open(version_path) as f:
            version_info = json.load(f)
        model_version = version_info["version_tag"]
        model_trained_at = version_info["trained_at"]
    except FileNotFoundError:
        model_version = "unknown (backend/model_version.json not found -- retrain to generate)"
        model_trained_at = None

    # Latency comes from backend/benchmark_latency.py, not a literal.
    latency_path = os.path.join(BASE_DIR, "latency_report.json")
    try:
        with open(latency_path) as f:
            lat = json.load(f)
        latency = {
            "api_latency_ms_p50": lat["wall_ms"]["p50"],
            "api_latency_ms_p95": lat["wall_ms"]["p95"],
            "api_latency_ms_p99": lat["wall_ms"]["p99"],
            "latency_measured_at": lat["generated_at"],
            "latency_mode": lat["mode"],
            "latency_sample_size": lat["requests"],
        }
    except FileNotFoundError:
        latency = {
            "api_latency_ms_p50": None,
            "api_latency_ms_p95": None,
            "api_latency_ms_p99": None,
            "latency_measured_at": None,
            "latency_mode": "NOT YET MEASURED (run backend/benchmark_latency.py)",
            "latency_sample_size": 0,
        }

    return {
        "data_source": DATA_SOURCE,
        "research_data": ("live Snowflake warehouse" if DATA_SOURCE == "snowflake"
                          else "snapshot computed by the pipeline (backend/generate_snapshots.py)"),
        "last_drift_check": drift_status,
        "drift_checked_at": drift_checked_at,
        "model_version": model_version,
        "model_trained_at": model_trained_at,
        **latency,
    }
@app.get("/api/sensitivity-analysis")
def sensitivity_analysis():
    if DATA_SOURCE != "snowflake":
        return load_snapshot("sensitivity_results")
    try:
        return _sensitivity_analysis_live()
    except Exception:
        return load_snapshot("sensitivity_results")

def _sensitivity_analysis_live():
    conn = get_snowflake_connection()
    cursor = conn.cursor()
    cursor.execute("""
        SELECT cost_multiplier, riskflow_total_cost, naive_total_cost,
               savings_vs_naive, savings_pct, fraud_caught_count, false_declines_count
        FROM sensitivity_results
        ORDER BY cost_multiplier
    """)
    cols = [c[0].lower() for c in cursor.description]
    rows = [dict(zip(cols, row)) for row in cursor.fetchall()]
    conn.close()
    return rows


# ---------------------------------------------------------------------------
# Merchant analyzer: "where should I set my fraud cutoff?"
# ---------------------------------------------------------------------------
import json  # noqa: E402
from collections import defaultdict, deque  # noqa: E402

from backend.analyzer import AnalysisError, ColumnsNotFound, analyze, load_orders  # noqa: E402
from backend.column_mapper import suggest_mapping  # noqa: E402

# Small in-memory rate limit: uploads are the only expensive endpoint, and the API
# runs as a single process, so a per-IP sliding window is enough.
RATE_LIMIT = int(os.getenv("ANALYZE_RATE_LIMIT", "12"))   # requests
RATE_WINDOW = 60.0                                        # seconds
_recent: dict[str, deque] = defaultdict(deque)


def _client_ip(request: Request) -> str:
    forwarded = request.headers.get("x-forwarded-for")
    if forwarded:
        return forwarded.split(",")[0].strip()
    return request.client.host if request.client else "unknown"


def _check_rate_limit(request: Request) -> None:
    now = time.monotonic()
    hits = _recent[_client_ip(request)]
    while hits and now - hits[0] > RATE_WINDOW:
        hits.popleft()
    if len(hits) >= RATE_LIMIT:
        raise HTTPException(429, "Too many analyses in a short time. Wait a minute and try again.")
    hits.append(now)

MAX_UPLOAD_BYTES = 25 * 1024 * 1024


@app.post("/api/analyze")
async def analyze_orders(
    request: Request,
    file: UploadFile | None = File(None),
    mapping: str | None = Form(None),
    use_sample: bool = Form(False),
    customer_value: float = Form(300.0),
    churn_rate: float = Form(0.39),
    chargeback_fee: float = Form(15.0),
    current_threshold: float | None = Form(None),
):
    _check_rate_limit(request)
    column_mapping = None
    if mapping:
        try:
            column_mapping = {str(k): str(v) for k, v in json.loads(mapping).items() if v}
        except (ValueError, AttributeError) as exc:
            raise HTTPException(400, "The column mapping was not valid.") from exc

    if use_sample:
        with open(os.path.join(SAMPLE_DIR, "sample_orders.csv"), "rb") as f:
            raw = f.read()
    elif file is not None:
        raw = await file.read(MAX_UPLOAD_BYTES + 1)
        if len(raw) > MAX_UPLOAD_BYTES:
            raise HTTPException(413, "File is larger than 25 MB.")
    else:
        raise HTTPException(400, "Upload a CSV file or choose the sample data.")

    try:
        orders, warnings = load_orders(raw, mapping=column_mapping)
        result = analyze(orders, customer_value=customer_value, churn_rate=churn_rate,
                         chargeback_fee=chargeback_fee, current_threshold=current_threshold,
                         warnings=warnings)
    except ColumnsNotFound as exc:
        # Not a dead end: tell the UI what columns exist so the merchant can match them.
        suggestion = suggest_mapping(exc.columns)
        return JSONResponse(status_code=422, content={
            "detail": str(exc),
            "needs_mapping": True,
            "columns": exc.columns,
            "matched": {k: v for k, v in exc.found.items() if v},
            "suggestion": suggestion,
            "suggested_by": "ai" if suggestion else None,
        })
    except AnalysisError as exc:
        raise HTTPException(422, str(exc)) from exc
    result["source"] = "sample" if use_sample else "upload"
    return result


@app.get("/api/template.csv")
def download_template():
    return FileResponse(os.path.join(SAMPLE_DIR, "template.csv"), media_type="text/csv",
                        filename="verdict_template.csv")


@app.get("/api/sample-orders.csv")
def download_sample_orders():
    return FileResponse(os.path.join(SAMPLE_DIR, "sample_orders.csv"), media_type="text/csv",
                        filename="verdict_sample_orders.csv")
