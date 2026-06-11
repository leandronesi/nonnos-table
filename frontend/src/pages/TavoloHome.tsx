/**
 * TavoloHome — Il Tavolo "il perche'", letto da Nonno.
 *
 * Ordine blocchi (SPRINT_OOUX.md §5 — una sola schermata, decisione PO 2026-06-01):
 *   1. INGRESSO   — NonnoGreeting (voce dominante, con la memoria visibile fusa
 *                   come prima riga quiet dentro la card)
 *   2. OBIETTIVO  — GoalHero (oro)
 *   3. MOMENTO    — MomentoDelGiorno (la spina resa posizione)
 *   4. ANCORE     — top-3 cliccabili -> /quaderno#percorso ("dove perdi, in breve")
 *   5. VARCO      — card-soglia quiet -> /quaderno (la sala d'analisi)
 *   6. AZIONI     — ghost, in fondo (aggiorna / rianalizza)
 *
 * Il GAP col target (maia_weighted) NON e' piu' un riquadro: era un muro di sei
 * numeri in prosa (estetica Aimchess). Vive ora nella VOCE di Nonno e nel Quaderno.
 *
 * Regole visive (DESIGN.md):
 *   - FLAT: profondita' tonal layers, niente ombre decorative
 *   - twilight <= 15% superficie, una sola CTA LOUD per schermo (in NonnoGreeting)
 *   - ORO solo per l'Obiettivo e rating_upside ancore
 *   - niente gradient-text, niente em-dash, niente card-dentro-card
 *   - classi tt-* per le primitive del KIT (index.css KIT block)
 *   - mono solo per numeri che Nonno cita nel discorso
 */

import React, { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { useOnboardingRun } from "../pipeline/OnboardingRunContext";
import { useTavoloActionsRef } from "../context/TavoloActionsContext";
import { downloadJson, quadernoPath } from "../auth/storage";
import { PRODUCT_NAME } from "../coaching";
import { runRefresh, runFullReanalyze } from "../pipeline/orchestrator";
import type { Aggregates, Anchor, PositionExample } from "../pipeline/aggregate";
import type { PlayerModelLite } from "../pipeline/playerModelLite";
import { goalProgress, anchorTrendsFromHistory, materialForGap } from "../pipeline/history";
import { navigateWithTransition, useCountUp, useInkDraw } from "../lib/motion";
import { NonnoGreeting } from "../components/NonnoGreeting";
import { NonnoLetter } from "../components/NonnoLetter";
import { MomentoDelGiorno } from "../components/MomentoDelGiorno";
import { readEntries } from "../session/journal";
import type { TimeClass } from "../auth/db.types";
import type { HistorySnapshot, HistoryFile, AnchorTrail } from "../types";

// ── djb2 hash — simple 5-line string identity for letter freshness ───────────

function djb2(str: string): string {
  let h = 5381;
  for (let i = 0; i < str.length; i++) {
    h = ((h << 5) + h) ^ str.charCodeAt(i);
    h = h >>> 0; // keep as 32-bit unsigned
  }
  return String(h);
}

// ── Reveal hook ───────────────────────────────────────────────────────────────

function useReveal(ref: React.RefObject<HTMLElement | null>) {
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          el.classList.add("in");
          io.disconnect();
        }
      },
      { threshold: 0.08 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [ref]);
}

// ── Reveal wrapper ─────────────────────────────────────────────────────────────

