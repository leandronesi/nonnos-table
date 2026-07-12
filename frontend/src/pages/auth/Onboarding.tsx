/**
 * Onboarding wizard (2 step).
 *
 * Step 1 — Chess.com:
 *   - input username, validazione contro api.chess.com/pub/player/{u}
 *   - il profilo e' una fonte pubblica scelta; piu' account possono selezionarlo
 *   - mostra avatar + ratings per conferma
 *
 * Step 2 — Goal:
 *   - target rating (slider 800-2400, coerente col dominio profilo)
 *   - orizzonte (settimane)
 *   - time class principale (auto-suggestita dalla rating dell'utente)
 *   - minuti/settimana (impegno dichiarato)
 *   INSERT profiles; l'orchestratore crea in modo idempotente il job mancante
 *   nav('/onboarding/waiting') che fa partire l'orchestratore client-side
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../../auth/AuthContext";
import { supabase } from "../../auth/supabaseClient";
import type { GoalTimeClass } from "../../auth/db.types";
import { AuthShell, Field, inputClass } from "./AuthShell";
import { tr } from "../../i18n/lang";
import { trackEvent } from "../../lib/telemetry";

interface ChessComPlayer {
  username: string;
  avatar?: string;
  name?: string;
  country?: string;
  followers?: number;
  joined?: number;
}

interface ChessComStats {
  chess_rapid?: { last?: { rating?: number } };
  chess_blitz?: { last?: { rating?: number } };
}

async function fetchChessComPlayer(username: string): Promise<ChessComPlayer | null> {
  const r = await fetch(`https://api.chess.com/pub/player/${encodeURIComponent(username)}`);
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`Chess.com API error: ${r.status}`);
  return (await r.json()) as ChessComPlayer;
}

async function fetchChessComStats(username: string): Promise<ChessComStats> {
  const r = await fetch(`https://api.chess.com/pub/player/${encodeURIComponent(username)}/stats`);
  if (!r.ok) throw new Error(`Chess.com stats API error: ${r.status}`);
  return (await r.json()) as ChessComStats;
}

function bestTimeClass(stats: ChessComStats): GoalTimeClass {
  const rapid = stats.chess_rapid?.last?.rating ?? 0;
  const blitz = stats.chess_blitz?.last?.rating ?? 0;
  return rapid > blitz ? "rapid" : "blitz";
}

function timeClassRating(stats: ChessComStats | null, timeClass: GoalTimeClass): number | null {
  if (!stats) return null;
  const rating = timeClass === "rapid"
    ? stats.chess_rapid?.last?.rating
    : stats.chess_blitz?.last?.rating;
  return typeof rating === "number" && Number.isFinite(rating) ? rating : null;
}

export function Onboarding() {
  const nav = useNavigate();
  const { user, profile, profileError, refreshProfile } = useAuth();

  useEffect(() => {
    if (!profile && profileError) {
      nav("/onboarding/waiting", { replace: true });
      return;
    }
    if (profile) {
      if (profile.onboarding_state === "ready") nav("/", { replace: true });
      else nav("/onboarding/waiting", { replace: true });
    }
  }, [profile, profileError, nav]);

  const [step, setStep] = useState<"chesscom" | "goal">("chesscom");

  // ---- Step 1 state ----
  const [usernameInput, setUsernameInput] = useState("");
  const [checking, setChecking] = useState(false);
  const [player, setPlayer] = useState<ChessComPlayer | null>(null);
  const [stats, setStats] = useState<ChessComStats | null>(null);
  const [chessError, setChessError] = useState<string | null>(null);

  // ---- Step 2 state ----
  const defaultTC: GoalTimeClass = useMemo(
    () => (stats ? bestTimeClass(stats) : "blitz"),
    [stats]
  );
  const [goalRating, setGoalRating] = useState(1600);
  const [goalTC, setGoalTC] = useState<GoalTimeClass>("blitz");
  const [weeklyMinutes, setWeeklyMinutes] = useState(120);

  // Deadline: driven by chip selection (13 / 26 / 52 weeks). DEFAULT = 26.
  // Built as a function so tr() is called at render-time, not frozen at module load.
  const DEADLINE_CHIPS: Array<{ label: string; weeks: number }> = [
    { label: tr("Con calma, 3 mesi", "3 months, no rush"), weeks: 13 },
    { label: tr("Entro 6 mesi", "Within 6 months"), weeks: 26 },
    { label: tr("Nell'anno", "Within the year"), weeks: 52 },
  ];
  const [goalHorizonWeeks, setGoalHorizonWeeks] = useState<number>(26);

  // Derive ISO deadline from weeks (clamped to min +7d / max +730d).
  const goalDeadline = useMemo(() => {
    const msWeeks = goalHorizonWeeks * 7 * 86400000;
    const msMin = 7 * 86400000;
    const msMax = 730 * 86400000;
    const ms = Math.max(msMin, Math.min(msMax, msWeeks));
    const d = new Date(Date.now() + ms);
    return d.toISOString().slice(0, 10);
  }, [goalHorizonWeeks]);

  const currentRating = useMemo(
    () => timeClassRating(stats, goalTC),
    [stats, goalTC],
  );

  useEffect(() => {
    setGoalTC(defaultTC);
  }, [defaultTC]);

  useEffect(() => {
    if (!stats) return;
    const base = timeClassRating(stats, defaultTC);
    if (base == null) return;
    const suggested = Math.min(2400, Math.max(800, Math.round((base + 200) / 50) * 50));
    setGoalRating(suggested);
  }, [stats, defaultTC]);

  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // Ink signature state: idle → signing → signed
  const [signing, setSigning] = useState(false);
  // The delayed submit must die with the component: a browser-back during the
  // 1000ms signature would otherwise fire an insert + navigate after unmount.
  const signTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    return () => {
      if (signTimerRef.current != null) clearTimeout(signTimerRef.current);
    };
  }, []);

  async function onConfirmChessCom() {
    setChessError(null);
    if (!usernameInput.trim()) {
      setChessError(tr("Inserisci il tuo username Chess.com.", "Enter your Chess.com username."));
      return;
    }
    setChecking(true);
    trackEvent("chess_profile_lookup_started");
    try {
      const p = await fetchChessComPlayer(usernameInput.trim());
      if (!p) {
        setChessError(
          tr(
            `Nessun account Chess.com con username "${usernameInput.trim()}".`,
            `No Chess.com account found for "${usernameInput.trim()}".`
          )
        );
        setChecking(false);
        return;
      }
      const s = await fetchChessComStats(p.username);
      const hasSupportedGames = Boolean(
        s.chess_rapid?.last?.rating || s.chess_blitz?.last?.rating,
      );
      if (!hasSupportedGames) {
        setChessError(tr(
          "Questo profilo non ha ancora un rating rapid o blitz. Gioca almeno una partita in una delle due categorie e poi torna.",
          "This profile does not have a rapid or blitz rating yet. Play at least one game in either category, then come back.",
        ));
        trackEvent("chess_profile_unsupported", { reason: "no_rapid_or_blitz" });
        return;
      }
      setPlayer(p);
      setStats(s);
      setGoalTC(bestTimeClass(s));
      trackEvent("chess_profile_lookup_succeeded", {
        has_rapid: Boolean(s.chess_rapid?.last?.rating),
        has_blitz: Boolean(s.chess_blitz?.last?.rating),
      });
    } catch (e) {
      setChessError(String(e instanceof Error ? e.message : e));
      trackEvent("chess_profile_lookup_failed");
    } finally {
      setChecking(false);
    }
  }

  // Returns true on success, false on error (sets submitError internally).
  async function onConfirmGoal(): Promise<boolean> {
    if (!user || !player) {
      setSubmitError(tr("Sessione persa. Ricarica la pagina.", "Session lost. Reload the page."));
      return false;
    }
    if (currentRating == null) {
      setSubmitError(tr(
        "Scegli una cadenza con rating e partite disponibili sul profilo.",
        "Choose a time control with a rating and available games on the profile.",
      ));
      return false;
    }
    setSubmitting(true);
    setSubmitError(null);
    const { error: pErr } = await supabase.from("profiles").insert({
      user_id: user.id,
      chess_com_username: player.username,
      goal_rating: goalRating,
      goal_horizon_weeks: goalHorizonWeeks,
      goal_deadline: goalDeadline,
      goal_time_class: goalTC,
      weekly_minutes: weeklyMinutes,
      onboarding_state: "pending",
    });
    if (pErr) {
      setSubmitting(false);
      setSubmitError(tr(
        "Non sono riuscito a salvare il profilo scelto. Riprova; nessuna analisi e' stata avviata.",
        "I could not save the selected profile. Try again; no analysis was started.",
      ));
      return false;
    }
    trackEvent("onboarding_goal_saved", {
      time_class: goalTC,
      horizon_weeks: goalHorizonWeeks,
      weekly_minutes: weeklyMinutes,
    });
    await refreshProfile();
    nav("/onboarding/waiting", { replace: true });
    return true;
  }

  // ---- Step 1 ----
  if (step === "chesscom" || !player) {
    return (
      <AuthShell
        eyebrow={tr("1 di 2", "1 of 2")}
        title={tr("Quale profilo analizziamo?", "Which profile should we analyze?")}
        subtitle={tr(
          "Inserisci un profilo pubblico Chess.com. Nel passo successivo scegli rapid o blitz; useremo fino a 100 partite di quella cadenza.",
          "Enter a public Chess.com profile. In the next step choose rapid or blitz; we will use up to 100 games from that time control."
        )}
      >
        {!player ? (
          <>
            <Field
              label={tr("Username Chess.com", "Chess.com username")}
              htmlFor="chesscom"
              hint={tr("Lo username visibile nell'URL del profilo pubblico.", "The username shown in the public profile URL.")}
              error={chessError}
            >
              <input
                id="chesscom"
                type="text"
                autoComplete="username"
                className={inputClass}
                value={usernameInput}
                onChange={(e) => setUsernameInput(e.target.value)}
                placeholder="es. magnuscarlsen"
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    onConfirmChessCom();
                  }
                }}
              />
            </Field>
            <button
              onClick={onConfirmChessCom}
              className="btn btn-primary btn-lg w-full"
              disabled={checking}
            >
              {checking ? tr("Cerco…", "Looking…") : tr("Trovami su Chess.com", "Find me on Chess.com")}
            </button>
            <p style={{ margin: "0.625rem 0 0", textAlign: "center", fontSize: "0.75rem", lineHeight: 1.45, color: "var(--color-faint)" }}>
              {tr(
                "Controlliamo il profilo pubblico; nel passo successivo scegli cadenza e obiettivo.",
                "We check the public profile; next you choose a time control and target.",
              )}
            </p>
          </>
        ) : (
          <>
            {/* Conferma profilo trovato */}
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: "0.875rem",
                padding: "0.875rem",
                background: "var(--color-surface-2)",
                border: "1px solid var(--color-line)",
                borderRadius: "8px",
                marginBottom: "1rem",
              }}
            >
              {player.avatar ? (
                <img
                  src={player.avatar}
                  alt=""
                  style={{ width: "2.75rem", height: "2.75rem", borderRadius: "50%", flexShrink: 0 }}
                  loading="lazy"
                />
              ) : (
                <div
                  style={{
                    width: "2.75rem",
                    height: "2.75rem",
                    borderRadius: "50%",
                    background: "var(--color-surface-3)",
                    flexShrink: 0,
                  }}
                />
              )}
              <div style={{ minWidth: 0 }}>
                <div
                  style={{
                    fontFamily: "var(--font-mono)",
                    fontSize: "0.9rem",
                    fontWeight: 600,
                    color: "var(--color-text)",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {player.username}
                </div>
                {player.name ? (
                  <div
                    style={{
                      fontSize: "0.75rem",
                      color: "var(--color-muted)",
                      marginTop: "0.15rem",
                    }}
                  >
                    {player.name}
                  </div>
                ) : null}
              </div>
            </div>

            {/* Nonno phrase for confirmed profile */}
            {(() => {
              const tcLabel = defaultTC; // rapid/blitz only
              const ratingMap: Record<string, number | undefined> = {
                rapid: stats?.chess_rapid?.last?.rating,
                blitz: stats?.chess_blitz?.last?.rating,
              };
              const rating = ratingMap[defaultTC];
              const phrase =
                rating
                  ? tr(
                      `Eccoti, ${player.username}. Ho visto le tue partite ${tcLabel}: sei a ${rating}. Siediti, cominciamo da qui.`,
                      `There you are, ${player.username}. I looked at your ${tcLabel} games: you are at ${rating}. Sit down, let's start from here.`
                    )
                  : tr(
                      `Eccoti, ${player.username}. Le partite le ho trovate. Siediti, cominciamo da qui.`,
                      `There you are, ${player.username}. I found your games. Sit down, let's start from here.`
                    );
              return (
                <div
                  style={{
                    padding: "0.85rem 1rem",
                    background: "color-mix(in srgb, var(--color-brand) 6%, transparent)",
                    borderRadius: "8px",
                    marginBottom: "1.25rem",
                    fontSize: "0.9375rem",
                    lineHeight: 1.55,
                    color: "var(--color-text)",
                    fontFamily: "var(--font-display, Inter Tight, Inter, system-ui, sans-serif)",
                    fontWeight: 500,
                  }}
                >
                  {phrase}
                </div>
              );
            })()}

            <div style={{ display: "flex", gap: "0.625rem" }}>
              <button
                onClick={() => {
                  setPlayer(null);
                  setStats(null);
                }}
                className="btn btn-ghost"
                style={{ flex: 1 }}
              >
                {tr("Cambia profilo", "Choose another")}
              </button>
              <button
                onClick={() => {
                  trackEvent("chess_profile_selected", { time_class: defaultTC });
                  setStep("goal");
                }}
                className="btn btn-primary"
                style={{ flex: 1 }}
              >
                {tr("Usa questo profilo", "Use this profile")}
              </button>
            </div>
            <p style={{ margin: "0.625rem 0 0", textAlign: "center", fontSize: "0.75rem", lineHeight: 1.45, color: "var(--color-faint)" }}>
              {tr(
                "Poi scegli rapid o blitz e il livello-obiettivo; l'analisi parte solo dopo la conferma finale.",
                "Next, choose rapid or blitz and your target level; analysis starts only after final confirmation.",
              )}
            </p>
          </>
        )}
      </AuthShell>
    );
  }

  // ---- Step 2 ---- goal
  return (
    <AuthShell
      eyebrow={tr("2 di 2", "2 of 2")}
      title={tr("Dove vuoi arrivare?", "Where do you want to go?")}
      subtitle={tr("Scegli una cadenza disponibile e il livello che vuoi raggiungere.", "Choose an available time control and the level you want to reach.")}
    >
      {/* Categoria di tempo */}
      <Field label={tr("Categoria di tempo", "Time control")} htmlFor="tc" hint={tr("Analizziamo fino a 100 partite della cadenza scelta. Le cadenze senza rating sul profilo sono disabilitate.", "We analyze up to 100 games from the selected time control. Controls without a profile rating are disabled.")}>
        <div style={{ display: "flex", gap: "0.5rem" }}>
          {(["blitz", "rapid"] as GoalTimeClass[]).map((tc) => {
            const active = goalTC === tc;
            const available = timeClassRating(stats, tc) != null;
            return (
              <button
                key={tc}
                type="button"
                onClick={() => { if (available) setGoalTC(tc); }}
                disabled={!available}
                style={{
                  flex: 1,
                  padding: "0.5rem 0",
                  borderRadius: "8px",
                  fontSize: "0.75rem",
                  fontFamily: "var(--font-mono)",
                  letterSpacing: "0.1em",
                  textTransform: "uppercase",
                  fontWeight: 600,
                  border: "1px solid",
                  cursor: available ? "pointer" : "not-allowed",
                  opacity: available ? 1 : 0.45,
                  transition: "background 150ms ease, border-color 150ms ease, color 150ms ease",
                  background: active ? "var(--color-brand)" : "var(--color-surface-2)",
                  borderColor: active ? "var(--color-brand)" : "var(--color-line)",
                  color: active ? "white" : "var(--color-text-soft)",
                }}
              >
                {tc}
              </button>
            );
          })}
        </div>
      </Field>

      {/* Slider target rating */}
      <Field
        label={tr("Dove punta la sedia", "Where is your chair pointing")}
        htmlFor="goal-rating"
        hint={currentRating != null
          ? tr(`Il rating osservato e' ${currentRating} in ${goalTC}.`, `The observed ${goalTC} rating is ${currentRating}.`)
          : tr("Rating non disponibile per questa cadenza.", "Rating is unavailable for this time control.")}
      >
        <input
          id="goal-rating"
          type="range"
          min={800}
          max={2400}
          step={50}
          value={goalRating}
          onChange={(e) => setGoalRating(parseInt(e.target.value, 10))}
          style={{ width: "100%", accentColor: "var(--color-brand)" }}
        />
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginTop: "0.375rem",
          }}
        >
          <span
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: "0.625rem",
              color: "var(--color-faint)",
            }}
          >
            800
          </span>
          <span
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: "1.05rem",
              fontWeight: 700,
              color: "var(--color-gold-soft)",
            }}
          >
            {goalRating}
          </span>
          <span
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: "0.625rem",
              color: "var(--color-faint)",
            }}
          >
            2400
          </span>
        </div>
        {/* Live delta comment — only when currentRating is known */}
        {stats && currentRating != null && (
          <p
            style={{
              margin: "0.5rem 0 0",
              fontSize: "0.8125rem",
              lineHeight: 1.5,
              color: "var(--color-text-soft)",
              fontFamily: "var(--font-body, Inter, system-ui, sans-serif)",
            }}
          >
            {(() => {
              const delta = goalRating - currentRating;
              if (delta <= 0)
                return tr(
                  "Stai puntando sotto di te. Possiamo lavorarci lo stesso, ma dimmi: sicuro?",
                  "You are pointing below where you are. We can still work with it, but tell me: are you sure?"
                );
              if (delta < 100)
                return tr(
                  `Il target e' ${delta} punti sopra il rating osservato. Useremo le partite del profilo per scegliere il primo focus.`,
                  `The target is ${delta} points above the observed rating. We will use the profile games to choose the first focus.`
                );
              if (delta <= 250)
                return tr(
                  `${delta} punti di distanza. L'analisi cerchera' i pattern ricorrenti su cui lavorare per primi.`,
                  `${delta} points of distance. The analysis will look for recurring patterns to work on first.`
                );
              if (delta <= 400)
                return tr(
                  `Stai puntando in alto: ${delta} punti di distanza richiedono tempo e verifiche sulle partite future.`,
                  `You are aiming high: ${delta} points of distance require time and checks on future games.`
                );
              return tr(
                "E' una salita lunga. Tienila, ma sappi che non si fa in fretta. Io ci sono per tutto il percorso.",
                "That is a long climb. Keep it, but know it does not happen fast. I am here for all of it."
              );
            })()}
          </p>
        )}

        {/* Ink signature — drawn when user commits to the goal */}
        <div
          className={signing ? "ink-drawn" : undefined}
          style={{ marginTop: "0.875rem", lineHeight: 0 }}
          aria-hidden="true"
        >
          <svg
            viewBox="0 0 200 24"
            style={{
              width: "clamp(160px, 60%, 220px)",
              height: "auto",
              display: "block",
            }}
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
          >
            <path
              pathLength={1}
              className="ink-path"
              d="M4 16 C 50 2, 90 26, 140 10 C 160 4, 175 8, 196 14"
              stroke="var(--color-brand-soft)"
              strokeWidth={2}
              strokeLinecap="round"
            />
          </svg>
        </div>
      </Field>

      {/* Deadline — 3 chips */}
      <Field label={tr("In quanto tempo?", "How long do you have?")} htmlFor="goal-deadline" hint={tr("Serve a confrontare il ritmo osservato con quello richiesto; non cambia il numero di esercizi.", "This compares observed pace with required pace; it does not change the number of exercises.")}>
        <div style={{ display: "flex", gap: "0.5rem" }}>
          {DEADLINE_CHIPS.map((chip) => {
            const active = goalHorizonWeeks === chip.weeks;
            return (
              <button
                key={chip.weeks}
                type="button"
                onClick={() => setGoalHorizonWeeks(chip.weeks)}
                style={{
                  flex: 1,
                  padding: "0.5rem 0.375rem",
                  borderRadius: "8px",
                  fontSize: "0.7rem",
                  fontFamily: "var(--font-mono)",
                  letterSpacing: "0.04em",
                  fontWeight: 600,
                  border: "1px solid",
                  cursor: "pointer",
                  textAlign: "center",
                  lineHeight: 1.4,
                  transition: "background 150ms ease, border-color 150ms ease, color 150ms ease",
                  background: active ? "var(--color-brand)" : "var(--color-surface-2)",
                  borderColor: active ? "var(--color-brand)" : "var(--color-line)",
                  color: active ? "white" : "var(--color-text-soft)",
                }}
              >
                {chip.label}
              </button>
            );
          })}
        </div>
      </Field>

      {/* Minuti a settimana */}
      <Field
        label={tr("Quanto puoi sederti a settimana?", "How much time can you sit down each week?")}
        htmlFor="weekly"
        hint={tr("Serve a proporre il focus settimanale; oggi non calibra la durata della singola sessione.", "This helps propose the weekly focus; today it does not calibrate individual session length.")}
      >
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "0.5rem" }}>
          {(([
            [30, tr("Mezz'ora", "Half an hour")],
            [60, tr("Un'ora", "One hour")],
            [120, tr("Due ore", "Two hours")],
            [180, tr("Tre ore", "Three hours")],
          ] as Array<[number, string]>)).map(([m, label]) => {
            const active = weeklyMinutes === m;
            return (
              <button
                key={m}
                type="button"
                onClick={() => setWeeklyMinutes(m)}
                style={{
                  padding: "0.5rem 0.25rem",
                  borderRadius: "8px",
                  fontSize: "0.75rem",
                  fontFamily: "var(--font-mono)",
                  fontWeight: 600,
                  border: "1px solid",
                  cursor: "pointer",
                  transition: "background 150ms ease, border-color 150ms ease, color 150ms ease",
                  background: active ? "var(--color-brand)" : "var(--color-surface-2)",
                  borderColor: active ? "var(--color-brand)" : "var(--color-line)",
                  color: active ? "white" : "var(--color-text-soft)",
                  textAlign: "center",
                }}
              >
                {label}
              </button>
            );
          })}
        </div>
      </Field>

      {submitError ? (
        <div
          style={{
            fontSize: "0.8125rem",
            color: "var(--color-danger)",
            marginBottom: "0.875rem",
            padding: "0.625rem 0.75rem",
            background: "rgba(244,63,94,0.08)",
            border: "1px solid rgba(244,63,94,0.22)",
            borderRadius: "6px",
          }}
        >
          {submitError}
        </div>
      ) : null}

      <div style={{ display: "flex", gap: "0.625rem", marginTop: "0.25rem" }}>
        <button
          onClick={() => setStep("chesscom")}
          className="btn btn-ghost"
          style={{ flex: 1 }}
        >
          {tr("Indietro", "Back")}
        </button>
        <button
          onClick={() => {
            // Guard: already signing or submitting
            if (signing || submitting) return;

            // (1) Disable immediately to prevent double-tap
            setSigning(true);

            // (2) After ink draw completes (900ms transition + small buffer),
            //     fire the actual submit. If it fails, re-enable.
            const prefersReducedMotion =
              typeof window !== "undefined" &&
              window.matchMedia("(prefers-reduced-motion: reduce)").matches;

            const delay = prefersReducedMotion ? 0 : 1000;

            signTimerRef.current = setTimeout(async () => {
              const ok = await onConfirmGoal();
              // On failure, re-enable the button so the user can retry.
              // The ink stroke stays drawn (no rewind).
              if (!ok) setSigning(false);
            }, delay);
          }}
          className="btn btn-primary"
          style={{ flex: 1 }}
          disabled={signing || submitting}
        >
          {submitting ? tr("Salvo…", "Saving…") : tr("Apparecchia il Tavolo", "Set the Table")}
        </button>
      </div>
      <p style={{ margin: "0.625rem 0 0", textAlign: "center", fontSize: "0.75rem", lineHeight: 1.45, color: "var(--color-faint)" }}>
        {tr(
          "Poi prepariamo una prima lettura con fino a 10 analisi riuscite; il profilo continuera' fino a 100 in background.",
          "Next, we prepare a first reading with up to 10 successful analyses; the profile then continues to 100 in the background.",
        )}
      </p>
    </AuthShell>
  );
}
