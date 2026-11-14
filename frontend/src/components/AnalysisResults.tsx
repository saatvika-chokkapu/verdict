import { useState } from "react";
import { ComposedChart, Area, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine } from "recharts";
import Modal from "./Modal";

const money = (n: number) => `${n < 0 ? "-" : ""}$${Math.abs(Math.round(n)).toLocaleString()}`;
const count = (n: number) => Math.round(n).toLocaleString();

function CurveTooltip({ active, payload, label, fmtT }: any) {
  if (!active || !payload?.length) return null;
  const p = payload[0].payload;
  const row = (name: string, v: number, color: string) => (
    <div style={{ display: "flex", justifyContent: "space-between", gap: 18, marginTop: 4, font: "400 13px var(--body)" }}>
      <span style={{ color: "var(--muted)" }}>{name}</span>
      <b style={{ color, fontVariantNumeric: "tabular-nums" }}>{money(v)}</b>
    </div>
  );
  return (
    <div style={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 10, padding: "10px 12px", minWidth: 210 }}>
      <div style={{ font: "600 13px var(--body)" }}>Declining scores of {fmtT(label)} and up</div>
      {row("Fraud let through", p.fraud_loss, "var(--red)")}
      {row("Customers turned away", p.decline_loss, "var(--amber)")}
      {row("Total cost", p.cost, "var(--text)")}
    </div>
  );
}

type Props = { result: any; onChangeNumbers: () => void; onStartOver: () => void };

