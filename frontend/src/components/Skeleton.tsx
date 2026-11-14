type SkeletonCardProps = {
  title: string;
  subtitle?: string;
  tiles?: number;
  delay?: string;
};

export default function SkeletonCard({ title, subtitle, tiles = 3, delay }: SkeletonCardProps) {
  return (
    <section className="skel-card" style={{ animation: "cardIn .5s ease-out both", animationDelay: delay }}>
      <div className="skel-row" style={{ justifyContent: "space-between" }}>
        <div>
          <h2 style={{ margin: 0, font: "600 19px 'Inter'", letterSpacing: "-.01em", color: "var(--text)" }}>{title}</h2>
          {subtitle && (
            <p style={{ margin: "7px 0 0", font: "400 13px 'Inter'", color: "var(--muted)" }}>{subtitle}</p>
          )}
        </div>
        <span
          style={{
            display: "inline-flex", alignItems: "center", gap: 7,
            font: "500 11px 'IBM Plex Mono',monospace", letterSpacing: ".08em", textTransform: "uppercase",
            color: "var(--muted)",
          }}
        >
          <span
            style={{
              width: 6, height: 6, borderRadius: "50%", background: "var(--muted)",
              animation: "pulseDot 1.4s ease-out infinite",
            }}
          />
          loading
        </span>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: `repeat(${tiles}, 1fr)`, gap: "var(--gap)", marginTop: 24 }}>
        {Array.from({ length: tiles }).map((_, i) => (
          <div key={i} style={{ background: "var(--tile)", border: "1px solid var(--border)", borderRadius: "var(--radius)", padding: "var(--tile-pad)" }}>
            <div className="skel-line" style={{ width: "60%", height: 10, marginBottom: 16 }} />
            <div className="skel-line" style={{ width: "80%", height: 26, marginBottom: 10 }} />
            <div className="skel-line" style={{ width: "45%", height: 10 }} />
          </div>
        ))}
      </div>
    </section>
  );
}


type ErrorCardProps = { title: string; onRetry: () => void };

export function ErrorCard({ title, onRetry }: ErrorCardProps) {
  return (
    <section className="skel-card" style={{ animation: "cardIn .5s ease-out both" }}>
      <h2 style={{ margin: 0, font: "600 19px 'Inter'", letterSpacing: "-.01em", color: "var(--text)" }}>{title}</h2>
      <p style={{ margin: "12px 0 16px", font: "400 13px 'Inter'", color: "var(--muted)", maxWidth: 460 }}>
        The live API did not respond. It runs on a free tier that sleeps when idle,
        so the first request after a quiet period can take up to a minute.
      </p>
      <button
        onClick={onRetry}
        style={{
          font: "500 12px 'IBM Plex Mono',monospace", letterSpacing: ".06em", textTransform: "uppercase",
          color: "var(--text)", background: "var(--tile)", border: "1px solid var(--border)",
          borderRadius: 8, padding: "9px 16px", cursor: "pointer",
        }}
      >
        Retry
      </button>
    </section>
  );
}
