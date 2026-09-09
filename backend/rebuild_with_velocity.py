import os
import pandas as pd
from dotenv import load_dotenv
import snowflake.connector
from snowflake.connector.pandas_tools import write_pandas
from cost_model import decline_cost, decide_transaction, VELOCITY_REVIEW_THRESHOLD

load_dotenv()
NAIVE_THRESHOLD = 0.5

print("Loading cached velocity data...")
df = pd.read_parquet("/tmp/df_with_velocity.parquet")

def realized_cost(is_fraud, decision, amount, segment):
    # Review is not a financial outcome by itself — the transaction still goes
    # through, same as approve, unless it actually was fraud. The cost only
    # differs from approve if the underlying transaction was genuinely fraudulent.
    if is_fraud == 1 and decision in ("approve", "review"):
        return amount
    if is_fraud == 0 and decision == "decline":
        return decline_cost(segment)
    return 0.0

print("Applying three-tier decision logic (approve/decline/review)...")
riskflow_decisions = []
for _, row in df.iterrows():
    decision, _, _ = decide_transaction(row["fraud_probability"], row["amount"], row["segment"])
    if decision == "approve" and row["txn_count_1h"] > VELOCITY_REVIEW_THRESHOLD:
        decision = "review"
    riskflow_decisions.append(decision)
df["riskflow_decision"] = riskflow_decisions

naive_decisions = df["fraud_probability"].apply(lambda p: "decline" if p > NAIVE_THRESHOLD else "approve")
df["naive_decision"] = naive_decisions

df["riskflow_cost"] = [
    realized_cost(label, decision, amt, seg)
    for label, decision, amt, seg in zip(df["is_fraud_label"], df["riskflow_decision"], df["amount"], df["segment"])
]
df["naive_cost"] = [
    realized_cost(label, decision, amt, seg)
    for label, decision, amt, seg in zip(df["is_fraud_label"], naive_decisions, df["amount"], df["segment"])
]

print("\nDecision breakdown:")
print(df["riskflow_decision"].value_counts())

review_df = df[df["riskflow_decision"] == "review"]
print(f"\nOf {len(review_df)} reviewed transactions: {review_df['is_fraud_label'].sum()} were actually fraud "
      f"({100*review_df['is_fraud_label'].mean():.1f}%) — vs. the dataset's overall fraud rate of "
      f"{100*df['is_fraud_label'].mean():.2f}%.")

output_cols = ["txn_id", "txn_date", "card1", "segment", "amount", "is_fraud_label",
               "fraud_probability", "txn_count_1h", "riskflow_decision", "riskflow_cost",
               "naive_decision", "naive_cost"]
result_df = df[output_cols].copy()
result_df.columns = [c.upper() for c in result_df.columns]

conn = snowflake.connector.connect(
    account=os.getenv("SNOWFLAKE_ACCOUNT"), user=os.getenv("SNOWFLAKE_USER"),
    password=os.getenv("SNOWFLAKE_PASSWORD"), role="ACCOUNTADMIN",
    warehouse=os.getenv("SNOWFLAKE_WAREHOUSE"), database=os.getenv("SNOWFLAKE_DATABASE"),
    schema=os.getenv("SNOWFLAKE_SCHEMA"),
)
cursor = conn.cursor()
cursor.execute(f"USE WAREHOUSE {os.getenv('SNOWFLAKE_WAREHOUSE')}")
cursor.execute(f"USE DATABASE {os.getenv('SNOWFLAKE_DATABASE')}")
cursor.execute(f"USE SCHEMA {os.getenv('SNOWFLAKE_SCHEMA')}")

success, num_chunks, num_rows, _ = write_pandas(
    conn, result_df, table_name="DECISION_RESULTS",
    database=os.getenv("SNOWFLAKE_DATABASE"), schema=os.getenv("SNOWFLAKE_SCHEMA"),
    auto_create_table=True, overwrite=True,
)
print(f"\nLoaded to Snowflake: {success} | Rows: {num_rows}")
conn.close()
