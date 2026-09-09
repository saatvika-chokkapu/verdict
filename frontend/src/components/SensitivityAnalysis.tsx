import { useEffect, useState } from "react";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ReferenceLine, ResponsiveContainer } from "recharts";
import { getSensitivityAnalysis } from "../api/client";
import SkeletonCard, { ErrorCard } from "./Skeleton";

const card: React.CSSProperties = {
  background: "var(--card)", border: "1px solid var(--border)", borderRadius: "var(--radius)",
  padding: "var(--card-pad)", boxShadow: "var(--shadow)", marginBottom: "18px",
  animation: "cardIn .5s ease-out both", animationDelay: "100ms",
};
const labelText: React.CSSProperties = { font: "500 11px 'IBM Plex Mono',monospace", letterSpacing: ".14em", textTransform: "uppercase", color: "var(--muted)" };

function findBreakeven(data: any[]): number | null {
  for (let i = 0; i < data.length - 1; i++) {
    if (data[i].savings_pct >= 0 && data[i + 1].savings_pct < 0) {
      const x0 = data[i].cost_multiplier, x1 = data[i + 1].cost_multiplier;
      const y0 = data[i].savings_pct, y1 = data[i + 1].savings_pct;
      return x0 + (0 - y0) * (x1 - x0) / (y1 - y0);
    }
  }
  return null;
}

export default function SensitivityAnalysis() {
  const [data, setData] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  const load = () => {
    setLoading(true); setFailed(false);
    getSensitivityAnalysis()
      .then((d) => { setData(d); setLoading(false); })
      .catch(() => { setFailed(true); setLoading(false); });
  };
  useEffect(load, []);

  if (failed) return <ErrorCard title="How sensitive is this result to our assumptions?" onRetry={load} />;
  if (loading) return <SkeletonCard title="How sensitive is this result to our assumptions?" subtitle="Stress-testing the savings figure against the documented cost assumptions." tiles={1} delay="100ms" />;

  const breakeven = findBreakeven(data);

  return (
    <section style={card}>
      <h2 style={{ margin: 0, font: "600 19px 'Inter'", letterSpacing: "-.01em" }}>How sensitive is this result to our assumptions?</h2>
      <p style={{ margin: "7px 0 20px", font: "400 13px 'Inter'", color: "var(--muted)", maxWidth: 600 }}>
        The $126K savings figure relies on two documented, not derived, assumptions. Here's how that result holds up if they're wrong.
      </p>

      <ResponsiveContainer width="100%" height={230}>
        <LineChart data={data} margin={{ top: 10, right: 20, left: 0, bottom: 5 }}>
          <CartesianGrid stroke="var(--grid)" strokeDasharray="2 5" vertical={false} />
          <XAxis dataKey="cost_multiplier" tick={{ fontSize: 11, fill: "var(--muted)" }} />
          <YAxis tick={{ fontSize: 11, fill: "var(--muted)" }} tickFormatter={(v) => `${v}%`} />
          <Tooltip contentStyle={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 8 }}
                   formatter={(value: any) => [`${value}%`, "savings vs. naive"]}
                   labelFormatter={(label) => `${label}x assumption`} />
          <ReferenceLine y={0} stroke="var(--muted)" strokeDasharray="3 3" />
          {breakeven && (
            <ReferenceLine x={breakeven} stroke="var(--violet)" strokeDasharray="4 4"
              label={{ value: `breakeven ~${breakeven.toFixed(2)}x`, position: "top", fontSize: 11, fill: "var(--violet)" }} />
          )}
          <Line type="monotone" dataKey="savings_pct" stroke="var(--violet)" strokeWidth={2.5} dot={{ r: 4, fill: "var(--violet)" }} animationDuration={900} />
        </LineChart>
      </ResponsiveContainer>
      <p style={{ textAlign: "center", margin: "4px 0 0", font: "400 11px 'IBM Plex Mono',monospace", color: "var(--muted)" }}>
        cost assumption multiplier (1.0x = documented estimate)
      </p>

      <div className="tile-hover" style={{ marginTop: 16, padding: "12px 16px", background: "var(--tile)", borderRadius: "var(--radius)", border: "1px solid var(--border)" }}>
        <span style={labelText}>Honest read</span>
        <p style={{ margin: "8px 0 0", font: "400 13px 'Inter'", color: "var(--text)" }}>
          Verdict beats the naive baseline as long as the real cost of losing a customer isn't more than
          about <strong style={{ color: "var(--violet)" }}>{breakeven ? `${breakeven.toFixed(2)}x` : "—"}</strong> our documented estimate. Past that point, the naive approach would actually perform better.
        </p>
      </div>
    </section>
  );
}
