import { useEffect, useState } from "react";
import type { Identity, Kpi, Diagnosis, PositionRow } from "../types";
import {
  loadSession,
  loadStreak,
  sessionIsTodayAndDone,
  sessionIsTodayAndInProgress,
  type SessionState,
  type DailyStreak,
} from "../session/store";

interface Props {
  identity: Identity;
  kpi: Kpi;
  topDiagnosis: Diagnosis | undefined;
  nDrills: number;
  nTurningPoints: number;
  onStartTrainer: () => void;
  onPlayTurningPoint: (p: PositionRow) => void;
  firstTurningPoint?: PositionRow;
  refreshKey?: number;  // cambia per forzare il reload dello stato sessione dal localStorage
}

/**
 * Hero "Today's Session" — la cosa più importante dell'app.
 *
 * Layout (Apple-Health/Linear inspired):
 *  - Sinistra: ring di progresso verso il goal 1600 (focal point gestalt).
 *  - Centro: nome + headline diagnosi #1 + CTA "Inizia sessione" (primary action).
 *  - Destra: 3 stats della sessione di oggi (puzzle pronti, bivi da rivedere, streak).
 */
export function TodaySession({
  identity,
  kpi,
  topDiagnosis,
  nDrills,
  nTurningPoints,
  onStartTrainer,
  refreshKey,
}: Props) {
  // Stato sessione di oggi (per cambiare la CTA)
  const [session, setSession] = useState<SessionState | null>(null);
  const [streak, setStreak] = useState<DailyStreak | null>(null);
  useEffect(() => {
    setSession(loadSession());
    setStreak(loadStreak());
    // Refresh quando torno dalla sessione (visibility change)
    const handler = () => {
      setSession(loadSession());
      setStreak(loadStreak());
    };
    window.addEventListener("visibilitychange", handler);
    window.addEventListener("focus", handler);
    return () => {
      window.removeEventListener("visibilitychange", handler);
      window.removeEventListener("focus", handler);
    };
  }, [refreshKey]);
  const sessionDone = sessionIsTodayAndDone(session);
  const sessionInProgress = sessionIsTodayAndInProgress(session);

  const goal = identity.goal;
  const current = goal.current_rating ?? 0;
  const target = goal.target;
  const start = goal.start_rating ?? current;
  const total = Math.max(target - start, 1);
  const progress = Math.max(0, Math.min(1, (current - start) / total));
  const projection = goal.projection_at_deadline ?? current;
  const onTrack = goal.on_track;

  const today = new Date().toLocaleDateString("it-IT", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });

  return (
    <div id="today" className="hero fade-in scroll-mt-8">
      <div className="grid grid-cols-1 lg:grid-cols-[auto_1fr_auto] gap-8 lg:gap-12 items-center">
        {/* Ring goal */}
        <div className="flex justify-center lg:justify-start">
          <GoalRing
            progress={progress}
            current={current}
            target={target}
            onTrack={onTrack}
            projection={projection}
          />
        </div>

        {/* Center: pitch */}
        <div className="text-center lg:text-left">
          <div className="label-eyebrow text-[color:var(--color-brand-soft)]">
            Sessione di oggi · {today}
          </div>
          <h1 className="display-medium mt-3 text-balance">
            {topDiagnosis ? topDiagnosis.title : "Tutto sotto controllo"}
          </h1>
          <p className="text-[color:var(--color-text-soft)] mt-3 leading-relaxed max-w-xl">
            {topDiagnosis
              ? topDiagnosis.evidence
              : "Non ho ancora trovato debolezze sistematiche con confidenza alta. Gioca qualche partita e torna."}
          </p>
          <div className="flex flex-wrap gap-3 mt-5 justify-center lg:justify-start items-center">
            {sessionDone ? (
              <>
                <button onClick={onStartTrainer} className="btn btn-ghost btn-lg">
                  ✓ Sessione completata · vedi recap
                </button>
                {streak && (
                  <span className="pill pill-good">
                    <span className="dot" style={{ background: "#34d399" }} />
                    streak {streak.current} g · +{session?.points ?? 0} pt
                  </span>
                )}
              </>
            ) : sessionInProgress ? (
              <button onClick={onStartTrainer} className="btn btn-primary btn-lg">
                ▶ Riprendi sessione
              </button>
            ) : (
              <button onClick={onStartTrainer} className="btn btn-primary btn-lg">
                ▶ Inizia sessione · 5 puzzle + 2 bivi + 1 partita
              </button>
            )}
            {topDiagnosis?.lichess_theme && !sessionDone && (
              <a
                href={`https://lichess.org/training/${topDiagnosis.lichess_theme}`}
                target="_blank"
                rel="noreferrer"
                className="btn btn-ghost btn-lg"
              >
                Tactics su Lichess →
              </a>
            )}
          </div>
        </div>

        {/* Right: stats */}
        <div className="grid grid-cols-3 lg:grid-cols-1 gap-2 lg:gap-3 min-w-[200px]">
          <MiniStat label="Puzzle pronti" value={nDrills.toString()} />
          <MiniStat label="Turning points" value={nTurningPoints.toString()} />
          <MiniStat label="Partite analizzate" value={kpi.games_analyzed.toString()} />
        </div>
      </div>
    </div>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="text-center lg:text-right">
      <div className="display-tiny tabular-nums">{value}</div>
      <div className="label-eyebrow mt-1 text-[9px]">{label}</div>
    </div>
  );
}

/**
 * Ring achievement (Apple Fitness style).
 * Usa SVG con arco percentuale + numero del rating in mezzo.
 */
function GoalRing({
  progress,
  current,
  target,
  onTrack,
  projection,
}: {
  progress: number;
  current: number;
  target: number;
  onTrack: boolean;
  projection: number;
}) {
  const SIZE = 200;
  const STROKE = 14;
  const RADIUS = (SIZE - STROKE) / 2;
  const CIRC = 2 * Math.PI * RADIUS;
  const offset = CIRC * (1 - progress);

  const stroke = onTrack ? "url(#ringGoodGrad)" : "url(#ringBadGrad)";

  return (
    <div className="ring-wrap">
      <svg width={SIZE} height={SIZE} style={{ transform: "rotate(-90deg)" }}>
        <defs>
          <linearGradient id="ringGoodGrad" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#34d399" />
            <stop offset="100%" stopColor="#06b6d4" />
          </linearGradient>
          <linearGradient id="ringBadGrad" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#7c5cff" />
            <stop offset="100%" stopColor="#a18bff" />
          </linearGradient>
        </defs>
        <circle
          className="ring-bg"
          cx={SIZE / 2}
          cy={SIZE / 2}
          r={RADIUS}
          strokeWidth={STROKE}
        />
        <circle
          className="ring-fg"
          cx={SIZE / 2}
          cy={SIZE / 2}
          r={RADIUS}
          strokeWidth={STROKE}
          stroke={stroke}
          strokeDasharray={CIRC}
          strokeDashoffset={offset}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <div className="display-rating leading-none">{current}</div>
        <div className="label-eyebrow mt-1">→ {target}</div>
        <div className={`pill mt-2 ${onTrack ? "pill-good" : "pill-bad"}`}>
          <span className="dot" style={{ background: onTrack ? "#34d399" : "#f43f5e" }} />
          {onTrack ? "ON TRACK" : `→ ${projection}`}
        </div>
      </div>
    </div>
  );
}
