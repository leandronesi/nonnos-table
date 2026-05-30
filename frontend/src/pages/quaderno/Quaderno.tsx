/**
 * Quaderno — backstage navigabile a tab.
 *
 * STRUTTURA:
 *   Tab 1 — EVOLUZIONE : punti deboli nel tempo (anchorTrendsFromHistory o trend_now)
 *                         + proiezione obiettivo da goalProgress()
 *   Tab 2 — TRAGUARDI  : computeMilestones() → raggiunti + in corso (barra)
 *   Tab 3 — STORIA     : RatingCurveChart + timeline diario coach_journal.md
 *   Tab 4 — PROFILO    : tagli analitici (decisions, time_management, tilt, by_color/phase)
 *   Tab 5 — CADUTE     : galleria posizioni (Cadute riusata come pannello)
 *   Tab 6 — REPERTORIO : RepertorioPanel
 *
 * Cross-link OOUX:
 *   Ancora (Evoluzione) -> filtra Cadute per motif/tipo
 *   Caduta -> mostra apertura (eco/opening)
 *
 * Route deep-link via URL hash: #evoluzione | #traguardi | #storia | #profilo
 *                                            | #cadute   | #repertorio
 *
 * Invarianti DESIGN.md:
 *   - FLAT: tonal layers, niente ombre decorative
 *   - twilight <=15%, una CTA per schermo
 *   - ORO solo Obiettivo e rating_upside
 *   - niente gradient-text, em-dash, card-dentro-card
 *   - classi tt-* + .segment/.segment-item
 */

import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../../auth/AuthContext";
import { downloadJson, downloadText, quadernoPath } from "../../auth/storage";
import { PRODUCT_NAME } from "../../coaching";
import type { Aggregates, Anchor, PositionExample } from "../../pipeline/aggregate";
import type { PlayerModelLite } from "../../pipeline/playerModelLite";
import type { HistoryFile, Milestone } from "../../types";
import {
  readHistory,
  anchorTrendsFromHistory,
  computeMilestones,
  goalProgress,
} from "../../pipeline/history";
import { RatingCurveChart } from "../../components/RatingCurveChart";
import { DecisionsCard } from "../../components/DecisionsCard";
import { WeeklyTrendCard } from "../../components/WeeklyTrendCard";
import { SpeedVsErrorsChart } from "../../components/SpeedVsErrorsChart";
import { BoardView } from "../../components/BoardView";
import { RepertorioPanel } from "../../components/RepertorioPanel";
import { CaduteTrainer } from "../../session/CaduteTrainer";
import { uciToArrow, cpToPawns, uciToSan } from "./boardArrows";

// ── Tab definition ─────────────────────────────────────────────────────────────

type TabKey = "evoluzione" | "traguardi" | "storia" | "profilo" | "cadute" | "repertorio";

const TABS: { key: TabKey; label: string }[] = [
  { key: "evoluzione",  label: "Evoluzione"  },
  { key: "traguardi",   label: "Traguardi"   },
  { key: "storia",      label: "Storia"      },
  { key: "profilo",     label: "Profilo"     },
  { key: "cadute",      label: "Cadute"      },
  { key: "repertorio",  label: "Repertorio"  },
];

function tabFromHash(): TabKey {
  const h = typeof window !== "undefined" ? window.location.hash.replace("#", "") : "";
  return TABS.some((t) => t.key === h) ? (h as TabKey) : "evoluzione";
}

// ── Motif label map ────────────────────────────────────────────────────────────

const MOTIF_LABEL: Record<string, string> = {
  pezzo_in_presa: "Pezzo in presa",
};

// ── Italian date helpers ───────────────────────────────────────────────────────

const MONTHS_IT = [
  "gen","feb","mar","apr","mag","giu","lug","ago","set","ott","nov","dic",
];

function dateIt(iso: string): string {
  try {
    const d = new Date(iso);
    return `${d.getDate()} ${MONTHS_IT[d.getMonth()]} ${d.getFullYear()}`;
  } catch { return iso.slice(0, 10); }
}

function weekToLabel(week_iso: string): string {
  // "2026-W22" → simple label
  return week_iso.replace("-W", " sett. ");
}

// ── Reveal ─────────────────────────────────────────────────────────────────────

function useReveal(ref: React.RefObject<HTMLElement | null>) {
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting) { el.classList.add("in"); io.disconnect(); } },
      { threshold: 0.06 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [ref]);
}

function Reveal({ children, delay = 0, className = "" }: {
  children: React.ReactNode; delay?: number; className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useReveal(ref);
  return (
    <div ref={ref} className={`tt-reveal ${className}`}
      style={delay ? { transitionDelay: `${delay}ms` } : undefined}>
      {children}
    </div>
  );
}

// ── CATEGORY PILL colors ──────────────────────────────────────────────────────

const CATEGORY_PILL: Record<string, { bg: string; color: string }> = {
  tattica:       { bg: "rgba(244,63,94,0.12)",  color: "var(--color-danger)" },
  timing:        { bg: "rgba(251,146,60,0.12)", color: "var(--color-warn, #f5a524)" },
  tecnica:       { bg: "rgba(161,139,255,0.14)", color: "var(--color-brand-soft)" },
  comportamento: { bg: "rgba(96,165,250,0.12)", color: "var(--color-info)" },
};
const DEFAULT_PILL = { bg: "rgba(255,255,255,0.07)", color: "var(--color-text-soft)" };

// ── Mini sparkline (SVG, no dep) ──────────────────────────────────────────────

function MiniSparkline({ points, improving }: { points: number[]; improving: boolean }) {
  if (points.length < 2) return null;
  const W = 80, H = 22, PAD = 2;
  const min = Math.min(...points);
  const max = Math.max(...points);
  const range = max - min || 1;
  const pts = points.map((v, i) => ({
    x: PAD + ((W - PAD * 2) * i) / (points.length - 1),
    y: PAD + (H - PAD * 2) * (1 - (v - min) / range),
  }));
  const polyline = pts.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
  const last = pts[pts.length - 1];
  const lineColor = improving ? "var(--color-ok)" : "var(--color-danger)";
  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} aria-hidden="true"
      style={{ display: "block", flexShrink: 0 }}>
      <polyline points={polyline} fill="none" stroke={lineColor}
        strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={last.x.toFixed(1)} cy={last.y.toFixed(1)} r="3" fill={lineColor} />
    </svg>
  );
}

// ── Section wrapper ───────────────────────────────────────────────────────────

