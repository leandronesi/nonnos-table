/**
 * DrillStep — interazione SENZA HINT visivo.
 *
 * Tutto il comportamento (drag&drop, Stockfish judge, retry, verdict)
 * è condiviso con WarmupGuidato tramite PositionPuzzle (componente interno).
 * Questa è una re-export thin per esporre il file con il suo nome semantico.
 */
export { DrillStep } from "./WarmupGuidato";
export type { DrillStepProps } from "./WarmupGuidato";
