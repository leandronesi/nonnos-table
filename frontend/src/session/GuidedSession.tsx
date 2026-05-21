import { useEffect, useState } from "react";
import type { PlayerModel, PositionRow } from "../types";
import { SessionHeader } from "./SessionHeader";
import { WarmupStep } from "./WarmupStep";
import { BivioStep } from "./BivioStep";
import { PlayStep } from "./PlayStep";
import { RecapStep } from "./RecapStep";
import {
  type SessionState,
  type DailyStreak,
  type DrillResult,
  type BivioResult,
  type PlayResult,
  loadSession,
  saveSession,
  startNewSession,
  completeSession,
  computePoints,
  loadStreak,
  sessionIsTodayAndDone,
  sessionIsTodayAndInProgress,
} from "./store";

interface Props {
  pm: PlayerModel;
  onClose: () => void;
}

const WARMUP_N = 5;
const BIVIO_N = 2;

/**
 * Orchestratore della sessione giornaliera.
 *
 * Logica:
 *   - All'apertura: carica sessione esistente di OGGI (riprendi step). Se non c'è,
 *     ne crea una nuova prendendo i primi N drill + M bivi dal player_model.
 *   - Per ogni step, salva il progresso in localStorage dopo OGNI azione.
 *   - Al completamento play, finalizza → recap + aggiorna streak.
 *   - Se la sessione di oggi è GIÀ stata fatta, mostra direttamente il recap.
 */
export function GuidedSession({ pm, onClose }: Props) {
  const [session, setSession] = useState<SessionState | null>(null);
  const [streak, setStreak] = useState<DailyStreak>(loadStreak);

  // Init: carica o crea sessione
  useEffect(() => {
    let existing = loadSession();
    if (existing && (sessionIsTodayAndDone(existing) || sessionIsTodayAndInProgress(existing))) {
      setSession(existing);
      return;
    }
    // crea nuova
    const drills = pm.drills.slice(0, WARMUP_N);
    const bivi = pm.turning_points.slice(0, BIVIO_N);
    const playTp = pm.turning_points[BIVIO_N];
    existing = startNewSession({
      drillIds: drills.map((d) => `${d.game_id}:${d.ply}`),
      bivioIds: bivi.map((b) => `${b.game_id}:${b.ply}`),
      playFen: playTp?.fen_before,
      playMyColor: playTp?.my_color || "white",
    });
    setSession(existing);
  }, [pm]);

  if (!session) {
    return (
      <div className="fixed inset-0 z-50 bg-[color:var(--color-bg)] flex items-center justify-center">
        <div className="label-eyebrow text-[color:var(--color-brand-soft)]">Carico sessione…</div>
      </div>
    );
  }

  // Recupera i PositionRow dai loro ID
  const drills: PositionRow[] = session.drillIds
    .map((id) => pm.drills.find((d) => `${d.game_id}:${d.ply}` === id))
    .filter((x): x is PositionRow => !!x);
  const bivi: PositionRow[] = session.bivioIds
    .map((id) => pm.turning_points.find((t) => `${t.game_id}:${t.ply}` === id))
    .filter((x): x is PositionRow => !!x);

  function update(patch: Partial<SessionState>) {
    setSession((prev) => {
      if (!prev) return prev;
      const next = { ...prev, ...patch };
      next.points = computePoints(next);
      saveSession(next);
      return next;
    });
  }

  function handleDrillDone(r: DrillResult) {
    if (!session) return;
    update({ drills: [...session.drills, r] });
  }

  function handleWarmupAllDone() {
    update({ step: "bivio" });
  }

  function handleBivioDone(r: BivioResult) {
    if (!session) return;
    update({ bivi: [...session.bivi, r] });
  }

  function handleBivioAllDone() {
    update({ step: "play" });
  }

  function handlePlayDone(r: PlayResult) {
    if (!session) return;
    const updated = { ...session, play: r, step: "recap" as const };
    const { session: final, streak: nextStreak } = completeSession(updated);
    setSession(final);
    setStreak(nextStreak);
  }

  return (
    <div className="fixed inset-0 z-50 bg-[color:var(--color-bg)] overflow-auto">
      <SessionHeader step={session.step} points={session.points} onExit={onClose} />
      <div className="max-w-[1200px] mx-auto px-6 lg:px-10 py-8">
        {session.step === "warmup" && (
          <WarmupStep
            drills={drills}
            results={session.drills}
            onDrillDone={handleDrillDone}
            onAllDone={handleWarmupAllDone}
          />
        )}
        {session.step === "bivio" && (
          <BivioStep
            tps={bivi}
            results={session.bivi}
            onBivioDone={handleBivioDone}
            onAllDone={handleBivioAllDone}
          />
        )}
        {session.step === "play" && session.playFen && (
          <PlayStep
            startFen={session.playFen}
            myColor={session.playMyColor || "white"}
            skillLevel={8}
            onDone={handlePlayDone}
          />
        )}
        {session.step === "play" && !session.playFen && (
          // se non c'è una posizione disponibile, saltiamo direttamente al recap
          <PlayStepFallback onSkip={() => handlePlayDone({ outcome: "abandoned", moves_played: 0, finished_at: Date.now() })} />
        )}
        {session.step === "recap" && (
          <RecapStep session={session} streak={streak} onClose={onClose} />
        )}
      </div>
    </div>
  );
}

function PlayStepFallback({ onSkip }: { onSkip: () => void }) {
  return (
    <div className="text-center py-20">
      <div className="display-medium">Nessuna posizione disponibile per la partita</div>
      <p className="text-[color:var(--color-text-soft)] mt-3">
        Non ci sono abbastanza turning points per giocare oggi. Vai al recap.
      </p>
      <button onClick={onSkip} className="btn btn-primary btn-lg mt-6">
        Vai al recap →
      </button>
    </div>
  );
}
