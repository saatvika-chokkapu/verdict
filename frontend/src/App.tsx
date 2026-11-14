import { useState } from "react";
import Analyzer from "./components/Analyzer";
import ProblemStatement from "./components/ProblemStatement";
import CostAnalysis from "./components/CostAnalysis";
import SensitivityAnalysis from "./components/SensitivityAnalysis";
import ThresholdSimulator from "./components/ThresholdSimulator";
import PipelineHealth from "./components/PipelineHealth";

const ARCHITECTURE = [
  ["Ingestion", "590K card transactions landed in an S3 + Glue lakehouse (Iceberg), provisioned with Terraform."],
  ["Streaming", "Kafka producer and consumers compute per-card velocity features into DynamoDB."],
  ["Model", "LightGBM fraud classifier (AUC 0.87) with drift monitoring (PSI) scheduled in Airflow."],
  ["Decisioning", "FastAPI service prices approve vs. decline in dollars for every transaction."],
  ["Warehouse", "dbt staging → intermediate → marts with tests, built on Snowflake."],
  ["Merchant analyzer", "Upload endpoint that validates messy CSVs, calibrates third-party scores and finds the cheapest cutoff."],
  ["Quality", "pytest suite and GitHub Actions CI, including an in-process latency benchmark."],
  ["Frontend", "React + TypeScript + Recharts on Vercel, API on Render."],
];

function Logo() {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 10 }}>
      <span style={{ width: 22, height: 22, display: "inline-flex", alignItems: "flex-end", gap: 3 }}>
        <span style={{ width: 5, height: 9, borderRadius: 1.5, background: "var(--teal)" }} />
        <span style={{ width: 5, height: 15, borderRadius: 1.5, background: "var(--blue)" }} />
        <span style={{ width: 5, height: 22, borderRadius: 1.5, background: "var(--amber)" }} />
      </span>
      <b style={{ font: "700 19px 'Inter'", letterSpacing: "-.02em" }}>Verdict</b>
    </span>
  );
}

function App() {
  const [theme, setTheme] = useState<"light" | "dark">("dark");
  const [sampleRequest, setSampleRequest] = useState(0);

  const trySample = () => {
    document.getElementById("analyze")?.scrollIntoView({ behavior: "smooth" });
    setSampleRequest((n) => n + 1);
  };

  return (
    <div data-theme={theme} style={{
      minHeight: "100vh", background: "var(--page)", color: "var(--text)",
      fontFamily: "'Inter', sans-serif", transition: "background .3s, color .3s",
    }}>
      <nav className="nav">
        <div className="wrap nav-inner">
          <Logo />
          <div className="nav-links">
            <a href="#analyze">Analyze</a>
            <a href="#research">The research</a>
            <a href="#built">How it's built</a>
          </div>
          <div className="seg">
            <button className={theme === "light" ? "seg-active" : ""} onClick={() => setTheme("light")}>Light</button>
            <button className={theme === "dark" ? "seg-active" : ""} onClick={() => setTheme("dark")}>Dark</button>
          </div>
        </div>
      </nav>

      <main className="wrap" style={{ paddingBottom: 60 }}>
        <header className="hero">
          <span className="eyebrow">For online stores that use a fraud filter</span>
          <h1>Your fraud filter may be costing you <em>more than fraud.</em></h1>
          <p className="lead">
            Every declined order is either fraud you stopped or a good customer you turned away. Verdict looks at your
            own orders and finds the risk-score cutoff that costs you the least, in dollars.
          </p>
          <div className="cta-row">
            <button className="btn btn-primary" onClick={trySample}>Try it with a sample store</button>
            <a className="btn" href="#analyze">Upload your orders</a>
          </div>
        </header>

        <div className="steps">
          <div className="step"><i>01</i><b>Export your orders</b><span>A CSV with the order amount and the risk score from your fraud tool (Stripe Radar, Signifyd and others).</span></div>
          <div className="step"><i>02</i><b>Enter your numbers</b><span>What a customer is worth to you and how many leave after a wrong decline.</span></div>
          <div className="step"><i>03</i><b>Get your cutoff</b><span>The cheapest cutoff, what it saves per month, and how sure you can be.</span></div>
        </div>

        <Analyzer sampleRequest={sampleRequest} />

        <div className="section-head" id="research" style={{ scrollMarginTop: 80 }}>
          <span className="eyebrow">The research behind it</span>
          <h2>Tested on 590,000 real card transactions</h2>
          <p>
            Before building the merchant tool, I trained a fraud model on the IEEE-CIS dataset and compared deciding
            by dollar cost against a fixed 0.5 probability cutoff. Results below are from that pipeline
            (precomputed snapshot of the Snowflake marts).
          </p>
        </div>
        <ProblemStatement />
        <CostAnalysis />
        <SensitivityAnalysis />
        <ThresholdSimulator />

        <div className="section-head" id="built" style={{ scrollMarginTop: 80 }}>
          <span className="eyebrow">How it's built</span>
          <h2>The pipeline</h2>
          <p>An end-to-end data platform, from raw transactions to a decision API and this dashboard.</p>
        </div>
        <section className="panel">
          <div className="arch">
            {ARCHITECTURE.map(([t, d]) => <div key={t}><b>{t}</b><span>{d}</span></div>)}
          </div>
        </section>
        <PipelineHealth />

        <p className="fine" style={{ marginTop: 24 }}>
          Built by Saatvika Chokkapu ·{" "}
          <a href="https://github.com/saatvika-chokkapu/verdict" style={{ color: "var(--teal)" }}>Source on GitHub</a>
        </p>
      </main>
    </div>
  );
}

export default App;
