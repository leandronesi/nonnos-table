import type { Kpi, ColorAgg, PerformanceAgg, Goal } from "../types";
import { Help } from "./Help";
import { GLOSS } from "../glossary";

/**
 * KpiRow ridisegnato con vera gerarchia (Gestalt):
 *  - KPI #1 GRANDE: il goal (rating attuale + gap + barra mini). È la cosa che guardi prima.
 *  - KPI #2, #3, #4: secondari, stessa dimensione tra loro, più piccoli del #1.
 *  - Ogni metrica tecnica ha un <Help> con definizione human-readable.
 *  - Numeri grossi + label esplicite sopra + sub spiegazione sotto (closure visiva).
 */

interface Props {
  kpi: Kpi;
  byColor: Record<"white" | "black", ColorAgg>;
  performance: PerformanceAgg;
  goal: Goal;
}

export function KpiRow({ kpi, byColor, performance, goal }: Props) {
  const totalGames = byColor.white.games + byColor.black.games;
  const totalWins = byColor.white.wins + byColor.black.wins;
  const winRate = totalGames ? (totalWins / totalGames) * 100 : 0;
  const blunderPct = kpi.blunder_rate * 100;

  // Per il KPI 'Elo atteso' usiamo la time_class del goal (blitz)
  const goalTcPerf = performance.by_time_class[goal.time_class];
  const perfLast = goalTcPerf?.last_20;
  const ratingNow = goalTcPerf?.current_rating ?? null;
  const perfGap = perfLast != null && ratingNow != null ? perfLast - ratingNow : null;

  // Barra mini di progresso verso il goal
  const start = goal.start_rating ?? ratingNow ?? 0;
  const target = goal.target;
  const cur = ratingNow ?? 0;
  const pct = Math.max(0, Math.min(100, ((cur - start) / (target - start)) * 100));

  return (
    <div className="grid grid-cols-1 lg:grid-cols-4 gap-5 mt-2">
      {/* KPI #1 — GRANDE, il goal */}
      <div className="card lg:col-span-2 relative overflow-hidden">
        <div
          className="absolute -top-10 -right-10 w-48 h-48 rounded-full pointer-events-none"
          style={{
            background:
              "radial-gradient(circle, rgba(124,92,255,0.18), transparent 70%)",
          }}
        />
        <div className="card-title flex items-center gap-2">
          Verso {target} {goal.time_class}
          <Help text={GLOSS.goal_target} />
        </div>
        <div className="flex items-baseline gap-4 mt-2">
          <div className="text-5xl font-[var(--font-display)] font-semibold tabular-nums tracking-tight">
            {cur}
          </div>
          <div className="text-sm text-slate-400">
            <div>
              ti mancano{" "}
              <span className="text-slate-100 font-semibold">{goal.points_needed}</span> punti
            </div>
            <div>
              in <span className="text-slate-100">{goal.days_left}</span> giorni
            </div>
          </div>
        </div>

        <div className="mt-3">
          <div className="h-2.5 w-full rounded-full bg-slate-800 overflow-hidden">
            <div
              className="h-2.5"
              style={{
                width: `${pct}%`,
                background:
                  "linear-gradient(90deg, var(--color-brand) 0%, var(--color-brand-soft) 100%)",
              }}
            />
          </div>
          <div className="flex justify-between text-[11px] text-slate-500 mt-1 tabular-nums">
            <span>{start} (start)</span>
            <span className="text-slate-400">{Math.round(pct)}% fatto</span>
            <span>{target}</span>
          </div>
        </div>
      </div>

      {/* KPI #2 — Elo atteso */}
      <SecondaryKpi
        title={
          <>
            Elo atteso <Help text={GLOSS.performance_rating} />
          </>
        }
        valueLine={perfLast != null ? `${perfLast}` : "—"}
        valueSub={
          perfGap != null ? (
            <>
              rating ora <span className="text-slate-200">{ratingNow}</span> ·{" "}
              <span className={perfGap >= 0 ? "text-green-300" : "text-red-300"}>
                gap {perfGap >= 0 ? "+" : ""}
                {perfGap}
              </span>
            </>
          ) : (
            "non disponibile"
          )
        }
        bottomLine={
          perfGap != null && perfGap > 20
            ? "giochi come uno più forte"
            : perfGap != null && perfGap < -20
            ? "stai sotto-rendendo"
            : "performance allineata al rating"
        }
        bottomTone={
          perfGap != null && perfGap > 20
            ? "good"
            : perfGap != null && perfGap < -20
            ? "bad"
            : "mute"
        }
      />

      {/* KPI #3 — Precisione (ACPL) */}
      <SecondaryKpi
        title={
          <>
            Precisione ·{" "}
            <Help label="ACPL" text={GLOSS.acpl} /> ultime 30
          </>
        }
        valueLine={kpi.acpl_recent.toFixed(1)}
        valueSub={
          <span>
            era{" "}
            <span className="text-slate-200 tabular-nums">
              {kpi.acpl_previous.toFixed(1)}
            </span>{" "}
            nelle 30 precedenti
          </span>
        }
        bottomLine={acplTrendLabel(kpi.acpl_delta)}
        bottomTone={
          kpi.acpl_delta == null
            ? "mute"
            : kpi.acpl_delta < -0.5
            ? "good"
            : kpi.acpl_delta > 0.5
            ? "bad"
            : "mute"
        }
      />

      {/* KPI #4 — Errori gravi (full row sotto) */}
      <div className="card lg:col-span-4">
        <div className="card-title flex items-center gap-1.5">
          Errori gravi · <Help label="blunder" text={GLOSS.blunder} />
        </div>
        <div className="grid grid-cols-3 gap-4 mt-2">
          <BigStat
            value={`${blunderPct.toFixed(2)}%`}
            label="delle tue mosse"
            sub={`${kpi.total_blunders} blunder totali`}
          />
          <BigStat
            value={`${totalWins}/${totalGames}`}
            label="vittorie"
            sub={`${winRate.toFixed(0)}% win rate`}
          />
          <BigStat
            value={`${kpi.games_analyzed}`}
            label="partite analizzate"
            sub="con Stockfish 17"
          />
        </div>
      </div>
    </div>
  );
}

