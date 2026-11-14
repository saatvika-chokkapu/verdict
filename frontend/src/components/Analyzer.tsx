import { useEffect, useRef, useState } from "react";
import { analyzeOrders, API_URL } from "../api/client";
import AnalysisResults from "./AnalysisResults";

type Props = { sampleRequest: number };

function NumberField(props: {
  label: string; help: string; prefix?: string; suffix?: string;
  value: string; onChange: (v: string) => void; placeholder?: string;
}) {
  return (
    <div className="field">
      <label>{props.label}</label>
      <div className="input-wrap">
        {props.prefix && <span>{props.prefix}</span>}
        <input inputMode="decimal" value={props.value} placeholder={props.placeholder}
               onChange={(e) => props.onChange(e.target.value)} />
        {props.suffix && <span>{props.suffix}</span>}
      </div>
      <small>{props.help}</small>
    </div>
  );
}

export default function Analyzer({ sampleRequest }: Props) {
  const [file, setFile] = useState<File | null>(null);
  const [useSample, setUseSample] = useState(false);
  const [customerValue, setCustomerValue] = useState("300");
  const [churn, setChurn] = useState("39");
  const [fee, setFee] = useState("15");
  const [currentCutoff, setCurrentCutoff] = useState("");
  const [dragOver, setDragOver] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<any>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const resultsRef = useRef<HTMLDivElement>(null);

  const run = async (opts?: { sample?: boolean }) => {
    const sample = opts?.sample ?? useSample;
    if (!sample && !file) { setError("Choose a CSV file first, or try the sample store."); return; }
    const cv = parseFloat(customerValue), cr = parseFloat(churn), cf = parseFloat(fee);
    if ([cv, cr, cf].some((n) => Number.isNaN(n) || n < 0) || cr > 100) {
      setError("Check your numbers: values must be positive and the percentage between 0 and 100.");
      return;
    }
    setLoading(true); setError(null);
    try {
      const data = await analyzeOrders({
        file: sample ? null : file, useSample: sample,
        customerValue: cv, churnRate: cr / 100, chargebackFee: cf,
        currentThreshold: currentCutoff.trim() ? parseFloat(currentCutoff) : null,
      });
      setResult(data);
      setTimeout(() => resultsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 80);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  // The hero's "Try with a sample store" button increments sampleRequest.
  useEffect(() => {
    if (sampleRequest > 0) { setUseSample(true); setFile(null); run({ sample: true }); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sampleRequest]);

  const pickFile = (f: File | undefined | null) => {
    if (!f) return;
    if (!f.name.toLowerCase().endsWith(".csv")) { setError("Please upload a .csv file."); return; }
    setFile(f); setUseSample(false); setError(null);
  };

  return (
    <>
      <section className="panel" id="analyze">
        <span className="eyebrow">Analyze your store</span>
        <h2 style={{ marginTop: 8 }}>Find the cheapest fraud cutoff for your margins</h2>
        <p className="sub">
          Export your recent orders with the risk score your fraud tool gave each one. Verdict prices every
          possible cutoff in dollars, counting both fraud you let through and good customers you turn away.
        </p>

        <div className="tool-grid">
          <div>
            <div
              className={`dropzone${dragOver ? " over" : ""}`}
              onClick={() => fileInput.current?.click()}
              onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={(e) => { e.preventDefault(); setDragOver(false); pickFile(e.dataTransfer.files?.[0]); }}
            >
              <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" style={{ color: "var(--teal)" }}>
                <path d="M12 16V4m0 0l-4 4m4-4l4 4M4 16v3a1 1 0 001 1h14a1 1 0 001-1v-3" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              <b>Drop your orders CSV here</b>
              <span>or click to choose a file · up to 25 MB</span>
              {file && <span className="file-chip">✓ {file.name}</span>}
              {useSample && !file && <span className="file-chip">✓ Sample store · 25,000 orders</span>}
              <input ref={fileInput} type="file" accept=".csv,text/csv" hidden
                     onChange={(e) => pickFile(e.target.files?.[0])} />
            </div>

            <div style={{ display: "flex", gap: 16, flexWrap: "wrap", marginTop: 14, alignItems: "center" }}>
              <button className="btn-link" onClick={() => { setUseSample(true); setFile(null); setError(null); }}>
                Use the sample store instead
              </button>
              <a className="btn-link" href={`${API_URL}/api/template.csv`}>Download the CSV template</a>
            </div>

            <div className="alert alert-note" style={{ marginTop: 16 }}>
              <b style={{ color: "var(--text)" }}>Columns we look for.</b> Required: order <code>amount</code> and
              {" "}<code>risk_score</code> (0–1 or 0–100). Optional but recommended: <code>declined</code> (what your
              current rule did), <code>chargeback</code> (whether an approved order later turned out to be fraud),
              and a date column. Common names like "Order Total" or "Risk Score" are recognized.
            </div>
          </div>

          <div>
            <NumberField label="What a customer is worth to you" prefix="$" value={customerValue} onChange={setCustomerValue}
              help="Average profit from a customer over their whole relationship with you, not just one order." />
            <NumberField label="Good customers who leave after a decline" suffix="%" value={churn} onChange={setChurn}
              help="Share of wrongly declined customers who never come back. 39% is a commonly cited industry figure." />
            <NumberField label="Fee per chargeback" prefix="$" value={fee} onChange={setFee}
              help="What your payment processor charges per dispute, on top of the refunded amount." />
            <NumberField label="Your current cutoff (optional)" value={currentCutoff} onChange={setCurrentCutoff}
              placeholder="e.g. 75"
              help="Only used if your file has no 'declined' column, so we can compare against what you do today." />

            <button className="btn btn-primary" style={{ width: "100%", justifyContent: "center" }}
                    disabled={loading} onClick={() => run()}>
              {loading ? <><span className="spinner" /> Analyzing…</> : "Analyze my orders"}
            </button>
            <p className="fine" style={{ marginTop: 10 }}>
              Your file is analyzed in memory and is not stored. The first run can take up to a minute while the server wakes up.
            </p>
          </div>
        </div>

        {error && <div className="alert alert-error">{error}</div>}
      </section>

      <div ref={resultsRef} style={{ scrollMarginTop: 80 }}>
        {result && <AnalysisResults result={result} />}
      </div>
    </>
  );
}
