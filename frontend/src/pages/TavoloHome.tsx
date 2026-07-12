/**
 * TavoloHome — Il Tavolo "il perche'", letto da Nonno.
 *
 * Ordine blocchi (SPRINT_OOUX.md §5 — una sola schermata, decisione PO 2026-06-01):
 *   1. INGRESSO   — NonnoGreeting (voce dominante, con la memoria visibile fusa
 *                   come prima riga quiet)
 *   2. DATI       — stato e aggiornamento, secondari rispetto alla sessione
 *   3. OBIETTIVO  — GoalHero (oro)
 *   4. MOMENTO    — MomentoDelGiorno (la spina resa posizione)
 *   5. ANCORE     — top-3 cliccabili -> /quaderno#percorso ("dove perdi, in breve")
 *   6. VARCO      — riga quiet -> /quaderno (la sala d'analisi)
 *
 * Il GAP col target (maia_weighted) NON e' piu' un riquadro: era un muro di sei
 * numeri in prosa (estetica Aimchess). Vive ora nella VOCE di Nonno e nel Quaderno.
 *
 * Regole visive (DESIGN.md):
 *   - FLAT: profondita' tonal layers, niente ombre decorative
 *   - twilight <= 15% superficie, una sola CTA LOUD per schermo (in NonnoGreeting)
 *   - ORO solo per l'Obiettivo
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
import { MomentoDelGiorno } from "../components/MomentoDelGiorno";
import type { AnchorTrail } from "../types";
import { useTavoloData } from "./tavolo/useTavoloData";
import { useOnboardingRun } from "../pipeline/OnboardingRunContext";
import { FREE_GAME_CAP } from "../pipeline/config";
import { selectedGamesForDisplay } from "../pipeline/analysisRunSemantics";
import { tr, getLang } from "../i18n/lang";
import { getAnchorLabel, getAnchorMeta } from "../i18n/anchors";
import { trackEvent } from "../lib/telemetry";
import {
  loadSession,
  sessionIsTodayAndDone,
  sessionIsTodayAndInProgress,
} from "../session/store";

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

function formatDatasetTimestamp(value: string | null | undefined): string {
  if (!value) return tr("non ancora disponibile", "not available yet");
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return tr("data non disponibile", "date unavailable");
  return new Intl.DateTimeFormat(getLang() === "en" ? "en-GB" : "it-IT", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(parsed);
}

function DatasetStatus({
  generatedAt,
  analyzed,
  backgroundRunning,
  backgroundError,
  backgroundCoverage,
  progress,
  refreshing,
  reanalyzing,
  reloading,
  refreshError,
  refreshNotice,
  onRefresh,
  onRetryBackground,
}: {
  generatedAt?: string | null;
  analyzed: number;
  backgroundRunning: boolean;
  backgroundError: string | null;
  backgroundCoverage: { selected: number; succeeded: number; failed: number } | null;
  progress: {
    gamesDone: number;
    gamesAnalyzed: number;
    gamesTotal: number;
    corpusFinalized?: boolean;
  } | null;
  refreshing: boolean;
  reanalyzing: boolean;
  reloading: boolean;
  refreshError: string | null;
  refreshNotice: string | null;
  onRefresh: () => void;
  onRetryBackground: () => void;
}) {
  const busy = backgroundRunning || refreshing || reanalyzing || reloading;
  const selected = selectedGamesForDisplay(progress, backgroundCoverage) ?? 0;
  const successful = backgroundCoverage?.succeeded ?? progress?.gamesAnalyzed ?? analyzed;
  const unsuccessful = backgroundCoverage?.failed ?? (progress
    && progress.corpusFinalized === true
    ? Math.max(0, progress.gamesDone - progress.gamesAnalyzed)
    : 0);
  const corpusScanning =
    backgroundRunning &&
    !backgroundCoverage &&
    progress?.corpusFinalized === false;
  const partialCompletion = (backgroundCoverage?.failed ?? 0) > 0;
  const canRetry = Boolean(backgroundError) || partialCompletion;
  const hasAttention = Boolean(
    backgroundError || partialCompletion || refreshError || refreshNotice || busy,
  );
  const coverageText = selected > 0
    ? tr(
        `${successful} analisi riuscite su ${selected} partite selezionate${unsuccessful > 0 ? `; ${unsuccessful} non completate` : ""}.`,
        `${successful} successful analyses out of ${selected} selected games${unsuccessful > 0 ? `; ${unsuccessful} not completed` : ""}.`,
      )
    : tr(
        `${analyzed} ${analyzed === 1 ? "partita analizzata" : "partite analizzate"} nel dataset corrente.`,
        `${analyzed} ${analyzed === 1 ? "game analyzed" : "games analyzed"} in the current dataset.`,
      );
  const compactCoverageText = selected > 0
    ? tr(`${successful}/${selected} analisi riuscite`, `${successful}/${selected} successful analyses`)
    : tr(
        `${analyzed} ${analyzed === 1 ? "partita analizzata" : "partite analizzate"}`,
        `${analyzed} ${analyzed === 1 ? "game analyzed" : "games analyzed"}`,
      );
  let statusText: string;
  if (backgroundError) {
    statusText = tr(
      `Il completamento si è interrotto. ${coverageText} La prima lettura e i dati pronti restano disponibili.`,
      `Profile completion stopped. ${coverageText} Your first reading and completed data remain available.`,
    );
  } else if (partialCompletion) {
    statusText = tr(
      `Profilo aggiornato con ${successful} analisi riuscite su ${selected} partite selezionate. ${unsuccessful} non hanno prodotto un'analisi valida e non sono usate nella lettura.`,
      `Profile updated with ${successful} successful analyses out of ${selected} selected games. ${unsuccessful} did not produce a valid analysis and are not used in the reading.`,
    );
  } else if (refreshError) {
    statusText = refreshError;
  } else if (refreshNotice) {
    statusText = refreshNotice;
  } else if (corpusScanning) {
    statusText = tr(
      `${successful} ${successful === 1 ? "analisi riuscita" : "analisi riuscite"}. Cerco altre partite della cadenza scelta, fino a ${FREE_GAME_CAP}; il totale reale arriva a fine scansione.`,
      `${successful} successful ${successful === 1 ? "analysis" : "analyses"}. Looking for more games in the selected time control, up to ${FREE_GAME_CAP}; the real total appears when scanning finishes.`,
    );
  } else if (backgroundRunning) {
    statusText = tr(
      `${coverageText} Continuo a completare il profilo mentre usi il Tavolo.`,
      `${coverageText} I am continuing to complete the profile while you use the Table.`,
    );
  } else if (reloading) {
    statusText = tr("Sto aggiornando la lettura con i risultati pronti.", "Updating the reading with the completed results.");
  } else {
    statusText = tr(`Lettura pronta. ${coverageText}`, `Reading ready. ${coverageText}`);
  }

  return (
    <aside
      className="mb-4 border-y border-[color:var(--color-line)] py-2.5 sm:mb-8 sm:py-3"
      aria-label={tr("Stato dei dati", "Data status")}
      aria-busy={busy}
    >
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="tt-eyebrow mb-1">{tr("Dati del Tavolo", "Table data")}</div>
          {!hasAttention && (
            <p className="m-0 text-xs leading-relaxed text-[color:var(--color-text-soft)]">
              {compactCoverageText}
            </p>
          )}
          <p className="mt-1 mb-0 text-[11px] leading-snug text-[color:var(--color-faint)]">
            {tr("Ultima lettura", "Latest reading")}: {formatDatasetTimestamp(generatedAt)}
          </p>
        </div>
        <button
          type="button"
          className="btn btn-ghost min-h-11 shrink-0"
          onClick={canRetry ? onRetryBackground : onRefresh}
          disabled={!canRetry && busy}
          style={{
            background: "transparent",
            borderColor: "color-mix(in srgb, var(--color-text-soft) 55%, var(--color-line))",
            color: "var(--color-text-soft)",
          }}
        >
          {backgroundError
            ? tr("Riprova completamento", "Retry completion")
            : partialCompletion
              ? tr(
                  `Riprova ${unsuccessful} ${unsuccessful === 1 ? "analisi" : "analisi"}`,
                  `Retry ${unsuccessful} ${unsuccessful === 1 ? "analysis" : "analyses"}`,
                )
            : busy
              ? tr("Aggiornamento in corso", "Update in progress")
              : tr("Controlla nuove partite", "Check for new games")}
        </button>
      </div>
      {hasAttention && (
        <p className="mt-3 mb-0 text-sm leading-relaxed text-[color:var(--color-text-soft)]" role="status" aria-live="polite">
          {statusText}
        </p>
      )}
      {canRetry && (
        <p className="mt-1.5 mb-0 text-[11px] leading-snug text-[color:var(--color-faint)]">
          {backgroundError
            ? tr("Riparte dal punto salvato; il Tavolo resta utilizzabile.", "Restarts from the saved checkpoint; the Table remains usable.")
            : tr("Ritenta solo le partite non riuscite; il Tavolo resta utilizzabile.", "Retries only the failed games; the Table remains usable.")}
        </p>
      )}
    </aside>
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
  trendReady,
}: {
  current: number;
  start: number;
  target: number;
  deadline: string;
  onTrack: boolean;
  pointsNeeded: number;
  rateNeeded: number | null;
  rateReal: number | null;
  trendReady: boolean;
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
    if (!trendReady) {
      return tr(
        "Servono almeno 14 giorni e 10 partite dopo l'onboarding per stimare il ritmo. Per ora mostro rating attuale e obiettivo.",
        "At least 14 days and 10 post-onboarding games are needed to estimate pace. For now, this shows current rating and goal.",
      );
    }
    const need = rateNeeded != null ? rateNeeded.toFixed(1) : null;
    const real = rateReal != null ? rateReal.toFixed(1) : null;
    if (need && real) {
      if (onTrack) return tr(`Se il ritmo medio dall'inizio del piano, ${real} punti a settimana, continuasse, sarebbe compatibile con quello richiesto.`, `If the average pace since the plan began, ${real} points a week, continued, it would be compatible with the required pace.`);
      return tr(`Se il ritmo medio dall'inizio del piano, ${real} punti a settimana, continuasse, resterebbe sotto i ${need} richiesti.`, `If the average pace since the plan began, ${real} points a week, continued, it would remain below the required ${need}.`);
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

      <p style={{ margin: "0.875rem 0 0", maxWidth: "42rem", fontSize: "0.88rem", lineHeight: 1.55, color: "var(--color-text-soft)" }}>
        {progressLine}
      </p>

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

  // Direction and confidence are canonical outputs of history.ts (20% +
  // materiality rules). Low-confidence trails keep the line but no verdict.
  const showDirection = trail.confidence === "medium" || trail.confidence === "high";
  const isImproving = showDirection && trail.direction === "improving";
  const isWorsening = showDirection && trail.direction === "worsening";

  // Label shown next to sparkline: "cala" = fewer errors = good (green),
  // "sale" = more errors = bad (warn color).
  const dirLabel = isImproving
    ? tr("cala", "falling")
    : isWorsening
    ? tr("sale", "rising")
    : null;
  const dirColor = isImproving
    ? "var(--color-ok, #34d399)"
    : isWorsening
    ? "var(--color-warn, #f5a524)"
    : "var(--color-faint)";

  return (
    <div
      style={{ flexShrink: 0, display: "flex", flexDirection: "column", alignItems: "center", gap: "0.15rem" }}
    >
      <div
        className={drawn ? "ink-drawn" : ""}
        ref={inkRef as React.RefCallback<HTMLDivElement>}
        style={{ lineHeight: 0 }}
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
      {dirLabel && (
        <div
          aria-label={
            isImproving
              ? tr("questa ancora sta calando", "this anchor is improving")
              : tr("questa ancora sta salendo", "this anchor is worsening")
          }
          style={{
            fontSize: "0.58rem",
            fontFamily: "var(--font-mono)",
            fontWeight: 700,
            letterSpacing: "0.04em",
            color: dirColor,
            lineHeight: 1,
            textAlign: "center",
          }}
        >
          {dirLabel}
        </div>
      )}
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
  const avoidable = anchor.count_avoidable ?? 0;
  const displayCount = avoidable > 0 ? avoidable : anchor.count;
  const evidenceParts: string[] = [];
  if (displayCount > 0) {
    evidenceParts.push(avoidable > 0
      ? tr(
          `${displayCount} ${displayCount === 1 ? "errore" : "errori"} con alternative supportate da Maia al tuo livello`,
          `${displayCount} ${displayCount === 1 ? "error" : "errors"} with Maia-supported alternatives at your level`,
        )
      : tr(
          `${displayCount} ${displayCount === 1 ? "errore" : "errori"}`,
          `${displayCount} ${displayCount === 1 ? "error" : "errors"}`,
        ));
  }
  if (anchor.share_of_errors > 0) {
    evidenceParts.push(tr(
      `${Math.round(anchor.share_of_errors * 100)}% degli errori osservati`,
      `${Math.round(anchor.share_of_errors * 100)}% of observed errors`,
    ));
  }
  if (anchor.games_with > 0) {
    evidenceParts.push(tr(
      `in ${anchor.games_with} ${anchor.games_with === 1 ? "partita" : "partite"}`,
      `across ${anchor.games_with} ${anchor.games_with === 1 ? "game" : "games"}`,
    ));
  }

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

        {/* Label + evidence in one natural line. */}
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
          {evidenceParts.length > 0 && (
            <p style={{ margin: 0, fontSize: "0.78rem", color: "var(--color-muted)", lineHeight: 1.5 }}>
              {evidenceParts.join(" · ")}
              {improving && (
                <span style={{ color: "var(--color-ok)" }}>
                  {tr(" · in miglioramento", " · improving")}
                </span>
              )}
            </p>
          )}
          {/* Action line — what to do about this anchor */}
          {(() => {
            const action = getAnchorMeta(anchor.type, lang, {
              label_it: anchor.label_it,
              action_it: anchor.action_it,
            }).action;
            return action ? (
              <div style={{
                marginTop: "0.3rem",
                fontSize: "0.72rem",
                color: "var(--color-faint)",
                lineHeight: 1.4,
                fontStyle: "italic",
              }}>
                {action}
              </div>
            ) : null;
          })()}
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
    <button
      type="button"
      onClick={onNavigate}
      onMouseEnter={() => setArrowShift(4)}
      onMouseLeave={() => setArrowShift(0)}
      className="min-h-11 text-left"
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "0.625rem",
        cursor: "pointer",
        userSelect: "none",
        padding: 0,
        border: 0,
        background: "transparent",
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
    </button>
  );
}

