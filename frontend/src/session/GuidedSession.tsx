import { useEffect, useState } from "react";
import type { PlayerModel, PositionRow } from "../types";
import { SessionHeader } from "./SessionHeader";
import { TemaStep } from "./TemaStep";
import { WarmupGuidato } from "./WarmupGuidato";
import { DrillStep } from "./DrillStep";
import { PlayStep } from "./PlayStep";
import { RecapStep } from "./RecapStep";
import {
  type SessionState,
  type DailyStreak,
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

// ---------------------------------------------------------------------------
// Position selection
// ---------------------------------------------------------------------------

function pickSessionPattern(pm: PlayerModel): string {
  const counts: Record<string, number> = {};
  for (const d of pm.drills) {
    const k = d.motif_label_it || d.motif;
    if (k) counts[k] = (counts[k] ?? 0) + 1;
  }
  const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  if (sorted.length > 0) return sorted[0][0];
  return pm.diagnoses?.[0]?.title ?? pm.weekly_focus?.headline ?? "il tuo pattern principale";
}

function pickPhasePositions(pm: PlayerModel): {
  tema: PositionRow | null;
  warmup: PositionRow | null;
  drill: PositionRow | null;
  play: PositionRow | null;
} {
  const usedGameIds = new Set<string>();
  const result: PositionRow[] = [];
  const sortedD = [...pm.drills].sort((a, b) => b.cp_loss - a.cp_loss);
  for (const d of sortedD) {
    if (result.length >= 3) break;
    if (!usedGameIds.has(d.game_id)) {
      usedGameIds.add(d.game_id);
      result.push(d);
    }
  }
  if (result.length < 3) {
    const sortedTp = [...pm.turning_points].sort((a, b) => b.cp_loss - a.cp_loss);
    for (const tp of sortedTp) {
      if (result.length >= 3) break;
      if (!usedGameIds.has(tp.game_id)) {
        usedGameIds.add(tp.game_id);
        result.push(tp);
      }
    }
  }
  const playTp = pm.turning_points.find((tp) => !usedGameIds.has(tp.game_id)) ?? pm.turning_points[0] ?? null;
  return {
    tema: result[0] ?? null,
    warmup: result[1] ?? null,
    drill: result[2] ?? null,
    play: playTp,
  };
}

function posId(p: PositionRow): string {
  return `${p.game_id}:${p.ply}`;
}

function findById(list: PositionRow[], id: string): PositionRow | null {
  return list.find((p) => posId(p) === id) ?? null;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * Orchestratore sessione 4 fasi: intro → tema → warmup_guidato → drill → play → outro
 *
 * - Tema: passiva, guarda
 * - Warmup guidato: muove con hint visivo (casa di partenza illuminata)
 * - Drill: muove senza hint
 * - Play: partita vs MAIA target, eval bar + undo multi-step + rifai partita
 */
export function GuidedSession({ pm, onClose }: Props) {
  const [session, setSession] = useState<SessionState | null>(null);
  const [streak, setStreak] = useState<DailyStreak>(loadStreak);

  const [temaPos, setTemaPos] = useState<PositionRow | null>(null);
  const [warmupPos, setWarmupPos] = useState<PositionRow | null>(null);
  const [drillPos, setDrillPos] = useState<PositionRow | null>(null);
  const [patternLabel, setPatternLabel] = useState<string>("");

  // Target dichiarato dal goal (non current_rating: vuoi giocare contro l'allievo che vuoi diventare)
  const maiaLevel = pm.identity.goal.target ?? 1600;
  const currentRating = pm.identity.goal.current_rating ?? undefined;
  const timeClass = pm.identity.goal.time_class ?? "rapid";

  function loadOrCreateSession() {
    const allPositions = [...pm.drills, ...pm.turning_points];
    let existing = loadSession();
    if (existing && (sessionIsTodayAndDone(existing) || sessionIsTodayAndInProgress(existing))) {
      setSession(existing);
      if (existing.temaPositionId) setTemaPos(findById(allPositions, existing.temaPositionId));
      if (existing.warmupPositionId) setWarmupPos(findById(allPositions, existing.warmupPositionId));
      if (existing.drillPositionId) setDrillPos(findById(allPositions, existing.drillPositionId));
      setPatternLabel(pickSessionPattern(pm));
      return;
    }
    const phases = pickPhasePositions(pm);
    const pattern = pickSessionPattern(pm);
    existing = startNewSession({
      drillIds: pm.drills.slice(0, 5).map(posId),
      bivioIds: pm.turning_points.slice(0, 2).map(posId),
      playFen: phases.play?.fen_before,
      playMyColor: phases.play?.my_color ?? "white",
      temaPositionId: phases.tema ? posId(phases.tema) : undefined,
      warmupPositionId: phases.warmup ? posId(phases.warmup) : undefined,
      drillPositionId: phases.drill ? posId(phases.drill) : undefined,
    });
    setSession(existing);
    setTemaPos(phases.tema);
    setWarmupPos(phases.warmup);
    setDrillPos(phases.drill);
    setPatternLabel(pattern);
  }

  useEffect(() => {
    loadOrCreateSession();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pm]);

  // Escape chiude il modal (a11y).
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [onClose]);

  if (!session) {
    return (
      <div className="fixed inset-0 z-50 bg-[color:var(--color-bg)] flex items-center justify-center">
        <div className="label-eyebrow text-[color:var(--color-brand-soft)]">Carico sessione…</div>
      </div>
    );
  }

  function update(patch: Partial<SessionState>) {
    setSession((prev) => {
      if (!prev) return prev;
      const next = { ...prev, ...patch };
      next.points = computePoints(next);
      saveSession(next);
      return next;
    });
  }

  function handleIntroDone() { update({ step: "tema" }); }
  function handleTemaDone() { update({ step: "warmup_guidato" }); }
  function handleWarmupDone() { update({ step: "drill" }); }
  function handleDrillDone() { update({ step: "play" }); }

  function handlePlayDone(r: PlayResult) {
    if (!session) return;
    const updated = { ...session, play: r, step: "outro" as const };
    const { session: final, streak: nextStreak } = completeSession(updated);
    setSession(final);
    setStreak(nextStreak);
  }

  function handlePhasePrev(current: SessionState["step"]) {
    const prevMap: Partial<Record<SessionState["step"], SessionState["step"]>> = {
      tema: "intro",
      warmup_guidato: "tema",
      drill: "warmup_guidato",
      play: "drill",
    };
    const prev = prevMap[current];
    if (prev) update({ step: prev });
  }

  function handleRestartSession() {
    try { localStorage.removeItem("mygotham_session"); } catch { /* ignore */ }
    loadOrCreateSession();
  }

  const introDescription = pm.weekly_focus?.headline ?? patternLabel;

  return (
    <div
      className="fixed inset-0 z-50 bg-[color:var(--color-bg)] overflow-auto"
      role="dialog"
      aria-modal="true"
      aria-label="Sessione di allenamento"
    >
      <SessionHeader step={session.step} points={session.points} onExit={onClose} onRestart={handleRestartSession} />
      <div className="max-w-[1200px] mx-auto px-6 lg:px-10 py-8">

        {/* INTRO */}
        {session.step === "intro" && (
          <div className="max-w-2xl mx-auto text-center py-16 space-y-6">
            <div className="label-eyebrow text-[color:var(--color-brand-soft)]">Sessione di oggi</div>
            <h2 className="display-medium">{introDescription}</h2>
            <p className="text-[color:var(--color-text-soft)] leading-relaxed">
              4 fasi: prima il tema (guardi), poi warm-up guidato, drill libero, e una partita contro un
              avversario <strong>{maiaLevel} {timeClass}</strong>, il livello che hai dichiarato come obiettivo.
              Tutte le posizioni vengono dalle tue partite reali.
            </p>
            <button onClick={handleIntroDone} className="btn btn-primary btn-lg">
              Cominciamo →
            </button>
          </div>
        )}

        {/* TEMA */}
        {session.step === "tema" && (
          temaPos ? (
            <div className="space-y-4">
              <button onClick={() => handlePhasePrev("tema")} className="btn btn-ghost btn-sm">
                ← Indietro
              </button>
              <TemaStep position={temaPos} patternLabel={patternLabel} onNext={handleTemaDone} />
            </div>
          ) : (
            <PhaseFallback
              title="Nessuna posizione per il tema"
              message="Non ci sono drill disponibili. Passiamo al warm-up."
              ctaLabel="Vai al warm-up →"
              onAction={handleTemaDone}
            />
          )
        )}

        {/* WARMUP GUIDATO */}
        {session.step === "warmup_guidato" && (
          warmupPos ? (
            <div className="space-y-4">
              <button onClick={() => handlePhasePrev("warmup_guidato")} className="btn btn-ghost btn-sm">
                ← Indietro
              </button>
              <WarmupGuidato position={warmupPos} patternLabel={patternLabel} onNext={handleWarmupDone} />
            </div>
          ) : (
            <PhaseFallback
              title="Nessuna posizione per il warm-up"
              message="Passiamo al drill."
              ctaLabel="Vai al drill →"
              onAction={handleWarmupDone}
            />
          )
        )}

        {/* DRILL */}
        {session.step === "drill" && (
          drillPos ? (
            <div className="space-y-4">
              <button onClick={() => handlePhasePrev("drill")} className="btn btn-ghost btn-sm">
                ← Indietro
              </button>
              <DrillStep position={drillPos} patternLabel={patternLabel} onNext={handleDrillDone} />
            </div>
          ) : (
            <PhaseFallback
              title="Nessuna posizione per il drill"
              message="Passiamo alla partita."
              ctaLabel="Vai alla partita →"
              onAction={handleDrillDone}
            />
          )
        )}

        {/* PLAY */}
        {session.step === "play" && session.playFen && (
          <div className="space-y-4">
            <button onClick={() => handlePhasePrev("play")} className="btn btn-ghost btn-sm">
              ← Indietro
            </button>
            <PlayStep
              startFen={session.playFen}
              myColor={session.playMyColor || "white"}
              maiaLevel={maiaLevel}
              currentRating={currentRating}
              timeClass={timeClass}
              coachSession={pm.coach_session}
              onDone={handlePlayDone}
            />
          </div>
        )}
        {session.step === "play" && !session.playFen && (
          <PhaseFallback
            title="Nessuna posizione per la partita"
            message="Non ci sono turning points oggi."
            ctaLabel="Vai al saluto →"
            onAction={() => handlePlayDone({ outcome: "abandoned", moves_played: 0, finished_at: Date.now() })}
          />
        )}

        {/* OUTRO / RECAP */}
        {(session.step === "outro" || session.step === "recap") && (
          <div className="space-y-6">
            <RecapStep session={session} streak={streak} trendWeekly={pm.trend_weekly} onClose={onClose} />
            <div className="max-w-2xl mx-auto text-center">
              <button onClick={handleRestartSession} className="btn btn-ghost">
                Rifai la sessione
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Helpers locali
// ---------------------------------------------------------------------------

function PhaseFallback({
  title, message, ctaLabel, onAction,
}: {
  title: string; message: string; ctaLabel: string; onAction: () => void;
}) {
  return (
    <div className="text-center py-20">
      <div className="display-medium">{title}</div>
      <p className="text-[color:var(--color-text-soft)] mt-3">{message}</p>
      <button onClick={onAction} className="btn btn-primary btn-lg mt-6">
        {ctaLabel}
      </button>
    </div>
  );
}
