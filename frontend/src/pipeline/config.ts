import type { GoalTimeClass } from "../auth/db.types";

/**
 * Config della pipeline browser-side.
 *
 * FREE_GAME_CAP — quante partite (le più recenti) ingeriamo + analizziamo nel
 * tier free. Alzato a 100 (2026-05-29) ora che l'analisi è parallela (pool di
 * worker Stockfish + MultiPV 2): dataset più ricco, statistiche più solide,
 * e la curva-rating combacia quasi con le partite analizzate. Resta sotto il
 * "scarica tutto": l'ingest scorre gli archivi in ordine inverso e si ferma
 * appena trova 100 partite della cadenza scelta.
 */
export const FREE_GAME_CAP = 100;

/** Prima fetta di analisi: le N partite più recenti → aggregate+coach parziale rapido.
 * Il resto del corpus effettivamente trovato continua in background. */
export const FIRST_BATCH_SIZE = 10;

/** Quante posizioni-esempio (mosse peggiori) passiamo al coach LLM. */
export const MAX_COACH_EXAMPLES = 8;

/** Dopo quanti giorni la Home propone a Nonno di riguardare le partite nuove. */
export const REFRESH_AFTER_DAYS = 7;

/** Quante posizioni mostrare nella galleria Cadute. */
export const CADUTE_LIMIT = 40;

/**
 * Ampiezza delle due finestre del trend: le ultime N partite contro le N
 * precedenti.
 *
 * Si contano PARTITE, non giorni. Il calendario misura la cosa sbagliata: chi
 * gioca 40 partite in un mese e 3 nel mese prima si vedrebbe confrontare 40
 * contro 3, e chi si ferma un mese non avrebbe nessun trend. A partite le due
 * finestre sono sempre confrontabili, esistono appena hai 2N partite
 * analizzate, e coincidono con la frase che il giocatore si dice da solo:
 * "come sto andando nelle ultime".
 *
 * 10 e' il compromesso: abbastanza per non seguire il rumore di una serataccia,
 * abbastanza poco perche' "ultimamente" voglia ancora dire ultimamente.
 */
export const TREND_WINDOW_GAMES = 10;

/**
 * Shared Maia budget across pattern opportunities, including successful choices.
 * Sample is balanced across patterns/games without sorting by error magnitude.
 * Legacy constant name retained for readers of error-specific coverage.
 */
export const CADUTE_MAIA_CAP = 400;

/**
 * Time classes supported as a goal analysis scope.
 *
 * Ogni run sceglie ESATTAMENTE una voce (rapid O blitz): l'array non autorizza
 * a sommarle nello stesso corpus. Daily/bullet/classical restano esclusi.
 */
export type AnalyzedTimeClass = GoalTimeClass;

export const ANALYZED_TIME_CLASSES: string[] = ["rapid", "blitz"];

export interface GoalAnalysisScope {
  timeClass: AnalyzedTimeClass;
  gameCap: number;
}

export function isAnalyzedTimeClass(value: string): value is AnalyzedTimeClass {
  return value === "rapid" || value === "blitz";
}

/** Fail closed: una cadenza non supportata non deve mai ricadere su un mix. */
export function goalAnalysisScope(value: string): GoalAnalysisScope {
  if (!isAnalyzedTimeClass(value)) {
    throw new Error(`unsupported_goal_time_class:${value}`);
  }
  return { timeClass: value, gameCap: FREE_GAME_CAP };
}

export function isInGoalAnalysisScope(
  game: { time_class: string },
  scope: GoalAnalysisScope,
): boolean {
  return game.time_class === scope.timeClass;
}

/** Pure reference implementation used by tests and in-memory defensive guards. */
export function selectRecentGoalGames<T extends { time_class: string; played_at: string }>(
  games: readonly T[],
  scope: GoalAnalysisScope,
): T[] {
  return games
    .filter((game) => isInGoalAnalysisScope(game, scope))
    .sort((a, b) => b.played_at.localeCompare(a.played_at))
    .slice(0, scope.gameCap);
}

/** A fine scansione il totale UI deve coincidere col corpus realmente trovato. */
export function completedGameProgress(
  gamesDone: number,
  gameCap: number = FREE_GAME_CAP,
): {
  gamesTotal: number;
  gamesDone: number;
} {
  const normalizedCap = Math.max(0, Math.min(FREE_GAME_CAP, Math.floor(gameCap)));
  const completed = Math.max(0, Math.min(normalizedCap, Math.floor(gamesDone)));
  return { gamesTotal: completed, gamesDone: completed };
}

/**
 * Dopo la prima lettura, continua se esistono analisi da ritentare oppure se il
 * passaggio da 10 ha saturato il cap e quindi potrebbero esistere partite 11-100.
 */
export function shouldBuildRestCorpus(
  firstPassIndexed: number,
  retryableGames: number,
): boolean {
  return retryableGames > 0 || firstPassIndexed >= FIRST_BATCH_SIZE;
}
