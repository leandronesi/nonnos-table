/**
 * TavoloHome — S3 redo (FASE 2, §5.2 BUILD.md).
 *
 * Ordine sezioni (il rituale):
 *   1. INGRESSO      — voce di Nonno (NonnoGreeting/frustata) DOMINANTE, CTA unica "Sediamoci al Tavolo"
 *   2. OBIETTIVO     — anello/hero-goal (oro) + riga progresso da goalProgress()
 *   3. LE TUE 3 ANCORE — top-3 by rating_upside desc, upside in oro, chip "stai migliorando"
 *   4. DETTAGLIO     — gap col target (maia_weighted) + GameArc + SpeedVsErrors + cadute (de-enfatizzati)
 *   5. NAVIGAZIONE   — links a Sessione / Quaderno in fondo
 *
 * Regole visive (DESIGN.md):
 *   - FLAT: profondita' tonal layers, niente ombre decorative
 *   - twilight <= 15% superficie, una sola CTA per schermo
 *   - ORO solo per l'Obiettivo e rating_upside ancore
 *   - niente gradient-text, niente em-dash, niente card-dentro-card
 *   - classi tt-* per le primitive del KIT (index.css KIT block)
 *   - classNames .tavolo-* per scoped layout
 */

import React, { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { downloadJson, quadernoPath } from "../auth/storage";
import { PRODUCT_NAME } from "../coaching";
import { runRefresh, runFullReanalyze } from "../pipeline/orchestrator";
import type { Aggregates, Anchor, PositionExample } from "../pipeline/aggregate";
import type { PlayerModelLite } from "../pipeline/playerModelLite";
import { goalProgress } from "../pipeline/history";
import { RatingCurveChart } from "../components/RatingCurveChart";
import { DecisionsCard } from "../components/DecisionsCard";
import { WeeklyTrendCard } from "../components/WeeklyTrendCard";
import { BoardView } from "../components/BoardView";
import { NonnoGreeting } from "../components/NonnoGreeting";
import { SpeedVsErrorsChart } from "../components/SpeedVsErrorsChart";
import { GameArcChart } from "../components/GameArcChart";
import { uciToArrow, cpToPawns, uciToSan } from "./quaderno/boardArrows";

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
}: {
  current: number;
  start: number;
  target: number;
  deadline: string;
  onTrack: boolean;
  pointsNeeded: number;
  rateNeeded: number | null;
  rateReal: number | null;
}) {
  const progress = Math.max(0, Math.min(1, (current - start) / Math.max(target - start, 1)));
  const fillPct = Math.round(progress * 100);
  const dl = deadline ? deadlineIt(deadline) : "";

  const progressLine = (() => {
    if (pointsNeeded <= 0) return "Obiettivo raggiunto.";
    const need = rateNeeded != null ? `+${rateNeeded.toFixed(1)}/sett` : null;
    const real = rateReal != null ? `vai a ${rateReal.toFixed(1)}` : null;
    if (need && real) return `Servono ${need}, ${real}.`;
    if (need) return `Servono ${need}.`;
    return `Mancano ${pointsNeeded} punti.`;
  })();

  return (
    <div
      style={{
        background: `
          radial-gradient(480px 240px at 90% -10%, color-mix(in srgb, var(--color-gold) 16%, transparent), transparent 60%),
          linear-gradient(180deg, color-mix(in srgb, var(--color-brand) 8%, transparent) 0%, transparent 55%),
          var(--color-surface-2)
        `,
        border: "1px solid color-mix(in srgb, var(--color-gold) 30%, transparent)",
        borderRadius: "14px",
        padding: "clamp(24px, 5vw, 40px)",
      }}
    >
      {/* Eyebrow */}
      <div className="tt-eyebrow tt-honey" style={{ marginBottom: "1.25rem" }}>
        Il tuo obiettivo
      </div>

      {/* Main row: current ← track → target */}
      <div
        style={{
          display: "flex",
          alignItems: "flex-end",
          justifyContent: "space-between",
          gap: "1rem",
          flexWrap: "wrap",
        }}
      >
        {/* Current */}
        <div>
          <div
            className="font-mono font-bold"
            style={{
              fontSize: "clamp(2.5rem, 6vw, 4.25rem)",
              lineHeight: 1,
              color: "var(--color-text)",
              fontVariantNumeric: "tabular-nums",
            }}
          >
            {current}
          </div>
          <div className="tt-eyebrow tt-muted" style={{ marginTop: "0.25rem" }}>oggi</div>
        </div>

        {/* Target in gold — La Regola del Miele */}
        <div style={{ textAlign: "right" }}>
          <div
            className="font-mono font-bold"
            style={{
              fontSize: "clamp(1.5rem, 3.5vw, 2.5rem)",
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

      {/* Track bar */}
      <div
        style={{
          marginTop: "1.25rem",
          height: "6px",
          borderRadius: "999px",
          background: "rgba(255,255,255,0.06)",
          position: "relative",
          overflow: "visible",
        }}
      >
        <div
          style={{
            width: `${fillPct}%`,
            height: "100%",
            borderRadius: "999px",
            background: "linear-gradient(90deg, var(--color-brand-soft), var(--color-gold-soft))",
            transition: "width 700ms cubic-bezier(0.23,1,0.32,1)",
            position: "relative",
          }}
        >
          {fillPct > 0 && (
            <div
              style={{
                position: "absolute",
                right: "-4px",
                top: "50%",
                transform: "translateY(-50%)",
                width: "10px",
                height: "10px",
                borderRadius: "999px",
                background: "var(--color-gold-soft)",
              }}
            />
          )}
        </div>
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
    </div>
  );
}

// ── AnchorRow ─────────────────────────────────────────────────────────────────

function AnchorRow({ anchor, rank }: { anchor: Anchor; rank: number }) {
  const improving =
    anchor.trend_now != null &&
    anchor.trend_now.direction === "improving" &&
    (anchor.trend_now.confidence === "medium" || anchor.trend_now.confidence === "high");

  return (
    <div
      style={{
        display: "flex",
        alignItems: "flex-start",
        gap: "1rem",
        padding: "1rem 0",
        borderBottom: "1px solid var(--color-line)",
      }}
    >
      {/* Rank number */}
      <div
        style={{
          flexShrink: 0,
          width: "2rem",
          height: "2rem",
          borderRadius: "999px",
          background: "var(--color-surface-3)",
          border: "1px solid var(--color-line-strong)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontFamily: "var(--font-mono)",
          fontWeight: 700,
          fontSize: "0.8rem",
          color: "var(--color-brand-soft)",
        }}
      >
        {rank}
      </div>

      {/* Label + chips */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            fontWeight: 600,
            fontSize: "0.95rem",
            color: "var(--color-text)",
            lineHeight: 1.3,
            marginBottom: "0.375rem",
          }}
        >
          {anchor.label_it}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", flexWrap: "wrap" }}>
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
      </div>
    </div>
  );
}

// ── Mini caduta board card ────────────────────────────────────────────────────

const MOTIF_LABEL: Record<string, string> = {
  pezzo_in_presa: "Pezzo in presa",
};

function CadutaCard({ caduta }: { caduta: PositionExample }) {
  const arrowPlayed = uciToArrow(caduta.played_uci, "rgba(239,68,68,0.85)");
  const arrowBest = uciToArrow(caduta.best_uci ?? null, "rgba(34,197,94,0.85)");
  const arrows = [arrowPlayed, arrowBest].filter(Boolean) as {
    from: string;
    to: string;
    color: string;
  }[];

  return (
    <div
      style={{
        background: "var(--color-surface)",
        border: "1px solid var(--color-line)",
        borderRadius: "10px",
        padding: "0.75rem",
      }}
    >
      <div style={{ display: "flex", justifyContent: "center" }}>
        <BoardView
          fen={caduta.fen_before}
          orientation={caduta.color}
          size={150}
          arrows={arrows}
        />
      </div>
      <div className="flex items-center gap-2 mt-2 flex-wrap">
        <span
          className="font-mono font-bold"
          style={{
            fontSize: "1.25rem",
            lineHeight: 1,
            color: "var(--color-danger)",
            fontVariantNumeric: "tabular-nums",
          }}
        >
          -{cpToPawns(caduta.cp_loss)}
        </span>
        <span
          className="tt-chip"
          style={{
            background: "rgba(96,165,250,0.12)",
            color: "var(--color-info, #60a5fa)",
            textTransform: "capitalize",
          }}
        >
          {caduta.phase}
        </span>
        {caduta.motif && (
          <span
            className="tt-chip tw"
          >
            {MOTIF_LABEL[caduta.motif] ?? caduta.motif}
          </span>
        )}
      </div>
      <div
        className="font-mono"
        style={{ fontSize: "0.7rem", color: "var(--color-muted)", marginTop: "0.375rem" }}
      >
        <span style={{ color: "var(--color-text-soft)" }}>{caduta.san}</span>
        {" "}
        <span style={{ color: "var(--color-faint)" }}>-&gt;</span>
        {" "}
        <span>{uciToSan(caduta.fen_before, caduta.best_uci ?? null)}</span>
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export function TavoloHome() {
  const { user, profile, refreshProfile } = useAuth();
  const nav = useNavigate();

  const [pmLite, setPmLite] = useState<PlayerModelLite | null>(null);
  const [aggregates, setAggregates] = useState<Aggregates | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [reanalyzing, setReanalyzing] = useState(false);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    (async () => {
      try {
        const [pm, agg] = await Promise.all([
          downloadJson<PlayerModelLite>(quadernoPath(user.id, "player_model_lite.json")),
          downloadJson<Aggregates>(quadernoPath(user.id, "aggregates.json")),
        ]);
        if (cancelled) return;
        setPmLite(pm);
        setAggregates(agg);
      } catch (e) {
        if (!cancelled) setError(String(e instanceof Error ? e.message : e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [user]);

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
          <div style={{ fontSize: "0.9rem", color: "var(--color-muted)" }}>Apparecchio…</div>
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
            Il Tavolo non e' ancora pronto
          </h1>
          <p style={{ color: "var(--color-text-soft)", fontSize: "0.9rem", marginBottom: "1.5rem" }}>
            Sembra che l'onboarding non sia stato completato. Riprendi da li'.
          </p>
          <Link to="/onboarding/waiting" className="btn btn-primary">
            Continua l'onboarding
          </Link>
        </div>
      </div>
    );
  }

  // ── Derived values ────────────────────────────────────────────────────────

  const goal = pmLite?.identity?.goal;
  const currentRating = goal?.current_rating ?? pmLite?.current_rating ?? null;
  const targetRating = profile?.goal_rating ?? goal?.target ?? 0;
  const startRating = goal?.start_rating ?? currentRating ?? 0;
  const onTrack = goal?.on_track ?? false;
  const deadline = goal?.deadline ?? "";

  // GoalProgress from history.ts
  const gp = goal ? goalProgress(goal) : null;

  // Top-3 anchors by rating_upside desc
  const anchorsRaw: Anchor[] = aggregates?.anchors ?? [];
  const anchorsTop3 = [...anchorsRaw]
    .sort((a, b) => (b.rating_upside ?? 0) - (a.rating_upside ?? 0))
    .slice(0, 3);

  // Cadute
  const caduteRaw: PositionExample[] = aggregates?.cadute ?? aggregates?.examples ?? [];
  const cadute3 = caduteRaw.slice(0, 3);

  // Phase bars
  const phases =
    aggregates?.by_phase != null
      ? [
          { key: "opening" as const, label: "Apertura",    pct: aggregates.by_phase.opening.blunder_pct,    moves: aggregates.by_phase.opening.moves },
          { key: "middlegame" as const, label: "Mediogioco", pct: aggregates.by_phase.middlegame.blunder_pct, moves: aggregates.by_phase.middlegame.moves },
          { key: "endgame" as const, label: "Finale",      pct: aggregates.by_phase.endgame.blunder_pct,    moves: aggregates.by_phase.endgame.moves },
        ]
      : [];

  const decisions = pmLite?.decisions ?? null;
  const weeklyTrend = pmLite?.weekly_trend ?? null;
  const showWeekly = weeklyTrend != null && weeklyTrend.last_7d.n_games >= 1;

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div
      className="mx-auto px-5 py-10 md:px-8 md:py-14"
      style={{ maxWidth: "56rem" }}
    >

        {/* ── 1. INGRESSO: voce di Nonno (dominante) ─────────────────── */}
        <Reveal>
          <NonnoGreeting
            goal={goal}
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
            onSediamoci={() => nav("/sessione")}
          />
        </Reveal>

        {/* ── 2. OBIETTIVO: hero-goal (oro) + riga progresso ─────────── */}
        {currentRating != null && (
          <Reveal delay={80} className="mb-8">
            <GoalHero
              current={currentRating}
              start={startRating}
              target={targetRating}
              deadline={deadline}
              onTrack={onTrack}
              pointsNeeded={gp?.points_needed ?? Math.max(0, targetRating - currentRating)}
              rateNeeded={gp?.rate_needed_per_week ?? null}
              rateReal={gp?.rate_real_per_week ?? null}
            />
          </Reveal>
        )}

        {/* ── 3. LE TUE 3 ANCORE ──────────────────────────────────────── */}
        {anchorsTop3.length > 0 && (
          <Reveal delay={160} className="mb-8">
            <div
              style={{
                background: "var(--color-surface)",
                border: "1px solid var(--color-line)",
                borderRadius: "14px",
                padding: "clamp(20px, 4vw, 32px)",
              }}
            >
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
                  to="/freni"
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
                Ordinate per potenziale di guadagno.
              </div>

              {/* List — no border on last row */}
              <div>
                {anchorsTop3.map((anchor, i) => (
                  <div
                    key={anchor.type}
                    style={i === anchorsTop3.length - 1 ? { borderBottom: "none" } : undefined}
                  >
                    <AnchorRow anchor={anchor} rank={i + 1} />
                  </div>
                ))}
              </div>
            </div>
          </Reveal>
        )}

        {/* ── 4. DETTAGLIO (secondario, de-enfatizzato) ───────────────── */}

        {/* Rating curve */}
        {pmLite != null && goal != null && (
          <Reveal delay={200} className="mb-8">
            <div
              style={{
                background: "var(--color-surface)",
                border: "1px solid var(--color-line)",
                borderRadius: "14px",
                padding: "clamp(20px, 4vw, 28px)",
              }}
            >
              <div className="tt-eyebrow" style={{ marginBottom: "1rem" }}>Curva di rating</div>
              <RatingCurveChart
                ratingCurve={pmLite.rating_curve}
                goal={goal}
              />
              <p style={{ fontSize: "0.72rem", color: "var(--color-muted)", marginTop: "0.5rem", lineHeight: 1.5 }}>
                Su tutto il tuo storico. L'analisi a fondo e' sulle partite recenti.
              </p>
            </div>
          </Reveal>
        )}

        {/* Gap col target (Maia) */}
        {aggregates?.maia_weighted != null && (() => {
          const mw = aggregates.maia_weighted!;
          return (
            <Reveal delay={220} className="mb-8">
              <div
                style={{
                  background: "var(--color-surface)",
                  border: "1px solid var(--color-line)",
                  borderRadius: "14px",
                  padding: "clamp(20px, 4vw, 28px)",
                }}
              >
                <div className="tt-eyebrow" style={{ marginBottom: "1rem", color: "var(--color-muted)" }}>
                  Il tuo gap col target
                </div>
                <p
                  style={{
                    fontSize: "0.92rem",
                    color: "var(--color-text-soft)",
                    lineHeight: 1.65,
                    margin: 0,
                  }}
                >
                  Su{" "}
                  <span className="font-mono font-bold" style={{ color: "var(--color-text)", fontVariantNumeric: "tabular-nums" }}>
                    {mw.errors_scored}
                  </span>{" "}
                  errori analizzati a fondo,{" "}
                  <span className="font-mono font-bold" style={{ color: "var(--color-danger)", fontVariantNumeric: "tabular-nums" }}>
                    {mw.avoidable}
                  </span>{" "}
                  erano alla tua portata. Sulle stesse posizioni un giocatore{" "}
                  {targetRating > 0 && (
                    <strong style={{ color: "var(--color-gold-soft)" }}>{targetRating}</strong>
                  )}{" "}
                  trova la mossa giusta il{" "}
                  <span className="font-mono font-bold" style={{ color: "var(--color-gold-soft)", fontVariantNumeric: "tabular-nums" }}>
                    {Math.round(mw.target_pct)}%
                  </span>{" "}
                  delle volte, tu il{" "}
                  <span className="font-mono font-bold" style={{ color: "var(--color-text)", fontVariantNumeric: "tabular-nums" }}>
                    {Math.round(mw.mine_pct)}%
                  </span>
                  . Quel{" "}
                  <span className="font-mono font-bold" style={{ color: "var(--color-brand-soft)", fontVariantNumeric: "tabular-nums" }}>
                    {Math.round(mw.gap_pct)}
                  </span>{" "}
                  punti di divario e' il tuo margine.
                </p>
              </div>
            </Reveal>
          );
        })()}

        {/* GameArcChart */}
        {aggregates?.maia_weighted != null && (
          <Reveal delay={240} className="mb-8">
            <GameArcChart
              maiaWeighted={aggregates.maia_weighted!}
              targetRating={targetRating > 0 ? targetRating : null}
            />
          </Reveal>
        )}

        {/* SpeedVsErrors */}
        {(pmLite?.time_management?.spent_vs_accuracy?.length ?? 0) > 0 && (
          <Reveal delay={260} className="mb-8">
            <SpeedVsErrorsChart
              data={pmLite!.time_management!.spent_vs_accuracy!}
              avoidable={aggregates?.maia_weighted?.spent_vs_avoidable}
            />
          </Reveal>
        )}

        {/* Secondary stats grid: Decisions + Weekly + Phase */}
        {(decisions != null || showWeekly || phases.length > 0) && (
          <Reveal delay={280} className="mb-8">
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
                gap: "1rem",
              }}
            >
              {decisions != null && (
                <div
                  style={{
                    background: "var(--color-surface)",
                    border: "1px solid var(--color-line)",
                    borderRadius: "14px",
                    padding: "1.25rem 1.5rem",
                  }}
                >
                  <div className="tt-eyebrow" style={{ marginBottom: "0.875rem", color: "var(--color-muted)" }}>
                    Decisioni
                  </div>
                  <DecisionsCard decisions={decisions} />
                </div>
              )}
              {showWeekly && weeklyTrend != null && (
                <WeeklyTrendCard trend={weeklyTrend} title="Settimana vs precedente" />
              )}
              {phases.length > 0 && (
                <div
                  style={{
                    background: "var(--color-surface)",
                    border: "1px solid var(--color-line)",
                    borderRadius: "14px",
                    padding: "1.25rem 1.5rem",
                  }}
                >
                  <div className="tt-eyebrow" style={{ marginBottom: "0.875rem", color: "var(--color-muted)" }}>
                    Errori gravi per fase
                  </div>
                  {phases.map((p) => (
                    <div
                      key={p.key}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "0.75rem",
                        paddingTop: "0.375rem",
                        paddingBottom: "0.375rem",
                      }}
                    >
                      <span
                        className="font-mono"
                        style={{ fontSize: "0.75rem", width: "5rem", textAlign: "right", color: "var(--color-text-soft)", flexShrink: 0 }}
                      >
                        {p.label}
                      </span>
                      <div style={{ flex: 1, height: "6px", borderRadius: "999px", background: "rgba(255,255,255,0.06)", overflow: "hidden" }}>
                        <div
                          style={{
                            width: `${Math.min(100, p.pct * 5)}%`,
                            height: "100%",
                            borderRadius: "999px",
                            background: "var(--color-brand-soft)",
                            transition: "width 600ms cubic-bezier(0.22,1,0.36,1)",
                          }}
                        />
                      </div>
                      <span
                        className="font-mono font-bold"
                        style={{ fontSize: "0.85rem", color: "var(--color-text)", flexShrink: 0, fontVariantNumeric: "tabular-nums" }}
                      >
                        {p.pct.toFixed(1)}%
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </Reveal>
        )}

        {/* Cadute preview */}
        {cadute3.length > 0 && (
          <Reveal delay={300} className="mb-8">
            <div>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  marginBottom: "0.75rem",
                }}
              >
                <div className="tt-eyebrow" style={{ color: "var(--color-muted)" }}>Le tue cadute</div>
                <Link
                  to="/cadute"
                  style={{ fontSize: "0.75rem", color: "var(--color-brand-soft)", textDecoration: "none", fontWeight: 600 }}
                >
                  vedi tutte
                </Link>
              </div>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
                  gap: "0.75rem",
                }}
              >
                {cadute3.map((c) => (
                  <CadutaCard key={c.fen_before + ":" + c.ply} caduta={c} />
                ))}
              </div>
            </div>
          </Reveal>
        )}

        {/* ── 5. AZIONI SECONDARIE (aggiorna / reanalizza) ──────────────── */}
        <Reveal delay={340} className="mb-8">
          <div
            style={{
              borderTop: "1px solid var(--color-line)",
              paddingTop: "1.25rem",
              display: "flex",
              gap: "0.75rem",
            }}
          >
            <button
              onClick={() => void handleRefresh()}
              disabled={refreshing || reanalyzing}
              className="btn btn-ghost btn-sm"
              style={{ flex: 1 }}
            >
              {refreshing ? "Preparo…" : "Aggiorna partite"}
            </button>
            <button
              onClick={() => void handleFullReanalyze()}
              disabled={refreshing || reanalyzing}
              className="btn btn-ghost btn-sm"
              style={{ flex: 1 }}
            >
              {reanalyzing ? "Rianalizzando…" : "Rianalizza da capo"}
            </button>
          </div>
        </Reveal>

    </div>
  );
}
