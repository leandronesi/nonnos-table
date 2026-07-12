export const ACCEPTABLE_MOVE_CP_LOSS = 50;
export const CRITICAL_CP_BAND = 150;
export const BOOK_PLY_LIMIT = 16;

export interface ObservedEngineLine {
  scoreCp: number | null;
  mate: number | null;
  moveUci: string | null;
}

/**
 * Restituisce solo le mosse MultiPV osservate che sono entro la tolleranza
 * dalla prima linea. Il risultato non e' un'enumerazione completa delle mosse
 * equivalenti. In presenza di mate resta conservativo e usa la sola best move.
 */
export function acceptableObservedMovesFromEvaluation(
  evaluation: { bestMoveUci: string | null; lines: ObservedEngineLine[] },
  maxCpLoss = ACCEPTABLE_MOVE_CP_LOSS,
): string[] {
  const bestMove = evaluation.bestMoveUci ?? evaluation.lines[0]?.moveUci ?? null;
  if (!bestMove) return [];

  const acceptable = new Set<string>([bestMove]);
  const bestLine = evaluation.lines.find((line) => line.moveUci === bestMove) ?? evaluation.lines[0];
  if (!bestLine || bestLine.mate !== null || bestLine.scoreCp === null) {
    return [...acceptable];
  }

  for (const line of evaluation.lines) {
    if (!line.moveUci || line.mate !== null || line.scoreCp === null) continue;
    const lossFromBest = bestLine.scoreCp - line.scoreCp;
    if (lossFromBest >= 0 && lossFromBest <= maxCpLoss) acceptable.add(line.moveUci);
  }
  return [...acceptable];
}

/** Posizione contendibile e fuori dal tratto iniziale trattato come libro. */
export function isCriticalPosition(ply: number, scoreBeforeCp: number): boolean {
  return ply > BOOK_PLY_LIMIT && Math.abs(scoreBeforeCp) <= CRITICAL_CP_BAND;
}

/**
 * Tempo pensato sul ply `index` (0-based). Per la prima mossa di ciascun colore
 * usa il tempo base; poi usa il clock dopo la propria mossa precedente.
 */
export function computeSpentSeconds(
  index: number,
  clocks: Array<number | null>,
  baseSeconds: number | null,
  incrementSeconds: number,
): number | null {
  const clockAfter = clocks[index] ?? null;
  if (clockAfter === null) return null;

  const clockBefore = index >= 2 ? (clocks[index - 2] ?? null) : baseSeconds;
  if (clockBefore === null) return null;

  const elapsed = clockBefore + incrementSeconds - clockAfter;
  if (elapsed < -0.05) return null;
  return Math.max(0, Math.round(elapsed * 1000) / 1000);
}