export default function AnalysisResults({ result: r, onChangeNumbers, onStartOver }: Props) {
  const [popup, setPopup] = useState<null | "compare" | "whatif" | "method">(null);
  const scale: number = r.score_scale;
  const fmtT = (t: number) => (scale === 100 ? String(Math.round(t)) : Number(t).toFixed(2));
  const cur = r.current, rec = r.recommended;
  const meaningful = r.savings > Math.max(1, cur.cost * 0.01);
  const fewerGood = cur.good_declined - rec.good_declined;
  const moreFraud = rec.fraud_missed - cur.fraud_missed;
  const declinesLess = rec.declined < cur.declined;
  const hasCurrent = r.current_cutoff != null;

  const headline = !meaningful
    ? "Your cutoff is already close to the cheapest one."
    : hasCurrent
      ? `Move your cutoff from ${fmtT(r.current_cutoff)} to ${fmtT(rec.threshold)}.`
      : `Decline orders that score ${fmtT(rec.threshold)} or higher.`;
  const saves = !meaningful ? null
    : r.monthly_savings != null ? `That saves about ${money(r.monthly_savings)} a month.`
    : `That saves about ${money(r.savings)} on these orders.`;

  const explanation = !meaningful
    ? "Moving it would change your costs by less than 1%. Try different numbers to see when that changes."
    : declinesLess
      ? `Today you turn away about ${count(cur.good_declined)} good customers to stop fraud. A looser cutoff lets about ${count(Math.max(moreFraud, 0))} more fraudulent orders through but keeps about ${count(fewerGood)} more good customers, and that trade is cheaper at your margins.`
      : `Today about ${count(cur.fraud_missed)} fraudulent orders get through. A stricter cutoff stops about ${count(-moreFraud)} of them at the cost of about ${count(-fewerGood)} good customers, and that trade is cheaper at your margins.`;

  // Very low cutoffs decline almost everything and dwarf the useful region,
  // so zoom the chart to cutoffs costing at most ~1.5x today's setup.
  const ceiling = Math.max(cur.cost, rec.cost) * 1.5;
  const zoomed = r.curve.filter((p: any) => p.cost <= ceiling);
  const curveData = zoomed.length >= 10 ? zoomed : r.curve;
  const holds = r.sensitivity.filter((s: any) => s.savings > 0).length;

  const pct = (t: number) => `${100 - (t / scale) * 100}%`;
  const left = (t: number) => `${(t / scale) * 100}%`;

  return (
    <div className="view">
      <p className="fine" style={{ marginBottom: 14 }}>
        {r.source === "sample" ? "Sample store" : "Your store"}: {r.rows.toLocaleString()} orders
        {r.period_days ? ` over ${Math.round(r.period_days)} days` : ""}
      </p>

      <div className="verdict">
        <div>
          <h1>{headline}</h1>
          {saves && <p className="saves">{saves}</p>}
          <p className="note">{explanation}</p>
        </div>

        <div className="ruler" aria-label="Risk score scale showing which orders are declined today and with the recommended cutoff">
          {hasCurrent && (
            <div className="ruler-row now">
              <span>Today</span>
              <div className="ruler-track">
                <div className="ruler-declined" style={{ width: pct(r.current_cutoff) }} />
                <span className="ruler-mark" style={{ left: left(r.current_cutoff) }}>{fmtT(r.current_cutoff)}</span>
              </div>
            </div>
          )}
          <div className="ruler-row">
            <span>Recommended</span>
            <div className="ruler-track">
              <div className="ruler-declined" style={{ width: pct(rec.threshold) }} />
              <span className="ruler-mark" style={{ left: left(rec.threshold) }}>{fmtT(rec.threshold)}</span>
            </div>
          </div>
          <div className="ruler-key">
            <span><i style={{ background: "color-mix(in oklab, var(--teal) 35%, var(--tile))" }} />Approved</span>
            <span><i style={{ background: "color-mix(in oklab, var(--red) 62%, var(--card))" }} />Declined</span>
            <span>Risk score 0 to {scale === 100 ? 100 : 1}</span>
          </div>
        </div>
      </div>

      <div className="figures">
        <div><span>Cost today</span><b>{money(cur.cost)}</b><small>{r.baseline_label}</small></div>
        <div><span>Cost at the recommended cutoff</span><b>{money(rec.cost)}</b><small>fraud losses plus customers lost</small></div>
        <div><span>Savings</span><b style={{ color: r.savings >= 0 ? "var(--teal)" : "var(--red)" }}>{money(r.savings)}</b><small>{r.savings_pct.toFixed(1)}% lower cost</small></div>
      </div>

      <section className="panel" style={{ marginTop: 16 }}>
        <h3 className="sub">What each cutoff would have cost you</h3>
        <p className="note">A lower cutoff declines more orders: less fraud, more good customers lost. The lowest point on the line is the cheapest balance.</p>
        <ResponsiveContainer width="100%" height={250}>
          <ComposedChart data={curveData} margin={{ top: 24, right: 12, left: 4, bottom: 0 }}>
            <CartesianGrid stroke="var(--grid)" vertical={false} />
            <XAxis dataKey="threshold" type="number" domain={["dataMin", "dataMax"]} tick={{ fontSize: 12, fill: "var(--muted)" }} tickFormatter={(v) => fmtT(v)} />
            <YAxis tick={{ fontSize: 12, fill: "var(--muted)" }} width={54} tickFormatter={(v) => (v >= 1000 ? `$${Math.round(v / 1000)}K` : `$${Math.round(v)}`)} />
            <Tooltip content={<CurveTooltip fmtT={fmtT} />} cursor={{ stroke: "var(--muted)", opacity: 0.4 }} />
            <Area type="monotone" dataKey="decline_loss" stackId="1" stroke="none" fill="var(--amber)" fillOpacity={0.28} isAnimationActive={false} />
            <Area type="monotone" dataKey="fraud_loss" stackId="1" stroke="none" fill="var(--red)" fillOpacity={0.2} isAnimationActive={false} />
            <Line type="monotone" dataKey="cost" stroke="var(--text)" strokeWidth={2.2} dot={false} isAnimationActive={false} />
            <ReferenceLine x={rec.threshold} stroke="var(--accent)" strokeWidth={1.5}
                           label={{ value: `Cheapest: ${fmtT(rec.threshold)}`, position: "top", fill: "var(--accent)", fontSize: 12, fontWeight: 600 }} />
          </ComposedChart>
        </ResponsiveContainer>
        <div className="legend">
          <span><i style={{ background: "var(--text)" }} />Total cost</span>
          <span><i style={{ background: "var(--red)" }} />Fraud let through</span>
          <span><i style={{ background: "var(--amber)" }} />Good customers turned away</span>
        </div>
      </section>

      <div className="more">
        <button onClick={() => setPopup("compare")}><b>Compare side by side</b><span>Orders declined, customers lost and fraud losses, today against the recommended cutoff.</span></button>
        <button onClick={() => setPopup("whatif")}><b>What if my numbers are off?</b><span>The recommendation holds in {holds} of {r.sensitivity.length} scenarios.</span></button>
        <button onClick={() => setPopup("method")}><b>How this was calculated</b><span>The cost formula, plus {r.warnings.length} note{r.warnings.length === 1 ? "" : "s"} about your data.</span></button>
      </div>

      <div className="btn-row" style={{ marginTop: 22 }}>
        <button className="btn" onClick={onChangeNumbers}>Change my numbers</button>
        <button className="btn" onClick={onStartOver}>Analyze another file</button>
      </div>

      {popup === "compare" && (
        <Modal title="Today against the recommended cutoff" onClose={() => setPopup(null)} wide>
          <div className="table-scroll">
            <table className="compare">
              <thead><tr><th></th><th>Today</th><th>Recommended</th></tr></thead>
              <tbody>
                {[
                  ["Orders declined", cur.declined, rec.declined, count, false],
                  ["Good customers turned away (estimated)", cur.good_declined, rec.good_declined, count, true],
                  ["Fraudulent orders let through (estimated)", cur.fraud_missed, rec.fraud_missed, count, true],
                  ["Fraud losses, including fees", cur.fraud_loss, rec.fraud_loss, money, true],
                  ["Value of customers lost", cur.decline_loss, rec.decline_loss, money, true],
                  ["Total cost", cur.cost, rec.cost, money, true],
                ].map(([label, a, b, f, judge]: any) => (
                  <tr key={label}>
                    <td style={label === "Total cost" ? { fontWeight: 700 } : undefined}>{label}</td>
                    <td>{f(a)}</td>
                    <td className={judge ? (b < a - 0.5 ? "better" : b > a + 0.5 ? "worse" : "") : ""}>{f(b)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Modal>
      )}

      {popup === "whatif" && (
        <Modal title="What if my numbers are off?" onClose={() => setPopup(null)} wide>
          <p className="note" style={{ marginBottom: 14 }}>
            Customer value and churn are estimates. This shows whether the recommended cutoff still beats today
            if a lost customer is really worth more or less than you entered.
          </p>
          <div className="table-scroll">
            <table className="compare">
              <thead><tr><th>If a lost customer costs you</th><th>Savings</th><th>Still better?</th></tr></thead>
              <tbody>
                {r.sensitivity.map((s: any) => (
                  <tr key={s.multiplier}>
                    <td>{money(r.assumptions.cost_per_wrongly_declined_customer * s.multiplier)}{s.multiplier === 1 ? " (what you entered)" : ` (${s.multiplier}× your estimate)`}</td>
                    <td className={s.savings > 0 ? "better" : "worse"}>{money(s.savings)}</td>
                    <td className={s.savings > 0 ? "better" : "worse"}>{s.savings > 0 ? "Yes" : "No"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Modal>
      )}

      {popup === "method" && (
        <Modal title="How this was calculated" onClose={() => setPopup(null)}>
          <p className="note" style={{ marginBottom: 12 }}>
            <b style={{ color: "var(--text)" }}>An approved order</b> costs its chance of being fraud × (order amount + {money(r.assumptions.chargeback_fee)} fee).
          </p>
          <p className="note" style={{ marginBottom: 12 }}>
            <b style={{ color: "var(--text)" }}>A declined order</b> costs its chance of being a good customer × {money(r.assumptions.cost_per_wrongly_declined_customer)},
            which is {money(r.assumptions.customer_value)} customer value × {Math.round(r.assumptions.churn_rate * 100)}% who leave.
          </p>
          <p className="note" style={{ marginBottom: 12 }}>
            Verdict adds these up for every possible cutoff and picks the cheapest. These are estimates to guide a decision, not guarantees.
          </p>
          {r.warnings.length > 0 && (
            <>
              <h3 className="sub" style={{ marginTop: 18 }}>Notes about your data</h3>
              <ul className="note" style={{ paddingLeft: 18, margin: "6px 0 0" }}>
                {r.warnings.map((w: string) => <li key={w} style={{ marginBottom: 6 }}>{w}</li>)}
              </ul>
            </>
          )}
        </Modal>
      )}
    </div>
  );
}
