import { useEffect, useRef, useState } from "react";
import type { SessionState, DailyStreak } from "./store";
import type { WeeklyTrend, CoachSession } from "../types";
import { WeeklyTrendCard } from "../components/WeeklyTrendCard";
import { CoachNote } from "../components/CoachNote";
import { sessionFallbackLine } from "../coaching";

/** Animated count-up da 0 al target con easing cubico. Durata in ms. */
function useCountUp(target: number, durationMs: number = 1200) {
  const [value, setValue] = useState(0);
  const start = useRef<number | null>(null);
  useEffect(() => {
    start.current = null;
    setValue(0);
    let raf = 0;
    function tick(now: number) {
      if (start.current == null) start.current = now;
      const t = Math.min(1, (now - start.current) / durationMs);
      const eased = 1 - Math.pow(1 - t, 3);
      setValue(Math.round(target * eased));
      if (t < 1) raf = requestAnimationFrame(tick);
    }
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, durationMs]);
  return value;
}

interface Props {
  session: SessionState;
  streak: DailyStreak;
  trendWeekly?: WeeklyTrend;
  coachSession?: CoachSession;
  onClose: () => void;
}

export function RecapStep({ session, streak, trendWeekly, coachSession, onClose }: Props) {
  const drillsTotal = session.drills.length;
  const perfect = session.drills.filter((d) => d.verdict === "perfect").length;
  const ok = session.drills.filter((d) => d.verdict === "ok").length;
  const wrong = session.drills.filter((d) => d.verdict === "wrong").length;
  const bivi = session.bivi.filter((b) => b.revealed).length;
  const playOutcome = session.play?.outcome;
  const durationMin = session.finishedAt
    ? Math.round((session.finishedAt - session.startedAt) / 1000 / 60)
    : null;

  const pointsAnim = useCountUp(session.points, 1400);
  const streakAnim = useCountUp(streak.current, 800);

  // Frase Coach in base all'esito della partita
  const outcomePhrase = (() => {
    if (!coachSession) return null;
    if (playOutcome === "win") return { text: coachSession.recap_win || sessionFallbackLine("recap_win"), tone: "win" as const };
    if (playOutcome === "loss") return { text: coachSession.recap_loss || sessionFallbackLine("recap_loss"), tone: "loss" as const };
    if (playOutcome === "draw") return { text: coachSession.recap_draw || sessionFallbackLine("recap_draw"), tone: "default" as const };
    return null;
  })();

  return (
    <div className="max-w-3xl mx-auto py-10">
      <div className="text-center">
        <div className="label-eyebrow text-[color:var(--color-brand-soft)]">Sessione completata</div>
        <h2 className="display-medium mt-3 recap-headline">Bravo, <span className="recap-points-num">+{pointsAnim}</span> punti</h2>
        <div className="text-sm text-[color:var(--color-text-soft)] mt-2">
          {drillsTotal} posizioni  -  {bivi}/{session.bivi.length} bivi  -  1 partita  - {" "}
          {durationMin != null ? `${durationMin} min` : ""}
        </div>
      </div>

      {outcomePhrase && (
        <div className="mt-6">
          <CoachNote text={outcomePhrase.text} tone={outcomePhrase.tone} />
        </div>
      )}

      {/* Giorni al tavolo + numero */}
      <div className="surface surface-padded mt-8 text-center">
        <div className="label-eyebrow">Giorni al tavolo</div>
        <div className="flex items-baseline justify-center gap-3 mt-3">
          <span className="display-rating leading-none recap-streak-num">🔥 {streakAnim}</span>
          <span className="text-2xl text-[color:var(--color-text-soft)] font-mono">
            {streakAnim === 1 ? "giorno" : "giorni"}
          </span>
        </div>
        <div className="text-xs text-[color:var(--color-muted)] font-mono mt-2">
          massimo: {streak.best}  -  {streak.totalSessions} sessioni  - {" "}
          {streak.totalPoints} pt totali
        </div>
      </div>

      {/* Breakdown posizioni */}
      <div className="grid grid-cols-3 gap-3 mt-6">
        <Stat label="Perfetti" value={perfect.toString()} color="#34d399" />
        <Stat label="Giocabili" value={ok.toString()} color="#facc15" />
        <Stat label="Errori" value={wrong.toString()} color="#f43f5e" />
      </div>

      {/* Risultato partita */}
      {playOutcome && (
        <div className="surface surface-padded mt-6">
          <div className="label-eyebrow">Partita finale</div>
          <div
            className="display-small mt-2"
            style={{
              color:
                playOutcome === "win"
                  ? "#34d399"
                  : playOutcome === "loss"
                  ? "#f43f5e"
                  : "#94a3b8",
            }}
          >
            {{
              win: "Vittoria  -  +20",
              draw: "Patta  -  +8",
              loss: "Sconfitta  -  +3",
              abandoned: "Abbandonata  -  0",
            }[playOutcome]}
          </div>
          {session.play?.moves_played != null && (
            <div className="text-xs text-[color:var(--color-muted)] mt-1 font-mono">
              {session.play.moves_played} mosse
            </div>
          )}
        </div>
      )}

      {/* Trend weekly: dove sei nella settimana */}
      {trendWeekly && (
        <div className="mt-8">
          <WeeklyTrendCard trend={trendWeekly} title="Ultimi 7gg vs precedenti" />
        </div>
      )}

      {/* CTA + chiusura Coach */}
      <div className="mt-10">
        {coachSession?.close && (
          <div className="mb-5">
            <CoachNote text={coachSession.close || sessionFallbackLine("close")} tone="warm" />
          </div>
        )}
        <div className="text-center">
          <button onClick={onClose} className="btn btn-primary btn-lg">
            Chiudi  -  ci vediamo domani
          </button>
          <div className="text-xs text-[color:var(--color-muted)] mt-4 font-mono">
            la prossima sessione sara' disponibile dopo le 00:00 UTC
          </div>
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div className="border border-[color:var(--color-line)] rounded-lg p-4 text-center">
      <div className="display-medium tabular-nums" style={{ color }}>{value}</div>
      <div className="label-eyebrow mt-1">{label}</div>
    </div>
  );
}

