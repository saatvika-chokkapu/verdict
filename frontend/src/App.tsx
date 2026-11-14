import { useCallback, useEffect, useState } from "react";
import { analyzeOrders } from "./api/client";
import Analyzer, { NumbersModal, type Numbers } from "./components/Analyzer";
import AnalysisResults from "./components/AnalysisResults";
import Modal from "./components/Modal";
import CostAnalysis from "./components/CostAnalysis";
import SensitivityAnalysis from "./components/SensitivityAnalysis";
import ThresholdSimulator from "./components/ThresholdSimulator";
import PipelineHealth from "./components/PipelineHealth";

type View = "analyze" | "result" | "research" | "built";
const VIEWS: View[] = ["analyze", "result", "research", "built"];

const STAGES: { name: string; short: string; detail: string }[] = [
  { name: "Ingestion", short: "Raw transactions into a lakehouse",
    detail: "590,000 card transactions from the IEEE-CIS dataset are loaded into an Iceberg table on S3, cataloged with AWS Glue. The storage, catalog and DynamoDB table are provisioned with Terraform." },
  { name: "Streaming", short: "Per-card velocity with Kafka",
    detail: "A Kafka producer replays transactions and consumers compute how many times each card was used in the last hour and day, writing those velocity features to DynamoDB for the decision API to read." },
  { name: "Model", short: "LightGBM fraud classifier",
    detail: "A LightGBM model (AUC 0.87) predicts the chance each transaction is fraud. An Airflow job checks for drift with the population stability index so a shifting data distribution gets noticed." },
  { name: "Decisioning", short: "Approve or decline, priced in dollars",
    detail: "A FastAPI service compares the expected cost of approving (fraud loss) with the expected cost of declining (a good customer lost) and picks the cheaper one. Unusually fast card activity sends an order to review." },
  { name: "Warehouse", short: "dbt models and tests",
    detail: "dbt builds staging, intermediate and mart models with data tests. It was built on Snowflake, and this site serves a snapshot of those marts so it stays up without a running warehouse." },
  { name: "Merchant analyzer", short: "Your orders in, a cutoff out",
    detail: "The upload endpoint accepts messy CSVs, recognizes common column names, and learns how a store's risk scores relate to real chargebacks before pricing every cutoff. Declined orders have no fraud outcome, so their risk is estimated from that learned relationship." },
  { name: "Quality", short: "Tests and CI",
    detail: "A pytest suite covers the cost model, the API contract, drift checks and the analyzer. GitHub Actions runs it on every push along with an in-process latency benchmark." },
  { name: "Frontend", short: "React on Vercel, API on Render",
    detail: "This site is React and TypeScript with Recharts, deployed on Vercel. The API runs on Render." },
];

const icons: Record<View, React.ReactNode> = {
  analyze: <path d="M12 16V4m0 0l-4 4m4-4l4 4M4 16v3a1 1 0 001 1h14a1 1 0 001-1v-3" />,
  result: <path d="M5 13l4 4L19 7" />,
  research: <path d="M4 19V5m0 14h16M8 15l3-4 3 2 4-6" />,
  built: <path d="M4 7h6v4H4zM14 13h6v4h-6zM10 9h2a2 2 0 012 2v4" />,
};
const labels: Record<View, string> = { analyze: "Analyze", result: "Your result", research: "The research", built: "How it's built" };

function viewFromHash(): View {
  const h = window.location.hash.replace("#", "") as View;
  return VIEWS.includes(h) ? h : "analyze";
}