// Minimum number of analyzed games before the analytic blocks are shown.
// Below this threshold Nonno explains honestly rather than leaving blank gaps.
const MIN_GAMES_FOR_INSIGHTS = 25;

// ── Main component ────────────────────────────────────────────────────────────

export function TavoloHome() {
  const nav = useNavigate();

  useEffect(() => {
    trackEvent("table_viewed");
  }, []);

  const {
    pmLite,
    aggregates,
    llmVoice,
    loading,
    error,
    refreshing,
    reanalyzing,
    refreshError,
    refreshNotice,
    memoriaVisibile,
    liveGoal,
    currentRating,
    startRating,
    targetRating,
    deadline,
    onTrack,
    goalProgressData: gp,
    goalTrendReady,
    anchorTrails,
    letterIdentity,
    letterSeenBefore,
    markLetterSeen,
    reloading,
    runRefreshHandler: handleRefresh,
    runFullReanalyzeHandler: handleFullReanalyze,
  } = useTavoloData();

  // Background progress distinguishes indexed corpus from successful analyses.
  const {
    backgroundRunning,
    backgroundError,
    backgroundCoverage,
    retryBackground,
    progress,
  } = useOnboardingRun();
  const storedSession = loadSession();
  const sessionStatus = sessionIsTodayAndDone(storedSession)
    ? "completed" as const
    : sessionIsTodayAndInProgress(storedSession)
      ? "in_progress" as const
      : "new" as const;

  // Two-step confirm gate for "Rianalizza da capo" (irreversible, heavy operation).
  // First click: confirming=true, button text changes to "Sicuro? Ricomincio da zero".
  // Second click within 4s: executes. No click / 4s timeout: resets to idle.
  const [reanalyzeConfirming, setReanalyzeConfirming] = useState(false);
  const reanalyzeConfirmTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const presentedLetterRef = useRef<string | null>(null);

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

  // A fresh coach brief is already visible in the greeting: mark it as seen
  // without hiding the primary session action behind a folded-letter gate.
  useEffect(() => {
    if (
      !llmVoice?.trim()
      || letterSeenBefore
      || !letterIdentity
      || presentedLetterRef.current === letterIdentity
    ) return;
    presentedLetterRef.current = letterIdentity;
    markLetterSeen();
  }, [letterIdentity, letterSeenBefore, llmVoice, markLetterSeen]);

  // ── Loading ──────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div
        className="min-h-screen flex items-center justify-center"
        style={{ background: "var(--color-bg)" }}
        role="status"
        aria-live="polite"
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
          role="alert"
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
          <button
            type="button"
            className="btn btn-ghost min-h-11 w-full sm:w-auto"
            onClick={() => void handleRefresh()}
            disabled={refreshing || reanalyzing}
          >
            {refreshing ? tr("Aggiornamento in corso", "Update in progress") : tr("Riprova aggiornamento", "Retry update")}
          </button>
          <p className="mt-2 mb-0 text-xs text-[color:var(--color-faint)]">
            {tr("Riprova a caricare e aggiornare le partite; i dati già salvati non vengono cancellati.", "Retries loading and updating games; saved data is not deleted.")}
          </p>
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
            {tr("Il Tavolo non è ancora apparecchiato", "The Table is not ready yet")}
          </h1>
          <p style={{ color: "var(--color-text-soft)", fontSize: "0.9rem", marginBottom: "1.5rem" }}>
            {tr("Non ho ancora finito di guardare le tue partite. Torniamo da dove ci eravamo fermati.", "I have not finished looking at your games yet. Let's go back to where we left off.")}
          </p>
          <Link to="/onboarding/waiting" className="btn btn-primary min-h-11 w-full sm:w-auto">
            {tr("Riprendiamo", "Let's continue")}
          </Link>
          <p className="mt-3 mb-2 text-xs text-[color:var(--color-faint)]">
            {tr("Apre lo stato della prima lettura e riparte dal punto salvato.", "Opens first-reading status and resumes from the saved checkpoint.")}
          </p>
          <button
            type="button"
            className="btn btn-ghost min-h-11 w-full sm:w-auto"
            onClick={() => void handleRefresh()}
            disabled={refreshing || reanalyzing}
          >
            {tr("Controlla nuove partite", "Check for new games")}
          </button>
        </div>
      </div>
    );
  }

  // ── Local derived values (render-only, not worth exporting) ──────────────

  // Top-3 anchors by the existing relative priority score (never presented as Elo).
  const anchorsRaw: Anchor[] = aggregates?.anchors ?? [];
  const anchorsTop3 = [...anchorsRaw]
    .sort((a, b) => b.weighted_score - a.weighted_score)
    .slice(0, 3);

  // Momento pool: cadute preferred, fallback to examples
  const momentoPool: PositionExample[] = aggregates?.cadute ?? aggregates?.examples ?? [];

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div
      className="mx-auto px-5 py-4 sm:py-10 md:px-8 md:py-14"
      style={{ maxWidth: "60rem" }}
    >

      <DatasetStatus
        generatedAt={aggregates?.generated_at ?? pmLite?.generated_at}
        analyzed={aggregates?.games_analyzed ?? pmLite?.kpi.games_analyzed ?? 0}
        backgroundRunning={backgroundRunning}
        backgroundError={backgroundError}
        backgroundCoverage={backgroundCoverage}
        progress={progress}
        refreshing={refreshing}
        reanalyzing={reanalyzing}
        reloading={reloading}
        refreshError={refreshError}
        refreshNotice={refreshNotice}
        onRefresh={() => void handleRefresh()}
        onRetryBackground={retryBackground}
      />

      {/* ════════════════════════════════════════════════════════════════════
          ATTO 1 — la spina del giorno (il colpo d'occhio).
          Ingresso, Obiettivo, Momento: la testa della pagina. Piu' aria,
          piu' peso, entra per prima. E' qui che cade l'occhio aprendo.
          ════════════════════════════════════════════════════════════════════ */}

      {/* ── 1. INGRESSO: voce e azione primaria, immediatamente disponibili. */}
      <div className="mb-16">
        <NonnoGreeting
          goal={liveGoal}
          memoria={memoriaVisibile}
          topAnchor={aggregates?.anchors?.[0] ?? null}
          decisions={
            pmLite?.decisions != null
              ? {
                  blow_rate: pmLite.decisions.blow_rate,
                  blew_winning: pmLite.decisions.blew_winning,
                  reached_winning: pmLite.decisions.reached_winning,
                }
              : null
          }
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
          sessionStatus={sessionStatus}
          voiceMessage={llmVoice ?? null}
        />
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
          const analyzed = progress?.gamesAnalyzed ?? 0;
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
                    trendReady={goalTrendReady}
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
                    "La lettura sulle prime 10 partite della cadenza scelta è provvisoria. Ora continuo in background, fino a 100 della stessa cadenza, per rendere il profilo più stabile. Puoi già usare il Tavolo.",
                    "The reading from the first 10 games in the selected time control is provisional. I am continuing in the background, up to 100 from that same control, to make the profile more stable. You can already use the Table.",
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
                    {tr("Analisi riuscite", "Successful analyses")}{" "}
                    <span style={{ fontFamily: "var(--font-mono)", color: "var(--color-text-soft)" }}>
                      {analyzed}
                    </span>{" "}
                    {tr("su", "of")}{" "}
                    <span style={{ fontFamily: "var(--font-mono)", color: "var(--color-text-soft)" }}>
                      {total}
                    </span>
                    {tr(" partite trovate nel corpus.", " games found in the corpus.")}
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
                    ? tr("partita del profilo", "profile game")
                    : tr("partite del profilo", "profile games")}.
                  {" "}{tr(
                    "Con circa venticinque partite il confronto usa un campione più ampio. Aggiungine altre e aggiorna il Tavolo.",
                    "At around twenty-five games, the comparison uses a broader sample. Add more games, then update the Table.",
                  )}
                </p>
                <p className="m-0 text-xs text-[color:var(--color-faint)]">
                  {tr(
                    "Per cercarne altre usa Controlla nuove partite nello stato dati qui sopra.",
                    "To look for more, use Check for new games in the data status above.",
                  )}
                </p>
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
            trendReady={goalTrendReady}
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
          numeri in prosa (estetica Aimchess). Il confronto resta nel Quaderno;
          la voce di Nonno usa solo i campi Maia dell'ancora mostrata. */}
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
                className="inline-flex min-h-11 items-center"
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
              {tr(
                "Quello che ritorna nelle tue partite. In cima, la priorità calcolata da ricorrenza, impatto e allenabilità.",
                "What keeps returning in your games. At the top, the priority based on recurrence, impact, and trainability."
              )}
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

      {/* Advanced maintenance stays discoverable without duplicating the
          always-visible update action above the analytical sections. */}
      <Reveal delay={300} className="mb-10">
        <details className="border-t border-[color:var(--color-line)] pt-4 text-sm text-[color:var(--color-muted)]">
          <summary className="flex min-h-11 cursor-pointer items-center py-2 text-[color:var(--color-text-soft)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--color-brand-soft)]">
            {tr("Opzioni dati avanzate", "Advanced data options")}
          </summary>
          <p className="mt-2 mb-3 max-w-xl text-xs leading-relaxed text-[color:var(--color-faint)]">
            {tr(
              "Rianalizza da capo ricalcola tutte le partite del corpus corrente. Usalo solo se vuoi rigenerare i dati già elaborati.",
              "Reanalyze from scratch recalculates every game in the current corpus. Use it only to regenerate existing analysis.",
            )}
          </p>
          <button
            onClick={handleReanalyzeClick}
            disabled={refreshing || reanalyzing}
            className="btn btn-ghost min-h-11 w-full sm:w-auto"
            style={{ color: reanalyzeConfirming ? "var(--color-warn)" : "var(--color-faint)" }}
          >
            {reanalyzing
              ? tr("Rianalizzando...", "Reanalyzing...")
              : reanalyzeConfirming
                ? tr("Sicuro? Ricomincio da zero", "Are you sure? This resets everything.")
                : tr("Rianalizza da capo", "Reanalyze from scratch.")}
          </button>
        </details>
      </Reveal>

      <Reveal delay={340} className="mb-10">
        <Link
          to="/settings#feedback"
          className="inline-flex min-h-11 items-center"
          onClick={() => trackEvent("feedback_opened", { source: "table_footer" })}
          style={{
            fontSize: "0.8rem",
            color: "var(--color-brand-soft)",
            textUnderlineOffset: "3px",
          }}
        >
          {tr("Questa lettura ti somiglia? Lascia un feedback", "Does this reading feel like you? Leave feedback")}
        </Link>
      </Reveal>

        </>
        );
      })()}

    </div>
  );
}
