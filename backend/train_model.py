import os
import pandas as pd
import lightgbm as lgb
from sklearn.model_selection import train_test_split
from sklearn.metrics import roc_auc_score
from pyiceberg.catalog import load_catalog
from dotenv import load_dotenv

load_dotenv()

BUCKET_NAME = "riskflow-lakehouse-7d75d72b"

# Unity Catalog three-level model name: catalog.schema.model
UC_REGISTERED_MODEL_NAME = "verdict_catalog.fraud_detection.lightgbm_fraud_model"
DATABRICKS_EXPERIMENT_PATH = "/Shared/verdict-fraud-detection"

# Pull data back from the lakehouse — proving Phase 1's table is genuinely usable
catalog = load_catalog("riskflow", **{"type": "glue", "warehouse": f"s3://{BUCKET_NAME}/"})
table = catalog.load_table("riskflow_lakehouse.raw_transactions")
df = table.scan().to_pandas()

print("Loaded from lakehouse:", df.shape)

# Encode categorical columns as integer codes — LightGBM needs numeric input
categorical_cols = ["ProductCD", "card4", "card6", "P_emaildomain", "DeviceType", "DeviceInfo"]
for col in categorical_cols:
    df[col] = df[col].astype("category").cat.codes

feature_cols = ["amount", "card1", "addr1"] + categorical_cols
X = df[feature_cols]
y = df["is_fraud_label"]

# Stratified split — preserves the same ~3.5% fraud rate in both train and test sets
X_train, X_test, y_train, y_test = train_test_split(
    X, y, test_size=0.2, stratify=y, random_state=42
)

print(f"Train size: {len(X_train)} | Test size: {len(X_test)}")
print(f"Train fraud rate: {y_train.mean():.4%} | Test fraud rate: {y_test.mean():.4%}")

model = lgb.LGBMClassifier(n_estimators=200, random_state=42)
model.fit(X_train, y_train)

# AUC, not accuracy — accuracy is meaningless on a 3.5% fraud rate, as Phase 1 proved
probs = model.predict_proba(X_test)[:, 1]
auc = roc_auc_score(y_test, probs)
print(f"\nTest AUC: {auc:.4f}")

# Save the trained model for the next script to use — this local file is still
# what backend/main.py actually loads for serving. The Databricks/Unity Catalog
# logging below is additive: real experiment tracking and model versioning,
# without changing how the live API serves predictions.
import joblib
joblib.dump(model, "backend/fraud_model.pkl")
print("Model saved to backend/fraud_model.pkl")

# Databricks + Unity Catalog Model Registry -- replaces "no experiment tracking
# or versioning at all" with a real registry. Requires DATABRICKS_HOST and
# DATABRICKS_TOKEN in .env (see .env.example); skips gracefully with a clear
# warning if they aren't set, so local training still always works.
if os.environ.get("DATABRICKS_HOST") and os.environ.get("DATABRICKS_TOKEN"):
    import mlflow
    import mlflow.lightgbm

    mlflow.set_tracking_uri("databricks")
    mlflow.set_registry_uri("databricks-uc")
    mlflow.set_experiment(DATABRICKS_EXPERIMENT_PATH)

    with mlflow.start_run():
        mlflow.log_param("model_type", "LightGBM")
        mlflow.log_param("n_estimators", 200)
        mlflow.log_param("train_rows", len(X_train))
        mlflow.log_metric("test_auc", float(auc))
        mlflow.lightgbm.log_model(
            model,
            artifact_path="model",
            registered_model_name=UC_REGISTERED_MODEL_NAME,
            input_example=X_train.head(3),
        )
    print(f"Logged run and registered model to Unity Catalog: {UC_REGISTERED_MODEL_NAME}")
else:
    print(
        "Skipping Databricks/Unity Catalog logging -- DATABRICKS_HOST and "
        "DATABRICKS_TOKEN not set in .env. Training still completed and saved locally."
    )

# Real, if lightweight, version tracking -- replaces the hardcoded "lightgbm_v1"
# string that used to live directly in the API. This is a stopgap until the
# Databricks + Unity Catalog Model Registry migration; it's honest about what it
# is (an incrementing local counter + real training metadata), not a full registry.
import json
from datetime import datetime, timezone

VERSION_PATH = "backend/model_version.json"
try:
    with open(VERSION_PATH) as f:
        prev = json.load(f)
        next_version_num = prev.get("version_num", 0) + 1
except FileNotFoundError:
    next_version_num = 1

version_info = {
    "version_num": next_version_num,
    "version_tag": f"lightgbm_v{next_version_num}",
    "trained_at": datetime.now(timezone.utc).isoformat(),
    "test_auc": round(float(auc), 4),
    "train_rows": len(X_train),
    "test_rows": len(X_test),
}
with open(VERSION_PATH, "w") as f:
    json.dump(version_info, f, indent=2)
print(f"Version info saved to {VERSION_PATH}: {version_info['version_tag']}")