function acplTrendLabel(delta: number | null): string {
  if (delta == null) return "primo periodo, nessun confronto";
  if (delta < -0.5) return `migliorato di ${Math.abs(delta).toFixed(1)} punti`;
  if (delta > 0.5) return `peggiorato di ${delta.toFixed(1)} punti`;
  return "stabile";
}

function SecondaryKpi({
  title,
  valueLine,
  valueSub,
  bottomLine,
  bottomTone,
}: {
  title: React.ReactNode;
  valueLine: string;
  valueSub: React.ReactNode;
  bottomLine: string;
  bottomTone: "good" | "bad" | "mute";
}) {
  const toneClass =
    bottomTone === "good"
      ? "text-green-300"
      : bottomTone === "bad"
      ? "text-red-300"
      : "text-slate-400";

  return (
    <div className="card flex flex-col">
      <div className="card-title flex items-center gap-1.5">{title}</div>
      <div className="kpi-value mt-2 tabular-nums">{valueLine}</div>
      <div className="kpi-sub mt-1">{valueSub}</div>
      <div
        className={`text-xs mt-auto pt-3 border-t border-[color:var(--color-line)] ${toneClass}`}
      >
        {bottomLine}
      </div>
    </div>
  );
}

function BigStat({
  value,
  label,
  sub,
}: {
  value: string;
  label: string;
  sub?: string;
}) {
  return (
    <div className="border border-[color:var(--color-line)] rounded-lg p-3">
      <div className="text-xl font-semibold tabular-nums">{value}</div>
      <div className="text-[11px] uppercase tracking-widest text-slate-500 mt-1">
        {label}
      </div>
      {sub && <div className="text-xs text-slate-400 mt-1">{sub}</div>}
    </div>
  );
}
