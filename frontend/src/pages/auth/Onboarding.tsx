/**
 * Onboarding wizard (2 step).
 *
 * Step 1 — Chess.com:
 *   - input username, validazione contro api.chess.com/pub/player/{u}
 *   - check unicita' in `profiles` (INSERT con UNIQUE, race-safe)
 *   - mostra avatar + ratings per conferma
 *
 * Step 2 — Goal:
 *   - target rating (slider 1000-2200)
 *   - orizzonte (settimane)
 *   - time class principale (auto-suggestita dalla rating dell'utente)
 *   - minuti/settimana (impegno dichiarato)
 *   INSERT profiles + INSERT ingest_jobs(status='queued')
 *   nav('/onboarding/waiting') che fa partire l'orchestratore client-side
 */

import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../../auth/AuthContext";
import { supabase } from "../../auth/supabaseClient";
import type { TimeClass } from "../../auth/db.types";
import { AuthShell, Field, inputClass } from "./AuthShell";

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
  chess_bullet?: { last?: { rating?: number } };
  chess_daily?: { last?: { rating?: number } };
}

async function fetchChessComPlayer(username: string): Promise<ChessComPlayer | null> {
  const r = await fetch(`https://api.chess.com/pub/player/${encodeURIComponent(username)}`);
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`Chess.com API error: ${r.status}`);
  return (await r.json()) as ChessComPlayer;
}

async function fetchChessComStats(username: string): Promise<ChessComStats> {
  const r = await fetch(`https://api.chess.com/pub/player/${encodeURIComponent(username)}/stats`);
  if (!r.ok) return {};
  return (await r.json()) as ChessComStats;
}

function bestTimeClass(stats: ChessComStats): TimeClass {
  const cands: Array<[TimeClass, number]> = [
    ["rapid", stats.chess_rapid?.last?.rating ?? 0],
    ["blitz", stats.chess_blitz?.last?.rating ?? 0],
    ["bullet", stats.chess_bullet?.last?.rating ?? 0],
  ];
  cands.sort((a, b) => b[1] - a[1]);
  return cands[0][0];
}