function Reveal({
  children,
  delay = 0,
  className = "",
}: {
  children: React.ReactNode;
  delay?: number;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useReveal(ref);
  return (
    <div
      ref={ref}
      className={`tt-reveal ${className}`}
      style={delay ? { transitionDelay: `${delay}ms` } : undefined}
    >
      {children}
    </div>
  );
}

// ── MONTHS helper ─────────────────────────────────────────────────────────────

const MONTHS_IT = [
  "gen","feb","mar","apr","mag","giu","lug","ago","set","ott","nov","dic",
];
function deadlineIt(deadline: string): string {
  const parts = deadline.slice(0, 7).split("-");
  if (parts.length < 2) return "";
  const m = parseInt(parts[1], 10) - 1;
  return `${MONTHS_IT[m] ?? ""} ${parts[0]}`;
}

// ── GoalHero ─────────────────────────────────────────────────────────────────

function GoalHero({
  current,
  start,
  target,
  deadline,
  onTrack,
  pointsNeeded,
  rateNeeded,
  rateReal,
  handicapLine,
}: {
  current: number;
  start: number;
  target: number;
  deadline: string;
  onTrack: boolean;
  pointsNeeded: number;
  rateNeeded: number | null;
  rateReal: number | null;
  handicapLine: string | null;
}) {
  const progress = Math.max(0, Math.min(1, (current - start) / Math.max(target - start, 1)));
  // Clamp fillPct to [2, 98] so dots at the edges are never clipped
  const fillPct = Math.max(2, Math.min(98, Math.round(progress * 100)));
  const dl = deadline ? deadlineIt(deadline) : "";

  // Count-up: animate from start rating to current on mount.
  // If start >= current (regression or first login), no count-up.
  const countedCurrent = useCountUp(
    current,
    1100,
    start < current ? start : undefined,
  );

  // Ink-draw hook for the SVG progress line (fires once on viewport entry)
  const { ref: inkRef, drawn } = useInkDraw();

  const progressLine = (() => {
    if (pointsNeeded <= 0) return "Ci sei. Sediamoci a guardare cosa hai costruito.";
    const need = rateNeeded != null ? rateNeeded.toFixed(1) : null;
    const real = rateReal != null ? rateReal.toFixed(1) : null;
    if (need && real) {
      if (onTrack) return `Stai salendo di ${real} punti a settimana. Sei sulla strada.`;
      if (rateReal != null && rateReal <= 0) return `In queste settimane sei sceso un po'. Capita. Ne servono ${need} a settimana: si riparte da qui.`;
      return `Stai salendo di ${real} a settimana. Ne servono ${need}. Qualcosa da aggiustare.`;
    }
    if (need) return `Per arrivare in tempo ne servono ${need} a settimana.`;
    return `Mancano ${pointsNeeded} punti.`;
  })();

  // Il Patto — ink on the wall. No box, no chrome. Gold lives only in the numbers and the dot.
  return (
    <div>
      {/* Eyebrow gold — La Regola del Miele */}
      <div className="tt-eyebrow tt-honey" style={{ marginBottom: "1.25rem" }}>
        Il tuo obiettivo
      </div>

      {/* Main row: current (counted) <- track -> target (gold) */}
      <div
        style={{
          display: "flex",
          alignItems: "flex-end",
          justifyContent: "space-between",
          gap: "1rem",
          flexWrap: "wrap",
        }}
      >
        {/* Current — count-up on mount */}
        <div>
          <div
            className="font-mono font-bold"
            style={{
              fontSize: "clamp(1.35rem, 3.5vw, 1.6rem)",
              lineHeight: 1,
              color: "var(--color-text)",
              fontVariantNumeric: "tabular-nums",
            }}
          >
            {countedCurrent}
          </div>
          <div className="tt-eyebrow tt-muted" style={{ marginTop: "0.25rem" }}>oggi</div>
        </div>

        {/* Target in gold — La Regola del Miele. Static, not animated. */}
        <div style={{ textAlign: "right" }}>
          <div
            className="font-mono font-bold"
            style={{
              fontSize: "clamp(1.35rem, 3.5vw, 1.6rem)",
              lineHeight: 1,
              color: "var(--color-gold-soft)",
              fontVariantNumeric: "tabular-nums",
            }}
          >
            {target}
          </div>
          <div className="tt-eyebrow tt-muted" style={{ marginTop: "0.25rem" }}>
            obiettivo{dl ? ` · ${dl}` : ""}
          </div>
        </div>
      </div>

      {/* Ink-line track — SVG replaces the old CSS bar.
          Drawn path = journey covered. Dashed remainder = road ahead. */}
      <div
        className={drawn ? "ink-drawn" : ""}
        style={{ marginTop: "1.25rem" }}
        ref={inkRef as React.RefCallback<HTMLDivElement>}
      >
        <svg
          width="100%"
          height="28"
          preserveAspectRatio="none"
          aria-hidden="true"
          style={{ display: "block", overflow: "visible" }}
        >
          {/* Completed path — ink-drawn stroke.
              transitionDelay 1250ms: the card settles in at 650ms + 600ms anim,
              the ink must draw on a visible stage, not behind the curtain. */}
          <line
            x1="0%"
            y1="50%"
            x2={`${fillPct}%`}
            y2="50%"
            pathLength={1}
            className="ink-path"
            stroke="color-mix(in srgb, var(--color-brand-soft) 80%, transparent)"
            strokeWidth="2"
            strokeLinecap="round"
            style={{ transitionDelay: "1250ms" }}
          />
          {/* Remaining road — dashed, always visible */}
          <line
            x1={`${fillPct}%`}
            y1="50%"
            x2="100%"
            y2="50%"
            stroke="var(--color-line-strong)"
            strokeWidth="2"
            strokeDasharray="3 6"
            strokeLinecap="round"
            opacity={0.8}
          />
          {/* Current position dot — appears after the ink finishes drawing */}
          <circle
            cx={`${fillPct}%`}
            cy="50%"
            r="3.5"
            fill="var(--color-brand-soft)"
            style={{
              opacity: drawn ? 1 : 0,
              transition: "opacity 300ms var(--ease-out)",
              // After the ink: 1250ms stage delay + 900ms draw.
              transitionDelay: drawn ? "2150ms" : "0ms",
            }}
          />
          {/* Target dot — always visible, gold */}
          <circle
            cx="100%"
            cy="50%"
            r="4"
            fill="var(--color-gold-soft)"
          />
        </svg>
      </div>

      {/* Meta row: progress line + on-track badge */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: "0.75rem",
          marginTop: "0.875rem",
          flexWrap: "wrap",
        }}
      >
        <span style={{ fontSize: "0.88rem", color: "var(--color-text-soft)" }}>
          {progressLine}
        </span>
        <span
          className="tt-chip"
          style={
            onTrack
              ? { color: "var(--color-ok)", background: "color-mix(in srgb, var(--color-ok) 12%, transparent)" }
              : { color: "var(--color-warn)", background: "color-mix(in srgb, var(--color-warn) 10%, transparent)" }
          }
        >
          {onTrack ? "In carreggiata" : "Fuori rotta"}
        </span>
      </div>

      {/* Handicap story — serif italic, wave B. */}
      {handicapLine && (
        <p
          style={{
            margin: 0,
            marginTop: "0.875rem",
            fontFamily: "var(--font-voice)",
            fontStyle: "italic",
            fontSize: "0.82rem",
            lineHeight: 1.55,
            color: "var(--color-text-soft)",
          }}
        >
          {handicapLine}
        </p>
      )}
    </div>
  );
}

