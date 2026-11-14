import { useState } from "react";
import { analyzeOrders, NeedsMapping } from "./api/client";
import Analyzer, { MappingModal, type Numbers } from "./components/Analyzer";
import { VerdictBlock, ChartBlock, DetailBlock } from "./components/AnalysisResults";
import Modal from "./components/Modal";
import CostAnalysis from "./components/CostAnalysis";
import SensitivityAnalysis from "./components/SensitivityAnalysis";
import ThresholdSimulator from "./components/ThresholdSimulator";

// Links shown in the About strip at the bottom. Leave one empty to hide it.
const LINKS = {
  github: "https://github.com/saatvika-chokkapu/verdict",
  portfolio: "https://saatvikachokkapu.com/",
  linkedin: "https://www.linkedin.com/in/saatvikachokkapu/",
};

const PIPELINE: [string, string][] = [
  ["Lakehouse", "590K card transactions in Iceberg on S3"],
  ["Kafka", "Per-card velocity features"],
  ["LightGBM", "Fraud probability per order"],
  ["FastAPI", "Approve or decline by dollar cost"],
  ["dbt", "Tested warehouse models"],
  ["This page", "React, with the analyzer API"],
];

type ResearchTab = "cost" | "sensitivity" | "simulator" | "built";

function App() {
  const [theme, setTheme] = useState<"dark" | "light">("dark");
  const [file, setFile] = useState<File | null>(null);
  const [useSample, setUseSample] = useState(false);
  const [numbers, setNumbers] = useState<Numbers>({ customerValue: "300", churn: "39", fee: "15", currentCutoff: "" });
  const [mapping, setMapping] = useState<Record<string, string> | null>(null);
  const [needsMapping, setNeedsMapping] = useState<NeedsMapping | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<any>(null);
  const [runId, setRunId] = useState(0);
  const [research, setResearch] = useState(false);
  const [tab, setTab] = useState<ResearchTab>("cost");

  const run = async (o: { n?: Numbers; sample?: boolean; f?: File | null; map?: Record<string, string> | null } = {}) => {
    const n = o.n ?? numbers, sample = o.sample ?? useSample, f = o.f !== undefined ? o.f : file;
    const map = o.map !== undefined ? o.map : mapping;
    if (!sample && !f) { setError("Choose a CSV file first, or use the sample store."); return; }
    const cv = parseFloat(n.customerValue), cr = parseFloat(n.churn), cf = parseFloat(n.fee);
    if ([cv, cr, cf].some((x) => Number.isNaN(x) || x < 0) || cr > 100) {
      setError("Check your numbers. Amounts must be positive and the percentage between 0 and 100.");
      return;
    }
    setLoading(true); setError(null);
    try {
      const data = await analyzeOrders({
        file: sample ? null : f, useSample: sample, mapping: sample ? null : map,
        customerValue: cv, churnRate: cr / 100, chargebackFee: cf,
        currentThreshold: n.currentCutoff.trim() ? parseFloat(n.currentCutoff) : null,
      });
      setResult(data);
      setRunId((i) => i + 1);
      window.scrollTo({ top: 0 });
    } catch (e: any) {
      if (e instanceof NeedsMapping) setNeedsMapping(e);
      else setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  const goHome = () => {
    setResult(null); setFile(null); setUseSample(false); setMapping(null); setError(null);
    window.scrollTo({ top: 0 });
  };

  const upload = (compact: boolean) => (
    <Analyzer
      compact={compact}
      file={file} useSample={useSample} numbers={numbers} loading={loading} error={error}
      onFile={(f) => { setFile(f); setUseSample(false); setMapping(null); setError(null); }}
      onSample={() => { setUseSample(true); setFile(null); setError(null); run({ sample: true, f: null }); }}
      onNumbers={(n) => { setNumbers(n); if (result) run({ n }); }}
      onAnalyze={() => run()}
      onError={setError}
    />
  );

  return (
    <div className="app" data-theme={theme}>
      <div className="frame">
        <header className="top row">
          <button className="brand" onClick={goHome} aria-label="Verdict, back to start">
            <span className="brand-mark">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round"><path d="M5 13l4 4L19 7" /></svg>
            </span>
            Verdict
          </button>
          <div className="top-actions">
            <button className="top-link" onClick={() => setResearch(true)}>The research</button>
            <button className="top-link" onClick={() => setTheme(theme === "dark" ? "light" : "dark")}>
              {theme === "dark" ? "Light mode" : "Dark mode"}
            </button>
          </div>
        </header>

        {!result ? (
          <>
            <div className="home row">
              <div>
                <h1 className="display">Your fraud filter may be costing you more than fraud.</h1>
                <p className="lead">
                  Every declined order is either fraud you stopped or a good customer you turned away.
                  Verdict reads your own orders and finds the risk-score cutoff that costs you the least.
                </p>
              </div>
              <div>{upload(false)}</div>
            </div>
            <div className="steps row">
              <div><span className="mono">step 1</span><b>Export your orders</b><span>A CSV with each order's amount and the risk score from your fraud tool, such as Stripe Radar or Signifyd.</span></div>
              <div><span className="mono">step 2</span><b>Check your numbers</b><span>What a customer is worth to you, and how many leave after a wrong decline.</span></div>
              <div><span className="mono">step 3</span><b>Get your cutoff</b><span>The cheapest cutoff, what it saves each month, and how well it holds up.</span></div>
            </div>
          </>
        ) : (
          <div className="quad" key={runId}>
            <section>
              <h2 className="block-title">Your orders</h2>
              {upload(true)}
            </section>
            <VerdictBlock result={result} />
            <ChartBlock result={result} />
            <DetailBlock result={result} />
          </div>
        )}

        <footer className="about">
          <span>Built by Saatvika Chokkapu, data and AI engineer.</span>
          <nav aria-label="About">
            {LINKS.github && <a href={LINKS.github} target="_blank" rel="noreferrer">GitHub</a>}
            {LINKS.portfolio && <a href={LINKS.portfolio} target="_blank" rel="noreferrer">Portfolio</a>}
            {LINKS.linkedin && <a href={LINKS.linkedin} target="_blank" rel="noreferrer">LinkedIn</a>}
          </nav>
        </footer>
      </div>

      {needsMapping && (
        <MappingModal info={needsMapping} onClose={() => setNeedsMapping(null)}
                      onConfirm={(m) => { setMapping(m); run({ map: m }); }} />
      )}

      {research && (
        <Modal title="Tested on 590,000 real card transactions" onClose={() => setResearch(false)} wide>
          <p className="note" style={{ marginBottom: 16 }}>
            Before building this tool, I trained a fraud model on the public IEEE-CIS dataset and compared two ways of deciding:
            a fixed 50% fraud-probability cutoff, and choosing whichever option costs less in dollars.
          </p>
          <div className="findings">
            <div><b style={{ color: "var(--teal)" }}>$126K saved</b><span>Deciding by dollar cost was 4.8% cheaper over six months.</span></div>
            <div><b>Fewer catches, bigger ones</b><span>Less fraud caught by count, but worth nearly twice as much per order.</span></div>
            <div><b>Holds up to 1.55×</b><span>It stays ahead unless a lost customer really costs over 1.55 times the estimate.</span></div>
          </div>
          <div className="tabs" role="tablist">
            {([["cost", "Cost over time"], ["sensitivity", "If the assumptions are wrong"], ["simulator", "Try a cutoff"], ["built", "How it's built"]] as const).map(([k, l]) => (
              <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? "on" : ""} onClick={() => setTab(k)}>{l}</button>
            ))}
          </div>
          {tab === "cost" && <CostAnalysis />}
          {tab === "sensitivity" && <SensitivityAnalysis />}
          {tab === "simulator" && <ThresholdSimulator />}
          {tab === "built" && (
            <>
              <div className="pipe">
                {PIPELINE.map(([name, what]) => <div className="node" key={name}><b>{name}</b><span>{what}</span></div>)}
              </div>
              <p className="note" style={{ marginTop: 16 }}>
                Infrastructure is defined in Terraform, drift checks run in Airflow, and tests run in GitHub Actions on every push.
              </p>
            </>
          )}
        </Modal>
      )}
    </div>
  );
}

export default App;
