export interface LatestRequestGate {
  begin: () => () => boolean;
  invalidate: () => void;
}

/**
 * Lets concurrent work finish while ensuring that only the newest request can
 * publish its result. Invalidating the gate also makes every in-flight token
 * stale, which is useful during sign-out and component cleanup.
 */
export function createLatestRequestGate(): LatestRequestGate {
  let generation = 0;

  return {
    begin() {
      const requestGeneration = ++generation;
      return () => requestGeneration === generation;
    },
    invalidate() {
      generation += 1;
    },
  };
}