export function Onboarding() {
  const nav = useNavigate();
  const { user, profile, refreshProfile } = useAuth();

  useEffect(() => {
    if (profile) {
      if (profile.onboarding_state === "ready") nav("/", { replace: true });
      else nav("/onboarding/waiting", { replace: true });
    }
  }, [profile, nav]);

  const [step, setStep] = useState<"chesscom" | "goal">("chesscom");

  // ---- Step 1 state ----
  const [usernameInput, setUsernameInput] = useState("");
  const [checking, setChecking] = useState(false);
  const [player, setPlayer] = useState<ChessComPlayer | null>(null);
  const [stats, setStats] = useState<ChessComStats | null>(null);
  const [chessError, setChessError] = useState<string | null>(null);

  // ---- Step 2 state ----
  const defaultTC: TimeClass = useMemo(
    () => (stats ? bestTimeClass(stats) : "blitz"),
    [stats]
  );
  const [goalRating, setGoalRating] = useState(1600);
  const [goalTC, setGoalTC] = useState<TimeClass>("blitz");
  const [weeklyMinutes, setWeeklyMinutes] = useState(120);

  const defaultDeadline = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() + 112);
    return d.toISOString().slice(0, 10);
  }, []);
  const [goalDeadline, setGoalDeadline] = useState<string>(defaultDeadline);

  const goalHorizonWeeks = useMemo(() => {
    const ms = new Date(goalDeadline).getTime() - Date.now();
    return Math.max(4, Math.min(104, Math.ceil(ms / (7 * 86400000))));
  }, [goalDeadline]);

  const deadlineMin = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() + 7);
    return d.toISOString().slice(0, 10);
  }, []);
  const deadlineMax = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() + 730);
    return d.toISOString().slice(0, 10);
  }, []);

  const currentRating = useMemo(() => {
    if (!stats) return 1200;
    const map: Record<TimeClass, number | undefined> = {
      rapid: stats.chess_rapid?.last?.rating,
      blitz: stats.chess_blitz?.last?.rating,
      bullet: stats.chess_bullet?.last?.rating,
      classical: undefined,
      daily: stats.chess_daily?.last?.rating,
    };
    return map[goalTC] ?? 1200;
  }, [stats, goalTC]);

  useEffect(() => {
    setGoalTC(defaultTC);
  }, [defaultTC]);

  useEffect(() => {
    if (!stats) return;
    const map: Record<TimeClass, number | undefined> = {
      rapid: stats.chess_rapid?.last?.rating,
      blitz: stats.chess_blitz?.last?.rating,
      bullet: stats.chess_bullet?.last?.rating,
      classical: undefined,
      daily: stats.chess_daily?.last?.rating,
    };
    const base = map[defaultTC] ?? 1200;
    const suggested = Math.min(2200, Math.max(1000, Math.round((base + 200) / 50) * 50));
    setGoalRating(suggested);
  }, [stats, defaultTC]);

  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  async function onConfirmChessCom() {
    setChessError(null);
    if (!usernameInput.trim()) {
      setChessError("Inserisci il tuo username Chess.com.");
      return;
    }
    setChecking(true);
    try {
      const p = await fetchChessComPlayer(usernameInput.trim());
      if (!p) {
        setChessError(`Nessun account Chess.com con username "${usernameInput.trim()}".`);
        setChecking(false);
        return;
      }
      const s = await fetchChessComStats(p.username);
      setPlayer(p);
      setStats(s);
    } catch (e) {
      setChessError(String(e instanceof Error ? e.message : e));
    } finally {
      setChecking(false);
    }
  }

  async function onConfirmGoal() {
    if (!user || !player) {
      setSubmitError("Sessione persa. Ricarica la pagina.");
      return;
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
      if (/duplicate key|unique/i.test(pErr.message)) {
        setSubmitError(
          "Questo username Chess.com e' gia' collegato a un altro account."
        );
        return;
      }
      setSubmitError(pErr.message);
      return;
    }
    const { error: jErr } = await supabase.from("ingest_jobs").insert({
      user_id: user.id,
      status: "queued",
      months_total: 0,
      months_done: 0,
      games_total: 0,
      games_done: 0,
    });
    if (jErr) {
      setSubmitting(false);
      setSubmitError(jErr.message);
      return;
    }
    await refreshProfile();
    nav("/onboarding/waiting", { replace: true });
  }

  // ---- Step 1 ----
  if (step === "chesscom" || !player) {
    return (
      <AuthShell
        eyebrow="1 di 2"
        title="Come ti chiami al tavolo?"
        subtitle="Dimmi il tuo username Chess.com. Leggo le tue partite pubbliche."
      >
        {!player ? (
          <>
            <Field
              label="Username Chess.com"
              htmlFor="chesscom"
              hint="Quello che vedi nell'URL del tuo profilo Chess.com."
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
              {checking ? "Cerco…" : "Trovami su Chess.com"}
            </button>
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

            {/* Rating per categoria */}
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(3, 1fr)",
                gap: "0.5rem",
                marginBottom: "1.25rem",
              }}
            >
              {[
                ["Rapid", stats?.chess_rapid?.last?.rating],
                ["Blitz", stats?.chess_blitz?.last?.rating],
                ["Bullet", stats?.chess_bullet?.last?.rating],
              ].map(([label, val]) => (
                <div
                  key={String(label)}
                  style={{
                    padding: "0.6rem 0.5rem",
                    background: "var(--color-surface-2)",
                    border: "1px solid var(--color-line)",
                    borderRadius: "8px",
                    textAlign: "center",
                  }}
                >
                  <div
                    style={{
                      fontFamily: "var(--font-mono)",
                      fontSize: "0.55rem",
                      letterSpacing: "0.14em",
                      textTransform: "uppercase",
                      color: "var(--color-muted)",
                      marginBottom: "0.3rem",
                    }}
                  >
                    {label}
                  </div>
                  <div
                    style={{
                      fontFamily: "var(--font-mono)",
                      fontSize: "1rem",
                      fontWeight: 600,
                      color: val ? "var(--color-text)" : "var(--color-faint)",
                    }}
                  >
                    {val ?? "—"}
                  </div>
                </div>
              ))}
            </div>

            <div style={{ display: "flex", gap: "0.625rem" }}>
              <button
                onClick={() => {
                  setPlayer(null);
                  setStats(null);
                }}
                className="btn btn-ghost"
                style={{ flex: 1 }}
              >
                Non sono io
              </button>
              <button
                onClick={() => setStep("goal")}
                className="btn btn-primary"
                style={{ flex: 1 }}
              >
                Sono io
              </button>
            </div>
          </>
        )}
      </AuthShell>
    );
  }

  // ---- Step 2 ---- goal
  return (
    <AuthShell
      eyebrow="2 di 2"
      title="Dove vuoi arrivare?"
      subtitle="L'oro e' il tuo target. Ti diro' cosa ti separa da lui."
    >
      {/* Categoria di tempo */}
      <Field label="Categoria di tempo" htmlFor="tc" hint="Su quale categoria ti misuri.">
        <div style={{ display: "flex", gap: "0.5rem" }}>
          {(["bullet", "blitz", "rapid"] as TimeClass[]).map((tc) => {
            const active = goalTC === tc;
            return (
              <button
                key={tc}
                type="button"
                onClick={() => setGoalTC(tc)}
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
                  cursor: "pointer",
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
        label={`Target rating`}
        htmlFor="goal-rating"
        hint={`Oggi sei ${currentRating} in ${goalTC}.`}
      >
        <input
          id="goal-rating"
          type="range"
          min={1000}
          max={2200}
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
            1000
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
            2200
          </span>
        </div>
      </Field>

      {/* Deadline */}
      <Field
        label="Deadline"
        htmlFor="goal-deadline"
        hint={`= ${goalHorizonWeeks} settimane da oggi`}
      >
        <input
          id="goal-deadline"
          type="date"
          className={inputClass}
          value={goalDeadline}
          min={deadlineMin}
          max={deadlineMax}
          onChange={(e) => setGoalDeadline(e.target.value)}
        />
      </Field>

      {/* Minuti a settimana */}
      <Field label="Tempo disponibile" htmlFor="weekly">
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "0.5rem" }}>
          {[30, 60, 120, 180].map((m) => {
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
                {m} min
              </button>
            );
          })}
        </div>
        <div
          style={{
            fontSize: "0.6875rem",
            color: "var(--color-faint)",
            marginTop: "0.375rem",
          }}
        >
          A settimana.
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
          Indietro
        </button>
        <button
          onClick={onConfirmGoal}
          className="btn btn-primary"
          style={{ flex: 1 }}
          disabled={submitting}
        >
          {submitting ? "Salvo…" : "Apparecchia il Tavolo"}
        </button>
      </div>
    </AuthShell>
  );
}
