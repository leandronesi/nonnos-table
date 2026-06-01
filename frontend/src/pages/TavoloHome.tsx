/**
 * TavoloHome — Il Tavolo "il perche'", letto da Nonno.
 *
 * Ordine blocchi (SPRINT_OOUX.md §5 — una sola schermata, decisione PO 2026-06-01):
 *   1. INGRESSO   — NonnoGreeting (voce dominante) + memoria visibile (journal)
 *   2. OBIETTIVO  — GoalHero (oro)
 *   3. MOMENTO    — MomentoDelGiorno (la spina resa posizione)
 *   4. GAP        — maia_weighted, solo testo tagliente (GameArc vive nel Quaderno)
 *   5. ANCORE     — top-3 cliccabili -> /quaderno#percorso ("dove perdi, in breve")
 *   6. VARCO      — card-soglia quiet -> /quaderno (la sala d'analisi)
 *   7. AZIONI     — ghost, in fondo (aggiorna / rianalizza)
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
import { downloadJson, quadernoPath } from "../auth/storage";
import { PRODUCT_NAME } from "../coaching";
import { runRefresh, runFullReanalyze } from "../pipeline/orchestrator";
import type { Aggregates, Anchor, PositionExample } from "../pipeline/aggregate";
import type { PlayerModelLite } from "../pipeline/playerModelLite";
import { goalProgress } from "../pipeline/history";
import { NonnoGreeting } from "../components/NonnoGreeting";
import { MomentoDelGiorno } from "../components/MomentoDelGiorno";
import { readEntries } from "../session/journal";

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

      {/* Main row: current <- track -> target */}
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
    return `${whenClause} ci siamo seduti insieme. Riprendiamo da li'.`;
  }
  // No full session yet, but some activity happened: keep it light, no raw body.
  return `${whenClause} sei passato dal Tavolo. Bene, riprendiamo.`;
}


// ── Main component ────────────────────────────────────────────────────────────

