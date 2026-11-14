import { useEffect, useState } from "react";
import { ComposedChart, Area, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine } from "recharts";
import Modal from "./Modal";

const money = (n: number) => `${n < 0 ? "-" : ""}$${Math.abs(Math.round(n)).toLocaleString()}`;
const count = (n: number) => Math.round(n).toLocaleString();
const reducedMotion = () => typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

/** Counts up to `target` once, when the result arrives. */
function useCountUp(target: number, ms = 900) {
  const [value, setValue] = useState(reducedMotion() ? target : 0);
  useEffect(() => {
    if (reducedMotion()) { setValue(target); return; }
    let frame = 0, start: number | null = null;
    const step = (t: number) => {
      if (start === null) start = t;
      const k = Math.min((t - start) / ms, 1);
      setValue(target * (1 - Math.pow(1 - k, 3)));
      if (k < 1) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [target, ms]);
  return value;
}

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

export function useResultHelpers(r: any) {
  const scale: number = r.score_scale;
  const fmtT = (t: number) => (scale === 100 ? String(Math.round(t)) : Number(t).toFixed(2));
  return { scale, fmtT };
}

/** Block 2: the answer. */
export function VerdictBlock({ result: r }: { result: any }) {
  const { scale, fmtT } = useResultHelpers(r);
  const cur = r.current, rec = r.recommended;
  const meaningful = r.savings > Math.max(1, cur.cost * 0.01);
  const hasCurrent = r.current_cutoff != null;
  const fewerGood = cur.good_declined - rec.good_declined;
  const moreFraud = rec.fraud_missed - cur.fraud_missed;
  const declinesLess = rec.declined < cur.declined;

  const perMonth = r.monthly_savings != null;
  const savingsShown = useCountUp(perMonth ? r.monthly_savings : r.savings);

  // The recommended marker starts at today's cutoff and slides to the new one.
  const [settled, setSettled] = useState(reducedMotion() || !hasCurrent);
  useEffect(() => {
    const id = setTimeout(() => setSettled(true), 250);
    return () => clearTimeout(id);
  }, []);
  const shown = settled ? rec.threshold : r.current_cutoff;

  const headline = !meaningful
    ? "Your cutoff is already close to the cheapest one."
    : hasCurrent
      ? `Move your cutoff from ${fmtT(r.current_cutoff)} to ${fmtT(rec.threshold)}.`
      : `Decline orders that score ${fmtT(rec.threshold)} or higher.`;

  const explanation = !meaningful
    ? "Moving it would change your costs by less than 1%. Try different numbers to see when that changes."
    : declinesLess
      ? `Today you turn away about ${count(cur.good_declined)} good customers to stop fraud. A looser cutoff lets about ${count(Math.max(moreFraud, 0))} more fraudulent orders through but keeps about ${count(fewerGood)} more good customers, and that trade is cheaper at your margins.`
      : `Today about ${count(cur.fraud_missed)} fraudulent orders get through. A stricter cutoff stops about ${count(-moreFraud)} of them at the cost of about ${count(-fewerGood)} good customers, and that trade is cheaper at your margins.`;

  const width = (t: number) => `${100 - (t / scale) * 100}%`;
  const left = (t: number) => `${(t / scale) * 100}%`;

  return (
    <section className="arrive" aria-live="polite">
      <h2 className="block-title">
        {r.source === "sample" ? "Sample store" : "Your store"}: {r.rows.toLocaleString()} orders{r.period_days ? ` over ${Math.round(r.period_days)} days` : ""}
      </h2>
      <p className="verdict-line">{headline}</p>
      {meaningful && <p className="saves">Saves about {money(savingsShown)}{perMonth ? " a month" : " on these orders"}</p>}
      <p className="note">{explanation}</p>

      <div className="ruler" aria-label="Which risk scores are declined today and at the recommended cutoff">
        {hasCurrent && (
          <div className="ruler-row now">
            <span>Today</span>
            <div className="ruler-track">
              <div className="ruler-declined" style={{ width: width(r.current_cutoff) }} />
              <span className="ruler-mark" style={{ left: left(r.current_cutoff) }}>{fmtT(r.current_cutoff)}</span>
            </div>
          </div>
        )}
        <div className="ruler-row">
          <span>Recommended</span>
          <div className="ruler-track">
            <div className="ruler-declined" style={{ width: width(shown) }} />
            <span className="ruler-mark" style={{ left: left(shown) }}>{fmtT(rec.threshold)}</span>
          </div>
        </div>
      </div>
      <div className="ruler-key mono"><span>risk score 0 to {scale === 100 ? 100 : 1}</span><span>striped = declined</span></div>

      <div className="figures">
        <div><span>Cost today</span><b>{money(cur.cost)}</b></div>
        <div><span>Cost at new cutoff</span><b>{money(rec.cost)}</b></div>
        <div><span>Savings</span><b style={{ color: r.savings >= 0 ? "var(--teal)" : "var(--red)" }}>{money(r.savings)} <small style={{ font: "400 13px var(--body)", color: "var(--muted)" }}>{r.savings_pct.toFixed(1)}%</small></b></div>
      </div>
    </section>
  );
}

/** Block 3: what every cutoff would have cost. */
export function ChartBlock({ result: r }: { result: any }) {
  const { fmtT } = useResultHelpers(r);
  const cur = r.current, rec = r.recommended;
  // Very low cutoffs decline almost everything and dwarf the useful region,
  // so zoom to cutoffs costing at most ~1.5x today's setup.
  const ceiling = Math.max(cur.cost, rec.cost) * 1.5;
  const zoomed = r.curve.filter((p: any) => p.cost <= ceiling);
  const data = zoomed.length >= 10 ? zoomed : r.curve;
  const animate = !reducedMotion();
  return (
    <section className="arrive" style={{ animationDelay: ".08s" }}>
      <h2 className="block-title">What each cutoff would have cost you</h2>
      <ResponsiveContainer width="100%" height={250}>
        <ComposedChart data={data} margin={{ top: 22, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid stroke="var(--grid)" vertical={false} />
          <XAxis dataKey="threshold" type="number" domain={["dataMin", "dataMax"]} tick={{ fontSize: 12, fill: "var(--muted)" }} tickFormatter={(v) => fmtT(v)} />
          <YAxis tick={{ fontSize: 12, fill: "var(--muted)" }} width={50} tickFormatter={(v) => (v >= 1000 ? `$${Math.round(v / 1000)}K` : `$${Math.round(v)}`)} />
          <Tooltip content={<CurveTooltip fmtT={fmtT} />} cursor={{ stroke: "var(--muted)", opacity: 0.4 }} />
          <Area type="monotone" dataKey="decline_loss" stackId="1" stroke="none" fill="var(--amber)" fillOpacity={0.3} isAnimationActive={false} />
          <Area type="monotone" dataKey="fraud_loss" stackId="1" stroke="none" fill="var(--red)" fillOpacity={0.3} isAnimationActive={false} />
          <Line type="monotone" dataKey="cost" stroke="var(--text)" strokeWidth={2} dot={false} isAnimationActive={animate} animationDuration={1100} />
          <ReferenceLine x={rec.threshold} stroke="var(--accent)" strokeWidth={1.5}
                         label={{ value: `Cheapest: ${fmtT(rec.threshold)}`, position: "top", fill: "var(--accent)", fontSize: 12, fontWeight: 600 }} />
        </ComposedChart>
      </ResponsiveContainer>
      <div className="legend">
        <span><i style={{ background: "var(--text)" }} />Total cost</span>
        <span><i style={{ background: "var(--red)" }} />Fraud let through</span>
        <span><i style={{ background: "var(--amber)" }} />Good customers turned away</span>
      </div>
      <p className="fine" style={{ marginTop: 10 }}>A lower cutoff declines more orders. The lowest point on the line is the cheapest balance.</p>
    </section>
  );
}

/** Block 4: cutoffs by order size, plus the detail popups. */
export function DetailBlock({ result: r }: { result: any }) {
  const { fmtT } = useResultHelpers(r);
  const [popup, setPopup] = useState<null | "compare" | "whatif" | "method">(null);
  const cur = r.current, rec = r.recommended;
  const size = r.by_order_size;
  const holds = r.sensitivity.filter((s: any) => s.savings > 0).length;
  const worthIt = size && size.extra_savings > Math.max(1, rec.cost * 0.005);

  return (
    <section className="arrive" style={{ animationDelay: ".14s" }}>
      <h2 className="block-title">A different cutoff for each order size</h2>
      {size ? (
        <>
          <div className="table-scroll">
            <table className="compare">
              <thead><tr><th>Order size</th><th>Orders</th><th>Cutoff</th><th>Cost</th></tr></thead>
              <tbody>
                {size.bands.map((b: any) => (
                  <tr key={b.label}>
                    <td>{b.label}</td>
                    <td>{b.orders.toLocaleString()}</td>
                    <td style={{ fontWeight: 600 }}>{fmtT(b.threshold)}{!b.own_cutoff && <span className="fine"> (overall)</span>}</td>
                    <td>{money(b.cost)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="note" style={{ marginTop: 12 }}>
            {worthIt
              ? <>Bigger orders lose more to fraud, so they deserve a stricter cutoff. Using these instead of one cutoff saves a further <b style={{ color: "var(--teal)" }}>{money(size.extra_savings)}</b>.</>
              : <>Splitting by order size makes almost no difference here, so one cutoff of {fmtT(rec.threshold)} is enough.</>}
            {size.bands.some((b: any) => !b.own_cutoff) && " A size range with too little fraud to learn from keeps the overall cutoff."}
          </p>
        </>
      ) : (
        <p className="note">This file is too small to split by order size reliably. It needs at least 900 orders.</p>
      )}

      <div className="links">
        <button className="btn-link" onClick={() => setPopup("compare")}>Compare today and recommended</button>
        <button className="btn-link" onClick={() => setPopup("whatif")}>What if my numbers are off?</button>
        <button className="btn-link" onClick={() => setPopup("method")}>How this was calculated</button>
      </div>

      {popup === "compare" && (
        <Modal title="Today against the recommended cutoff" onClose={() => setPopup(null)}>
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
                    <td style={label === "Total cost" ? { fontWeight: 600 } : undefined}>{label}</td>
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
        <Modal title="What if my numbers are off?" onClose={() => setPopup(null)}>
          <p className="note" style={{ marginBottom: 14 }}>
            Customer value and churn are estimates. This shows whether the recommended cutoff still beats today
            if a lost customer is really worth more or less than you entered. It holds in {holds} of {r.sensitivity.length} cases.
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
            <ul className="note" style={{ paddingLeft: 18, margin: "6px 0 0" }}>
              {r.warnings.map((w: string) => <li key={w} style={{ marginBottom: 6 }}>{w}</li>)}
            </ul>
          )}
        </Modal>
      )}
    </section>
  );
}
