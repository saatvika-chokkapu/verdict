import { useRef, useState } from "react";
import { API_URL, NeedsMapping } from "../api/client";
import Modal from "./Modal";

export type Numbers = { customerValue: string; churn: string; fee: string; currentCutoff: string };

type Props = {
  file: File | null;
  useSample: boolean;
  numbers: Numbers;
  loading: boolean;
  error: string | null;
  compact?: boolean;
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

const ROLE_LABELS: [string, string, boolean][] = [
  ["amount", "Order amount", true],
  ["score", "Risk score", true],
  ["declined", "Was it declined?", false],
  ["fraud", "Did it turn out to be fraud?", false],
  ["date", "Order date", false],
];

/** Shown when the file's column names weren't recognized. */
export function MappingModal({ info, onConfirm, onClose }: {
  info: NeedsMapping; onConfirm: (mapping: Record<string, string>) => void; onClose: () => void;
}) {
  const [mapping, setMapping] = useState<Record<string, string>>({ ...(info.suggestion || {}), ...info.matched });
  const ready = mapping.amount && mapping.score;
  return (
    <Modal title="Match your columns" onClose={onClose}>
      <p className="note" style={{ marginBottom: 16 }}>
        We couldn't tell which of your columns is which. Pick the right one for each row.
        {info.suggestedBy === "ai" && " The choices below were suggested by AI from your column names only. No order data was shared."}
      </p>
      {ROLE_LABELS.map(([role, label, required]) => (
        <div className="field" key={role} style={{ marginBottom: 12 }}>
          <label>{label}{required ? "" : " (optional)"}</label>
          <div className="input-wrap">
            <select value={mapping[role] || ""} onChange={(e) => setMapping({ ...mapping, [role]: e.target.value })}>
              <option value="">{required ? "Choose a column" : "Not in my file"}</option>
              {info.columns.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
        </div>
      ))}
      <button className="btn btn-primary btn-wide" style={{ marginTop: 8 }} disabled={!ready}
              onClick={() => { onConfirm(Object.fromEntries(Object.entries(mapping).filter(([, v]) => v))); onClose(); }}>
        Use these columns
      </button>
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
    <div>
      {chosen ? (
        <div className="chosen">
          <b>{chosen}</b>
          <button className="btn-link" onClick={() => p.onFile(null)}>Remove</button>
        </div>
      ) : (
        <>
          <div
            className={`dropzone${dragOver ? " over" : ""}`}
            role="button" tabIndex={0}
            style={p.compact ? { padding: "18px 14px" } : undefined}
            onClick={() => fileInput.current?.click()}
            onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") fileInput.current?.click(); }}
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => { e.preventDefault(); setDragOver(false); pick(e.dataTransfer.files?.[0]); }}
          >
            <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="1.8">
              <path d="M12 16V4m0 0l-4 4m4-4l4 4M4 16v3a1 1 0 001 1h14a1 1 0 001-1v-3" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <b>Drop your orders CSV here</b>
            <span>or click to choose a file, up to 25 MB</span>
          </div>
          <div className="or">or</div>
          <button className="btn btn-wide" disabled={p.loading} onClick={p.onSample}>Use a sample store</button>
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
        {p.loading ? <><span className="spinner" /> Analyzing</> : p.compact && chosen ? "Run again" : "Find my cutoff"}
      </button>
      {p.error && <div className="alert" role="alert">{p.error}</div>}

      <p className="fine" style={{ margin: "14px 0 0" }}>
        Your file is analyzed in memory and never stored.{" "}
        <button className="btn-link" style={{ fontSize: 12.5 }} onClick={() => setPopup("format")}>What should my file look like?</button>
      </p>

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
            Your column names don't have to match. If we can't recognize them, you'll be asked to match them yourself.
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
