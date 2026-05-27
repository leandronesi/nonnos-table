import type { Diagnosis } from "../types";

// Numbered list editorial. Niente "card" inscatolate uguali: solo separazione
// hairline e numero ordinale grande a sinistra. Tipo articolo di Wired.
export function DiagnosisList({ diagnoses }: { diagnoses: Diagnosis[] }) {
  if (!diagnoses || diagnoses.length === 0) return null;
  return (
    <div className="surface surface-padded">
      {diagnoses.map((d, i) => (
        <div key={d.key} className="numbered-item">
          <div className="numbered-ord">{String(i + 1).padStart(2, "0")}</div>
          <div className="flex-1 min-w-0">
            <div className="flex items-baseline gap-3 flex-wrap">
              <h4 className="font-[var(--font-display)] text-xl font-semibold tracking-tight">
                {d.title}
              </h4>
              <ConfidenceBadge c={d.confidence} />
            </div>
            <p className="text-sm text-[color:var(--color-text-soft)] mt-2 leading-relaxed max-w-3xl">
              {d.evidence}
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-3 text-sm">
              <span className="text-[color:var(--color-brand-soft)] font-medium">
                Allena
              </span>
              <span className="text-[color:var(--color-text)]">{d.trainable}</span>
              {d.lichess_theme && (
                <a
                  href={`https://lichess.org/training/${d.lichess_theme}`}
                  target="_blank"
                  rel="noreferrer"
                  className="btn btn-ghost text-xs"
                >
                  Lichess - {d.lichess_theme}
                </a>
              )}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

function ConfidenceBadge({ c }: { c: string }) {
  const map: Record<string, { label: string; cls: string }> = {
    high: { label: "alta confidenza", cls: "pill-good" },
    medium: { label: "media confidenza", cls: "pill-warn" },
    low: { label: "bassa confidenza", cls: "border-[color:var(--color-line-strong)] text-[color:var(--color-muted)]" },
  };
  const m = map[c] || map.low;
  return <span className={`pill ${m.cls} text-[10px]`}>{m.label}</span>;
}
