"""
Latency benchmark for POST /api/decision.

Two modes:
  in-process (default)  -- drives the FastAPI app through TestClient. Measures
                           model inference + decision policy + serialization,
                           with the DynamoDB lookup stubbed. Reproducible in CI.
  --url http://host:port -- fires real HTTP requests at a running server, so
                           network and uvicorn overhead are included.

Writes backend/latency_report.json (p50/p95/p99, throughput) which
/api/pipeline/health reads instead of hardcoding numbers.

Usage:
    python backend/benchmark_latency.py                 # 2000 in-process requests
    python backend/benchmark_latency.py -n 5000
    python backend/benchmark_latency.py --url http://localhost:8000
"""
import argparse
import json
import os
import random
import statistics
import sys
import time
from datetime import datetime, timezone

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
REPORT_PATH = os.path.join(BASE_DIR, "latency_report.json")

CARD4 = ["visa", "mastercard", "american express", "discover"]
CARD6 = ["debit", "credit"]
PRODUCT = ["W", "C", "R", "H", "S"]
EMAIL = ["gmail.com", "yahoo.com", "hotmail.com", "anonymous.com", "outlook.com", "aol.com"]
DEVICE_TYPE = ["desktop", "mobile"]
DEVICE_INFO = ["Windows", "iOS Device", "MacOS", "Trident/7.0", "SM-G950U Build/NRD90M"]


def make_txn(i: int, rng: random.Random) -> dict:
    return {
        "txn_id": i,
        "amount": round(rng.lognormvariate(4.0, 1.0), 2),
        "card1": rng.randint(1000, 18396),
        "card4": rng.choice(CARD4),
        "card6": rng.choice(CARD6),
        "addr1": float(rng.randint(100, 540)),
        "ProductCD": rng.choice(PRODUCT),
        "P_emaildomain": rng.choice(EMAIL),
        "DeviceType": rng.choice(DEVICE_TYPE),
        "DeviceInfo": rng.choice(DEVICE_INFO),
    }


def percentile(sorted_vals, p):
    k = (len(sorted_vals) - 1) * p
    f, c = int(k), min(int(k) + 1, len(sorted_vals) - 1)
    return sorted_vals[f] + (sorted_vals[c] - sorted_vals[f]) * (k - f)


def run(n: int, url: str | None, warmup: int, seed: int) -> dict:
    rng = random.Random(seed)
    if url:
        import httpx
        client = httpx.Client(base_url=url, timeout=30)
        mode = "http"
    else:
        from fastapi.testclient import TestClient
        import backend.main as main
        # Benchmark the service, not the network hop to DynamoDB.
        main.get_card_velocity = lambda card_id: {"txn_count_1h": 0, "txn_count_24h": 0}
        client = TestClient(main.app)
        mode = "in-process"

    for i in range(warmup):
        client.post("/api/decision", json=make_txn(-i - 1, rng))

    wall, server = [], []
    decisions = {"approve": 0, "decline": 0, "review": 0}
    t_start = time.perf_counter()
    for i in range(n):
        txn = make_txn(i, rng)
        t0 = time.perf_counter()
        r = client.post("/api/decision", json=txn)
        wall.append((time.perf_counter() - t0) * 1000)
        r.raise_for_status()
        body = r.json()
        server.append(body["latency_ms"])
        decisions[body["decision"]] += 1
    elapsed = time.perf_counter() - t_start

    wall.sort(); server.sort()
    report = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "mode": mode,
        "target": url or "TestClient(backend.main.app)",
        "requests": n,
        "warmup": warmup,
        "seed": seed,
        "python": sys.version.split()[0],
        "wall_ms": {
            "p50": round(percentile(wall, 0.50), 2),
            "p95": round(percentile(wall, 0.95), 2),
            "p99": round(percentile(wall, 0.99), 2),
            "mean": round(statistics.fmean(wall), 2),
            "max": round(wall[-1], 2),
        },
        "server_ms": {  # the endpoint's own perf_counter span (inference + policy)
            "p50": round(percentile(server, 0.50), 2),
            "p95": round(percentile(server, 0.95), 2),
            "p99": round(percentile(server, 0.99), 2),
        },
        "throughput_rps_sequential": round(n / elapsed, 1),
        "decision_mix": decisions,
    }
    return report


def main_cli():
    ap = argparse.ArgumentParser()
    ap.add_argument("-n", type=int, default=2000)
    ap.add_argument("--url", default=None)
    ap.add_argument("--warmup", type=int, default=50)
    ap.add_argument("--seed", type=int, default=42)
    args = ap.parse_args()

    report = run(args.n, args.url, args.warmup, args.seed)
    with open(REPORT_PATH, "w") as f:
        json.dump(report, f, indent=2)

    w, s = report["wall_ms"], report["server_ms"]
    print(f"[{report['mode']}] {report['requests']} requests -> {REPORT_PATH}")
    print(f"  wall   p50 {w['p50']} ms | p95 {w['p95']} ms | p99 {w['p99']} ms | max {w['max']} ms")
    print(f"  server p50 {s['p50']} ms | p95 {s['p95']} ms | p99 {s['p99']} ms")
    print(f"  sequential throughput {report['throughput_rps_sequential']} req/s | mix {report['decision_mix']}")


if __name__ == "__main__":
    main_cli()
