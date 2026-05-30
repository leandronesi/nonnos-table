import type { WeeklyTrend } from "../types";

/**
 * Trend a 7 giorni: confronto fra ultimi 7gg e i 7gg precedenti.
 *
 * Struttura a RIGHE (label a sinistra, numero mono a destra): robusta a qualsiasi
 * larghezza, niente colonne strette che spaccano le label o troncano i valori.
 * Stesso pattern di DecisionsCard. Verde = migliori, rosso = peggiori (la direzione
 * "buona" dipende dalla metrica: ACPL piu' basso = meglio, win_rate piu' alto = meglio).
 */
export function WeeklyTrendCard({ trend, title = "Settimana vs precedente" }: {
  trend: WeeklyTrend;
  title?: string;
}) {
  const last = trend.last_7d;
  const prev = trend.prev_7d;
  const d = trend.delta;

  const enough = last.n_games >= 3 && prev.n_games >= 3;
  if (!enough) {
    return (
      <div className="surface surface-padded">
        <div className="label-eyebrow text-[color:var(--color-brand-soft)] mb-2">{title}</div>
        <p className="text-sm text-[color:var(--color-text-soft)]">
          Servono almeno 3 partite per settimana per un confronto significativo.
          Hai giocato {last.n_games} (ultimi 7gg) vs {prev.n_games} (settimana prima).
        </p>
      </div>
    );
  }

  return (
    <div className="surface surface-padded">
      <div className="label-eyebrow text-[color:var(--color-brand-soft)] mb-1">{title}</div>
      <div className="flex flex-col">
        <MetricRow
          label="Vittorie"
          value={`${Math.round((last.win_rate ?? 0) * 100)}%`}
          delta={d.win_rate}
          deltaFmt={(x) => `${x > 0 ? "+" : ""}${Math.round(x * 100)}pp`}
          higherIsBetter
        />
        <MetricRow
          label="Perdita media"
          value={String(Math.round(last.avg_cp_loss))}
          delta={d.avg_cp_loss}
          deltaFmt={(x) => (x > 0 ? "+" : "") + Math.round(x)}
          higherIsBetter={false}
        />
        <MetricRow
          label="Errori gravi"
          value={String(last.n_blunders)}
          delta={d.n_blunders}
          deltaFmt={(x) => (x > 0 ? "+" : "") + Math.round(x)}
          higherIsBetter={false}
        />
        <MetricRow
          label="Partite"
          value={String(last.n_games)}
          delta={d.n_games}
          deltaFmt={(x) => (x > 0 ? "+" : "") + Math.round(x)}
          higherIsBetter
        />
      </div>
    </div>
  );
}

function MetricRow({
  label,
  value,
  delta,
  deltaFmt,
  higherIsBetter,
}: {
  label: string;
  value: string;
  delta: number | null;
  deltaFmt: (x: number) => string;
  higherIsBetter: boolean;
}) {
  const num = delta ?? 0;
  const isImprovement = num === 0 ? null : (num > 0) === higherIsBetter;
  const fg =
    isImprovement == null
      ? "var(--color-muted)"
      : isImprovement
      ? "var(--color-ok)"
      : "var(--color-danger)";

  return (
    <div
      className="flex items-center justify-between gap-4"
      style={{ padding: "0.6rem 0", borderTop: "1px solid var(--color-line)" }}
    >
      <div className="text-sm" style={{ color: "var(--color-text-soft)" }}>
        {label}
      </div>
      <div className="flex items-baseline gap-2 shrink-0">
        <span
          className="mono tabular-nums"
          style={{ fontSize: "1.25rem", fontWeight: 700, color: "var(--color-text)", lineHeight: 1 }}
        >
          {value}
        </span>
        {delta != null && (
          <span
            className="text-xs tabular-nums"
            style={{ color: fg, minWidth: "3.4rem", textAlign: "right" }}
          >
            {deltaFmt(num)} {isImprovement === true ? "↑" : isImprovement === false ? "↓" : ""}
          </span>
        )}
      </div>
    </div>
  );
}
