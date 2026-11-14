import { ComposedChart, Area, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine } from "recharts";

const money = (n: number) => `${n < 0 ? "-" : ""}$${Math.abs(Math.round(n)).toLocaleString()}`;
const count = (n: number) => Math.round(n).toLocaleString();

function CurveTooltip({ active, payload, label, scale }: any) {
  if (!active || !payload?.length) return null;
  const p = payload[0].payload;
  const row = (name: string, v: number, color: string) => (
    <div style={{ display: "flex", justifyContent: "space-between", gap: 16, marginTop: 4 }}>
      <span style={{ font: "400 11px 'Inter'", color: "var(--muted)" }}>{name}</span>
      <span style={{ font: "600 12px 'IBM Plex Mono',monospace", color }}>{money(v)}</span>
    </div>
  );
  return (
    <div style={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 8, padding: "9px 12px", boxShadow: "0 6px 20px var(--shadow-color)", minWidth: 190 }}>
      <div style={{ font: "500 10px 'IBM Plex Mono',monospace", color: "var(--muted)", letterSpacing: ".1em", textTransform: "uppercase" }}>
        Decline score ≥ {scale === 100 ? label : Number(label).toFixed(2)}
      </div>
      {row("Fraud let through", p.fraud_loss, "var(--red)")}
      {row("Customers turned away", p.decline_loss, "var(--amber)")}
      {row("Total cost", p.cost, "var(--text)")}
    </div>
  );
}

