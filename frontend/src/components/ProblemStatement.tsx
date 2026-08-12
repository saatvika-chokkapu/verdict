const card: React.CSSProperties = {
  background: "var(--card)", border: "1px solid var(--border)", borderRadius: "var(--radius)",
  padding: "var(--card-pad)", boxShadow: "var(--shadow)", marginBottom: "18px",
  animation: "cardIn .5s ease-out both",
};
const row: React.CSSProperties = { marginBottom: 18 };
const label: React.CSSProperties = {
  font: "600 11px 'IBM Plex Mono',monospace", letterSpacing: ".14em", textTransform: "uppercase",
  color: "var(--blue)", marginBottom: 6, display: "block",
};
const text: React.CSSProperties = { font: "400 14px 'Inter'", color: "var(--text)", lineHeight: 1.6, margin: 0 };

export default function ProblemStatement() {
  return (
    <section style={card}>
      <div style={row}>
        <span style={label}>The problem</span>
        <p style={text}>
          Fraud systems that maximize fraud-catch rate end up declining far more legitimate customers
          than they save in prevented fraud. Industry research estimates false declines cost merchants
          roughly 9x more than fraud itself — and 39% of customers who experience one never return.
        </p>
      </div>
      <div style={row}>
        <span style={label}>What this tests</span>
        <p style={text}>
          Whether scoring each transaction by its actual dollar cost — instead of by a fixed fraud-probability
          cutoff — reduces total cost, using a real fraud classifier trained on 590,000 transactions.
        </p>
      </div>
      <div style={{ ...row, marginBottom: 0 }}>
        <span style={label}>What we found</span>
        <p style={text}>
          Over 6 months of real transaction data, cost-aware decisioning saved $126K (4.8%) by deliberately
          catching less fraud by count — but the fraud it caught was worth nearly 2x more on average,
          while reducing false declines on legitimate customers. The result holds as long as our churn
          and customer-value assumptions aren't more than ~55% too low — see the sensitivity analysis below.
        </p>
      </div>
    </section>
  );
}
