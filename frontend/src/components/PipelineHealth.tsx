import { useEffect, useState } from "react";
import { getPipelineHealth } from "../api/client";
import SkeletonCard, { ErrorCard } from "./Skeleton";

const card: React.CSSProperties = {
  background: "var(--card)", border: "1px solid var(--border)", borderRadius: 18,
  padding: "var(--card-pad)", boxShadow: "var(--shadow)", animation: "cardIn .5s ease-out both", animationDelay: "300ms",
};
const tile: React.CSSProperties = {
  background: "var(--tile)", border: "1px solid var(--border)", borderRadius: "var(--radius)",
  padding: "var(--tile-pad)",
};
const labelText: React.CSSProperties = {
  font: "500 13px var(--body)", letterSpacing: "0",
  color: "var(--muted)", marginBottom: 13,
};

function StatusPill({ value }: { value: string }) {
  const label = value.charAt(0).toUpperCase() + value.slice(1).toLowerCase();
  const v = value.toLowerCase();
  const color =
    v.includes("degrad") || v.includes("error") || v.includes("down") || v.includes("unstable") ? "var(--red)" :
    v.includes("warn") || v.includes("review") ? "var(--amber)" :
    "var(--teal)";
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 7,
      background: `color-mix(in oklab,${color} 15%,transparent)`, color,
      padding: "6px 12px", borderRadius: 999, font: "600 13px var(--body)",
    }}>
      <span style={{ width: 6, height: 6, borderRadius: "50%", background: color }} />
      {label}
    </span>
  );
}

export default function PipelineHealth() {
  const [health, setHealth] = useState<any>(null);
  const [failed, setFailed] = useState(false);

  const load = () => {
    setFailed(false);
    getPipelineHealth().then(setHealth).catch(() => setFailed(true));
  };
  useEffect(load, []);

  if (failed) return <ErrorCard title="System status" onRetry={load} />;
  if (!health) return <SkeletonCard title="System status" tiles={3} delay="300ms" />;

  return (
    <section style={card}>
      <h2 style={{ margin: "0 0 22px", font: "600 19px var(--body)", letterSpacing: "-.01em" }}>System status</h2>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(240px,1fr))", gap: "var(--gap)" }}>
        <div className="tile-hover" style={tile}>
          <div style={labelText}>API</div>
          <StatusPill value="online" />
        </div>
        <div className="tile-hover" style={tile} title={health.research_data}>
          <div style={labelText}>Research data</div>
          <StatusPill value={health.data_source === "snowflake" ? "live warehouse" : "snapshot"} />
        </div>
        <div className="tile-hover" style={tile}>
          <div style={labelText}>Drift check</div>
          <StatusPill value={health.last_drift_check === "NOT YET CHECKED" ? "scheduled in Airflow" : health.last_drift_check} />
        </div>
        <div className="tile-hover" style={tile}>
          <div style={labelText}>Model version</div>
          <div style={{ font: "500 20px var(--body)", color: "var(--text)" }}>{String(health.model_version).startsWith("unknown") ? "LightGBM v1" : health.model_version}</div>
        </div>
        <div className="tile-hover" style={tile} title={health.latency_measured_at ? `Measured ${health.latency_mode}, n=${health.latency_sample_size}, ${health.latency_measured_at}` : "Run backend/benchmark_latency.py"}>
          <div style={labelText}>Latency p50</div>
          <div style={{ font: "500 20px var(--body)", color: "var(--text)" }}>
            {health.api_latency_ms_p50 ?? "—"}<span style={{ fontSize: 13, color: "var(--muted)", marginLeft: 1 }}>ms</span>
          </div>
        </div>
        <div className="tile-hover" style={tile} title={health.latency_measured_at ? `Measured ${health.latency_mode}, n=${health.latency_sample_size}` : "Run backend/benchmark_latency.py"}>
          <div style={labelText}>Latency p95</div>
          <div style={{ font: "500 20px var(--body)", color: "var(--text)" }}>
            {health.api_latency_ms_p95 ?? "—"}<span style={{ fontSize: 13, color: "var(--muted)", marginLeft: 1 }}>ms</span>
          </div>
        </div>
      </div>
    </section>
  );
}
