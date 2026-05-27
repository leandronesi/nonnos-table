import type { Identity, Kpi } from "../types";

/**
 * Player stat card: sotto il profilo.
 *
 * Qui mostriamo i numeri duri del
 * goal: ritmo, proiezione, ratings per cadenza. Layout a 4 stat in grid.
 */
export function PlayerCard({ identity, kpi }: { identity: Identity; kpi: Kpi }) {
  const goal = identity.goal;
  const ratings = Object.entries(identity.rating_by_time_class);
  const onTrack = goal.on_track;

  return (
    <div className="surface surface-padded fade-in fade-in-delay-1">
      <div className="flex items-baseline justify-between flex-wrap gap-3 mb-4">
        <div className="flex items-baseline gap-3">
          <span className="label-eyebrow">Target - {goal.time_class} entro {goal.deadline}</span>
          <span className={`pill ${onTrack ? "pill-good" : "pill-bad"}`}>
            <span className="dot" style={{ background: onTrack ? "#34d399" : "#f43f5e" }} />
            {onTrack ? "IN LINEA" : "DIETRO"}
          </span>
        </div>
        <div className="flex gap-1.5 flex-wrap">
          {ratings.map(([tc, r]) => (
            <div key={tc} className="pill">
              <span className="text-[color:var(--color-muted)] uppercase">{tc}</span>
              <span className="text-[color:var(--color-text)] tabular-nums font-semibold">{r}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Stat
          label="Punti mancanti"
          value={`${goal.points_needed}`}
          sub={`per arrivare a ${goal.target}`}
        />
        <Stat
          label="Giorni rimasti"
          value={`${goal.days_left}`}
          sub={`scadenza ${goal.deadline}`}
        />
        <Stat
          label="Ritmo richiesto"
          value={goal.rate_per_day_needed != null ? `${goal.rate_per_day_needed}` : "-"}
          sub="pt al giorno"
          tone={onTrack ? "ok" : "bad"}
        />
        <Stat
          label="Ritmo attuale"
          value={goal.rate_per_day_so_far != null ? `${goal.rate_per_day_so_far}` : "-"}
          sub={`proiezione ${goal.projection_at_deadline ?? "-"}`}
          tone={onTrack ? "ok" : "neutral"}
        />
      </div>

      <div className="hairline mt-5" />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mt-5 text-sm">
        <KpiInline label="Posizioni critiche" value={kpi.critical_positions.toString()} />
        <KpiInline
          label="Blunder critici"
          value={`${kpi.blunders_critical}`}
          sub={`${kpi.avoidable_blunders} evitabili`}
        />
        <KpiInline
          label="Accordo MAIA"
          value={kpi.agreement_maia_mine_pct != null ? `${Math.round(kpi.agreement_maia_mine_pct * 100)}%` : "-"}
          sub={kpi.agreement_maia_target_pct != null ? `${Math.round(kpi.agreement_maia_target_pct * 100)}% vs target` : ""}
        />
        <KpiInline
          label="ACPL ultime 30"
          value={kpi.acpl_recent_30 != null ? `${kpi.acpl_recent_30}` : "-"}
          sub={kpi.acpl_delta != null
            ? `${kpi.acpl_delta > 0 ? "+" : ""}${kpi.acpl_delta} vs prec`
            : "primo periodo"}
        />
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  sub,
  tone = "neutral",
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: "ok" | "bad" | "neutral";
}) {
  const tc = tone === "ok" ? "text-emerald-300" : tone === "bad" ? "text-rose-300" : "text-[color:var(--color-text)]";
  return (
    <div className="stat">
      <div className="stat-label">{label}</div>
      <div className={`stat-value ${tc}`}>{value}</div>
      {sub && <div className="stat-sub">{sub}</div>}
    </div>
  );
}

function KpiInline({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div>
      <div className="label-eyebrow">{label}</div>
      <div className="display-tiny tabular-nums mt-1">{value}</div>
      {sub && <div className="text-[11px] mono text-[color:var(--color-muted)] mt-0.5">{sub}</div>}
    </div>
  );
}