export default function AnalysisResults({ result }: { result: any }) {
  const r = result;
  const scale: number = r.score_scale;
  const fmtT = (t: number) => (scale === 100 ? String(Math.round(t)) : t.toFixed(2));
  const cur = r.current, rec = r.recommended;
  const meaningful = r.savings > Math.max(1, cur.cost * 0.01);
  const sample = r.source === "sample";

  const fewerGood = cur.good_declined - rec.good_declined;
  const moreFraud = rec.fraud_missed - cur.fraud_missed;
  const declinesLess = rec.declined < cur.declined;

  const headline = meaningful
    ? r.monthly_savings != null
      ? <>Decline orders scoring {fmtT(rec.threshold)} or higher and save about <span style={{ color: "var(--teal)" }}>{money(r.monthly_savings)} a month</span>.</>
      : <>Decline orders scoring {fmtT(rec.threshold)} or higher and save about <span style={{ color: "var(--teal)" }}>{money(r.savings)}</span>.</>
    : <>Your current setup is already close to the cheapest option.</>;

  const explanation = meaningful
    ? declinesLess
      ? <>Right now, {r.baseline_label} turns away about <strong>{count(cur.good_declined)} good customers</strong> to stop fraud.
          At your margins, that costs more than it saves. A looser cutoff lets through roughly{" "}
          <strong>{count(Math.max(moreFraud, 0))} more fraudulent orders</strong> but keeps about{" "}
          <strong>{count(fewerGood)} more good customers</strong>, which is cheaper overall.</>
      : <>Right now, {r.baseline_label} lets about <strong>{count(cur.fraud_missed)} fraudulent orders</strong> through.
          Tightening the cutoff stops about <strong>{count(-moreFraud)} of them</strong> and costs you about{" "}
          <strong>{count(-fewerGood)} good customers</strong>, which is cheaper overall at your margins.</>
    : <>Moving the cutoff would change your costs by less than 1%, so there's no strong reason to change it.
        Try adjusting the customer value or churn rate to see when that changes.</>;

  // Very low cutoffs decline almost everything and dwarf the interesting region,
  // so zoom the chart to cutoffs that cost at most ~1.5x today's setup.
  const ceiling = Math.max(cur.cost, rec.cost) * 1.5;
  const zoomed = r.curve.filter((p: any) => p.cost <= ceiling);
  const curveData = zoomed.length >= 10 ? zoomed : r.curve;

  const holds = r.sensitivity.filter((s: any) => s.savings > 0).length;

  return (
    <>
      <div className="verdict-banner">
        <span className="eyebrow">{sample ? "Result for the sample store" : "Your result"} · {r.rows.toLocaleString()} orders{r.period_days ? ` over ${Math.round(r.period_days)} days` : ""}</span>
        <h3>{headline}</h3>
        <p>{explanation}</p>
      </div>

      <section className="panel">
        <div className="kpis" style={{ marginTop: 0 }}>
          <div className="kpi">
            <div className="k">Cost today</div>
            <div className="v" style={{ color: "var(--amber)" }}>{money(cur.cost)}</div>
            <div className="d">{r.baseline_label}</div>
          </div>
          <div className="kpi">
            <div className="k">Cost with Verdict's cutoff</div>
            <div className="v" style={{ color: "var(--teal)" }}>{money(rec.cost)}</div>
            <div className="d">decline score ≥ {fmtT(rec.threshold)}</div>
          </div>
          <div className="kpi">
            <div className="k">Estimated savings</div>
            <div className="v" style={{ color: r.savings >= 0 ? "var(--teal)" : "var(--red)" }}>{money(r.savings)}</div>
            <div className="d">{r.savings_pct.toFixed(1)}% lower cost{r.monthly_savings != null ? ` · ${money(r.monthly_savings)}/month` : ""}</div>
          </div>
        </div>

        <h2 style={{ fontSize: 17 }}>What every cutoff would have cost you</h2>
        <p className="sub">Lower cutoffs decline more orders: less fraud, more good customers lost. The lowest point of the line is the cheapest balance.</p>
        <ResponsiveContainer width="100%" height={280}>
          <ComposedChart data={curveData} margin={{ top: 22, right: 12, left: 4, bottom: 0 }}>
            <CartesianGrid stroke="var(--grid)" strokeDasharray="2 5" vertical={false} />
            <XAxis dataKey="threshold" type="number" domain={["dataMin", "dataMax"]} tick={{ fontSize: 10, fill: "var(--muted)" }}
                   tickFormatter={(v) => fmtT(v)} label={{ value: "decline if risk score ≥", position: "insideBottomRight", offset: -2, fontSize: 10, fill: "var(--muted)" }} />
            <YAxis tick={{ fontSize: 10, fill: "var(--muted)" }} tickFormatter={(v) => v >= 1000 ? `$${Math.round(v / 1000)}K` : `$${Math.round(v)}`} width={52} />
            <Tooltip content={<CurveTooltip scale={scale} />} cursor={{ stroke: "var(--muted)", opacity: 0.4 }} />
            <Area type="monotone" dataKey="decline_loss" stackId="1" stroke="none" fill="var(--amber)" fillOpacity={0.22} />
            <Area type="monotone" dataKey="fraud_loss" stackId="1" stroke="none" fill="var(--red)" fillOpacity={0.18} />
            <Line type="monotone" dataKey="cost" stroke="var(--text)" strokeWidth={2.2} dot={false} />
            <ReferenceLine x={rec.threshold} stroke="var(--teal)" strokeDasharray="4 4"
                           label={{ value: `best: ${fmtT(rec.threshold)}`, position: "top", fill: "var(--teal)", fontSize: 11 }} />
          </ComposedChart>
        </ResponsiveContainer>
        <div style={{ display: "flex", gap: 20, flexWrap: "wrap", marginTop: 10 }}>
          {[["var(--text)", "Total cost"], ["var(--red)", "Fraud let through"], ["var(--amber)", "Good customers turned away"]].map(([c, l]) => (
            <span key={l} style={{ display: "flex", alignItems: "center", gap: 8, font: "400 12px 'Inter'", color: "var(--muted)" }}>
              <span style={{ width: 14, height: 3, borderRadius: 2, background: c }} />{l}
            </span>
          ))}
        </div>
      </section>

      <section className="panel">
        <h2 style={{ fontSize: 17 }}>Today vs. the recommended cutoff</h2>
        <div className="table-scroll" style={{ marginTop: 14 }}>
          <table className="compare">
            <thead><tr><th></th><th>Today</th><th>Recommended</th></tr></thead>
            <tbody>
              {[
                ["Orders declined", cur.declined, rec.declined, count, false],
                ["Good customers turned away (est.)", cur.good_declined, rec.good_declined, count, true],
                ["Fraudulent orders let through (est.)", cur.fraud_missed, rec.fraud_missed, count, true],
                ["Fraud losses incl. fees", cur.fraud_loss, rec.fraud_loss, money, true],
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
      </section>

      <section className="panel">
        <h2 style={{ fontSize: 17 }}>What if your numbers are off?</h2>
        <p className="sub">
          Customer value and churn are estimates. Here's whether the recommended cutoff still beats today if a lost customer
          is actually worth more or less than you entered. It holds in {holds} of {r.sensitivity.length} scenarios.
        </p>
        <div className="table-scroll" style={{ marginTop: 14 }}>
          <table className="compare">
            <thead><tr><th>A lost customer is worth…</th><th>Savings</th><th>Still better?</th></tr></thead>
            <tbody>
              {r.sensitivity.map((s: any) => (
                <tr key={s.multiplier}>
                  <td>{s.multiplier === 1 ? "What you entered" : `${s.multiplier}× what you entered`} ({money(r.assumptions.cost_per_wrongly_declined_customer * s.multiplier)})</td>
                  <td className={s.savings > 0 ? "better" : "worse"}>{money(s.savings)}</td>
                  <td className={s.savings > 0 ? "better" : "worse"}>{s.savings > 0 ? "Yes" : "No"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="alert alert-note">
          <b style={{ color: "var(--text)" }}>How this was calculated.</b> Each approved order costs its chance of being fraud ×
          (amount + {money(r.assumptions.chargeback_fee)} fee). Each declined order costs its chance of being a good customer ×{" "}
          {money(r.assumptions.cost_per_wrongly_declined_customer)} ({money(r.assumptions.customer_value)} customer value ×{" "}
          {Math.round(r.assumptions.churn_rate * 100)}% who leave). These are estimates to guide a decision, not guarantees.
          {r.warnings.length > 0 && (
            <ul style={{ margin: "10px 0 0", paddingLeft: 18 }}>
              {r.warnings.map((w: string) => <li key={w} style={{ marginBottom: 4 }}>{w}</li>)}
            </ul>
          )}
        </div>
      </section>
    </>
  );
}
