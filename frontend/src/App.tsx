import { useState } from "react";
import SideNotes from "./components/SideNotes";
import ProblemStatement from "./components/ProblemStatement";
import CostAnalysis from "./components/CostAnalysis";
import SensitivityAnalysis from "./components/SensitivityAnalysis";
import ThresholdSimulator from "./components/ThresholdSimulator";
import PipelineHealth from "./components/PipelineHealth";

function App() {
  const [theme, setTheme] = useState<"light" | "dark">("dark");

  return (
    <div data-theme={theme} style={{
      minHeight: "100vh", position: "relative",
      background: "var(--page)",
      color: "var(--text)",
      fontFamily: "'Inter', sans-serif",
      transition: "background .3s, color .3s",
    }}>
      <SideNotes />
      <div style={{ maxWidth: "1060px", margin: "0 auto", padding: "38px 28px 60px" }}>

        <header style={{
          display: "flex", justifyContent: "space-between", alignItems: "flex-end",
          flexWrap: "wrap", gap: "20px", marginBottom: "28px", paddingBottom: "24px",
          borderBottom: "1px solid var(--border)",
        }}>
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
              <span style={{ position: "relative", width: 26, height: 26, display: "inline-flex", alignItems: "flex-end", gap: 3, flex: "none" }}>
                <span style={{ width: 5, height: 10, borderRadius: 1.5, background: "var(--teal)", animation: "signalBar 1.8s ease-in-out infinite" }} />
                <span style={{ width: 5, height: 18, borderRadius: 1.5, background: "var(--blue)", animation: "signalBar 1.8s ease-in-out infinite .2s" }} />
                <span style={{ width: 5, height: 26, borderRadius: 1.5, background: "var(--amber)", animation: "signalBar 1.8s ease-in-out infinite .4s" }} />
              </span>
              <h1 style={{ margin: 0, font: "700 26px 'Inter'", letterSpacing: "-.02em", color: "var(--text)" }}>Verdict</h1>
            </div>
            <p style={{ margin: "10px 0 0", font: "400 14px 'Inter'", color: "var(--muted)" }}>
              Real-time payment risk and cost-optimized decisioning
            </p>
          </div>

          <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: "12px" }}>
            <div className="seg">
              <button className={theme === "light" ? "seg-active" : ""} onClick={() => setTheme("light")}>Light</button>
              <button className={theme === "dark" ? "seg-active" : ""} onClick={() => setTheme("dark")}>Dark</button>
            </div>
            <span style={{
              display: "inline-flex", alignItems: "center", gap: "7px",
              font: "500 11px 'IBM Plex Mono',monospace", letterSpacing: ".08em", textTransform: "uppercase",
              color: "var(--teal)", border: "1px solid color-mix(in oklab,var(--teal) 35%,var(--border))",
              borderRadius: "999px", padding: "6px 11px",
            }}>
              <span style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--teal)", animation: "pulseDot 2.2s ease-out infinite" }} />
              Live · Snowflake
            </span>
          </div>
        </header>

        <ProblemStatement />
        <CostAnalysis />
        <SensitivityAnalysis />
        <ThresholdSimulator />
        <PipelineHealth />

        <p style={{ margin: "22px 2px 0", font: "400 11px 'IBM Plex Mono',monospace", color: "var(--muted)" }}>
          Live values streamed from a Snowflake warehouse via the Verdict API.
        </p>
      </div>
    </div>
  );
}

export default App;
