import { useRef, useState } from "react";
import { API_URL } from "../api/client";
import Modal from "./Modal";

export type Numbers = { customerValue: string; churn: string; fee: string; currentCutoff: string };

type Props = {
  file: File | null;
  useSample: boolean;
  numbers: Numbers;
  loading: boolean;
  error: string | null;
  onFile: (f: File | null) => void;
  onSample: () => void;
  onNumbers: (n: Numbers) => void;
  onAnalyze: () => void;
  onError: (msg: string | null) => void;
};

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

export function NumbersModal({ numbers, onSave, onClose, saveLabel }: {
  numbers: Numbers; onSave: (n: Numbers) => void; onClose: () => void; saveLabel: string;
}) {
  const [draft, setDraft] = useState(numbers);
  const set = (k: keyof Numbers) => (v: string) => setDraft({ ...draft, [k]: v });
  return (
    <Modal title="Your numbers" onClose={onClose}>
      <NumberField label="What a customer is worth to you" prefix="$" value={draft.customerValue} onChange={set("customerValue")}
        help="Average profit from a customer over their whole relationship with you, not just one order." />
      <NumberField label="Good customers who leave after a decline" suffix="%" value={draft.churn} onChange={set("churn")}
        help="Share of wrongly declined customers who never come back. 39% is a commonly cited industry figure." />
      <NumberField label="Fee per chargeback" prefix="$" value={draft.fee} onChange={set("fee")}
        help="What your payment processor charges per dispute, on top of the refunded amount." />
      <NumberField label="Your current cutoff (optional)" value={draft.currentCutoff} onChange={set("currentCutoff")} placeholder="for example 75"
        help="Only needed if your file has no 'declined' column." />
      <button className="btn btn-primary btn-wide" onClick={() => { onSave(draft); onClose(); }}>{saveLabel}</button>
    </Modal>
  );
}

export default function Analyzer(p: Props) {
  const [dragOver, setDragOver] = useState(false);
  const [popup, setPopup] = useState<null | "numbers" | "format">(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const pick = (f: File | undefined | null) => {
    if (!f) return;
    if (!f.name.toLowerCase().endsWith(".csv")) { p.onError("That file isn't a CSV. Export your orders as .csv and try again."); return; }
    p.onFile(f);
  };
  const chosen = p.file ? p.file.name : p.useSample ? "Sample store, 25,000 orders" : null;

  return (
    <div className="view">
      <div className="start">
        <div>
          <h1 className="display">Your fraud filter may be costing you more than fraud.</h1>
          <p className="lead">
            Every declined order is either fraud you stopped or a good customer you turned away.
            Verdict reads your own orders and finds the risk-score cutoff that costs you the least.
          </p>
        </div>

        <div className="upload-card">
          {chosen ? (
            <div className="chosen">
              <span><b>{chosen}</b></span>
              <button className="btn-link" onClick={() => { p.onFile(null); }}>Remove</button>
            </div>
          ) : (
            <>
              <div
                className={`dropzone${dragOver ? " over" : ""}`}
                role="button" tabIndex={0}
                onClick={() => fileInput.current?.click()}
                onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") fileInput.current?.click(); }}
                onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                onDragLeave={() => setDragOver(false)}
                onDrop={(e) => { e.preventDefault(); setDragOver(false); pick(e.dataTransfer.files?.[0]); }}
              >
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="1.8">
                  <path d="M12 16V4m0 0l-4 4m4-4l4 4M4 16v3a1 1 0 001 1h14a1 1 0 001-1v-3" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                <b>Drop your orders CSV here</b>
                <span>or click to choose a file, up to 25 MB</span>
              </div>
              <div className="or">or</div>
              <button className="btn btn-wide" onClick={p.onSample}>Use a sample store</button>
            </>
          )}
          <input ref={fileInput} type="file" accept=".csv,text/csv" hidden onChange={(e) => { pick(e.target.files?.[0]); e.target.value = ""; }} />

          <div className="numbers">
            <span>
              Customer worth <b>${p.numbers.customerValue}</b>, <b>{p.numbers.churn}%</b> leave after a decline,
              {" "}<b>${p.numbers.fee}</b> chargeback fee
            </span>
            <button className="btn-link" onClick={() => setPopup("numbers")}>Change</button>
          </div>

          <button className="btn btn-primary btn-wide" disabled={p.loading} onClick={p.onAnalyze}>
            {p.loading ? <><span className="spinner" /> Analyzing</> : "Find my cutoff"}
          </button>
          {p.error && <div className="alert alert-error" role="alert">{p.error}</div>}

          <p className="fine" style={{ margin: "14px 0 0", display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
            <span>Your file is analyzed in memory and never stored.</span>
            <button className="btn-link" onClick={() => setPopup("format")}>What should my file look like?</button>
          </p>
        </div>
      </div>

      <div className="how">
        <div><b><i>1</i>Export your orders</b><span>A CSV with each order's amount and the risk score from your fraud tool, such as Stripe Radar or Signifyd.</span></div>
        <div><b><i>2</i>Check your numbers</b><span>What a customer is worth to you, and how many leave after a wrong decline.</span></div>
        <div><b><i>3</i>Get your cutoff</b><span>The cheapest cutoff, what it saves each month, and how well it holds up.</span></div>
      </div>

      {popup === "numbers" && (
        <NumbersModal numbers={p.numbers} onSave={p.onNumbers} onClose={() => setPopup(null)} saveLabel="Save numbers" />
      )}
      {popup === "format" && (
        <Modal title="What your file should look like" onClose={() => setPopup(null)}>
          <div className="table-scroll">
            <table className="compare">
              <thead><tr><th>Column</th><th style={{ textAlign: "left" }}>What it is</th><th>Needed?</th></tr></thead>
              <tbody>
                <tr><td><b>amount</b></td><td style={{ textAlign: "left" }}>Order total in dollars</td><td>Required</td></tr>
                <tr><td><b>risk_score</b></td><td style={{ textAlign: "left" }}>Score from your fraud tool, 0 to 1 or 0 to 100</td><td>Required</td></tr>
                <tr><td><b>declined</b></td><td style={{ textAlign: "left" }}>yes or no: did your current rule decline it?</td><td>Recommended</td></tr>
                <tr><td><b>chargeback</b></td><td style={{ textAlign: "left" }}>yes or no: did an approved order turn out to be fraud? Leave blank for declined orders.</td><td>Recommended</td></tr>
                <tr><td><b>created_at</b></td><td style={{ textAlign: "left" }}>Order date, used for savings per month</td><td>Optional</td></tr>
              </tbody>
            </table>
          </div>
          <p className="note" style={{ margin: "14px 0 18px" }}>
            Column names don't have to match exactly. Names like "Order Total" or "Risk Score" are recognized.
          </p>
          <div className="btn-row">
            <a className="btn btn-primary" href={`${API_URL}/api/template.csv`}>Download the template</a>
            <a className="btn" href={`${API_URL}/api/sample-orders.csv`}>Download the sample store file</a>
          </div>
        </Modal>
      )}
    </div>
  );
}