// ── AnchorMicroTrail — 64x16 ink sparkline for a trail ───────────────────────

function AnchorMicroTrail({ trail }: { trail: AnchorTrail }) {
  const { ref: inkRef, drawn } = useInkDraw();

  // Build normalised y-points (0=top 1=bottom, y is inverted in SVG)
  const freqPoints = trail.points
    .map((p) => p.freq)
    .filter((f): f is number => f != null);

  if (freqPoints.length < 2) return null;

  const maxF = Math.max(...freqPoints);
  const minF = Math.min(...freqPoints);
  const range = maxF - minF || 1;

  const W = 64;
  const H = 16;
  const PAD = 2;
  const usableW = W - PAD * 2;
  const usableH = H - PAD * 2;

  const pts = freqPoints.map((f, i) => {
    const x = PAD + (i / (freqPoints.length - 1)) * usableW;
    const y = PAD + (1 - (f - minF) / range) * usableH;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  const polylinePoints = pts.join(" ");
  const lastPt = pts[pts.length - 1].split(",");
  const lx = parseFloat(lastPt[0]);
  const ly = parseFloat(lastPt[1]);

  return (
    <div
      className={drawn ? "ink-drawn" : ""}
      ref={inkRef as React.RefCallback<HTMLDivElement>}
      style={{ flexShrink: 0, lineHeight: 0 }}
      aria-hidden="true"
    >
      <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`}>
        <polyline
          points={polylinePoints}
          pathLength={1}
          className="ink-path"
          stroke="var(--color-text-soft)"
          strokeWidth="1.5"
          fill="none"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <circle
          cx={lx}
          cy={ly}
          r="2"
          fill="var(--color-text-soft)"
          style={{
            opacity: drawn ? 1 : 0,
            transition: "opacity 300ms var(--ease-out)",
            transitionDelay: drawn ? "950ms" : "0ms",
          }}
        />
      </svg>
    </div>
  );
}

// ── AnchorRow ─────────────────────────────────────────────────────────────────

function AnchorRow({ anchor, rank, trail }: { anchor: Anchor; rank: number; trail: AnchorTrail | null }) {
  const improving =
    anchor.trend_now != null &&
    anchor.trend_now.direction === "improving" &&
    (anchor.trend_now.confidence === "medium" || anchor.trend_now.confidence === "high");

  const hasTrail = trail != null && trail.points.length >= 2;

  return (
    <Link
      to="/quaderno#percorso"
      style={{ textDecoration: "none", color: "inherit", display: "block" }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "flex-start",
          gap: "1rem",
          padding: "1rem 0",
          borderBottom: "1px solid var(--color-line)",
          transition: "opacity 160ms cubic-bezier(0.23,1,0.32,1)",
        }}
        onMouseEnter={(e) => { (e.currentTarget as HTMLDivElement).style.opacity = "0.78"; }}
        onMouseLeave={(e) => { (e.currentTarget as HTMLDivElement).style.opacity = "1"; }}
      >
        {/* Rank number — mono small muted, no bubble */}
        <div
          style={{
            flexShrink: 0,
            width: "1.25rem",
            fontFamily: "var(--font-mono)",
            fontWeight: 600,
            fontSize: "0.72rem",
            color: "var(--color-faint)",
            paddingTop: "0.15rem",
          }}
        >
          {rank}
        </div>

        {/* Label + chips */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              fontFamily: "var(--font-voice)",
              fontWeight: 500,
              fontSize: "1.1rem",
              color: "var(--color-text)",
              lineHeight: 1.3,
              marginBottom: "0.375rem",
            }}
          >
            {anchor.label_it}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", flexWrap: "wrap" }}>
            {/* 3D: mostra count_avoidable (Maia-filtrato) se > 0, altrimenti count grezzo */}
            {(() => {
              const avoidable = (anchor.count_avoidable ?? 0);
              const displayCount = avoidable > 0 ? avoidable : anchor.count;
              const label = avoidable > 0 ? "alla tua portata" : "errori";
              if (displayCount > 0) {
                return (
                  <span className="tt-chip" style={{ color: "var(--color-muted)", background: "rgba(255,255,255,0.05)", fontVariantNumeric: "tabular-nums" }}>
                    <span className="font-mono" style={{ fontWeight: 700, color: avoidable > 0 ? "var(--color-warn)" : "var(--color-text)" }}>
                      {displayCount}
                    </span>
                    {" "}{label}
                  </span>
                );
              }
              return null;
            })()}
            {anchor.rating_upside != null && anchor.rating_upside > 0 && (
              <span
                className="tt-chip"
                style={{
                  color: "var(--color-gold-soft)",
                  background: "color-mix(in srgb, var(--color-gold) 14%, transparent)",
                }}
              >
                +{anchor.rating_upside} punti
              </span>
            )}
            {improving && (
              <span className="tt-chip good">stai migliorando</span>
            )}
          </div>
          {/* Spread across games — contextualizes the count */}
          {anchor.games_with > 0 && (
            <div style={{
              marginTop: "0.25rem",
              fontSize: "0.75rem",
              color: "var(--color-muted)",
              lineHeight: 1.3,
            }}>
              In {anchor.games_with} partite diverse
            </div>
          )}
        </div>

        {/* Micro-trail sparkline — ink, no colour judgment, ink tells the story */}
        {hasTrail && (
          <div style={{ display: "flex", alignItems: "center", paddingTop: "0.25rem" }}>
            <AnchorMicroTrail trail={trail!} />
          </div>
        )}
      </div>
    </Link>
  );
}


// ── Memoria visibile (la frase "L'altra volta...") ───────────────────────────

/**
 * Builds the "memoria visibile" line shown above NonnoGreeting in Nonno's voice.
 *
 * The journal `body` strings are self-contained sentences (some written for the
 * Quaderno feed), so they do NOT read naturally after "L'altra volta": some carry
 * em-dashes or "di oggi" wording that fights the "last time" framing. So we do
 * not concatenate the raw body here — we recompose a short memory line from the
 * entry kind, preferring the last full SESSION over a single exercise/streak,
 * and lean on the TIME tic ("ieri", "tre giorni fa") without inventing facts.
 *
 * Returns null when there is nothing worth surfacing.
 */
function buildMemoria(): string | null {
  const entries = readEntries();
  if (entries.length === 0) return null;

  // Prefer the last actual session; fall back to the most recent entry of any kind.
  const lastSession = entries.find((e) => e.kind === "session_done");
  const ref = lastSession ?? entries[0];

  // Days since that entry (from its UTC date string, so clock/time-zone hours
  // never turn "today" into "yesterday").
  const today = new Date();
  const todayUtcMid = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  const parts = ref.date.split("-").map((n) => parseInt(n, 10));
  let whenClause = "L'altra volta";
  if (parts.length === 3 && parts.every((n) => !Number.isNaN(n))) {
    const refUtcMid = Date.UTC(parts[0], parts[1] - 1, parts[2]);
    const days = Math.round((todayUtcMid - refUtcMid) / 86400000);
    if (days === 1) whenClause = "Ieri";
    else if (days >= 2 && days <= 6) whenClause = `${days} giorni fa`;
    else if (days > 6) whenClause = "L'ultima volta";
    // days <= 0 (same UTC day): keep the neutral "L'altra volta".
  }

  if (lastSession != null) {
    // If the session recorded a dominant motif, surface it here.
    const motif = typeof lastSession.meta?.dominant_motif === "string"
      ? lastSession.meta.dominant_motif
      : null;
    if (motif) {
      return `${whenClause} abbiamo lavorato su "${motif}". Riprendiamo da li'.`;
    }
    return `${whenClause} ci siamo seduti insieme. Riprendiamo da li'.`;
  }
  // No full session yet, but some activity happened: keep it light, no raw body.
  return `${whenClause} sei passato dal Tavolo. Bene, riprendiamo.`;
}


// ── Chess.com stats shape (same as Onboarding.tsx) ───────────────────────────

interface ChessComStats {
  chess_rapid?: { last?: { rating?: number } };
  chess_blitz?: { last?: { rating?: number } };
  chess_bullet?: { last?: { rating?: number } };
  chess_daily?: { last?: { rating?: number } };
}

function ratingFromStats(stats: ChessComStats, tc: TimeClass): number | null {
  switch (tc) {
    case "rapid":  return stats.chess_rapid?.last?.rating ?? null;
    case "blitz":  return stats.chess_blitz?.last?.rating ?? null;
    case "bullet": return stats.chess_bullet?.last?.rating ?? null;
    case "daily":  return stats.chess_daily?.last?.rating ?? null;
    default:       return null;
  }
}

// ── Handicap story (GoalHero) ─────────────────────────────────────────────────

// materialForGap is now in pipeline/history.ts (shared with Viaggio component).

/**
 * Derives the handicap story from a history array.
 * Returns null when there are not enough snapshots, no material step, or no improvement.
 */
function buildHandicapLine(snapshots: HistorySnapshot[]): string | null {
  if (snapshots.length < 2) return null;
  // history.json order is not guaranteed: sort chronologically before picking ends
  const sorted = [...snapshots].sort((a, b) => a.captured_at.localeCompare(b.captured_at));
  const first = sorted[0];
  const last = sorted[sorted.length - 1];

  const firstMw = first.maia_weighted;
  const lastMw = last.maia_weighted;
  if (firstMw.mine_pct == null || firstMw.target_pct == null) return null;
  // No claim without current data: a missing last snapshot must not read as "alla pari"
  if (lastMw.mine_pct == null || lastMw.target_pct == null) return null;

  const firstGap = firstMw.target_pct - firstMw.mine_pct;
  const initialMaterial = materialForGap(firstGap);
  if (!initialMaterial) return null; // started at par — nothing interesting to say

  // Require improvement: current step must be strictly lower than initial.
  const lastGap = lastMw.target_pct - lastMw.mine_pct;
  const currentMaterial = materialForGap(lastGap);

  const initialStep = initialMaterial.step;
  const currentStep = currentMaterial?.step ?? 0; // 0 = quasi alla pari
  if (currentStep >= initialStep) return null; // no real improvement

  if (currentMaterial != null) {
    return `Quando ci siamo seduti la prima volta ti avrei dato ${initialMaterial.label} di vantaggio. Oggi ti darei ${currentMaterial.label}.`;
  }
  return `Quando ci siamo seduti la prima volta ti avrei dato ${initialMaterial.label} di vantaggio. Oggi giochiamo quasi alla pari.`;
}

/**
 * Fetches the live ELO from Chess.com for the user's goal time-class.
 * Returns null while loading or on any failure — caller falls back to stored value.
 * No throttle needed: display-only, one cheap request at mount.
 */
function useLiveElo(
  chessComUsername: string | null | undefined,
  goalTimeClass: TimeClass | null | undefined,
): number | null {
  const [liveRating, setLiveRating] = useState<number | null>(null);

  useEffect(() => {
    if (!chessComUsername || !goalTimeClass) return;
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch(
          `https://api.chess.com/pub/player/${encodeURIComponent(chessComUsername)}/stats`,
        );
        if (!r.ok) return; // silently fall back
        const stats = (await r.json()) as ChessComStats;
        const rating = ratingFromStats(stats, goalTimeClass);
        if (!cancelled && rating != null) setLiveRating(rating);
      } catch (e) {
        // Network failures are expected (offline, CORS, Chess.com down).
        // We degrade gracefully — no crash, no UI error.
        // eslint-disable-next-line no-console
        console.warn("[TavoloHome] Chess.com live ELO fetch failed:", e);
      }
    })();
    return () => { cancelled = true; };
  }, [chessComUsername, goalTimeClass]);

  return liveRating;
}