export function TavoloHome() {
  const { user, profile, refreshProfile } = useAuth();
  const nav = useNavigate();
  const { dataVersion } = useOnboardingRun();

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

  // Momento pool: cadute preferred, fallback to examples
  const momentoPool: PositionExample[] = aggregates?.cadute ?? aggregates?.examples ?? [];

  // Journal: "memoria visibile" — recomposed in Nonno's voice (prefers the last
  // full session, leans on the TIME tic). Reads localStorage synchronously.
  const memoriaVisibile = buildMemoria();

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div
      className="mx-auto px-5 py-10 md:px-8 md:py-14"
      style={{ maxWidth: "56rem" }}
    >

      {/* ════════════════════════════════════════════════════════════════════
          ATTO 1 — la spina del giorno (il colpo d'occhio).
          Ingresso, Obiettivo, Momento, Gap: la testa della pagina. Piu' aria,
          piu' peso, entra per prima. E' qui che cade l'occhio aprendo.
          ════════════════════════════════════════════════════════════════════ */}

      {/* ── 1. INGRESSO: voce di Nonno + memoria visibile ──────────────── */}
      <Reveal className="mb-10">
        {/* Memoria visibile — quiet row above NonnoGreeting, omitted if journal empty */}
        {memoriaVisibile && (
          <div
            style={{
              marginBottom: "0.875rem",
              padding: "0.625rem 0.875rem",
              background: "var(--color-surface-2)",
              border: "1px solid var(--color-line)",
              borderRadius: "8px",
              fontSize: "0.78rem",
              color: "var(--color-muted)",
              lineHeight: 1.5,
            }}
          >
            {memoriaVisibile}
          </div>
        )}

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

      {/* ── 2. OBIETTIVO: hero-goal (oro) ──────────────────────────────── */}
      {currentRating != null && (
        <Reveal delay={80} className="mb-10">
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

      {/* ── 3. IL MOMENTO DEL GIORNO (la spina resa posizione) ─────────── */}
      {momentoPool.length > 0 && (
        <Reveal delay={140} className="mb-10">
          <MomentoDelGiorno
            pool={momentoPool}
            targetRating={targetRating > 0 ? targetRating : null}
          />
        </Reveal>
      )}

      {/* ── 4. IL GAP COL TARGET (solo testo — il grafico vive nel Quaderno) ── */}
      {aggregates?.maia_weighted != null && (() => {
        const mw = aggregates.maia_weighted!;
        return (
          <Reveal delay={180} className="mb-10">
            <div
              style={{
                background: "var(--color-surface)",
                border: "1px solid var(--color-line)",
                borderRadius: "14px",
                padding: "clamp(22px, 4vw, 30px)",
              }}
            >
              <div className="tt-eyebrow" style={{ marginBottom: "1rem", color: "var(--color-gold-soft)" }}>
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
                Ho guardato a fondo{" "}
                <span className="font-mono font-bold" style={{ color: "var(--color-text)", fontVariantNumeric: "tabular-nums" }}>
                  {mw.errors_scored}
                </span>{" "}
                dei tuoi errori:{" "}
                <span className="font-mono font-bold" style={{ color: "var(--color-danger)", fontVariantNumeric: "tabular-nums" }}>
                  {mw.avoidable}
                </span>{" "}
                erano alla tua portata. Sulle stesse posizioni,{" "}
                {targetRating > 0 ? (
                  <>
                    uno al tuo{" "}
                    <strong style={{ color: "var(--color-gold-soft)" }}>{targetRating}</strong>
                  </>
                ) : (
                  "il giocatore che vuoi diventare"
                )}{" "}
                la mossa giusta la trova il{" "}
                <span className="font-mono font-bold" style={{ color: "var(--color-gold-soft)", fontVariantNumeric: "tabular-nums" }}>
                  {Math.round(mw.target_pct)}%
                </span>{" "}
                delle volte, tu il{" "}
                <span className="font-mono font-bold" style={{ color: "var(--color-text)", fontVariantNumeric: "tabular-nums" }}>
                  {Math.round(mw.mine_pct)}%
                </span>
                . Quei{" "}
                <span className="font-mono font-bold" style={{ color: "var(--color-brand-soft)", fontVariantNumeric: "tabular-nums" }}>
                  {Math.round(mw.gap_pct)}
                </span>{" "}
                punti di scarto sono il tuo margine da prendere.
              </p>
            </div>
          </Reveal>
        );
      })()}

      {/* ── 5. DOVE PERDI, IN BREVE (top-3 ancore, cliccabili) ─────────── */}
      {anchorsTop3.length > 0 && (
        <Reveal delay={220} className="mb-10">
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

      {/* ── 6. VARCO AL QUADERNO (quiet, surface-2, flat, no em-dash) ─────── */}
      <Reveal delay={260} className="mb-10">
        <div
          role="button"
          tabIndex={0}
          onClick={() => nav("/quaderno")}
          onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); nav("/quaderno"); } }}
          style={{
            background: "var(--color-surface-2)",
            border: "1px solid var(--color-line)",
            borderRadius: "14px",
            padding: "clamp(20px, 4vw, 28px)",
            cursor: "pointer",
            transition: "border-color 160ms cubic-bezier(0.23,1,0.32,1)",
          }}
          onMouseEnter={(e) => { (e.currentTarget as HTMLDivElement).style.borderColor = "var(--color-line-strong)"; }}
          onMouseLeave={(e) => { (e.currentTarget as HTMLDivElement).style.borderColor = "var(--color-line)"; }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "flex-start",
              justifyContent: "space-between",
              gap: "1rem",
            }}
          >
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="tt-eyebrow tt-muted" style={{ marginBottom: "0.5rem" }}>
                Il perche', a fondo
              </div>
              <p
                style={{
                  margin: 0,
                  fontSize: "0.92rem",
                  color: "var(--color-text-soft)",
                  lineHeight: 1.6,
                  maxWidth: "56ch",
                }}
              >
                La sala dove guardiamo tutto con calma: la curva, dove perdi tempo, le aperture.
              </p>
            </div>
            <div
              style={{
                flexShrink: 0,
                fontSize: "1.1rem",
                color: "var(--color-muted)",
                paddingTop: "0.25rem",
              }}
              aria-hidden="true"
            >
              &rarr;
            </div>
          </div>
        </div>
      </Reveal>

      {/* ── 7. AZIONI SECONDARIE (ghost, in fondo) ─────────────────────── */}
      <Reveal delay={300} className="mb-8">
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
            {refreshing ? "Preparo..." : "Aggiorna partite"}
          </button>
          <button
            onClick={() => void handleFullReanalyze()}
            disabled={refreshing || reanalyzing}
            className="btn btn-ghost btn-sm"
            style={{ flex: 1 }}
          >
            {reanalyzing ? "Rianalizzando..." : "Rianalizza da capo"}
          </button>
        </div>
      </Reveal>

    </div>
  );
}
