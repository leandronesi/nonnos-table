/**
 * aggregatesCache — in-memory handoff of the already-fetched aggregates.
 *
 * TavoloHome downloads aggregates.json for its own blocks; when the user walks
 * to the Sessione the same file would be fetched again behind a spinner, which
 * (a) delays the ritual and (b) kills the tavolo-board View Transition morph:
 * at transition time the destination DOM would only contain the spinner, so
 * the shared element never finds its pair and the browser falls back to the
 * root crossfade.
 *
 * A module-level cache keyed by user id + dataVersion lets Sessione mount
 * synchronously with the data the Tavolo already has. Plain module state, not
 * a context: this is a pure performance handoff, not application state.
 * Stale entries (different user or dataVersion) are simply ignored.
 */

import type { Aggregates } from "./aggregate";

interface CachedAggregates {
  userId: string;
  dataVersion: number;
  aggregates: Aggregates;
}

let cached: CachedAggregates | null = null;

export function setCachedAggregates(
  userId: string,
  dataVersion: number,
  aggregates: Aggregates,
): void {
  cached = { userId, dataVersion, aggregates };
}

export function getCachedAggregates(
  userId: string,
  dataVersion: number,
): Aggregates | null {
  if (cached && cached.userId === userId && cached.dataVersion === dataVersion) {
    return cached.aggregates;
  }
  return null;
}
