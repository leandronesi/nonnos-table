import type { WeeklyTrend } from "../types";

/**
 * Trend a 7 giorni: confronto fra ultimi 7gg e i 7gg precedenti. Mostrato
 * a fine sessione come "ricompensa" e nella sezione sopra-piega del
 * cruscotto se la settimana e` significativa.
 *
 * Lettura: per ogni metrica, una freccia + numero. Verde = stai migliorando,
 * rosso = stai peggiorando. La direzione "buona" dipende dalla metrica
 * (ACPL: piu` basso = meglio. win_rate: piu` alto = meglio).
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
          Servono almeno 3 partite per settimana per avere un confronto significativo.
          Hai giocato {last.n_games} (ultimi 7gg) vs {prev.n_games} (settimana prima).
        </p>
      </div>
    );
  }

  return (
    <div className="surface surface-padded">
      <div className="label-eyebrow text-[color:var(--color-brand-soft)] mb-3">{title}</div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <Metric
          label="Win rate"
          value={`${Math.round((last.win_rate ?? 0) * 100)}%`}
          delta={d.win_rate}
          deltaFmt={(x) => `${x > 0 ? "+" : ""}${Math.round(x * 100)}pt`}
          higherIsBetter
        />
        <Metric
          label="ACPL critico"
          value={String(last.avg_cp_loss)}
          delta={d.avg_cp_loss}
          deltaFmt={(x) => (x > 0 ? "+" : "") + Math.round(x)}
          higherIsBetter={false}
        />
        <Metric
          label="Blunder"
          value={String(last.n_blunders)}
          delta={d.n_blunders}
          deltaFmt={(x) => (x > 0 ? "+" : "") + Math.round(x)}
          higherIsBetter={false}
        />
        <Metric
          label="Partite"
          value={String(last.n_games)}
          delta={d.n_games}
          deltaFmt={(x) => (x > 0 ? "+" : "") + Math.round(x)}
          higherIsBetter // piu` partite = piu` dati
        />
      </div>
    </div>
  );
}

function Metric({
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
  const tone =
    isImprovement == null
      ? { fg: "#cbd5e1" }
      : isImprovement
      ? { fg: "#86efac" }
      : { fg: "#fda4af" };
  return (
    <div>
      <div className="text-[10px] tracking-wider uppercase text-[color:var(--color-muted)]">{label}</div>
      <div className="display-small mt-1 tabular-nums" style={{ color: "var(--color-text)" }}>
        {value}
      </div>
      {delta != null && (
        <div className="text-xs mt-1 tabular-nums" style={{ color: tone.fg }}>
          {deltaFmt(num)} {isImprovement === true ? "↑" : isImprovement === false ? "↓" : ""}
        </div>
      )}
    </div>
  );
}
