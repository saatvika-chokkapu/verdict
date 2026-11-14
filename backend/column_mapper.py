"""
Suggest which of a merchant's columns is the amount, risk score, and so on,
when the automatic name matching in analyzer.py can't tell.

Privacy: only the column NAMES are sent to the model. No order rows, amounts,
customer details or any other cell values ever leave the server.

The feature is optional. Without ANTHROPIC_API_KEY (or if the call fails for
any reason) this returns None and the UI falls back to letting the merchant
match the columns by hand.
"""
from __future__ import annotations

import json
import os

ROLES = {
    "amount": "the order total in money",
    "score": "the fraud risk score the merchant's fraud tool gave the order",
    "declined": "whether the merchant's current rule declined or blocked the order",
    "fraud": "whether the order later turned out to be fraud (chargeback or dispute)",
    "date": "when the order was placed",
}
MODEL = os.getenv("COLUMN_MAPPER_MODEL", "claude-haiku-4-5-20251001")


def suggest_mapping(columns: list[str]) -> dict[str, str] | None:
    api_key = os.getenv("ANTHROPIC_API_KEY")
    if not api_key or not columns:
        return None
    try:
        import anthropic

        client = anthropic.Anthropic(api_key=api_key, timeout=12.0, max_retries=1)
        roles = "\n".join(f"- {k}: {v}" for k, v in ROLES.items())
        prompt = (
            "A store owner uploaded a CSV of orders. These are its column names:\n"
            f"{json.dumps(columns[:200])}\n\n"
            "Match columns to these roles:\n"
            f"{roles}\n\n"
            "Reply with only a JSON object mapping role to the exact column name. "
            "Leave out any role that has no reasonable match. Do not guess wildly."
        )
        message = client.messages.create(
            model=MODEL, max_tokens=300,
            messages=[{"role": "user", "content": prompt}],
        )
        text = "".join(block.text for block in message.content if getattr(block, "type", "") == "text")
        start, end = text.find("{"), text.rfind("}")
        if start < 0 or end <= start:
            return None
        parsed = json.loads(text[start:end + 1])
    except Exception:  # noqa: BLE001 — a suggestion is a nicety; never fail the request over it
        return None
    # Trust nothing: keep only known roles pointing at columns that really exist.
    return {role: col for role, col in parsed.items() if role in ROLES and col in columns} or None