function Section({ children, eyebrow, delay = 0 }: {
  children: React.ReactNode; eyebrow?: string; delay?: number;
}) {
  return (
    <Reveal delay={delay} className="mb-8">
      <div
        style={{
          background: "var(--color-surface)",
          border: "1px solid var(--color-line)",
          borderRadius: "14px",
          padding: "clamp(18px,4vw,28px)",
        }}
      >
        {eyebrow && (
          <div className="tt-eyebrow" style={{ marginBottom: "1rem", color: "var(--color-muted)" }}>
            {eyebrow}
          </div>
        )}
        {children}
      </div>
    </Reveal>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// TAB: EVOLUZIONE
// ─────────────────────────────────────────────────────────────────────────────

function TabEvoluzione({
  aggregates,
  pmLite,
  history,
  onSelectAnchor,
}: {
  aggregates: Aggregates | null;
  pmLite: PlayerModelLite | null;
  history: HistoryFile;
  onSelectAnchor: (anchorType: string) => void;
}) {
  const goal = pmLite?.identity?.goal ?? null;
  const anchors: Anchor[] = aggregates?.anchors ?? [];
  const sortedAnchors = [...anchors].sort((a, b) => (b.rating_upside ?? 0) - (a.rating_upside ?? 0));

  // anchorTrendsFromHistory (>=2 snapshots) or fall back to trend_now
  const historySeries = history.snapshots.length >= 2
    ? anchorTrendsFromHistory(history)
    : null;

  const gp = goal ? goalProgress(goal) : null;

  const hasAnchors = sortedAnchors.length > 0;

  // Build Nonno's intro for Evoluzione based on available data
  const evolNonno = (() => {
    if (!hasAnchors) return "Non ho ancora abbastanza partite per disegnare il tuo profilo. Gioca, poi torni qui.";
    const top = sortedAnchors[0];
    const trendNow = top.trend_now;
    const improving = trendNow?.direction === "improving" && (trendNow.confidence === "medium" || trendNow.confidence === "high");
    if (improving) {
      return `Stai migliorando su "${top.label_it}". Il grafico lo conferma. Continua cosi'.`;
    }
    if (gp && !gp.on_track) {
      return `Sei fuori rotta verso il target. Le ancore qui sotto mostrano dove guadagnare piu' punti.`;
    }
    return `Queste sono le tue ancore: i pattern che, se impari a riconoscerli, valgono piu' punti. Cliccane una per vedere le posizioni collegate.`;
  })();

  return (
    <div>
      {/* Nonno voice */}
      <Reveal delay={0} className="mb-6">
        <p className="tt-nonno">{evolNonno}</p>
      </Reveal>

      {/* Proiezione obiettivo */}
      {gp != null && goal != null && (
        <Section eyebrow="Verso il tuo obiettivo" delay={0}>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "1.5rem", alignItems: "flex-start" }}>
            <div>
              <div style={{ fontSize: "0.82rem", color: "var(--color-text-soft)", marginBottom: "0.5rem" }}>
                Servono{" "}
                <span className="font-mono font-bold" style={{ color: "var(--color-text)", fontVariantNumeric: "tabular-nums" }}>
                  +{gp.rate_needed_per_week != null ? `${gp.rate_needed_per_week.toFixed(1)}/sett` : "n.d."}
                </span>
                {gp.rate_real_per_week != null && (
                  <>, vai a <span className="font-mono font-bold" style={{ color: gp.on_track ? "var(--color-ok)" : "var(--color-warn)", fontVariantNumeric: "tabular-nums" }}>
                    {gp.rate_real_per_week.toFixed(1)}
                  </span></>
                )}
                .
              </div>
              {gp.projection != null && (
                <div style={{ fontSize: "0.78rem", color: "var(--color-muted)", fontVariantNumeric: "tabular-nums" }}>
                  Proiezione alla scadenza:{" "}
                  <span className="font-mono font-bold" style={{ color: "var(--color-text)" }}>
                    {Math.round(gp.projection)}
                  </span>
                  {goal.target > 0 && (
                    <> su <span className="font-mono" style={{ color: "var(--color-gold-soft)" }}>{goal.target}</span></>
                  )}
                </div>
              )}
            </div>
            <span
              className="tt-chip"
              style={gp.on_track
                ? { color: "var(--color-ok)", background: "color-mix(in srgb, var(--color-ok) 12%, transparent)" }
                : { color: "var(--color-warn)", background: "color-mix(in srgb, var(--color-warn) 10%, transparent)" }
              }
            >
              {gp.on_track ? "In carreggiata" : "Fuori rotta"}
            </span>
          </div>
        </Section>
      )}

      {/* Ancore nel tempo */}
      {hasAnchors ? (
        <Section eyebrow="Le tue ancore nel tempo" delay={80}>
          <p style={{ fontSize: "0.82rem", color: "var(--color-muted)", marginBottom: "1.25rem", lineHeight: 1.5 }}>
            Ordinate per potenziale di guadagno. Cliccane una per vedere le cadute collegate.
          </p>
          {sortedAnchors.map((anchor, i) => {
            const series = historySeries?.[anchor.type];
            const hasSeries = series && series.length >= 2;
            const trendNow = anchor.trend_now ?? null;
            const hasDirection =
              trendNow != null &&
              (trendNow.confidence === "medium" || trendNow.confidence === "high");

            // Build sparkline from history mine_pct OR count values
            let sparkPoints: number[] | null = null;
            let sparkImproving = false;
            if (hasSeries) {
              const vals = series!.map((pt) => pt.count);
              sparkPoints = vals;
              // improving = count going down (fewer errors)
              sparkImproving = vals[vals.length - 1] < vals[0];
            } else if (hasDirection && trendNow) {
              sparkImproving = trendNow.direction === "improving";
            }

            const improving =
              (hasSeries && sparkImproving) ||
              (!hasSeries && hasDirection && trendNow?.direction === "improving");

            const pill = CATEGORY_PILL[anchor.category] ?? DEFAULT_PILL;

            return (
              <div
                key={anchor.type}
                onClick={() => onSelectAnchor(anchor.type)}
                style={{
                  display: "flex",
                  alignItems: "flex-start",
                  gap: "1rem",
                  padding: "0.875rem 0",
                  borderBottom: i < sortedAnchors.length - 1 ? "1px solid var(--color-line)" : undefined,
                  cursor: "pointer",
                  transition: "opacity 120ms",
                }}
                onMouseEnter={(e) => (e.currentTarget.style.opacity = "0.8")}
                onMouseLeave={(e) => (e.currentTarget.style.opacity = "1")}
              >
                {/* Rank */}
                <div style={{
                  flexShrink: 0, width: "1.75rem", height: "1.75rem",
                  borderRadius: "999px",
                  background: "var(--color-surface-3)",
                  border: "1px solid var(--color-line-strong)",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  fontFamily: "var(--font-mono)", fontWeight: 700,
                  fontSize: "0.72rem", color: "var(--color-brand-soft)",
                }}>
                  {i + 1}
                </div>

                {/* Label + meta */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 600, fontSize: "0.95rem", color: "var(--color-text)", lineHeight: 1.3, marginBottom: "0.375rem" }}>
                    {anchor.label_it}
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", flexWrap: "wrap" }}>
                    {anchor.rating_upside != null && anchor.rating_upside > 0 && (
                      <span className="tt-chip" style={{ color: "var(--color-gold-soft)", background: "color-mix(in srgb, var(--color-gold) 14%, transparent)" }}>
                        +{anchor.rating_upside} punti
                      </span>
                    )}
                    <span className="tt-chip" style={{ background: pill.bg, color: pill.color }}>
                      {anchor.category}
                    </span>
                    {hasSeries && improving && (
                      <span className="tt-chip good">in miglioramento</span>
                    )}
                    {hasSeries && !improving && (
                      <span className="tt-chip warn">ancora da lavorare</span>
                    )}
                    {!hasSeries && hasDirection && improving && (
                      <span className="tt-chip good">stai migliorando</span>
                    )}
                    {!hasSeries && !hasDirection && !hasSeries && (
                      <span className="tt-chip" style={{ color: "var(--color-faint)", background: "rgba(255,255,255,0.04)" }}>
                        prima misura
                      </span>
                    )}
                    <span className="font-mono" style={{ fontSize: "0.72rem", color: "var(--color-muted)", fontVariantNumeric: "tabular-nums" }}>
                      {anchor.count} {anchor.count === 1 ? "errore" : "errori"} in {anchor.games_with} {anchor.games_with === 1 ? "partita" : "partite"}
                    </span>
                  </div>

                  {/* History series text OR empty state */}
                  {hasSeries ? (
                    <div style={{ marginTop: "0.5rem", fontSize: "0.78rem", color: "var(--color-text-soft)", lineHeight: 1.4 }}>
                      {series!.length} punti nel tempo: {series![0].count} errori ({weekToLabel(series![0].week_iso)}) {sparkImproving ? "scesi a" : "saliti a"} {series![series!.length - 1].count} ({weekToLabel(series![series!.length - 1].week_iso)})
                    </div>
                  ) : !hasDirection ? (
                    <div style={{ marginTop: "0.5rem", fontSize: "0.78rem", color: "var(--color-faint)", lineHeight: 1.4 }}>
                      Prima misura registrata. Il trend appare dopo la prossima analisi.
                    </div>
                  ) : trendNow != null ? (
                    <div style={{ marginTop: "0.5rem", fontSize: "0.78rem", color: "var(--color-text-soft)", lineHeight: 1.4 }}>
                      {trendNow.recent_per_game != null && trendNow.prior_per_game != null
                        ? `Recente: ${trendNow.recent_per_game.toFixed(2)} errori/partita vs precedente: ${trendNow.prior_per_game.toFixed(2)}`
                        : "Dati parziali sulla finestra recente."
                      }
                    </div>
                  ) : null}
                </div>

                {/* Sparkline */}
                {sparkPoints && sparkPoints.length >= 2 && (
                  <div style={{ flexShrink: 0 }}>
                    <MiniSparkline points={sparkPoints} improving={sparkImproving} />
                  </div>
                )}

                {/* Arrow cross-link hint */}
                <div style={{ flexShrink: 0, color: "var(--color-faint)", fontSize: "0.75rem", paddingTop: "0.25rem" }}>
                  cadute
                </div>
              </div>
            );
          })}
        </Section>
      ) : (
        <Section delay={80}>
          <div style={{ color: "var(--color-muted)", fontSize: "0.88rem", textAlign: "center", padding: "2rem 0" }}>
            Ancora nessuna ancora rilevata. Torna dopo la prossima analisi.
          </div>
        </Section>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// TAB: TRAGUARDI
// ─────────────────────────────────────────────────────────────────────────────

// ── Traguardi helpers ─────────────────────────────────────────────────────────

/**
 * Builds Nonno's celebratory voice line for an achieved milestone.
 * The line acknowledges past thresholds and hints at the next one.
 */
function nonnoCelebration(
  topAchieved: Milestone,
  allAchievedSameType: Milestone[],
  nextInProgress: Milestone | null,
): string {
  if (topAchieved.type === "rating_gain") {
    const gained = topAchieved.evidence ?? 0;
    // List all passed thresholds of this type
    const passed = allAchievedSameType
      .map((m) => `+${m.threshold}`)
      .join(", ");
    const passedText = allAchievedSameType.length > 1
      ? `Hai gia' passato ${passed}.`
      : `Hai gia' passato il ${passed}.`;
    if (nextInProgress != null) {
      const nextPct = Math.round((nextInProgress.progress_pct ?? 0) * 100);
      return `Hai guadagnato ${gained} punti dall'inizio. ${passedText} Il +${nextInProgress.threshold} e' al ${nextPct}%.`;
    }
    return `Hai guadagnato ${gained} punti dall'inizio. ${passedText}`;
  }
  if (topAchieved.type === "gap_closed") {
    const pct = topAchieved.evidence ?? 0;
    if (nextInProgress != null) {
      const nextPct = Math.round((nextInProgress.progress_pct ?? 0) * 100);
      return `Hai chiuso il ${pct}% del gap verso il target. Il prossimo traguardo (${Math.round(nextInProgress.threshold * 100)}%) e' al ${nextPct}%.`;
    }
    return `Hai chiuso il ${pct}% del gap verso il target.`;
  }
  if (topAchieved.type === "anchor_improved") {
    if (nextInProgress != null) {
      return `${topAchieved.label_it}. ${nextInProgress.label_it} e' al ${Math.round((nextInProgress.progress_pct ?? 0) * 100)}%.`;
    }
    return topAchieved.label_it + ".";
  }
  if (topAchieved.type === "anchor_domata") {
    return `${topAchieved.label_it}. Un'ancora in meno.`;
  }
  if (topAchieved.type === "on_track") {
    return "Sei in carreggiata per raggiungere il target. Continua cosi'.";
  }
  return topAchieved.label_it + ".";
}

/**
 * Picks the single most relevant achieved milestone per type
 * (highest threshold achieved) and the single closest next-in-progress per type.
 *
 * Returns { topAchieved, nextInProgress } pairs to render — one "card" per type.
 */
function deduplicateMilestones(milestones: Milestone[]): Array<{
  topAchieved: Milestone;
  allAchievedSameType: Milestone[];
  nextInProgress: Milestone | null;
}> {
  // Group by type
  const byType = new Map<string, { achieved: Milestone[]; inProgress: Milestone[] }>();
  for (const m of milestones) {
    let grp = byType.get(m.type);
    if (!grp) { grp = { achieved: [], inProgress: [] }; byType.set(m.type, grp); }
    if (m.achieved) grp.achieved.push(m);
    else if (m.progress_pct != null && m.progress_pct < 1) grp.inProgress.push(m);
  }

  const result: Array<{
    topAchieved: Milestone;
    allAchievedSameType: Milestone[];
    nextInProgress: Milestone | null;
  }> = [];

  for (const [, grp] of byType) {
    if (grp.achieved.length === 0) continue;
    // Most relevant = highest threshold achieved
    const sorted = [...grp.achieved].sort((a, b) => b.threshold - a.threshold);
    const topAchieved = sorted[0];
    // Next in progress = closest to completion (highest progress_pct with threshold > topAchieved.threshold)
    const nextCandidates = grp.inProgress
      .filter((m) => m.threshold > topAchieved.threshold)
      .sort((a, b) => (b.progress_pct ?? 0) - (a.progress_pct ?? 0));
    const nextInProgress = nextCandidates[0] ?? null;
    result.push({ topAchieved, allAchievedSameType: grp.achieved, nextInProgress });
  }

  return result;
}

function TabTraguardi({
  milestones,
  historyLength,
}: {
  milestones: Milestone[];
  historyLength: number;
}) {
  // Dedup: one card per type, most relevant achieved + next in progress
  const dedupedCards = deduplicateMilestones(milestones);

  // Fallback: types with ONLY in-progress (no achieved) — show the closest one per type
  const achievedTypes = new Set(dedupedCards.map((c) => c.topAchieved.type));
  const onlyInProgress = milestones.filter(
    (m) => !m.achieved && !achievedTypes.has(m.type) && m.progress_pct != null && m.progress_pct < 1,
  );
  // Pick closest per type
  const inProgressByType = new Map<string, Milestone>();
  for (const m of onlyInProgress) {
    const cur = inProgressByType.get(m.type);
    if (!cur || (m.progress_pct ?? 0) > (cur.progress_pct ?? 0)) {
      inProgressByType.set(m.type, m);
    }
  }
  const onlyInProgressCards = [...inProgressByType.values()].sort(
    (a, b) => (b.progress_pct ?? 0) - (a.progress_pct ?? 0),
  );

  // Nonno voice for Traguardi
  const traguardiNonno = (() => {
    if (milestones.length === 0 || historyLength < 2) {
      return "I traguardi si costruiscono con il tempo. Ogni analisi aggiunge un punto alla storia.";
    }
    if (dedupedCards.length === 0 && onlyInProgressCards.length > 0) {
      return "Stai avvicinandoti. Il primo traguardo formale arriva presto.";
    }
    if (dedupedCards.length > 0) {
      return "Qui trovi quello che hai gia' costruito, e cosa viene dopo. Ogni traguardo e' una misura reale, non un badge.";
    }
    return "Continua a giocare. I traguardi arrivano con la continuita'.";
  })();

  if (milestones.length === 0 || (dedupedCards.length === 0 && onlyInProgressCards.length === 0)) {
    return (
      <div>
        <Reveal delay={0} className="mb-6">
          <p className="tt-nonno">{traguardiNonno}</p>
        </Reveal>
        <Section delay={60}>
          <div style={{ color: "var(--color-muted)", fontSize: "0.88rem", textAlign: "center", padding: "2rem 0" }}>
            {historyLength < 2
              ? "I traguardi si calcolano dopo la seconda analisi. Torna presto."
              : "Nessun traguardo ancora. Continua a giocare."}
          </div>
        </Section>
      </div>
    );
  }

  return (
    <div>
      {/* Nonno voice */}
      <Reveal delay={0} className="mb-6">
        <p className="tt-nonno">{traguardiNonno}</p>
      </Reveal>
      {/* ── Cards per achieved type ─────────────────────────────────────── */}
      {dedupedCards.map(({ topAchieved, allAchievedSameType, nextInProgress }, idx) => {
        const celebText = nonnoCelebration(topAchieved, allAchievedSameType, nextInProgress);
        const nextPct = nextInProgress != null ? Math.round((nextInProgress.progress_pct ?? 0) * 100) : null;

        return (
          <Section key={topAchieved.type} delay={idx * 60}>
            {/* Nonno's voice — the main text */}
            <div className="tt-nonno" style={{ marginBottom: nextInProgress ? "1.25rem" : 0, lineHeight: 1.65 }}>
              {celebText}
            </div>

            {/* "Next" progress bar if present */}
            {nextInProgress != null && nextPct != null && (
              <div>
                <div style={{
                  display: "flex", justifyContent: "space-between", alignItems: "baseline",
                  marginBottom: "0.5rem", gap: "0.5rem",
                }}>
                  <div style={{ fontSize: "0.82rem", color: "var(--color-text-soft)", lineHeight: 1.3 }}>
                    Prossimo: {nextInProgress.label_it}
                  </div>
                  <span className="font-mono font-bold" style={{
                    flexShrink: 0, fontSize: "0.82rem",
                    color: nextPct >= 75 ? "var(--color-ok)" : "var(--color-brand-soft)",
                    fontVariantNumeric: "tabular-nums",
                  }}>
                    {nextPct}%
                  </span>
                </div>
                <div style={{ height: "4px", borderRadius: "999px", background: "rgba(255,255,255,0.06)", overflow: "hidden" }}>
                  <div style={{
                    width: `${nextPct}%`, height: "100%", borderRadius: "999px",
                    background: nextPct >= 75 ? "var(--color-ok)" : nextPct >= 40 ? "var(--color-warn)" : "var(--color-brand-soft)",
                    transition: "width 600ms cubic-bezier(0.23,1,0.32,1)",
                  }} />
                </div>
              </div>
            )}

            {/* Past achieved thresholds (secondary, muted list) */}
            {allAchievedSameType.length > 1 && (
              <div style={{ marginTop: "0.875rem", display: "flex", flexWrap: "wrap", gap: "0.5rem" }}>
                {[...allAchievedSameType]
                  .sort((a, b) => a.threshold - b.threshold)
                  .map((m) => (
                    <span key={`${m.type}-${m.threshold}`}
                      className="tt-chip"
                      style={{ background: "color-mix(in srgb, var(--color-ok) 10%, transparent)", color: "var(--color-ok)" }}
                    >
                      {m.type === "rating_gain" ? `+${m.threshold} pt` :
                       m.type === "gap_closed"  ? `${Math.round(m.threshold * 100)}% gap` :
                       m.label_it}
                    </span>
                  ))}
              </div>
            )}
          </Section>
        );
      })}

      {/* ── Types that only have in-progress (no achieved yet) ─────────── */}
      {onlyInProgressCards.length > 0 && (
        <Section eyebrow="In corso" delay={dedupedCards.length * 60}>
          {onlyInProgressCards.map((m, i) => {
            const pct = Math.round((m.progress_pct ?? 0) * 100);
            return (
              <div key={`${m.type}-${m.threshold}`}
                style={{
                  padding: "0.875rem 0",
                  borderBottom: i < onlyInProgressCards.length - 1 ? "1px solid var(--color-line)" : undefined,
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: "0.5rem", gap: "0.5rem" }}>
                  <div style={{ fontWeight: 500, fontSize: "0.88rem", color: "var(--color-text)", lineHeight: 1.3 }}>
                    {m.label_it}
                  </div>
                  <span className="font-mono font-bold" style={{ flexShrink: 0, fontSize: "0.85rem", color: "var(--color-brand-soft)", fontVariantNumeric: "tabular-nums" }}>
                    {pct}%
                  </span>
                </div>
                <div style={{ height: "4px", borderRadius: "999px", background: "rgba(255,255,255,0.06)", overflow: "hidden" }}>
                  <div style={{
                    width: `${pct}%`, height: "100%", borderRadius: "999px",
                    background: pct >= 75 ? "var(--color-ok)" : pct >= 40 ? "var(--color-warn)" : "var(--color-brand-soft)",
                    transition: "width 600ms cubic-bezier(0.23,1,0.32,1)",
                  }} />
                </div>
              </div>
            );
          })}
        </Section>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// TAB: STORIA
// ─────────────────────────────────────────────────────────────────────────────

interface JournalEntry {
  date: string;
  text: string;
}

function parseJournal(raw: string): JournalEntry[] {
  const entries: JournalEntry[] = [];
  // Split on lines that look like "## YYYY-MM-DD" or "# YYYY-MM-DD" or "--- YYYY-MM-DD ---"
  const lines = raw.split(/\r?\n/);
  let current: { date: string; lines: string[] } | null = null;

  for (const line of lines) {
    // Match date header patterns
    const headerMatch =
      line.match(/^#{1,3}\s+(\d{4}-\d{2}-\d{2})/) ||
      line.match(/^---+\s+(\d{4}-\d{2}-\d{2})\s+---+/) ||
      line.match(/^\[(\d{4}-\d{2}-\d{2})\]/);

    if (headerMatch) {
      if (current && current.lines.length > 0) {
        entries.push({ date: current.date, text: current.lines.join("\n").trim() });
      }
      current = { date: headerMatch[1], lines: [] };
    } else if (current) {
      // Skip dividers
      if (!line.match(/^---+$/) && !line.match(/^===+$/)) {
        current.lines.push(line);
      }
    }
  }
  if (current && current.lines.length > 0) {
    entries.push({ date: current.date, text: current.lines.join("\n").trim() });
  }

  // Most recent first, then DEDUP voci identiche: il coach appende una nota a
  // ogni analisi, anche identica. Collassiamo i duplicati tenendo l'occorrenza
  // piu' recente, cosi' la Storia non e' "20 volte la stessa cosa".
  const ordered = entries.reverse();
  const seen = new Set<string>();
  return ordered.filter((e) => {
    const key = e.text.replace(/\s+/g, " ").trim();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** Render inline del markdown del diario (**grassetto**, _corsivo_) in nodi React. */
function renderInline(text: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  const regex = /(\*\*[^*]+\*\*|_[^_]+_)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let k = 0;
  while ((m = regex.exec(text)) !== null) {
    if (m.index > last) nodes.push(text.slice(last, m.index));
    const tok = m[0];
    if (tok.startsWith("**")) {
      nodes.push(
        <strong key={k++} style={{ color: "var(--color-text)", fontWeight: 700 }}>
          {tok.slice(2, -2)}
        </strong>,
      );
    } else {
      nodes.push(
        <em key={k++} style={{ fontStyle: "italic", color: "var(--color-muted)" }}>
          {tok.slice(1, -1)}
        </em>,
      );
    }
    last = m.index + tok.length;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
}

function TabStoria({
  pmLite,
  journalRaw,
}: {
  pmLite: PlayerModelLite | null;
  journalRaw: string | null;
}) {
  const goal = pmLite?.identity?.goal ?? null;
  const journalEntries = journalRaw ? parseJournal(journalRaw) : [];

  const storiaNonno = (() => {
    if (journalEntries.length === 0) {
      return "La curva di rating e' l'impronta del tuo percorso. Il diario arriva dopo la prima sessione di coaching.";
    }
    const last = journalEntries[0];
    if (last) {
      return `L'ultima nota e' del ${dateIt(last.date)}. La storia si accumula. Ogni sessione lascia un segno.`;
    }
    return "Qui vivi la storia della tua progressione, partita dopo partita.";
  })();

  return (
    <div>
      {/* Nonno voice */}
      <Reveal delay={0} className="mb-6">
        <p className="tt-nonno">{storiaNonno}</p>
      </Reveal>

      {/* Rating curve */}
      {pmLite != null && goal != null ? (
        <Reveal delay={0} className="mb-8">
          <RatingCurveChart ratingCurve={pmLite.rating_curve} goal={goal} />
        </Reveal>
      ) : (
        <Section delay={0}>
          <div style={{ color: "var(--color-muted)", fontSize: "0.88rem", textAlign: "center", padding: "1.5rem 0" }}>
            Curva di rating non disponibile.
          </div>
        </Section>
      )}

      {/* Journal timeline */}
      {journalEntries.length > 0 ? (
        <Section eyebrow="Diario di Nonno" delay={80}>
          <div>
            {journalEntries.map((entry, i) => (
              <div key={entry.date + i}
                style={{
                  display: "flex", gap: "1rem",
                  padding: "0.875rem 0",
                  borderBottom: i < journalEntries.length - 1 ? "1px solid var(--color-line)" : undefined,
                }}
              >
                <div style={{
                  flexShrink: 0,
                  fontFamily: "var(--font-mono)", fontSize: "0.72rem",
                  color: "var(--color-faint)", whiteSpace: "nowrap",
                  paddingTop: "0.125rem", minWidth: "5rem",
                }}>
                  {dateIt(entry.date)}
                </div>
                <div style={{ fontSize: "0.88rem", color: "var(--color-text-soft)", lineHeight: 1.65 }}>
                  {entry.text.split("\n").map((line, j, arr) => (
                    <span key={j}>{renderInline(line)}{j < arr.length - 1 && <br />}</span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </Section>
      ) : (
        <Section eyebrow="Diario di Nonno" delay={80}>
          <div style={{ color: "var(--color-muted)", fontSize: "0.88rem" }}>
            Il diario apparira' dopo la prima sessione di coaching.
          </div>
        </Section>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// TAB: PROFILO
// ─────────────────────────────────────────────────────────────────────────────

function HBar({ pct, danger, label, sub }: { pct: number; danger: boolean; label: string; sub: string }) {
  const capped = Math.min(100, pct * 5);
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", padding: "0.375rem 0" }}>
      <div className="font-mono" style={{ fontSize: "0.75rem", width: "5.5rem", textAlign: "right", color: "var(--color-muted)", flexShrink: 0 }}>
        {label}
      </div>
      <div style={{ flex: 1, height: "5px", borderRadius: "999px", background: "rgba(255,255,255,0.06)", overflow: "hidden" }}>
        <div style={{
          width: `${capped}%`, height: "100%", borderRadius: "999px",
          background: danger ? "var(--color-danger)" : "var(--color-brand-soft)",
          transition: "width 600ms cubic-bezier(0.22,1,0.36,1)",
        }} />
      </div>
      <div className="font-mono font-bold" style={{ fontSize: "0.88rem", color: danger ? "var(--color-danger)" : "var(--color-text)", flexShrink: 0, fontVariantNumeric: "tabular-nums", width: "3rem", textAlign: "right" }}>
        {pct.toFixed(1)}%
      </div>
      <div className="font-mono" style={{ fontSize: "0.7rem", color: "var(--color-faint)", flexShrink: 0, width: "5rem" }}>
        {sub}
      </div>
    </div>
  );
}

function TabProfilo({
  aggregates,
  pmLite,
}: {
  aggregates: Aggregates | null;
  pmLite: PlayerModelLite | null;
}) {
  const decisions = pmLite?.decisions ?? null;
  const weeklyTrend = pmLite?.weekly_trend ?? null;
  const showWeekly = weeklyTrend != null && weeklyTrend.last_7d.n_games >= 1;
  const tilt = pmLite?.tilt ?? null;
  const showTilt = tilt != null && tilt.tilt_factor > 1.1 && tilt.after_blunder_n >= 5;

  // Nonno voice for Profilo
  const profiloNonno = (() => {
    if (showTilt && tilt) {
      const factor = tilt.tilt_factor.toFixed(1);
      return `Dopo un errore, la tua lucidita' cala di un fattore ${factor}. Questo e' il tuo profilo: conosci il punto debole, puoi lavorarci.`;
    }
    if (decisions != null && decisions.blow_rate != null && decisions.blow_rate > 0.35) {
      return `Trasformi meno del 65% delle posizioni vinte. La tua fase critica e' la conversione: guarda le Decisioni.`;
    }
    return `Qui dentro c'e' il tuo carattere scacchistico: come decidi, dove sbagli, con quale colore, in quale fase. Non giudizi, fatti.`;
  })();

  const phases = aggregates?.by_phase != null
    ? [
        { key: "opening"    as const, label: "Apertura",   pct: aggregates.by_phase.opening.blunder_pct,    moves: aggregates.by_phase.opening.moves    },
        { key: "middlegame" as const, label: "Mediogioco", pct: aggregates.by_phase.middlegame.blunder_pct,  moves: aggregates.by_phase.middlegame.moves  },
        { key: "endgame"    as const, label: "Finale",     pct: aggregates.by_phase.endgame.blunder_pct,     moves: aggregates.by_phase.endgame.moves     },
      ]
    : [];
  const maxPhasePct = phases.length > 0 ? Math.max(...phases.map((p) => p.pct)) : 0;

  const colors = aggregates?.by_color
    ? [
        { label: "Bianco", pct: aggregates.by_color.white.blunder_pct, games: aggregates.by_color.white.games, danger: aggregates.by_color.white.blunder_pct > aggregates.by_color.black.blunder_pct },
        { label: "Nero",   pct: aggregates.by_color.black.blunder_pct, games: aggregates.by_color.black.games, danger: aggregates.by_color.black.blunder_pct > aggregates.by_color.white.blunder_pct },
      ]
    : [];

  const hasSpeedData = (pmLite?.time_management?.spent_vs_accuracy?.length ?? 0) > 0;

  return (
    <div>
      {/* Nonno voice */}
      <Reveal delay={0} className="mb-6">
        <p className="tt-nonno">{profiloNonno}</p>
      </Reveal>

      {/* Decisioni */}
      {decisions != null && (
        <Section eyebrow="Decisioni" delay={60}>
          <DecisionsCard decisions={decisions} />
        </Section>
      )}

      {/* Velocita' vs errori */}
      {hasSpeedData && (
        <Reveal delay={80} className="mb-8">
          <SpeedVsErrorsChart
            data={pmLite!.time_management!.spent_vs_accuracy!}
            avoidable={aggregates?.maia_weighted?.spent_vs_avoidable}
          />
        </Reveal>
      )}

      {/* Tilt */}
      {showTilt && tilt != null && (
        <Section eyebrow="Tilt" delay={120}>
          <p style={{ fontSize: "0.88rem", color: "var(--color-text-soft)", lineHeight: 1.65, margin: 0 }}>
            Dopo un errore grave la tua perdita media sale a{" "}
            <span className="font-mono font-bold" style={{ color: "var(--color-danger)", fontVariantNumeric: "tabular-nums" }}>
              {Math.round(tilt.after_blunder_avg_cp_loss)}
            </span>{" "}
            cp (vs baseline{" "}
            <span className="font-mono" style={{ color: "var(--color-text)", fontVariantNumeric: "tabular-nums" }}>
              {Math.round(tilt.baseline_avg_cp_loss)}
            </span>
            ). Fattore tilt:{" "}
            <span className="font-mono font-bold" style={{ color: "var(--color-warn)", fontVariantNumeric: "tabular-nums" }}>
              {tilt.tilt_factor.toFixed(2)}
            </span>
            . Dopo un errore, rallenta: la prossima mossa e' piu' critica di quanto pensi.
          </p>
        </Section>
      )}

      {/* Errori per fase */}
      {phases.length > 0 && (
        <Section eyebrow="Errori gravi per fase" delay={160}>
          {phases.map((p) => (
            <HBar key={p.key} label={p.label} pct={p.pct} sub={`${p.moves} mosse`} danger={p.pct === maxPhasePct && p.pct > 0} />
          ))}
        </Section>
      )}

      {/* Bianco vs Nero */}
      {colors.length > 0 && (
        <Section eyebrow="Bianco vs Nero" delay={200}>
          {colors.map((c) => (
            <HBar key={c.label} label={c.label} pct={c.pct} sub={`${c.games} partite`} danger={c.danger} />
          ))}
        </Section>
      )}

      {/* Trend settimanale */}
      {showWeekly && weeklyTrend != null && (
        <Reveal delay={240} className="mb-8">
          <WeeklyTrendCard trend={weeklyTrend} title="Settimana vs precedente" />
        </Reveal>
      )}

      {decisions == null && !hasSpeedData && phases.length === 0 && (
        <Section delay={0}>
          <div style={{ color: "var(--color-muted)", fontSize: "0.88rem", textAlign: "center", padding: "2rem 0" }}>
            Ancora nessun dato di profilo. Completa l'analisi.
          </div>
        </Section>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// TAB: CADUTE
// ─────────────────────────────────────────────────────────────────────────────

/** Group cadute by motif/anchor label (key = motif ?? "varie") */
interface CaduteGroup {
  key: string;       // motif key, "varie" for unclassified
  label: string;     // Italian display label
  positions: PositionExample[];
}

function buildCaduteGroups(raw: PositionExample[]): CaduteGroup[] {
  const map = new Map<string, CaduteGroup>();

  for (const pos of raw) {
    const key = pos.motif ?? "varie";
    const label = pos.motif
      ? (MOTIF_LABEL[pos.motif] ?? pos.motif.replace(/_/g, " "))
      : "Varie";

    let grp = map.get(key);
    if (!grp) {
      grp = { key, label, positions: [] };
      map.set(key, grp);
    }
    grp.positions.push(pos);
  }

  // Sort: named groups by count desc, "varie" last
  const named = [...map.values()].filter((g) => g.key !== "varie").sort((a, b) => b.positions.length - a.positions.length);
  const varie = map.get("varie");
  return varie ? [...named, varie] : named;
}

function avoidabilityLabel(c: PositionExample): "evitabile" | "difficile" | null {
  if (c.avoidable === true || (c.priority_score != null && c.priority_score >= 2)) return "evitabile";
  if (c.move_difficulty != null) {
    return c.move_difficulty >= 0.6 ? "difficile" : c.move_difficulty < 0.5 ? "evitabile" : null;
  }
  return null;
}

/** Mini gallery of position boards for a group */
function GroupGallery({ positions, onOpeningLink }: { positions: PositionExample[]; onOpeningLink: (eco: string) => void }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(190px, 1fr))", gap: "0.75rem", marginTop: "1rem" }}>
      {positions.slice(0, 6).map((c, i) => {
        const arrowPlayed = uciToArrow(c.played_uci, "rgba(239,68,68,0.85)");
        const arrowBest   = uciToArrow(c.best_uci ?? null, "rgba(34,197,94,0.85)");
        const arrows = [arrowPlayed, arrowBest].filter(Boolean) as { from: string; to: string; color: string }[];
        const avoid = avoidabilityLabel(c);
        return (
          <div key={i} style={{ background: "var(--color-surface-2)", border: "1px solid var(--color-line)", borderRadius: "8px", padding: "0.625rem" }}>
            <div style={{ display: "flex", justifyContent: "center" }}>
              <BoardView fen={c.fen_before} orientation={c.color} size={180} arrows={arrows} />
            </div>
            <div className="font-mono font-bold" style={{ fontSize: "1.1rem", color: "var(--color-danger)", fontVariantNumeric: "tabular-nums", marginTop: "0.375rem" }}>
              -{cpToPawns(c.cp_loss)}
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: "0.3rem", marginTop: "0.375rem" }}>
              <span className="tt-chip" style={{ background: "rgba(96,165,250,0.10)", color: "var(--color-info)", fontSize: "0.65rem" }}>
                {c.phase.charAt(0).toUpperCase() + c.phase.slice(1)}
              </span>
              {c.category === "blunder" ? (
                <span className="tt-chip bad" style={{ fontSize: "0.65rem" }}>Errore grave</span>
              ) : (
                <span className="tt-chip warn" style={{ fontSize: "0.65rem" }}>Errore</span>
              )}
              {avoid === "evitabile" && <span className="tt-chip warn" style={{ fontSize: "0.65rem" }}>Evitabile</span>}
            </div>
            <div className="font-mono" style={{ fontSize: "0.65rem", color: "var(--color-muted)", marginTop: "0.25rem", fontVariantNumeric: "tabular-nums" }}>
              <span style={{ color: "var(--color-danger)", fontWeight: 600 }}>{c.san}</span>
              <span style={{ color: "var(--color-faint)" }}>{" > "}</span>
              <span style={{ color: "var(--color-ok)", fontWeight: 600 }}>{uciToSan(c.fen_before, c.best_uci ?? null)}</span>
            </div>
            {c.eco && (
              <button
                onClick={() => onOpeningLink(c.eco!)}
                style={{ marginTop: "0.25rem", fontSize: "0.62rem", color: "var(--color-brand-soft)", background: "none", border: "none", cursor: "pointer", fontFamily: "var(--font-mono)", fontVariantNumeric: "tabular-nums", padding: 0, textAlign: "left" }}
              >
                {c.eco}{c.opening ? ` · ${c.opening.slice(0, 22)}` : ""}
              </button>
            )}
          </div>
        );
      })}
      {positions.length > 6 && (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", background: "var(--color-surface-2)", border: "1px solid var(--color-line)", borderRadius: "8px", minHeight: "120px" }}>
          <span style={{ fontSize: "0.82rem", color: "var(--color-muted)" }}>+{positions.length - 6} altre</span>
        </div>
      )}
    </div>
  );
}

function TabCadute({
  aggregates,
  anchorFilter,
  onOpeningLink,
}: {
  aggregates: Aggregates | null;
  anchorFilter: string | null;
  onOpeningLink: (eco: string) => void;
}) {
  // trainer state: null = group list, string = key of group being trained
  const [trainingGroup, setTrainingGroup] = useState<string | null>(null);
  // expanded group for gallery view
  const [expandedGroup, setExpandedGroup] = useState<string | null>(null);

  const raw: PositionExample[] = aggregates?.cadute ?? aggregates?.examples ?? [];

  // If anchor filter is active, filter positions by motif match
  const basePositions = anchorFilter
    ? raw.filter((c) => {
        const motifKey = anchorFilter.toLowerCase().replace(/ /g, "_");
        return !c.motif || c.motif.includes(motifKey) || motifKey.includes(c.motif);
      })
    : raw;

  const groups = buildCaduteGroups(basePositions);

  const nonnoLine = (() => {
    if (raw.length === 0) return null;
    const total = raw.length;
    const named = groups.filter((g) => g.key !== "varie");
    if (named.length > 0) {
      const top = named[0];
      return `Hai ${total} posizioni raccolte. Il pattern piu' frequente e' "${top.label}" (${top.positions.length} volte). Scegli un gruppo e allena.`;
    }
    return `Hai ${total} cadute raccolte. Puoi allenarle una per una o a gruppi.`;
  })();

  // If trainer is active, show full trainer
  if (trainingGroup !== null) {
    const grp = groups.find((g) => g.key === trainingGroup);
    if (!grp) {
      setTrainingGroup(null);
      return null;
    }
    return (
      <div>
        <CaduteTrainer
          positions={grp.positions}
          groupLabel={grp.label}
          onClose={() => setTrainingGroup(null)}
        />
      </div>
    );
  }

  if (raw.length === 0) {
    return (
      <div style={{ padding: "3rem 0", textAlign: "center" }}>
        <p className="tt-nonno" style={{ marginBottom: "1rem" }}>
          Ancora nessuna caduta registrata. Torna dopo la prossima analisi.
        </p>
      </div>
    );
  }

  return (
    <div>
      {/* Nonno voice */}
      {nonnoLine && (
        <Reveal delay={0} className="mb-6">
          <p className="tt-nonno">{nonnoLine}</p>
        </Reveal>
      )}

      {/* Anchor filter banner */}
      {anchorFilter && (
        <Reveal delay={0} className="mb-4">
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0.5rem 0.875rem", background: "color-mix(in srgb, var(--color-brand) 8%, transparent)", borderRadius: "8px", border: "1px solid color-mix(in srgb, var(--color-brand) 20%, transparent)" }}>
            <span style={{ fontSize: "0.82rem", color: "var(--color-brand-soft)" }}>Filtro ancora attivo</span>
          </div>
        </Reveal>
      )}

      {/* Group list */}
      <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
        {groups.map((grp, idx) => {
          const isExpanded = expandedGroup === grp.key;
          const avoidable = grp.positions.filter((p) => avoidabilityLabel(p) === "evitabile").length;
          return (
            <Reveal key={grp.key} delay={idx * 40}>
              <div style={{
                background: "var(--color-surface)", border: "1px solid var(--color-line)",
                borderRadius: "12px", overflow: "hidden",
              }}>
                {/* Group header */}
                <div style={{
                  display: "flex", alignItems: "center", gap: "1rem",
                  padding: "1rem 1.25rem",
                }}>
                  {/* Label + count */}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 700, fontSize: "1rem", color: "var(--color-text)", lineHeight: 1.25 }}>
                      {grp.label}
                    </div>
                    <div style={{ marginTop: "0.25rem", display: "flex", gap: "0.5rem", flexWrap: "wrap", alignItems: "center" }}>
                      <span className="font-mono" style={{ fontSize: "0.75rem", color: "var(--color-muted)", fontVariantNumeric: "tabular-nums" }}>
                        {grp.positions.length} {grp.positions.length === 1 ? "posizione" : "posizioni"}
                      </span>
                      {avoidable > 0 && (
                        <span className="tt-chip warn" style={{ fontSize: "0.65rem" }}>
                          {avoidable} evitabili
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Actions */}
                  <div style={{ display: "flex", gap: "0.5rem", flexShrink: 0 }}>
                    <button
                      onClick={() => setExpandedGroup(isExpanded ? null : grp.key)}
                      className="btn btn-ghost btn-sm"
                      style={{ fontSize: "0.75rem" }}
                    >
                      {isExpanded ? "Nascondi" : "Sfoglia"}
                    </button>
                    <button
                      onClick={() => setTrainingGroup(grp.key)}
                      className="btn btn-primary btn-sm"
                      style={{ fontSize: "0.82rem", fontWeight: 700 }}
                    >
                      Allena
                    </button>
                  </div>
                </div>

                {/* Expanded gallery */}
                {isExpanded && (
                  <div style={{ padding: "0 1.25rem 1rem" }}>
                    <GroupGallery positions={grp.positions} onOpeningLink={onOpeningLink} />
                  </div>
                )}
              </div>
            </Reveal>
          );
        })}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// TAB: REPERTORIO
// ─────────────────────────────────────────────────────────────────────────────

function TabRepertorio({ aggregates }: { aggregates: Aggregates | null }) {
  const hasRepertoire = (aggregates?.repertoire?.length ?? 0) > 0;

  const repertorioNonno = (() => {
    if (!hasRepertoire) return "Il repertorio si costruisce con le partite analizzate. Ogni apertura giocata lascia una traccia.";
    const total = aggregates!.repertoire!.length;
    return `${total} aperture nel repertorio. Clicca su un'apertura per vedere dove si concentrano gli errori evitabili.`;
  })();

  const cadute = aggregates?.cadute ?? aggregates?.examples ?? [];

  return (
    <div>
      <Reveal delay={0} className="mb-6">
        <p className="tt-nonno">{repertorioNonno}</p>
      </Reveal>
      <Section delay={60}>
        <RepertorioPanel repertoire={aggregates?.repertoire} cadute={cadute} />
      </Section>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN: Quaderno
// ─────────────────────────────────────────────────────────────────────────────

export function Quaderno() {
  const { user } = useAuth();
  const [pmLite,     setPmLite]     = useState<PlayerModelLite | null>(null);
  const [aggregates, setAggregates] = useState<Aggregates | null>(null);
  const [history,    setHistory]    = useState<HistoryFile>({ schema_version: 1, snapshots: [] });
  const [journalRaw, setJournalRaw] = useState<string | null>(null);
  const [loading,    setLoading]    = useState(true);
  const [error,      setError]      = useState<string | null>(null);

  const [activeTab, setActiveTab] = useState<TabKey>(tabFromHash);
  // Cross-link state: which anchor is selected (to filter cadute)
  const [selectedAnchor, setSelectedAnchor] = useState<string | null>(null);

  // Milestones (computed from history + goal + aggregates)
  const [milestones, setMilestones] = useState<Milestone[]>([]);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    (async () => {
      try {
        const [pm, agg, hist, journal] = await Promise.all([
          downloadJson<PlayerModelLite>(quadernoPath(user.id, "player_model_lite.json")),
          downloadJson<Aggregates>(quadernoPath(user.id, "aggregates.json")),
          readHistory(user.id),
          downloadText(quadernoPath(user.id, "coach_journal.md")),
        ]);
        if (cancelled) return;
        setPmLite(pm);
        setAggregates(agg);
        setHistory(hist);
        setJournalRaw(journal);

        // Compute milestones if we have enough data
        if (pm?.identity?.goal && agg) {
          const ms = computeMilestones({
            history: hist,
            goal: pm.identity.goal,
            aggregates: agg,
          });
          setMilestones(ms);
        }
      } catch (e) {
        if (!cancelled) setError(String(e instanceof Error ? e.message : e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [user]);

  // Sync tab to URL hash
  useEffect(() => {
    const onHash = () => {
      const t = tabFromHash();
      setActiveTab(t);
    };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  function goTab(key: TabKey) {
    setActiveTab(key);
    window.history.replaceState(null, "", `#${key}`);
  }

  function handleSelectAnchor(anchorType: string) {
    setSelectedAnchor(anchorType);
    goTab("cadute");
  }

  function handleOpeningLink(_eco: string) {
    // Navigate to Repertorio tab — the panel will show by color/opening
    goTab("repertorio");
  }

  // ── Loading ──────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: "var(--color-bg)" }}>
        <div className="text-center">
          <div className="tt-eyebrow" style={{ marginBottom: "0.5rem" }}>{PRODUCT_NAME}</div>
          <div style={{ fontSize: "0.9rem", color: "var(--color-muted)" }}>Apro il Quaderno…</div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center p-6" style={{ background: "var(--color-bg)" }}>
        <div style={{ background: "var(--color-surface)", border: "1px solid var(--color-line)", borderRadius: "14px", padding: "2rem", maxWidth: "36rem" }}>
          <div className="tt-eyebrow" style={{ color: "var(--color-danger)", marginBottom: "0.5rem" }}>Errore</div>
          <p style={{ color: "var(--color-text-soft)", fontSize: "0.9rem", marginBottom: "1.5rem" }}>{error}</p>
          <Link to="/" className="btn btn-ghost btn-sm">Torna al Tavolo</Link>
        </div>
      </div>
    );
  }

  if (!aggregates && !pmLite) {
    return (
      <div className="min-h-screen flex items-center justify-center p-6" style={{ background: "var(--color-bg)" }}>
        <div style={{ background: "var(--color-surface)", border: "1px solid var(--color-line)", borderRadius: "14px", padding: "2.5rem", maxWidth: "36rem", textAlign: "center" }}>
          <div className="tt-eyebrow" style={{ marginBottom: "0.75rem" }}>{PRODUCT_NAME}</div>
          <h1 style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: "1.4rem", color: "var(--color-text)", marginBottom: "0.75rem" }}>
            Il Quaderno e' ancora vuoto
          </h1>
          <p style={{ color: "var(--color-text-soft)", fontSize: "0.88rem", marginBottom: "1.5rem", lineHeight: 1.6 }}>
            Dopo la prima analisi troverai le tue ancore, la storia e i traguardi.
          </p>
          <Link to="/" className="btn btn-primary">Torna al Tavolo</Link>
        </div>
      </div>
    );
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="mx-auto px-5 py-8 md:px-8 md:py-12" style={{ maxWidth: "58rem" }}>

        {/* Page title */}
        <div style={{ marginBottom: "1.75rem" }}>
          <h1 style={{ fontFamily: "var(--font-display)", fontWeight: 800, fontSize: "clamp(1.6rem,4vw,2.4rem)", lineHeight: 1.15, color: "var(--color-text)", marginBottom: "0.4rem" }}>
            Il tuo Quaderno
          </h1>
          <p style={{ fontSize: "0.88rem", color: "var(--color-muted)", lineHeight: 1.5, maxWidth: "52ch" }}>
            La casa continua della tua storia a scacchi. Tutto quello che costruisci nel tempo.
          </p>
        </div>

        {/* Tab bar */}
        <div style={{ overflowX: "auto", marginBottom: "2rem" }}>
          <div className="segment" style={{ display: "inline-flex", minWidth: "max-content" }}>
            {TABS.map((tab) => (
              <button
                key={tab.key}
                onClick={() => goTab(tab.key)}
                className={`segment-item${activeTab === tab.key ? " active" : ""}`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>

        {/* Tab content */}
        <div>
          {activeTab === "evoluzione" && (
            <TabEvoluzione
              aggregates={aggregates}
              pmLite={pmLite}
              history={history}
              onSelectAnchor={handleSelectAnchor}
            />
          )}
          {activeTab === "traguardi" && (
            <TabTraguardi
              milestones={milestones}
              historyLength={history.snapshots.length}
            />
          )}
          {activeTab === "storia" && (
            <TabStoria
              pmLite={pmLite}
              journalRaw={journalRaw}
            />
          )}
          {activeTab === "profilo" && (
            <TabProfilo
              aggregates={aggregates}
              pmLite={pmLite}
            />
          )}
          {activeTab === "cadute" && (
            <TabCadute
              aggregates={aggregates}
              anchorFilter={selectedAnchor}
              onOpeningLink={handleOpeningLink}
            />
          )}
          {activeTab === "repertorio" && (
            <TabRepertorio aggregates={aggregates} />
          )}
        </div>

    </div>
  );
}
