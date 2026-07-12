export interface AnalysisProgressCounts {
  processed: number;
  total: number;
  succeeded: number;
}

export interface AnalysisCoverage {
  /** Partite selezionate nel corpus (massimo il cap del piano). */
  selected: number;
  /** Analisi persistite e quindi realmente usate da aggregati e coach. */
  succeeded: number;
  /** Partite selezionate che non hanno prodotto un'analisi valida. */
  failed: number;
}

const PARTIAL_ANALYSIS_PREFIX = "background_analysis_partial";
const LEGACY_INCOMPLETE_PREFIX = "background_analysis_incomplete";

function finiteCount(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
}

/** Costruisce una copertura coerente: succeeded non puo' superare selected. */
export function buildAnalysisCoverage(
  selected: number,
  succeeded: number,
): AnalysisCoverage {
  const normalizedSelected = finiteCount(selected);
  const normalizedSucceeded = Math.min(
    normalizedSelected,
    finiteCount(succeeded),
  );
  return {
    selected: normalizedSelected,
    succeeded: normalizedSucceeded,
    failed: normalizedSelected - normalizedSucceeded,
  };
}

/**
 * Persistiamo la copertura parziale sul job senza chiamarla completamento pieno.
 * `null` significa che tutte le partite selezionate sono state analizzate.
 */
export function serializePartialAnalysis(
  coverage: AnalysisCoverage,
): string | null {
  if (coverage.failed <= 0) return null;
  return `${PARTIAL_ANALYSIS_PREFIX}:${coverage.succeeded}/${coverage.selected}`;
}

/** Legge sia il formato corrente sia i job creati dalla vecchia retry loop. */
export function parsePartialAnalysis(
  value: string | null | undefined,
): AnalysisCoverage | null {
  if (!value) return null;
  const match = value.match(
    new RegExp(`(?:${PARTIAL_ANALYSIS_PREFIX}|${LEGACY_INCOMPLETE_PREFIX}):(\\d+)\\/(\\d+)`),
  );
  if (!match) return null;
  const coverage = buildAnalysisCoverage(Number(match[2]), Number(match[1]));
  return coverage.failed > 0 ? coverage : null;
}

/**
 * Durante la scansione Chess.com `gamesTotal` puo' essere solo il cap cercato.
 * Un denominatore viene mostrato come "selezionato" soltanto dopo che il corpus
 * reale e' finalizzato, oppure quando esiste una coverage terminale.
 */
export function selectedGamesForDisplay(
  progress: { gamesTotal: number; corpusFinalized?: boolean } | null,
  coverage: AnalysisCoverage | null,
): number | null {
  if (coverage) return coverage.selected;
  if (!progress || progress.corpusFinalized !== true) return null;
  return finiteCount(progress.gamesTotal);
}

/** Una SELECT fallita non equivale mai a un corpus vuoto completato 0/0. */
export function requireAnalysisRows<T>(
  rows: T[] | null,
  error: { message: string } | null,
): T[] {
  if (error) throw new Error(`analysis_games_select_failed:${error.message}`);
  return rows ?? [];
}

/** Count null/error non deve mai essere interpretato come zero di dominio. */
export function requireExactCount(
  count: number | null,
  error: { message: string } | null,
  code: string,
): number {
  if (error) throw new Error(`${code}:${error.message}`);
  if (count == null) throw new Error(`${code}:missing_count`);
  return finiteCount(count);
}

export function countNewGoalGames(
  games: readonly { end_time?: number; time_class?: string }[],
  goalTimeClass: string,
  cutoffSeconds: number,
  cap: number,
): number {
  const limit = finiteCount(cap);
  return Math.min(
    limit,
    games.filter(
      (game) =>
        game.time_class === goalTimeClass &&
        Number.isFinite(game.end_time) &&
        (game.end_time ?? 0) > cutoffSeconds,
    ).length,
  );
}

export interface AnalysisStateLike {
  analysis_status: string;
  analysis_path?: string | null;
}

export function isPersistedAnalysisSuccess(game: AnalysisStateLike): boolean {
  return game.analysis_status === "done" && Boolean(game.analysis_path);
}

/** Il passaggio completo ritenta errori precedenti e salta solo successi persistiti. */
export function analysisWorkItems<T extends AnalysisStateLike>(
  games: readonly T[],
  range?: { offset: number; limit: number },
): T[] {
  const slice = range
    ? games.slice(range.offset, range.offset + range.limit)
    : games.slice();
  return slice.filter((game) => !isPersistedAnalysisSuccess(game));
}

/** Un tentativo processato e' distinto da un'analisi pubblicabile riuscita. */
export function advanceAnalysisProgress(
  current: AnalysisProgressCounts,
  succeeded: boolean,
): AnalysisProgressCounts {
  return {
    ...current,
    processed: current.processed + 1,
    succeeded: current.succeeded + (succeeded ? 1 : 0),
  };
}

/** Il Tavolo non puo' aprirsi se la prima fetta non ha prodotto alcun JSON valido. */
export function canPublishFirstReading(sliceSucceeded: number): boolean {
  return Number.isFinite(sliceSucceeded) && sliceSucceeded >= 1;
}
