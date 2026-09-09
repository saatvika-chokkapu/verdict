import { useEffect, useState } from "react";
import { getThresholdSimulation } from "../api/client";

const card: React.CSSProperties = {
  background: "var(--card)", border: "1px solid var(--border)", borderRadius: "var(--radius)",
  padding: "var(--card-pad)", boxShadow: "var(--shadow)", animation: "cardIn .5s ease-out both", animationDelay: "200ms", marginBottom: "18px",
};
const tile: React.CSSProperties = {
  background: "var(--tile)", border: "1px solid var(--border)", borderRadius: "var(--radius)",
  padding: "var(--tile-pad)",
};
const labelText: React.CSSProperties = {
  font: "500 11px 'IBM Plex Mono',monospace", letterSpacing: ".14em", textTransform: "uppercase", color: "var(--muted)",
};
const dot = (color: string): React.CSSProperties => ({ width: 7, height: 7, borderRadius: 2, background: color });

export default function ThresholdSimulator() {
  const [threshold, setThreshold] = useState(0.5);
  const [result, setResult] = useState<any>(null);

  useEffect(() => {
    let stale = false;
    getThresholdSimulation(threshold)
      .then((r) => { if (!stale) setResult(r); })
      .catch(() => {});
    return () => { stale = true; };
  }, [threshold]);

  const fmt = (n: number) => `$${Math.round(n).toLocaleString()}`;
  const pct = ((threshold - 0.05) / (0.95 - 0.05)) * 100;

  return (
    <section style={card}>
      <h2 style={{ margin: 0, font: "600 19px 'Inter'", letterSpacing: "-.01em" }}>Threshold simulator</h2>
      <p style={{ margin: "7px 0 0", font: "400 13px 'Inter'", color: "var(--muted)", maxWidth: 520 }}>
        Drag to see how the decision threshold trades fraud capture against false declines.
      </p>

      <div style={{ margin: "24px 0 28px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 15 }}>
          <span style={labelText}>Decision threshold</span>
          <span style={{ font: "600 24px 'IBM Plex Mono',monospace", color: "var(--blue)", fontVariantNumeric: "tabular-nums" }}>
            {threshold.toFixed(2)}
          </span>
        </div>
        <input
          type="range" className="rf-range" min="0.05" max="0.95" step="0.05"
          value={threshold}
          onChange={(e) => setThreshold(parseFloat(e.target.value))}
          style={{ width: "100%", background: `linear-gradient(90deg, var(--blue) ${pct}%, var(--border) ${pct}%)` }}
        />
        <div style={{ display: "flex", justifyContent: "space-between", marginTop: 9, font: "400 10px 'IBM Plex Mono',monospace", color: "var(--muted)" }}>
          <span>0.05 · lenient</span>
          <span>scores ≥ threshold are declined</span>
          <span>0.95 · strict</span>
        </div>
      </div>

      {result && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "var(--gap)" }}>
          <div className="tile-hover" style={tile}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14 }}><span style={dot("var(--blue)")} /><span style={labelText}>Fraud caught</span></div>
            <div style={{ font: "500 28px/1 'IBM Plex Mono',monospace", color: "var(--blue)", fontVariantNumeric: "tabular-nums" }}>{result.fraud_caught_count.toLocaleString()}</div>
            <div style={{ marginTop: 8, font: "400 12px 'Inter'", color: "var(--muted)" }}>transactions blocked</div>
          </div>
          <div className="tile-hover" style={tile}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14 }}><span style={dot("var(--amber)")} /><span style={labelText}>False declines</span></div>
            <div style={{ font: "500 28px/1 'IBM Plex Mono',monospace", color: "var(--amber)", fontVariantNumeric: "tabular-nums" }}>{result.false_declines.toLocaleString()}</div>
            <div style={{ marginTop: 8, font: "400 12px 'Inter'", color: "var(--muted)" }}>good customers blocked</div>
          </div>
          <div className="tile-hover" style={tile}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14 }}><span style={dot("var(--teal)")} /><span style={labelText}>Fraud caught value</span></div>
            <div style={{ font: "600 28px/1 'IBM Plex Mono',monospace", color: "var(--teal)", fontVariantNumeric: "tabular-nums" }}>{fmt(result.fraud_caught_value)}</div>
            <div style={{ marginTop: 8, font: "400 12px 'Inter'", color: "var(--muted)" }}>loss prevented</div>
          </div>
          <div className="tile-hover" style={tile}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14 }}><span style={dot("var(--red)")} /><span style={labelText}>Fraud missed value</span></div>
            <div style={{ font: "600 28px/1 'IBM Plex Mono',monospace", color: "var(--red)", fontVariantNumeric: "tabular-nums" }}>{fmt(result.fraud_missed_value)}</div>
            <div style={{ marginTop: 8, font: "400 12px 'Inter'", color: "var(--muted)" }}>loss not prevented</div>
          </div>
        </div>
      )}
    </section>
  );
}