function App() {
  const [theme, setTheme] = useState<"light" | "dark">("light");
  const [view, setViewState] = useState<View>(viewFromHash);
  const [file, setFile] = useState<File | null>(null);
  const [useSample, setUseSample] = useState(false);
  const [numbers, setNumbers] = useState<Numbers>({ customerValue: "300", churn: "39", fee: "15", currentCutoff: "" });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<any>(null);
  const [tab, setTab] = useState<"cost" | "sensitivity" | "simulator">("cost");
  const [stage, setStage] = useState<number | null>(null);
  const [editNumbers, setEditNumbers] = useState(false);

  const setView = useCallback((v: View) => {
    setViewState(v);
    window.history.replaceState(null, "", `#${v}`);
    window.scrollTo(0, 0);
  }, []);

  useEffect(() => {
    const onHash = () => setViewState(viewFromHash());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  const run = async (n: Numbers = numbers, sample = useSample, f = file) => {
    if (!sample && !f) { setError("Choose a CSV file first, or use the sample store."); return; }
    const cv = parseFloat(n.customerValue), cr = parseFloat(n.churn), cf = parseFloat(n.fee);
    if ([cv, cr, cf].some((x) => Number.isNaN(x) || x < 0) || cr > 100) {
      setError("Check your numbers. Amounts must be positive and the percentage between 0 and 100.");
      return;
    }
    setLoading(true); setError(null);
    try {
      const data = await analyzeOrders({
        file: sample ? null : f, useSample: sample,
        customerValue: cv, churnRate: cr / 100, chargebackFee: cf,
        currentThreshold: n.currentCutoff.trim() ? parseFloat(n.currentCutoff) : null,
      });
      setResult(data);
      setView("result");
    } catch (e: any) {
      setError(e.message);
      setView("analyze");
    } finally {
      setLoading(false);
    }
  };

  const showResult = view === "result" && result;

  return (
    <div className="app" data-theme={theme}>
      <aside className="side">
        <div className="brand">
          <span className="brand-mark">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 13l4 4L19 7" /></svg>
          </span>
          <span className="word">Verdict</span>
        </div>
        {VIEWS.map((v) => (
          <button key={v} className={`side-link${view === v ? " active" : ""}`} disabled={v === "result" && !result}
                  aria-current={view === v ? "page" : undefined} onClick={() => setView(v)}
                  title={v === "result" && !result ? "Analyze a file first" : undefined}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">{icons[v]}</svg>
            {labels[v]}
          </button>
        ))}
        <div className="side-foot">
          <div className="theme-toggle" role="group" aria-label="Color theme">
            <button className={theme === "light" ? "on" : ""} onClick={() => setTheme("light")}>Light</button>
            <button className={theme === "dark" ? "on" : ""} onClick={() => setTheme("dark")}>Dark</button>
          </div>
          <span style={{ font: "400 12.5px var(--body)" }}>
            Built by Saatvika Chokkapu<br />
            <a href="https://github.com/saatvika-chokkapu/verdict">Source on GitHub</a>
          </span>
        </div>
      </aside>

      <main className="main">
        {(view === "analyze" || (view === "result" && !result)) && (
          <Analyzer
            file={file} useSample={useSample} numbers={numbers} loading={loading} error={error}
            onFile={(f) => { setFile(f); setUseSample(false); setError(null); }}
            onSample={() => { setUseSample(true); setFile(null); setError(null); run(numbers, true, null); }}
            onNumbers={setNumbers}
            onAnalyze={() => run()}
            onError={setError}
          />
        )}

        {showResult && (
          <AnalysisResults
            result={result}
            onChangeNumbers={() => setEditNumbers(true)}
            onStartOver={() => { setFile(null); setUseSample(false); setView("analyze"); }}
          />
        )}

        {view === "research" && (
          <div className="view">
            <h2 className="title">Tested on 590,000 real card transactions</h2>
            <p className="note">
              Before building the merchant tool, I trained a fraud model on the public IEEE-CIS dataset and compared two ways
              of deciding: a fixed 50% fraud-probability cutoff, and choosing whichever option costs less in dollars.
            </p>
            <section className="panel" style={{ marginTop: 22 }}>
              <div className="findings">
                <div><b style={{ color: "var(--teal)" }}>$126K saved</b><span>Deciding by dollar cost was 4.8% cheaper over six months of transactions.</span></div>
                <div><b>Fewer catches, bigger ones</b><span>It caught less fraud by count, but the fraud it caught was worth nearly twice as much per order.</span></div>
                <div><b>Holds up to 1.55×</b><span>It stays ahead unless losing a customer really costs over 1.55 times the estimate used.</span></div>
              </div>
            </section>
            <div className="tabs" role="tablist">
              {([["cost", "Cost over time"], ["sensitivity", "If the assumptions are wrong"], ["simulator", "Try a cutoff"]] as const).map(([k, l]) => (
                <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? "on" : ""} onClick={() => setTab(k)}>{l}</button>
              ))}
            </div>
            {tab === "cost" && <CostAnalysis />}
            {tab === "sensitivity" && <SensitivityAnalysis />}
            {tab === "simulator" && <ThresholdSimulator />}
            <p className="fine">Charts use a saved snapshot of the pipeline's output tables.</p>
          </div>
        )}

        {view === "built" && (
          <div className="view">
            <h2 className="title">How it's built</h2>
            <p className="note">Data moves through eight stages, from raw transactions to this page. Select a stage to see what it does.</p>
            <div className="flow" style={{ margin: "22px 0 16px" }}>
              {STAGES.map((s, i) => (
                <button key={s.name} onClick={() => setStage(i)}>
                  <i>{i + 1}</i><b>{s.name}</b><span>{s.short}</span>
                </button>
              ))}
            </div>
            <PipelineHealth />
          </div>
        )}
      </main>

      {stage !== null && (
        <Modal title={`${stage + 1}. ${STAGES[stage].name}`} onClose={() => setStage(null)}>
          <p className="note" style={{ fontSize: 15.5 }}>{STAGES[stage].detail}</p>
          <div className="btn-row" style={{ marginTop: 20 }}>
            {stage > 0 && <button className="btn" onClick={() => setStage(stage - 1)}>Previous stage</button>}
            {stage < STAGES.length - 1 && <button className="btn btn-primary" onClick={() => setStage(stage + 1)}>Next stage</button>}
          </div>
        </Modal>
      )}

      {editNumbers && (
        <NumbersModal numbers={numbers} saveLabel="Update my result" onClose={() => setEditNumbers(false)}
                      onSave={(n) => { setNumbers(n); run(n); }} />
      )}
    </div>
  );
}

export default App;
