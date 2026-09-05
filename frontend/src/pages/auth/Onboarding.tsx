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

import { useEffect, useMemo, useState } from "react";
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

  async function onConfirmChessCom() {
    if (checking) return;
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
    if (submitting) return false;
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
    try {
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
          "Non sono riuscito a salvare il profilo scelto. Controlla la connessione e riprova.",
          "I could not save the selected profile. Check your connection and try again.",
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
    } catch {
      setSubmitError(tr("Connessione interrotta. Riprova a salvare il profilo.", "Connection interrupted. Try saving your profile again."));
      return false;
    } finally {
      setSubmitting(false);
    }
  }

  function chooseTimeClass(tc: GoalTimeClass) {
    setGoalTC(tc);
    const rating = timeClassRating(stats, tc);
    if (rating != null) setGoalRating(Math.min(2400, Math.max(800, Math.round((rating + 200) / 50) * 50)));
  }

  if (step === "chesscom" || !player) return <AuthShell
    eyebrow={tr("1 DI 2 · LE TUE PARTITE", "1 OF 2 · YOUR GAMES")}
    title={tr("Partiamo dal tuo profilo.", "Start with your profile.")}
    subtitle={tr("Inserisci lo username pubblico Chess.com. Ti mostriamo il profilo prima di analizzare le partite.", "Enter your public Chess.com username. You can check the profile before we analyse the games.")}>
    {!player ? <form onSubmit={(e) => { e.preventDefault(); void onConfirmChessCom(); }}>
      <Field label={tr("Username Chess.com", "Chess.com username")} htmlFor="chesscom" hint={tr("Lo trovi nell’indirizzo del tuo profilo Chess.com.", "Find it in your Chess.com profile address.")} error={chessError}>
        <input id="chesscom" className={inputClass} value={usernameInput} onChange={(e) => setUsernameInput(e.target.value)} autoComplete="username" autoCapitalize="none" spellCheck={false} required disabled={checking} placeholder={tr("Il tuo username", "Your username")} />
      </Field>
      <button type="submit" className="btn btn-primary w-full" disabled={checking}>{checking ? tr("Cerco il profilo…", "Finding your profile…") : tr("Trova il profilo", "Find profile")}</button>
    </form> : <>
      <div className="onboarding-player">
        {player.avatar && <img src={player.avatar} alt="" width="48" height="48" />}
        <div><strong>{player.username}</strong>{player.name && <span>{player.name}</span>}</div>
      </div>
      <p className="onboarding-note">{tr("Profilo trovato. Questi sono i rating pubblici disponibili; l’analisi delle partite deve ancora iniziare.", "Profile found. These are the available public ratings; game analysis has not started yet.")}</p>
      <div className="onboarding-ratings">{(["rapid", "blitz"] as GoalTimeClass[]).map(tc => <div key={tc}><span>{tc}</span><strong>{timeClassRating(stats, tc) ?? "—"}</strong></div>)}</div>
      <div className="onboarding-actions"><button type="button" className="btn btn-ghost" onClick={() => { setPlayer(null); setStats(null); }}>{tr("Cambia profilo", "Change profile")}</button><button type="button" className="btn btn-primary" onClick={() => { trackEvent("chess_profile_selected", { time_class: defaultTC }); setStep("goal"); }}>{tr("Usa questo profilo", "Use this profile")}</button></div>
    </>}
  </AuthShell>;

  return <AuthShell eyebrow={tr("2 DI 2 · IL PROSSIMO PASSO", "2 OF 2 · YOUR NEXT STEP")} title={tr("Su cosa lavoriamo?", "What shall we work on?")} subtitle={tr("Scegli una cadenza e il livello da usare come riferimento. Partiamo dalle tue abitudini, compreso l’uso del tempo.", "Choose a time control and a reference level. Start with your habits, including how you use your time.")}>
    <form onSubmit={(e) => { e.preventDefault(); void onConfirmGoal(); }}>
      <fieldset className="onboarding-choice" disabled={submitting}><legend>{tr("Partite da analizzare", "Games to analyse")}</legend><div className="onboarding-options">
        {(["rapid", "blitz"] as GoalTimeClass[]).map(tc => <button key={tc} type="button" aria-pressed={goalTC === tc} disabled={timeClassRating(stats, tc) == null} onClick={() => chooseTimeClass(tc)}><strong>{tc}</strong><span>{timeClassRating(stats, tc) ?? tr("Nessun rating", "No rating")}</span></button>)}
      </div><p className="onboarding-note">{tr("Fino a 100 partite della categoria scelta. I confronti temporali distinguono anche le diverse cadenze e gli incrementi.", "Up to 100 games in your chosen category. Clock comparisons also distinguish time controls and increments.")}</p></fieldset>
      <Field label={tr("Livello di riferimento", "Reference level")} htmlFor="goal-rating">
        <div className="onboarding-target"><span>{tr("Ora", "Now")}<strong>{currentRating ?? "—"}</strong></span><span aria-hidden="true">→</span><span>{tr("Obiettivo", "Target")}<output htmlFor="goal-rating">{goalRating}</output></span></div>
        <input id="goal-rating" type="range" min={800} max={2400} step={50} value={goalRating} onChange={(e) => setGoalRating(Number(e.target.value))} disabled={submitting} />
        <p className="onboarding-note">{tr("Suggeriamo circa 200 Elo più su. Maia confronta le scelte ai due livelli: è un riferimento per l’allenamento, non una previsione di rating.", "We suggest about 200 Elo higher. Maia compares choices at the two levels: a training reference, not a rating prediction.")}</p>
      </Field>
      <details className="onboarding-preferences"><summary>{tr("Il tempo che vuoi dedicare", "Time you want to commit")}</summary>
        <fieldset className="onboarding-choice" disabled={submitting}><legend>{tr("Orizzonte personale", "Personal horizon")}</legend><div className="onboarding-options onboarding-options-three">{DEADLINE_CHIPS.map(chip => <button key={chip.weeks} type="button" aria-pressed={goalHorizonWeeks === chip.weeks} onClick={() => setGoalHorizonWeeks(chip.weeks)}>{chip.label}</button>)}</div></fieldset>
        <fieldset className="onboarding-choice" disabled={submitting}><legend>{tr("Minuti a settimana", "Minutes per week")}</legend><div className="onboarding-options">{[30, 60, 120, 180].map(minutes => <button key={minutes} type="button" aria-pressed={weeklyMinutes === minutes} onClick={() => setWeeklyMinutes(minutes)}>{minutes} min</button>)}</div></fieldset>
        <p className="onboarding-note">{tr("Un impegno che scegli tu. Non promettiamo di raggiungere il rating entro questa data.", "A commitment you choose. We do not promise you will reach the rating by this date.")}</p>
      </details>
      {submitError && <p className="auth-field-error" role="alert">{submitError}</p>}
      <div className="onboarding-actions"><button type="button" className="btn btn-ghost" disabled={submitting} onClick={() => setStep("chesscom")}>{tr("Indietro", "Back")}</button><button type="submit" className="btn btn-primary" disabled={submitting}>{submitting ? tr("Salvo…", "Saving…") : tr("Analizza le mie partite", "Analyse my games")}</button></div>
      <p className="onboarding-note">{tr("La prima lettura parte da 10 partite, o da quelle disponibili. L’analisi prosegue nel browser: vedrai l’avanzamento e potrai riprendere se si interrompe.", "The first reading starts with 10 games, or those available. Analysis continues in your browser: follow progress and resume if it stops.")}</p>
    </form>
  </AuthShell>;
}
