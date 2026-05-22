import type { TacticalBreakdown } from "../types";

/**
 * Distribuzione dei motivi tattici tra i miei mistake/blunder critici.
 *
 * Esempio di lettura: "Forchetta · 47 ricorrenze, 12% dei tuoi blunder, gap
 * +28% sulla mossa giusta". Il pattern con piu` "gap" e piu` casi e` quello
 * che brucia di piu` punti Elo: priorita` di training.
 */
export function TacticalBreakdownCard({ items }: { items: TacticalBreakdown[] }) {
  if (!items || items.length === 0) {
    return (
      <div className="surface surface-padded">
        <p className="text-sm text-[color:var(--color-text-soft)]">
          Nessun motivo tattico rilevato nei tuoi mistake / blunder critici.
        </p>
      </div>
    );
  }

  // max share per scalare la barra
  const maxShare = Math.max(...items.map((i) => i.share_pct));

  return (
    <div className="surface surface-padded">
      <div className="space-y-3">
        {items.map((it) => {
          const widthPct = maxShare > 0 ? (it.share_pct / maxShare) * 100 : 0;
          const tone =
            it.avg_gap_pct >= 25
              ? { fg: "#fda4af", track: "rgba(244, 63, 94, 0.18)" }
              : it.avg_gap_pct >= 15
              ? { fg: "#fcd34d", track: "rgba(251, 191, 36, 0.18)" }
              : { fg: "#94a3b8", track: "rgba(148, 163, 184, 0.18)" };
          return (
            <div key={it.key}>
              <div className="flex items-baseline justify-between gap-3 mb-1">
                <div className="text-sm text-[color:var(--color-text)]">
                  {it.label_it}
                  <span className="text-[10px] ml-2 text-[color:var(--color-muted)] uppercase tracking-wider">
                    {it.n} / {it.n_total} ({it.share_pct}%)
                  </span>
                </div>
                <div className="text-xs tabular-nums" style={{ color: tone.fg }}>
                  gap +{it.avg_gap_pct}%
                </div>
              </div>
              <div
                className="h-1.5 rounded-full overflow-hidden"
                style={{ background: tone.track }}
              >
                <div
                  className="h-full rounded-full"
                  style={{ width: `${widthPct}%`, background: tone.fg }}
                />
              </div>
              <div className="text-[10px] text-[color:var(--color-muted)] mt-1 font-mono">
                avg cp_loss {it.avg_cp_loss}
              </div>
            </div>
          );
        })}
      </div>
      <div className="text-[11px] text-[color:var(--color-muted)] mt-5 leading-relaxed">
        <b>gap +N%</b> = differenza fra "quanto un 1600 trova la mossa giusta in queste posizioni"
        e "quanto la trova al tuo livello". Piu` alto = piu` valore di allenamento.
      </div>
    </div>
  );
}
