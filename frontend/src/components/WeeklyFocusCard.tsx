import type { WeeklyFocus, CoachBrief } from "../types";

/**
 * "Cosa fare questa settimana". Una sola headline editorial grande,
 * 3 action card sotto in griglia. Niente liste tristi.
 */
export function WeeklyFocusCard({ focus, brief }: { focus: WeeklyFocus; brief?: CoachBrief }) {
  const headline = brief?.headline || focus.headline;
  const narrative = brief?.diagnosis_narrative || focus.evidence;
  const actions = brief?.this_week || focus.actions;
  const avoid = brief?.avoid;

  return (
    <div className="surface surface-padded relative overflow-hidden">
      <div
        className="absolute -top-20 -right-20 w-72 h-72 rounded-full pointer-events-none"
        style={{ background: "radial-gradient(circle, rgba(124,92,255,0.18), transparent 70%)" }}
      />

      <div className="relative max-w-4xl">
        <h3 className="font-[var(--font-display)] text-3xl lg:text-4xl font-semibold leading-tight tracking-tight">
          "{headline}"
        </h3>
        {narrative && (
          <p className="text-[color:var(--color-text-soft)] text-base mt-4 leading-relaxed">
            {narrative}
          </p>
        )}
      </div>

      {actions && actions.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mt-8">
          {actions.map((a, i) => (
            <div
              key={i}
              className="relative p-4 rounded-xl"
              style={{
                background: "linear-gradient(180deg, rgba(124,92,255,0.08) 0%, rgba(124,92,255,0.02) 100%)",
                border: "1px solid rgba(124,92,255,0.18)",
              }}
            >
              <div className="font-[var(--font-display)] text-3xl font-bold text-[color:var(--color-brand-soft)] tabular-nums opacity-60">
                {String(i + 1).padStart(2, "0")}
              </div>
              <div className="text-sm text-[color:var(--color-text)] mt-2 leading-relaxed">{a}</div>
            </div>
          ))}
        </div>
      )}

      {avoid && (
        <div className="mt-5 p-4 rounded-xl border border-rose-500/25 bg-rose-500/[0.05]">
          <div className="label-eyebrow text-rose-300">Da evitare</div>
          <div className="text-sm text-[color:var(--color-text)] mt-1">{avoid}</div>
        </div>
      )}

      {brief && (
        <div className="mt-5 pt-4 hairline text-[11px] text-[color:var(--color-muted)] font-mono">
          generato da {brief.model} · {brief.generated_at}
        </div>
      )}
    </div>
  );
}
