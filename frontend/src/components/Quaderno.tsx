import { useEffect, useMemo, useState } from "react";
import { X, Database, Target, Sparkles, Library, TrendingUp } from "lucide-react";
import type { PlayerModel, PositionRow, PatternEvolution, PatternWeeklyPoint, RecentProgressionWindow } from "../types";
import { BoardView } from "./BoardView";
import { PlayerCard } from "./PlayerCard";
import { WeeklyTrendCard } from "./WeeklyTrendCard";
import { DecisionsCard } from "./DecisionsCard";
import { TacticalBreakdownCard } from "./TacticalBreakdownCard";
import { BlindSpotsList } from "./BlindSpotsList";
import { DiagnosisList } from "./DiagnosisList";
import { RatingCurveChart } from "./RatingCurveChart";
import { CoachNarrative } from "./CoachNarrative";
import { RepertoireCard } from "./RepertoireCard";
import { PlaySession } from "./PlaySession";
import { squaresOfSan, turnFromFen } from "../chess-utils";

type QuadernoTab = "dati" | "cadute" | "storia" | "repertorio" | "evoluzione";

export function Quaderno({ pm, onClose }: { pm: PlayerModel; onClose: () => void }) {
  // Ordine narrativo (default = Evoluzione, perché la prima cosa che vedi
  // del Quaderno è "come stai cambiando"):
  //   Evoluzione → Storia → Cadute → Repertorio → Dati (backstage tecnico in fondo)
  const [tab, setTab] = useState<QuadernoTab>("evoluzione");

  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [onClose]);

  return (
    <div
      className="quaderno-overlay"
      role="dialog"
      aria-modal="true"
      aria-label="Quaderno"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="quaderno-panel">
        <header className="quaderno-header">
          <div className="quaderno-title">
            <h2>Quaderno</h2>
            <span className="quaderno-subtitle">Il coach tiene tutto qui</span>
          </div>
          <button className="quaderno-close" onClick={onClose} aria-label="Chiudi quaderno">
            <X size={20} />
          </button>
        </header>

        <nav className="quaderno-tabs" role="tablist">
          <button role="tab" aria-selected={tab === "evoluzione"} className={tab === "evoluzione" ? "active" : ""} onClick={() => setTab("evoluzione")}>
            <TrendingUp size={14} /> Evoluzione
          </button>
          <button role="tab" aria-selected={tab === "storia"} className={tab === "storia" ? "active" : ""} onClick={() => setTab("storia")}>
            <Sparkles size={14} /> Storia
          </button>
          <button role="tab" aria-selected={tab === "cadute"} className={tab === "cadute" ? "active" : ""} onClick={() => setTab("cadute")}>
            <Target size={14} /> Cadute
          </button>
          <button role="tab" aria-selected={tab === "repertorio"} className={tab === "repertorio" ? "active" : ""} onClick={() => setTab("repertorio")}>
            <Library size={14} /> Repertorio
          </button>
          <button role="tab" aria-selected={tab === "dati"} className={tab === "dati" ? "active" : ""} onClick={() => setTab("dati")}>
            <Database size={14} /> Dati
          </button>
        </nav>

        <main className="quaderno-content">
          {tab === "evoluzione" && <EvoluzioneTab pm={pm} />}
          {tab === "storia" && <StoriaTab pm={pm} />}
          {tab === "cadute" && <CaduteTab pm={pm} />}
          {tab === "repertorio" && <RepertorioTab pm={pm} />}
          {tab === "dati" && <DatiTab pm={pm} />}
        </main>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tab: Cadute — cluster per pattern (R1-A6)
// ---------------------------------------------------------------------------

interface Cluster {
  key: string;
  label_it: string;
  positions: PositionRow[];
  description: string;
}

const MOTIF_CONFIG: { key: keyof PositionRow; clusterKey: string; label_it: string; description: string }[] = [
  { key: "motif_hanging_piece", clusterKey: "hanging_piece", label_it: "Pezzo in presa", description: "Lasci pezzi in presa dopo aver mosso un difensore. Soprattutto nel mediogioco." },
  { key: "motif_fork", clusterKey: "fork", label_it: "Forchetta", description: "Ti scappa la forchetta avversaria. Spesso dopo una tua mossa attiva." },
  { key: "motif_removed_defender", clusterKey: "removed_defender", label_it: "Rimozione del difensore", description: "Quando l'avversario toglie un tuo difensore, perdi il pezzo difeso." },
  { key: "motif_back_rank", clusterKey: "back_rank", label_it: "Ottava traversa", description: "L'ottava ti rimane scoperta. Attento al matto sulla riga di base." },
  { key: "motif_discovered_attack", clusterKey: "discovered_attack", label_it: "Attacco scoperto", description: "Quando muovi un pezzo, dietro c'è una linea che non vedi." },
];

const OTHER_CLUSTER = { clusterKey: "other", label_it: "Altre cadute", description: "Cadute senza un pattern tattico specifico." };

function buildClusters(pm: PlayerModel): Cluster[] {
  const source: PositionRow[] = pm.drills && pm.drills.length > 0 ? pm.drills : pm.turning_points;
  const buckets: Record<string, PositionRow[]> = {};
  for (const pos of source) {
    let assigned = false;
    for (const m of MOTIF_CONFIG) {
      const val = (pos as unknown as Record<string, unknown>)[m.key as string];
      if (Number(val) === 1) {
        if (!buckets[m.clusterKey]) buckets[m.clusterKey] = [];
        buckets[m.clusterKey].push(pos);
        assigned = true;
        break;
      }
    }
    if (!assigned) {
      if (!buckets[OTHER_CLUSTER.clusterKey]) buckets[OTHER_CLUSTER.clusterKey] = [];
      buckets[OTHER_CLUSTER.clusterKey].push(pos);
    }
  }
  const clusters: Cluster[] = [];
  for (const m of MOTIF_CONFIG) {
    const positions = buckets[m.clusterKey] ?? [];
    if (positions.length === 0) continue;
    clusters.push({
      key: m.clusterKey, label_it: m.label_it, description: m.description,
      positions: [...positions].sort((a, b) => b.cp_loss - a.cp_loss),
    });
  }
  const others = buckets[OTHER_CLUSTER.clusterKey] ?? [];
  if (others.length > 0) {
    clusters.push({
      key: OTHER_CLUSTER.clusterKey, label_it: OTHER_CLUSTER.label_it, description: OTHER_CLUSTER.description,
      positions: [...others].sort((a, b) => b.cp_loss - a.cp_loss),
    });
  }
  clusters.sort((a, b) => {
    if (a.key === OTHER_CLUSTER.clusterKey) return 1;
    if (b.key === OTHER_CLUSTER.clusterKey) return -1;
    return b.positions.length - a.positions.length;
  });
  return clusters;
}

function formatDateIt(dateStr: string | null): string {
  if (!dateStr) return "—";
  try {
    const d = new Date(dateStr);
    return d.toLocaleDateString("it-IT", { day: "numeric", month: "short" });
  } catch { return dateStr; }
}

function PositionMiniCard({ pos }: { pos: PositionRow }) {
  const fen = pos.fen_before;
  const orientation = pos.my_color ?? turnFromFen(fen);
  const played = fen && pos.san ? squaresOfSan(fen, pos.san) : null;
  const best = fen && pos.best_san_sf ? squaresOfSan(fen, pos.best_san_sf) : null;
  const highlights = [
    ...(pos.last_opp_from && pos.last_opp_to
      ? [{ square: pos.last_opp_from, color: "#fde04755" }, { square: pos.last_opp_to, color: "#fde04788" }]
      : []),
    ...(played ? [{ square: played.from, color: "#f43f5e66" }, { square: played.to, color: "#f43f5e" }] : []),
    ...(best ? [{ square: best.from, color: "#34d39966" }, { square: best.to, color: "#34d399" }] : []),
  ];
  const arrows = [
    ...(pos.last_opp_from && pos.last_opp_to ? [{ from: pos.last_opp_from, to: pos.last_opp_to, color: "#fde047" }] : []),
    ...(played ? [{ from: played.from, to: played.to, color: "#f43f5e" }] : []),
    ...(best && best.from !== played?.from ? [{ from: best.from, to: best.to, color: "#34d399" }] : []),
  ];
  const spent = pos.spent_seconds != null ? `${Math.round(pos.spent_seconds)}s` : null;
  return (
    <div className="cluster-position-card">
      <div className="cluster-position-board">
        <BoardView fen={fen} size={220} orientation={orientation} highlights={highlights} arrows={arrows} />
      </div>
      <div className="cluster-position-meta">
        <span className="cluster-position-date">{formatDateIt(pos.date)} · vs <strong>{pos.opp_rating ?? "?"}</strong></span>
        {spent && <span className="cluster-position-chip">{spent}</span>}
      </div>
      <div className="cluster-position-text">
        Hai giocato <span className="cluster-position-san-bad">{pos.san}</span>. Il giusto era{" "}
        <span className="cluster-position-san-good">{pos.best_san_sf ?? "…"}</span>.
      </div>
    </div>
  );
}

function ClusterRow({ cluster, expanded, onToggle }: { cluster: Cluster; expanded: boolean; onToggle: () => void }) {
  return (
    <div className={`cluster-row${expanded ? " cluster-row-expanded" : ""}`}>
      <button className="cluster-row-header" onClick={onToggle} aria-expanded={expanded}>
        <span className="cluster-row-chevron" aria-hidden="true">{expanded ? "▼" : "▶"}</span>
        <span className="cluster-row-label">{cluster.label_it}</span>
        <span className="cluster-row-count">{cluster.positions.length} {cluster.positions.length === 1 ? "esempio" : "esempi"}</span>
      </button>
      {expanded && (
        <div className="cluster-row-body">
          <p className="cluster-description">{cluster.description}</p>
          <div className="cluster-positions-grid">
            {cluster.positions.map((pos) => (
              <PositionMiniCard key={`${pos.game_id}:${pos.ply}`} pos={pos} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function CaduteTab({ pm }: { pm: PlayerModel }) {
  const [expandedCluster, setExpandedCluster] = useState<string | null>(null);
  const clusters = useMemo(() => buildClusters(pm), [pm]);
  if (clusters.length === 0) {
    return (
      <div className="cadute-tab">
        <p style={{ color: "var(--color-text-soft)", fontSize: "0.875rem" }}>
          Nessuna caduta disponibile.
        </p>
      </div>
    );
  }
  return (
    <div className="cadute-tab">
      <div className="quaderno-eyebrow mb-3">I pattern delle tue cadute</div>
      <div className="cadute-clusters">
        {clusters.map((c) => (
          <ClusterRow key={c.key} cluster={c} expanded={expandedCluster === c.key}
            onToggle={() => setExpandedCluster(expandedCluster === c.key ? null : c.key)} />
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tab: Evoluzione — pattern tracking visibile con sparkline (R1-A7)
// ---------------------------------------------------------------------------

function EvoluzioneTab({ pm }: { pm: PlayerModel }) {
  const gd = pm.growth_delta;
  const rp = pm.identity.goal.recent_progression;
  const currentRating = pm.identity.goal.current_rating;
  const target = pm.identity.goal.target;
  const timeClass = pm.identity.goal.time_class || "blitz";

  return (
    <div className="evoluzione-tab quaderno-tab-body">
      {/* 1. Rating attuale — la prima cosa che vedi */}
      <section className="quaderno-section">
        <div className="quaderno-eyebrow">Rating attuale ({timeClass})</div>
        <div className="evol-rating-block">
          <div className="evol-rating-current">
            <span className="evol-rating-now">{currentRating ?? "—"}</span>
            <span className="evol-rating-arrow">→</span>
            <span className="evol-rating-target">{target}</span>
          </div>
          <div className="evol-rating-meta">{pm.identity.goal.points_needed} punti al target</div>
        </div>
      </section>

      {/* 2. Progressione 10 / 30 / 60 / 90 giorni — cosa è successo di recente */}
      {rp && (
        <section className="quaderno-section">
          <div className="quaderno-eyebrow">Progressione recente</div>
          <div className="progression-windows">
            <WindowCard label="Ultimi 10 giorni" data={rp.last_10d} />
            <WindowCard label="Ultimi 30 giorni" data={rp.last_30d} />
            <WindowCard label="Ultimi 90 giorni" data={rp.last_90d} />
          </div>
        </section>
      )}

      {/* 3. Pattern evolution con sparkline */}
      <section className="quaderno-section">
        <div className="quaderno-eyebrow">Come stai cambiando, pattern per pattern</div>
        <EvoluzionePatterns gd={gd} />
      </section>
    </div>
  );
}

function EvoluzionePatterns({ gd }: { gd?: import("../types").GrowthDelta }) {
  if (!gd || !gd.available) {
    return (
      <div className="quaderno-empty">
        Servono più partite per misurare l'evoluzione dei pattern. Continua a giocare.
      </div>
    );
  }
  const patterns = (gd.patterns ?? []).filter((p) => p.weekly_series && p.weekly_series.length > 0);
  if (patterns.length === 0) {
    return (
      <div className="quaderno-empty">
        Servono qualche settimana di partite in più per disegnare la traiettoria dei pattern.
      </div>
    );
  }
  return (
    <>
      {patterns.map((p) => (
        <PatternRow key={p.key} pattern={p} />
      ))}
    </>
  );
}

function PatternRow({ pattern: p }: { pattern: PatternEvolution }) {
  const delta = p.current_share - p.previous_share;
  const deltaPct = Math.round(Math.abs(delta) * 100);
  const isImproving = p.trend === "improving";
  const isWorsening = p.trend === "worsening";
  return (
    <div className="pattern-row">
      <div className="pattern-row-header">
        <span className="pattern-label">{p.label_it}</span>
        <span className={"pattern-trend-arrow" + (isImproving ? " pattern-trend-improving" : isWorsening ? " pattern-trend-worsening" : " pattern-trend-stable")}>
          {isImproving ? "↘" : isWorsening ? "↗" : "→"}
          {deltaPct > 0 ? ` ${isImproving ? "-" : "+"}${deltaPct}pt` : ""}
        </span>
      </div>
      <div className="pattern-row-detail">
        <span className="pattern-shares">
          {Math.round(p.previous_share * 100)}% → {Math.round(p.current_share * 100)}%
        </span>
        <div className="pattern-sparkline">
          <Sparkline data={p.weekly_series} />
        </div>
      </div>
      {p.phrase_hint && <div className="pattern-phrase">"{p.phrase_hint}"</div>}
    </div>
  );
}

function Sparkline({ data }: { data: PatternWeeklyPoint[] }) {
  const W = 120, H = 28, PAD = 3;
  if (data.length < 2) return null;
  const values = data.map((d) => d.share);
  const minV = Math.min(...values);
  const maxV = Math.max(...values);
  const range = maxV - minV || 1;
  const pts = data.map((d, i) => ({
    x: PAD + ((W - PAD * 2) * i) / (data.length - 1),
    y: PAD + (H - PAD * 2) * (1 - (d.share - minV) / range),
  }));
  const polyline = pts.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
  const last = pts[pts.length - 1];
  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} className="pattern-sparkline-svg" aria-hidden="true">
      <polyline points={polyline} fill="none" stroke="var(--color-gold-soft)" strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={last.x.toFixed(1)} cy={last.y.toFixed(1)} r="3" fill="var(--color-gold)" />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Tab: Dati
// ---------------------------------------------------------------------------

function DatiTab({ pm }: { pm: PlayerModel }) {
  // NB: Trend settimanale e Curva Elo vivono in Storia. Qui solo KPI raw
  // + decisions + tactical + speed-vs-errors (backstage tecnico, no narrativa).
  return (
    <div className="quaderno-tab-body">
      <section className="quaderno-section">
        <div className="quaderno-eyebrow">Identità e obiettivo</div>
        <PlayerCard identity={pm.identity} kpi={pm.kpi} />
      </section>
      <section className="quaderno-section">
        <div className="quaderno-eyebrow">KPI chiave</div>
        <div className="quaderno-kpi-grid">
          <KpiStat label="Posizioni critiche" value={String(pm.kpi.critical_positions)} />
          <KpiStat label="Blunder critici" value={String(pm.kpi.blunders_critical)} />
          <KpiStat label="Blunder evitabili" value={String(pm.kpi.avoidable_blunders)} tone="hot" />
          <KpiStat label="ACPL su critiche" value={pm.kpi.avg_cp_loss_on_critical != null ? String(Math.round(pm.kpi.avg_cp_loss_on_critical)) : "-"} />
          {pm.kpi.agreement_maia_mine_pct != null && <KpiStat label="MAIA accord. (mio)" value={`${Math.round(pm.kpi.agreement_maia_mine_pct * 100)}%`} />}
          {pm.kpi.agreement_maia_target_pct != null && <KpiStat label="MAIA accord. (target)" value={`${Math.round(pm.kpi.agreement_maia_target_pct * 100)}%`} />}
        </div>
      </section>
      <section className="quaderno-section">
        <div className="quaderno-eyebrow">Decisioni vs risultato</div>
        <DecisionsCard decisions={pm.decisions} />
      </section>
      {pm.tactical_breakdown && pm.tactical_breakdown.length > 0 && (
        <section className="quaderno-section">
          <div className="quaderno-eyebrow">Motivi tattici</div>
          <TacticalBreakdownCard items={pm.tactical_breakdown} />
        </section>
      )}
      {pm.blind_spots && pm.blind_spots.length > 0 && (
        <section className="quaderno-section">
          <div className="quaderno-eyebrow">Errori per conseguenza</div>
          <BlindSpotsList blind_spots={pm.blind_spots} />
        </section>
      )}
      {pm.diagnoses && pm.diagnoses.length > 0 && (
        <section className="quaderno-section">
          <div className="quaderno-eyebrow">Diagnosi</div>
          <DiagnosisList diagnoses={pm.diagnoses} />
        </section>
      )}
    </div>
  );
}

function KpiStat({ label, value, tone = "default" }: { label: string; value: string; tone?: "default" | "hot" | "good" }) {
  return (
    <div className={`quaderno-kpi-stat quaderno-kpi-${tone}`}>
      <span className="quaderno-kpi-label">{label}</span>
      <strong className="quaderno-kpi-value">{value}</strong>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tab: Storia
// ---------------------------------------------------------------------------

function StoriaTab({ pm }: { pm: PlayerModel }) {
  // NB: la Progressione 10/30/90gg vive in Evoluzione (tab default, è la prima
  // cosa che l'utente deve vedere quando apre il Quaderno).
  return (
    <div className="quaderno-tab-body">
      {pm.trend_weekly && (
        <section className="quaderno-section">
          <div className="quaderno-eyebrow">Trend settimanale</div>
          <WeeklyTrendCard trend={pm.trend_weekly} />
        </section>
      )}
      <section className="quaderno-section">
        <div className="quaderno-eyebrow">Curva Elo</div>
        <RatingCurveChart ratingCurve={pm.rating_curve} goal={pm.identity.goal} />
      </section>
      {pm.coach_artifacts && (
        <section className="quaderno-section">
          <div className="quaderno-eyebrow">Coach diary</div>
          <CoachNarrative {...pm.coach_artifacts} />
        </section>
      )}
    </div>
  );
}

function WindowCard({ label, data }: { label: string; data: RecentProgressionWindow }) {
  if (!data.available) {
    return (
      <div className="window-card">
        <div className="window-card-label">{label}</div>
        <div className="window-card-delta window-card-delta-neutral">—</div>
        <div className="window-card-meta">dati insufficienti</div>
      </div>
    );
  }
  const delta = data.delta ?? 0;
  const cls = delta > 0 ? "window-card-delta-pos" : delta < 0 ? "window-card-delta-neg" : "window-card-delta-neutral";
  const sign = delta > 0 ? "+" : "";
  return (
    <div className="window-card">
      <div className="window-card-label">{label}</div>
      <div className={`window-card-delta ${cls}`}>{sign}{delta}</div>
      <div className="window-card-meta">{data.games} partite</div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tab: Repertorio
// ---------------------------------------------------------------------------

function RepertorioTab({ pm }: { pm: PlayerModel }) {
  const [playPosition, setPlayPosition] = useState<PositionRow | null>(null);
  const hasRepertoire =
    (pm.repertoire_black && pm.repertoire_black.length > 0) ||
    (pm.repertoire_white && pm.repertoire_white.length > 0);
  return (
    <div className="quaderno-tab-body">
      {hasRepertoire ? (
        <section className="quaderno-section">
          <div className="quaderno-eyebrow">Aperture deboli: le posizioni che ti fregano</div>
          <div className="space-y-6">
            {pm.repertoire_black && pm.repertoire_black.length > 0 && (
              <div>
                <div className="label-eyebrow mb-3">Col Nero</div>
                <RepertoireCard openings={pm.repertoire_black} onPlay={(p) => setPlayPosition(p)} />
              </div>
            )}
            {pm.repertoire_white && pm.repertoire_white.length > 0 && (
              <div>
                <div className="label-eyebrow mb-3">Col Bianco</div>
                <RepertoireCard openings={pm.repertoire_white} onPlay={(p) => setPlayPosition(p)} />
              </div>
            )}
          </div>
        </section>
      ) : (
        <div className="quaderno-empty">
          Nessun dato di repertorio disponibile ancora. Servono almeno ~20 partite per apertura.
        </div>
      )}
      {playPosition && (
        <div className="fixed inset-0 z-60 bg-black/80 backdrop-blur-sm overflow-auto"
          onClick={(e) => { if (e.target === e.currentTarget) setPlayPosition(null); }}>
          <div className="min-h-full flex items-start justify-center p-4 lg:p-10">
            <div className="w-full max-w-[1100px]">
              <PlaySession
                startFen={playPosition.fen_before}
                startSan={playPosition.san}
                myColor={(playPosition.my_color || "white") as "white" | "black"}
                context={{
                  date: playPosition.date ?? undefined,
                  opp_rating: playPosition.opp_rating,
                  opening: playPosition.opening,
                  eco: playPosition.eco,
                }}
                onClose={() => setPlayPosition(null)}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