// ── VarcoQuaderno — una riga di testo serif quiet con freccia ────────────────
// No box, no card. Hover: the arrow advances 4px.

function VarcoQuaderno({ onNavigate }: { onNavigate: () => void }) {
  const [arrowShift, setArrowShift] = React.useState(0);
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onNavigate}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onNavigate(); } }}
      onMouseEnter={() => setArrowShift(4)}
      onMouseLeave={() => setArrowShift(0)}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "0.625rem",
        cursor: "pointer",
        userSelect: "none",
      }}
    >
      <span
        style={{
          fontFamily: "var(--font-voice)",
          fontSize: "0.95rem",
          fontWeight: 400,
          color: "var(--color-text-soft)",
          lineHeight: 1.5,
        }}
      >
        La sala dove guardiamo tutto con calma: la curva, dove perdi tempo, le aperture.
      </span>
      <span
        aria-hidden="true"
        style={{
          fontSize: "1rem",
          color: "var(--color-muted)",
          flexShrink: 0,
          transform: `translateX(${arrowShift}px)`,
          transition: "transform 180ms cubic-bezier(0.23,1,0.32,1)",
        }}
      >
        &rarr;
      </span>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export function TavoloHome() {
  const { user, profile, refreshProfile } = useAuth();
  const nav = useNavigate();
  const { dataVersion } = useOnboardingRun();
  const tavoloActionsRef = useTavoloActionsRef();

  const [pmLite, setPmLite] = useState<PlayerModelLite | null>(null);
  const [aggregates, setAggregates] = useState<Aggregates | null>(null);
  /** voice_message from coach_brief.json. null = missing/not ready. undefined = still loading. */
  const [llmVoice, setLlmVoice] = useState<string | null | undefined>(undefined);
  /** generated_at from coach_brief.json (optional — undefined when absent). */
  const [llmGeneratedAt, setLlmGeneratedAt] = useState<string | undefined>(undefined);
  /**
   * Whether this letter was already seen on a PREVIOUS visit (read from localStorage at load time).
   * When true, no letter is shown (fallback to NonnoGreeting).
   */
  const [letterSeenBefore, setLetterSeenBefore] = useState(false);
  /**
   * Whether the user has opened the letter during THIS visit.
   * Used only to hide the "Toccala per aprirla." caption after opening.
   */
  const [letterOpenedThisVisit, setLetterOpenedThisVisit] = useState(false);
  const [historySnapshots, setHistorySnapshots] = useState<HistorySnapshot[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [reanalyzing, setReanalyzing] = useState(false);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    (async () => {
      try {
        // coach_brief.json and history.json are optional — degrade gracefully.
        const briefPromise = downloadJson<{ voice_message?: string; generated_at?: string }>(
          quadernoPath(user.id, "coach_brief.json"),
        ).catch(() => null);
        const historyPromise = downloadJson<{ snapshots?: HistorySnapshot[] }>(
          quadernoPath(user.id, "history.json"),
        ).catch(() => null);

        const [pm, agg, brief, history] = await Promise.all([
          downloadJson<PlayerModelLite>(quadernoPath(user.id, "player_model_lite.json")),
          downloadJson<Aggregates>(quadernoPath(user.id, "aggregates.json")),
          briefPromise,
          historyPromise,
        ]);
        if (cancelled) return;
        setPmLite(pm);
        setAggregates(agg);
        const voice = brief?.voice_message ?? null;
        setLlmVoice(voice);
        setLlmGeneratedAt(brief?.generated_at ?? undefined);
        // Check localStorage to determine if this letter was already seen.
        if (voice && voice.trim().length > 0) {
          const identity = brief?.generated_at ?? djb2(voice.trim());
          const seen = localStorage.getItem("nonno_letter_seen");
          setLetterSeenBefore(seen === identity);
        }
        setHistorySnapshots(history?.snapshots ?? null);
      } catch (e) {
        if (!cancelled) setError(String(e instanceof Error ? e.message : e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
    // dataVersion: increments when background pipeline finishes, forces data reload.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, dataVersion]);

  async function handleRefresh() {
    if (!profile) return;
    setRefreshing(true);
    try {
      await runRefresh(profile);
      await refreshProfile();
      nav("/onboarding/waiting", { replace: true });
    } finally {
      setRefreshing(false);
    }
  }

  async function handleFullReanalyze() {
    if (!profile) return;
    setReanalyzing(true);
    try {
      await runFullReanalyze(profile);
      await refreshProfile();
      nav("/onboarding/waiting", { replace: true });
    } finally {
      setReanalyzing(false);
    }
  }

  // Register the action callbacks in the shared context so AppShell sidebar can call them.
  // Using useEffect with stable refs is not needed here: we write to the mutable ref
  // every render (same pattern as callback refs), which is safe and avoids stale closures.
  tavoloActionsRef.current = {
    handleRefresh,
    handleFullReanalyze,
  };
  // Clear on unmount so the sidebar never holds stale closures from a dead mount.
  useEffect(() => {
    return () => {
      tavoloActionsRef.current = null;
    };
  }, [tavoloActionsRef]);

  // ── Part A: live ELO from Chess.com (display-only, no persistence) ────────
  // Falls back to stored current_rating if fetch fails or returns null.
  const liveElo = useLiveElo(profile?.chess_com_username, profile?.goal_time_class);

  // ── Loading ──────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div
        className="min-h-screen flex items-center justify-center"
        style={{ background: "var(--color-bg)" }}
      >
        <div className="text-center">
          <div className="tt-eyebrow" style={{ marginBottom: "0.5rem" }}>
            {PRODUCT_NAME}
          </div>
          <div style={{ fontSize: "0.9rem", color: "var(--color-muted)" }}>Apparecchio...</div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div
        className="min-h-screen flex items-center justify-center p-6"
        style={{ background: "var(--color-bg)" }}
      >
        <div
          style={{
            background: "var(--color-surface)",
            border: "1px solid var(--color-line)",
            borderRadius: "14px",
            padding: "2rem",
            maxWidth: "36rem",
          }}
        >
          <div className="tt-eyebrow" style={{ color: "var(--color-danger)", marginBottom: "0.5rem" }}>
            Errore
          </div>
          <p style={{ color: "var(--color-text-soft)", fontSize: "0.9rem" }}>{error}</p>
        </div>
      </div>
    );
  }

  if (!aggregates && !pmLite) {
    return (
      <div
        className="min-h-screen flex items-center justify-center p-6"
        style={{ background: "var(--color-bg)" }}
      >
        <div
          style={{
            background: "var(--color-surface)",
            border: "1px solid var(--color-line)",
            borderRadius: "14px",
            padding: "2.5rem",
            maxWidth: "36rem",
            textAlign: "center",
          }}
        >
          <div className="tt-eyebrow" style={{ marginBottom: "0.75rem" }}>{PRODUCT_NAME}</div>
          <h1
            style={{
              fontFamily: "var(--font-display)",
              fontWeight: 700,
              fontSize: "1.5rem",
              color: "var(--color-text)",
              marginBottom: "0.75rem",
            }}
          >
            Il Tavolo non e' ancora apparecchiato
          </h1>
          <p style={{ color: "var(--color-text-soft)", fontSize: "0.9rem", marginBottom: "1.5rem" }}>
            Non ho ancora finito di guardare le tue partite. Torniamo da dove ci eravamo fermati.
          </p>
          <Link to="/onboarding/waiting" className="btn btn-primary">
            Riprendiamo
          </Link>
        </div>
      </div>
    );
  }

  // ── Derived values ────────────────────────────────────────────────────────

  const goal = pmLite?.identity?.goal;
  // Part A: use live ELO from Chess.com if available; fall back to stored value.
  const storedRating = goal?.current_rating ?? pmLite?.current_rating ?? null;
  const currentRating = liveElo ?? storedRating;
  // Single source of truth: a goal whose current_rating is the LIVE ELO. Used by
  // the greeting, the Obiettivo card AND the rate/points math below — otherwise
  // the card showed the live rating while the message and "servono +X/sett" still
  // used the stale stored one (the incoherence the PO caught).
  const liveGoal = goal ? { ...goal, current_rating: currentRating } : undefined;
  const targetRating = profile?.goal_rating ?? goal?.target ?? 0;
  const startRating = goal?.start_rating ?? currentRating ?? 0;
  const onTrack = goal?.on_track ?? false;
  const deadline = goal?.deadline ?? "";

  // GoalProgress recomputed from the LIVE goal (rate-needed / points reflect the
  // current ELO, not the rating at the last coach generation).
  const gp = liveGoal ? goalProgress(liveGoal) : null;

  // Top-3 anchors by rating_upside desc
  const anchorsRaw: Anchor[] = aggregates?.anchors ?? [];
  const anchorsTop3 = [...anchorsRaw]
    .sort((a, b) => (b.rating_upside ?? 0) - (a.rating_upside ?? 0))
    .slice(0, 3);

  // Momento pool: cadute preferred, fallback to examples
  const momentoPool: PositionExample[] = aggregates?.cadute ?? aggregates?.examples ?? [];

  // Handicap story: derived from history snapshots
  const handicapLine = historySnapshots ? buildHandicapLine(historySnapshots) : null;

  // Anchor trails: build from history snapshots for the micro-scia sparklines.
  // anchorTrendsFromHistory expects a HistoryFile struct.
  const anchorTrails: AnchorTrail[] = historySnapshots && historySnapshots.length >= 2
    ? anchorTrendsFromHistory({ schema_version: 1, snapshots: historySnapshots } as HistoryFile)
    : [];

  // Journal: "memoria visibile" — recomposed in Nonno's voice (prefers the last
  // full session, leans on the TIME tic). Reads localStorage synchronously.
  const memoriaVisibile = buildMemoria();

  // Letter: fresh detection.
  // The letter appears ONLY when (a) there is a real LLM voice AND (b) it is new.
  const hasVoice = llmVoice != null && llmVoice.trim().length > 0;
  const letterIdentity = hasVoice
    ? (llmGeneratedAt ?? djb2(llmVoice!.trim()))
    : null;
  // Show the letter wrapper only on the fresh visit (not yet seen before this visit).
  const showLetter = hasVoice && !letterSeenBefore;

  function handleLetterOpen() {
    if (letterIdentity) {
      // Persist seen so NEXT visits show NonnoGreeting directly.
      localStorage.setItem("nonno_letter_seen", letterIdentity);
      // Mark opened this visit so we hide the caption.
      setLetterOpenedThisVisit(true);
      // Note: we do NOT set letterSeenBefore(true) here — the letter stays
      // visible and open for the rest of this visit (no jump to NonnoGreeting).
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div
      className="mx-auto px-5 py-10 md:px-8 md:py-14"
      style={{ maxWidth: "60rem" }}
    >

      {/* ════════════════════════════════════════════════════════════════════
          ATTO 1 — la spina del giorno (il colpo d'occhio).
          Ingresso, Obiettivo, Momento: la testa della pagina. Piu' aria,
          piu' peso, entra per prima. E' qui che cade l'occhio aprendo.
          ════════════════════════════════════════════════════════════════════ */}

      {/* ── 1. INGRESSO: voce scritta sulla parete ──────────────────────────
          No Reveal wrapper here: the card owns its mount stagger (ng-stagger-*),
          a second opacity layer would double-fade the most important scene.
          When the letter is fresh (new LLM voice, not yet seen), show it folded.
          After opening (or on repeat visits), fall back to NonnoGreeting as usual. */}
      <div className="mb-16">
        {showLetter ? (
          <div>
            {/* Eyebrow above the closed letter */}
            <div
              className="tt-eyebrow"
              style={{ color: "var(--color-brand-soft)", marginBottom: "1rem" }}
            >
              E' arrivata una lettera
            </div>

            <NonnoLetter
              identity={letterIdentity!}
              onOpen={handleLetterOpen}
            >
              {/* The full NonnoGreeting lives inside the opened letter.
                  inLetter=true removes the top memoria/eyebrow margin (they are
                  handled by the letter chrome above), but the CTA must stay. */}
              <NonnoGreeting
                goal={liveGoal}
                memoria={memoriaVisibile}
                topAnchor={aggregates?.anchors?.[0] ?? null}
                decisions={
                  pmLite?.decisions != null
                    ? {
                        blow_rate: pmLite.decisions.blow_rate,
                        blew_winning: pmLite.decisions.blew_winning,
                      }
                    : null
                }
                maiaWeighted={aggregates?.maia_weighted ?? null}
                byPhase={
                  aggregates?.by_phase != null
                    ? {
                        opening: aggregates.by_phase.opening.blunder_pct,
                        middlegame: aggregates.by_phase.middlegame.blunder_pct,
                        endgame: aggregates.by_phase.endgame.blunder_pct,
                      }
                    : null
                }
                onSediamoci={() => navigateWithTransition(() => nav("/sessione"))}
                voiceMessage={llmVoice ?? null}
                inLetter
              />
            </NonnoLetter>

            {/* Caption below the closed letter — fades out once the user opens it */}
            {!letterOpenedThisVisit && (
              <p
                style={{
                  marginTop: "0.75rem",
                  fontSize: "0.82rem",
                  color: "var(--color-faint)",
                  lineHeight: 1.4,
                }}
              >
                Toccala per aprirla.
              </p>
            )}
          </div>
        ) : (
          <NonnoGreeting
            goal={liveGoal}
            memoria={memoriaVisibile}
            topAnchor={aggregates?.anchors?.[0] ?? null}
            decisions={
              pmLite?.decisions != null
                ? {
                    blow_rate: pmLite.decisions.blow_rate,
                    blew_winning: pmLite.decisions.blew_winning,
                  }
                : null
            }
            maiaWeighted={aggregates?.maia_weighted ?? null}
            byPhase={
              aggregates?.by_phase != null
                ? {
                    opening: aggregates.by_phase.opening.blunder_pct,
                    middlegame: aggregates.by_phase.middlegame.blunder_pct,
                    endgame: aggregates.by_phase.endgame.blunder_pct,
                  }
                : null
            }
            onSediamoci={() => navigateWithTransition(() => nav("/sessione"))}
            voiceMessage={llmVoice ?? null}
          />
        )}
      </div>

      {/* ── 2. OBIETTIVO: il Patto scritto sulla parete ─────────────────────
          settle-in at 650ms: after Nonno finishes speaking (~500ms). */}
      {currentRating != null && (
        <div
          className="settle-in mb-16"
          style={{ animationDelay: "650ms" }}
        >
          <GoalHero
            current={currentRating}
            start={startRating}
            target={targetRating}
            deadline={deadline}
            onTrack={onTrack}
            pointsNeeded={gp?.points_needed ?? Math.max(0, targetRating - currentRating)}
            rateNeeded={gp?.rate_needed_per_week ?? null}
            rateReal={gp?.rate_real_per_week ?? null}
            handicapLine={handicapLine}
          />
        </div>
      )}

      {/* ── 3. LA SCENA DEL LEGNO — la scacchiera sul tavolo ───────────────
          settle-in at 850ms: after GoalHero is visible and ink starts drawing. */}
      {momentoPool.length > 0 && (
        <div
          className="settle-in mb-16"
          style={{ animationDelay: "850ms" }}
        >
          <MomentoDelGiorno
            pool={momentoPool}
            targetRating={targetRating > 0 ? targetRating : null}
          />
        </div>
      )}

      {/* ── DOVE PERDI, IN BREVE (top-3 ancore, cliccabili) ─────────────
          Il gap col target (maia_weighted) NON vive piu' qui: era un muro di
          numeri in prosa (estetica Aimchess). Quella verita' ora sta nella VOCE
          di Nonno (NonnoGreeting riceve maiaWeighted) e nel Quaderno (Evoluzione). */}
      {/* Ancore — appunti sulla parete, nessuna scatola. Righe separate da bordo sottile. */}
      {anchorsTop3.length > 0 && (
        <Reveal delay={220} className="mb-16">
          <div>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                marginBottom: "0.25rem",
                gap: "0.75rem",
              }}
            >
              <div className="tt-eyebrow">Le tue 3 ancore</div>
              <Link
                to="/quaderno#percorso"
                style={{
                  fontSize: "0.75rem",
                  color: "var(--color-brand-soft)",
                  textDecoration: "none",
                  fontWeight: 600,
                }}
              >
                vedi tutte
              </Link>
            </div>
            <div
              style={{
                fontSize: "0.82rem",
                color: "var(--color-muted)",
                marginBottom: "0.5rem",
                lineHeight: 1.4,
              }}
            >
              Quello che ti tiene ancorato giu'. In cima, l'ancora che ti vale piu' punti se la sciogli.
            </div>

            {/* List — rows divided by border-bottom. Last row no border (handled in AnchorRow). */}
            <div>
              {anchorsTop3.map((anchor, i) => {
                const trail = anchorTrails.find((t) => t.key === anchor.type) ?? null;
                return (
                  <div
                    key={anchor.type}
                    style={i === anchorsTop3.length - 1 ? { borderBottom: "none" } : undefined}
                  >
                    <AnchorRow anchor={anchor} rank={i + 1} trail={trail} />
                  </div>
                );
              })}
            </div>
          </div>
        </Reveal>
      )}

      {/* ── 5. VARCO AL QUADERNO — una riga, non una porta di cartone */}
      <Reveal delay={260} className="mb-16">
        <VarcoQuaderno onNavigate={() => navigateWithTransition(() => nav("/quaderno"))} />
      </Reveal>

      {/* ── 6. AZIONI SECONDARIE (mobile only — desktop uses sidebar links) ── */}
      {/* On desktop these live as quiet text links in the AppShell sidebar footer. */}
      <div
        className="appshell-mobile-actions"
        style={{
          borderTop: "1px solid var(--color-line)",
          paddingTop: "1rem",
          paddingBottom: "0.5rem",
          marginBottom: "0.5rem",
          fontSize: "0.75rem",
          color: "var(--color-faint)",
          textAlign: "center",
          justifyContent: "center",
          gap: "0",
        }}
      >
        <button
          onClick={() => void handleRefresh()}
          disabled={refreshing || reanalyzing}
          style={{
            background: "none",
            border: "none",
            padding: 0,
            cursor: refreshing || reanalyzing ? "default" : "pointer",
            opacity: refreshing || reanalyzing ? 0.4 : 1,
            color: "var(--color-faint)",
            fontSize: "inherit",
            fontFamily: "inherit",
            textDecoration: "underline",
            textDecorationColor: "color-mix(in srgb, var(--color-faint) 50%, transparent)",
            textUnderlineOffset: "2px",
          }}
        >
          {refreshing ? "Preparo..." : "Aggiorna le partite"}
        </button>
        <span style={{ color: "var(--color-faint)", padding: "0 0.4rem", userSelect: "none" }}> · </span>
        <button
          onClick={() => void handleFullReanalyze()}
          disabled={refreshing || reanalyzing}
          style={{
            background: "none",
            border: "none",
            padding: 0,
            cursor: refreshing || reanalyzing ? "default" : "pointer",
            opacity: refreshing || reanalyzing ? 0.4 : 1,
            color: "var(--color-faint)",
            fontSize: "inherit",
            fontFamily: "inherit",
            textDecoration: "underline",
            textDecorationColor: "color-mix(in srgb, var(--color-faint) 50%, transparent)",
            textUnderlineOffset: "2px",
          }}
        >
          {reanalyzing ? "Rianalizzando..." : "Rianalizza da capo"}
        </button>
      </div>

    </div>
  );
}
