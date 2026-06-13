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
import { PRODUCT_NAME } from "../coaching";
import type { Anchor, PositionExample } from "../pipeline/aggregate";
import { navigateWithTransition, useCountUp, useInkDraw } from "../lib/motion";
import { NonnoGreeting } from "../components/NonnoGreeting";
import { NonnoLetter } from "../components/NonnoLetter";
import { MomentoDelGiorno } from "../components/MomentoDelGiorno";
import type { AnchorTrail } from "../types";
import { useTavoloData } from "./tavolo/useTavoloData";
import { useOnboardingRun } from "../pipeline/OnboardingRunContext";
import { tr, getLang } from "../i18n/lang";
import { getAnchorLabel } from "../i18n/anchors";

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

// Not a module-level constant: called at render-time so tr() reads the live lang.
function getMonths(): string[] {
  return [
    tr("gen", "Jan"), tr("feb", "Feb"), tr("mar", "Mar"), tr("apr", "Apr"),
    tr("mag", "May"), tr("giu", "Jun"), tr("lug", "Jul"), tr("ago", "Aug"),
    tr("set", "Sep"), tr("ott", "Oct"), tr("nov", "Nov"), tr("dic", "Dec"),
  ];
}
function deadlineIt(deadline: string): string {
  const parts = deadline.slice(0, 7).split("-");
  if (parts.length < 2) return "";
  const m = parseInt(parts[1], 10) - 1;
  return `${getMonths()[m] ?? ""} ${parts[0]}`;
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
    if (pointsNeeded <= 0) return tr("Ci sei. Sediamoci a guardare cosa hai costruito.", "You're there. Let's sit down and look at what you've built.");
    const need = rateNeeded != null ? rateNeeded.toFixed(1) : null;
    const real = rateReal != null ? rateReal.toFixed(1) : null;
    if (need && real) {
      if (onTrack) return tr(`Stai salendo di ${real} punti a settimana. Sei sulla strada.`, `You're gaining ${real} points a week. You're on track.`);
      if (rateReal != null && rateReal <= 0) return tr(`In queste settimane sei sceso un po'. Capita. Ne servono ${need} a settimana: si riparte da qui.`, `You've dropped a little these weeks. It happens. You need ${need} a week: we start again from here.`);
      return tr(`Stai salendo di ${real} a settimana. Ne servono ${need}. Qualcosa da aggiustare.`, `You're gaining ${real} a week. You need ${need}. Something to fix.`);
    }
    if (need) return tr(`Per arrivare in tempo ne servono ${need} a settimana.`, `To get there in time you need ${need} a week.`);
    return tr(`Mancano ${pointsNeeded} punti.`, `${pointsNeeded} points to go.`);
  })();

  // Il Patto — ink on the wall. No box, no chrome. Gold lives only in the numbers and the dot.
  return (
    <div>
      {/* Eyebrow gold — La Regola del Miele */}
      <div className="tt-eyebrow tt-honey" style={{ marginBottom: "1.25rem" }}>
        {tr("Il tuo obiettivo", "Your goal")}
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
          <div className="tt-eyebrow tt-muted" style={{ marginTop: "0.25rem" }}>{tr("oggi", "today")}</div>
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
            {tr("obiettivo", "goal")}{dl ? ` · ${dl}` : ""}
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
          {onTrack ? tr("In carreggiata", "On track") : tr("Fuori rotta", "Off track")}
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
  const lang = getLang();
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
            {getAnchorLabel(anchor.type, lang, anchor.label_it)}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", flexWrap: "wrap" }}>
            {/* 3D: mostra count_avoidable (Maia-filtrato) se > 0, altrimenti count grezzo */}
            {(() => {
              const avoidable = (anchor.count_avoidable ?? 0);
              const displayCount = avoidable > 0 ? avoidable : anchor.count;
              const label = avoidable > 0 ? tr("alla tua portata", "within your reach") : tr("errori", "errors");
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
                +{anchor.rating_upside} {tr("punti", "points")}
              </span>
            )}
            {improving && (
              <span className="tt-chip good">{tr("stai migliorando", "improving")}</span>
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
              {tr(`In ${anchor.games_with} partite diverse`, `Across ${anchor.games_with} games`)}
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
        {tr("La sala dove guardiamo tutto con calma: la curva, dove perdi tempo, le aperture.", "The room where we look at everything carefully: the curve, where you lose time, the openings.")}
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

// Minimum number of analyzed games before the analytic blocks are shown.
// Below this threshold Nonno explains honestly rather than leaving blank gaps.
const MIN_GAMES_FOR_INSIGHTS = 25;

// ── Main component ────────────────────────────────────────────────────────────

export function TavoloHome() {
  const nav = useNavigate();

  const {
    pmLite,
    aggregates,
    llmVoice,
    llmGeneratedAt: _llmGeneratedAt,
    loading,
    error,
    refreshing,
    reanalyzing,
    memoriaVisibile,
    liveGoal,
    currentRating,
    startRating,
    targetRating,
    deadline,
    onTrack,
    goalProgressData: gp,
    handicapLine,
    anchorTrails,
    letterIdentity,
    letterSeenBefore,
    letterOpenedThisVisit,
    markLetterSeen,
    reloading,
    runRefreshHandler: handleRefresh,
    runFullReanalyzeHandler: handleFullReanalyze,
  } = useTavoloData();

  // Whether onboarding background analysis (games 11-100) is still running, plus
  // its live progress (gamesDone/gamesTotal) so the Tavolo can show how many are left.
  const { backgroundRunning, progress } = useOnboardingRun();

  // Two-step confirm gate for "Rianalizza da capo" (irreversible, heavy operation).
  // First click: confirming=true, button text changes to "Sicuro? Ricomincio da zero".
  // Second click within 4s: executes. No click / 4s timeout: resets to idle.
  const [reanalyzeConfirming, setReanalyzeConfirming] = useState(false);
  const reanalyzeConfirmTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  function handleReanalyzeClick() {
    if (refreshing || reanalyzing) return;
    if (!reanalyzeConfirming) {
      setReanalyzeConfirming(true);
      reanalyzeConfirmTimerRef.current = setTimeout(() => {
        setReanalyzeConfirming(false);
        reanalyzeConfirmTimerRef.current = null;
      }, 4000);
    } else {
      // Confirmed: cancel the auto-reset timer and execute.
      if (reanalyzeConfirmTimerRef.current !== null) {
        clearTimeout(reanalyzeConfirmTimerRef.current);
        reanalyzeConfirmTimerRef.current = null;
      }
      setReanalyzeConfirming(false);
      void handleFullReanalyze();
    }
  }

  // Cancel the pending confirm timer on unmount (route change) so it never
  // fires setState on a dead component.
  useEffect(() => {
    return () => {
      if (reanalyzeConfirmTimerRef.current !== null) {
        clearTimeout(reanalyzeConfirmTimerRef.current);
      }
    };
  }, []);

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
          <div style={{ fontSize: "0.9rem", color: "var(--color-muted)" }}>{tr("Apparecchio...", "Setting the table...")}</div>
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
            {tr("Errore", "Error")}
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
            {tr("Il Tavolo non e' ancora apparecchiato", "The Table is not ready yet")}
          </h1>
          <p style={{ color: "var(--color-text-soft)", fontSize: "0.9rem", marginBottom: "1.5rem" }}>
            {tr("Non ho ancora finito di guardare le tue partite. Torniamo da dove ci eravamo fermati.", "I have not finished looking at your games yet. Let's go back to where we left off.")}
          </p>
          <Link to="/onboarding/waiting" className="btn btn-primary">
            {tr("Riprendiamo", "Let's continue")}
          </Link>
        </div>
      </div>
    );
  }

  // ── Local derived values (render-only, not worth exporting) ──────────────

  // Top-3 anchors by rating_upside desc
  const anchorsRaw: Anchor[] = aggregates?.anchors ?? [];
  const anchorsTop3 = [...anchorsRaw]
    .sort((a, b) => (b.rating_upside ?? 0) - (a.rating_upside ?? 0))
    .slice(0, 3);

  // Momento pool: cadute preferred, fallback to examples
  const momentoPool: PositionExample[] = aggregates?.cadute ?? aggregates?.examples ?? [];

  // Letter: fresh detection.
  const hasVoice = llmVoice != null && llmVoice.trim().length > 0;
  const showLetter = hasVoice && !letterSeenBefore;

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
              {tr("E' arrivata una lettera", "A letter arrived")}
            </div>

            <NonnoLetter
              identity={letterIdentity!}
              onOpen={markLetterSeen}
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
                {tr("Toccala per aprirla.", "Tap to open it.")}
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

      {/* ── SOGLIA PARTITE — gate a tre vie prima di tutti i blocchi analitici ──
          Three cases, in order:
          1. fewGames && backgroundRunning  → "sto ancora guardando" (Nonno warm, no button)
          2. fewGames && !backgroundRunning → "poche partite vere" + "Aggiorna le partite"
          3. !fewGames (or no aggregates)   → full analytic blocks below
          The empty-state (!aggregates && !pmLite) is handled earlier and is unaffected. */}
      {(() => {
        const fewGames =
          aggregates != null && aggregates.games_analyzed < MIN_GAMES_FOR_INSIGHTS;

        // `reloading` keeps this branch alive during the ~300ms reload right
        // after the background finishes, so a >=25 user never flashes the
        // "few games" message before the full Tavolo arrives.
        if (fewGames && (backgroundRunning || reloading)) {
          // Case 1: first batch done, background still running — Nonno is still looking.
          const seen = progress?.gamesDone ?? 0;
          const total = progress?.gamesTotal ?? 0;
          return (
            <Reveal delay={120} className="mb-16">
              {/* Optional: show the Obiettivo block if data is available — it is
                  the user's own declared pact, not derived from deep analysis,
                  so it is honest to display even with only 10 games. */}
              {currentRating != null && targetRating > 0 && (
                <div style={{ marginBottom: "2rem" }}>
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
              <div
                style={{
                  fontFamily: "var(--font-voice)",
                  fontSize: "1rem",
                  color: "var(--color-text-soft)",
                  lineHeight: 1.65,
                  maxWidth: "38rem",
                }}
              >
                <p
                  className="nonno-pulse"
                  style={{ marginBottom: 0 }}
                >
                  {tr(
                    "Ho cominciato dalle tue ultime dieci partite e sto andando indietro nel tempo, una alla volta. Dammi ancora un momento e poi ci sediamo davvero. Tu intanto guarda pure in giro.",
                    "I started from your last ten games and I am working back through them one by one. Give me a moment more and then we sit down for real. Feel free to look around.",
                  )}
                </p>
                {total > 0 && (
                  <p
                    style={{
                      marginTop: "0.85rem",
                      marginBottom: 0,
                      fontSize: "0.85rem",
                      color: "var(--color-muted)",
                    }}
                  >
                    {tr("Ne ho guardate", "I have looked at")}{" "}
                    <span style={{ fontFamily: "var(--font-mono)", color: "var(--color-text-soft)" }}>
                      {seen}
                    </span>{" "}
                    {tr("su", "of")}{" "}
                    <span style={{ fontFamily: "var(--font-mono)", color: "var(--color-text-soft)" }}>
                      {total}
                    </span>
                    .
                  </p>
                )}
              </div>
            </Reveal>
          );
        }

        if (fewGames) {
          // Case 2: analysis finished but genuinely few games on Chess.com.
          return (
            <Reveal delay={120} className="mb-16">
              <div
                style={{
                  fontFamily: "var(--font-voice)",
                  fontSize: "1rem",
                  color: "var(--color-text-soft)",
                  lineHeight: 1.65,
                  maxWidth: "38rem",
                }}
              >
                <p style={{ marginBottom: "1rem" }}>
                  {tr("Per ora ho potuto guardare", "So far I have been able to look at")}{" "}
                  <span style={{ fontFamily: "var(--font-mono)", color: "var(--color-text)" }}>
                    {aggregates.games_analyzed}
                  </span>{" "}
                  {aggregates.games_analyzed === 1
                    ? tr("partita tua", "of your games")
                    : tr("partite tue", "of your games")}.
                  {" "}{tr(
                    "Da una venticinquina in su comincio a vedere i tuoi freni veri: giocane ancora qualcuna e torna, ti aspetto qui.",
                    "Around twenty-five games I start to see what is really holding you back. Play a few more and come back. I will be here.",
                  )}
                </p>
                <button
                  onClick={() => void handleRefresh()}
                  disabled={refreshing || reanalyzing}
                  style={{
                    background: "none",
                    border: "1px solid var(--color-line)",
                    borderRadius: "8px",
                    padding: "0.5rem 1rem",
                    cursor: refreshing || reanalyzing ? "default" : "pointer",
                    opacity: refreshing || reanalyzing ? 0.5 : 1,
                    color: "var(--color-text-soft)",
                    fontSize: "0.85rem",
                    fontFamily: "var(--font-body)",
                    transition: "border-color 140ms, color 140ms",
                  }}
                  onMouseEnter={(e) => { if (!refreshing && !reanalyzing) (e.currentTarget as HTMLButtonElement).style.borderColor = "var(--color-line-strong)"; }}
                  onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.borderColor = "var(--color-line)"; }}
                >
                  {refreshing ? tr("Preparo...", "One moment...") : tr("Aggiorna le partite", "Sync your games")}
                </button>
              </div>
            </Reveal>
          );
        }

        // Case 3: enough games analyzed — render full analytic blocks below.
        return (
        <>

      {/* ── 2. OBIETTIVO: il Patto scritto sulla parete ─────────────────────
          settle-in at 650ms: after Nonno finishes speaking (~500ms).
          targetRating guard: never render GoalHero with target=0 (no goal set). */}
      {currentRating != null && targetRating > 0 && (
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
              <div className="tt-eyebrow">{tr("Le tue 3 ancore", "Your 3 anchors")}</div>
              <Link
                to="/quaderno#percorso"
                style={{
                  fontSize: "0.75rem",
                  color: "var(--color-brand-soft)",
                  textDecoration: "none",
                  fontWeight: 600,
                }}
              >
                {tr("vedi tutte", "see all")}
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
              {tr("Quello che ti tiene ancorato giu'. In cima, l'ancora che ti vale piu' punti se la sciogli.", "What is holding you here. At the top, the one that is worth the most points if you close it.")}
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
          {refreshing ? tr("Preparo...", "One moment...") : tr("Aggiorna le partite", "Sync your games")}
        </button>
        <span style={{ color: "var(--color-faint)", padding: "0 0.4rem", userSelect: "none" }}> · </span>
        <button
          onClick={handleReanalyzeClick}
          disabled={refreshing || reanalyzing}
          style={{
            background: "none",
            border: "none",
            padding: 0,
            cursor: refreshing || reanalyzing ? "default" : "pointer",
            opacity: refreshing || reanalyzing ? 0.4 : 1,
            color: reanalyzeConfirming ? "var(--color-warn)" : "var(--color-faint)",
            fontSize: "inherit",
            fontFamily: "inherit",
            textDecoration: "underline",
            textDecorationColor: "color-mix(in srgb, var(--color-faint) 50%, transparent)",
            textUnderlineOffset: "2px",
            transition: "color 200ms ease",
          }}
        >
          {reanalyzing
            ? tr("Rianalizzando...", "Reanalyzing...")
            : reanalyzeConfirming
              ? tr("Sicuro? Ricomincio da zero", "Are you sure? This resets everything.")
              : tr("Rianalizza da capo", "Reanalyze from scratch.")}
        </button>
      </div>

        </>
        );
      })()}

    </div>
  );
}
