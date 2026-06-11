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

import { useEffect, useMemo, useRef, useState } from "react";
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

  // Deadline: driven by chip selection (13 / 26 / 52 weeks). DEFAULT = 26.
  const DEADLINE_CHIPS: Array<{ label: string; weeks: number }> = [
    { label: "Con calma, 3 mesi", weeks: 13 },
    { label: "Entro 6 mesi", weeks: 26 },
    { label: "Nell'anno", weeks: 52 },
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

  // Returns true on success, false on error (sets submitError internally).
  async function onConfirmGoal(): Promise<boolean> {
    if (!user || !player) {
      setSubmitError("Sessione persa. Ricarica la pagina.");
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
      if (/duplicate key|unique/i.test(pErr.message)) {
        setSubmitError(
          "Questo username Chess.com e' gia' collegato a un altro account."
        );
        return false;
      }
      setSubmitError(pErr.message);
      return false;
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
      return false;
    }
    await refreshProfile();
    nav("/onboarding/waiting", { replace: true });
    return true;
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

            {/* Nonno phrase for confirmed profile */}
            {(() => {
              const tcLabel = defaultTC; // rapid/blitz/bullet
              const ratingMap: Record<string, number | undefined> = {
                rapid: stats?.chess_rapid?.last?.rating,
                blitz: stats?.chess_blitz?.last?.rating,
                bullet: stats?.chess_bullet?.last?.rating,
              };
              const rating = ratingMap[defaultTC];
              const phrase =
                rating
                  ? `Eccoti, ${player.username}. Ho visto le tue partite ${tcLabel}: sei a ${rating}. Siediti, cominciamo da qui.`
                  : `Eccoti, ${player.username}. Le partite le ho trovate. Siediti, cominciamo da qui.`;
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
      subtitle="Dimmi dove punta la sedia. Poi lavoriamo."
    >
      {/* Categoria di tempo */}
      <Field label="Categoria di tempo" htmlFor="tc" hint="Su quale cadenza giochi di piu'.">
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
        label="Dove punta la sedia"
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
        {/* Live delta comment — only when currentRating is known */}
        {stats && (
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
                return "Stai puntando sotto di te. Possiamo lavorarci lo stesso, ma dimmi: sicuro?";
              if (delta < 100)
                return `Ci sei quasi. Quei ${delta} punti dipendono da una cosa sola. La troviamo.`;
              if (delta <= 250)
                return `${delta} punti. Non e' poco, ma e' esattamente dove posso aiutarti. Si comincia.`;
              if (delta <= 400)
                return `Stai puntando in alto. ${delta} punti vogliono tempo e una cosa per volta. Ce la fai.`;
              return "E' una salita lunga. Tienila, ma sappi che non si fa in fretta. Io ci sono per tutto il percorso.";
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
      <Field label="In quanto tempo?" htmlFor="goal-deadline" hint="Nonno calibra il passo su questo.">
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
      <Field label="Quanto puoi sederti a settimana?" htmlFor="weekly">
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "0.5rem" }}>
          {([
            [30, "Mezz'ora"],
            [60, "Un'ora"],
            [120, "Due ore"],
            [180, "Tre ore"],
          ] as Array<[number, string]>).map(([m, label]) => {
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
          Indietro
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
          {submitting ? "Salvo…" : "Apparecchia il Tavolo"}
        </button>
      </div>
    </AuthShell>
  );
}
