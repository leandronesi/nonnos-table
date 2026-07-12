import type { IngestJobKind, IngestJobStatus } from "../auth/db.types";

export interface LeaseSnapshot {
  kind: IngestJobKind;
  status: IngestJobStatus;
  leaseToken: string | null;
  leaseExpiresAtMs: number | null;
  createdAtMs: number;
}

export type LeaseObservationAction = "claim" | "wait" | "terminal" | "wrong_kind";

export function observedWorkFingerprint(input: {
  status: IngestJobStatus;
  monthsDone: number;
  gamesDone: number;
  profileState: string;
}): string {
  return [input.status, input.monthsDone, input.gamesDone, input.profileState].join(":");
}

export function shouldAdoptJob(expected: IngestJobKind, actual: IngestJobKind): boolean {
  return expected === actual;
}

export function observationAction(
  snapshot: LeaseSnapshot,
  expectedKind: IngestJobKind,
  nowMs: number,
): LeaseObservationAction {
  if (!shouldAdoptJob(expectedKind, snapshot.kind)) return "wrong_kind";
  if (snapshot.status === "done"
    || (snapshot.kind === "silent" && snapshot.status === "error")) return "terminal";
  if (!snapshot.leaseToken
    || snapshot.leaseExpiresAtMs == null
    || snapshot.leaseExpiresAtMs <= nowMs) return "claim";
  return "wait";
}

export function shouldTreatObservedJobAsTerminal(input: {
  snapshot: LeaseSnapshot;
  expectedKind: IngestJobKind;
  profileReady: boolean;
  allowTerminalClaim: boolean;
}): boolean {
  const action = observationAction(
    input.snapshot,
    input.expectedKind,
    Number.NEGATIVE_INFINITY,
  );
  if (action !== "terminal") return false;
  if (input.snapshot.kind === "main" && !input.profileReady) return false;
  // An explicit partial-retry CTA must acquire ownership even if the target
  // row is done; a denial caused by another live lease means wait, not no-op.
  if (input.allowTerminalClaim
    && input.snapshot.kind === "main"
    && input.snapshot.status === "done") return false;
  return true;
}

export function observedLifecycleTransition(input: {
  readySeen: boolean;
  profileReady: boolean;
  status: IngestJobStatus;
}): {
  readySeen: boolean;
  firstBatchBecameReady: boolean;
  backgroundWork: boolean;
} {
  return {
    readySeen: input.readySeen || input.profileReady,
    firstBatchBecameReady: !input.readySeen && input.profileReady,
    backgroundWork: input.profileReady
      && (input.status === "analyzing_rest" || input.status === "coaching"),
  };
}

export function shouldNotifyObservedBackgroundDone(input: {
  backgroundWorkSeen: boolean;
  profileWasReadyAtStart: boolean;
  selectedGames: number;
  firstBatchSize: number;
}): boolean {
  return input.backgroundWorkSeen
    || (input.profileWasReadyAtStart && input.selectedGames > input.firstBatchSize);
}

export function applyLeaseClaim(input: {
  snapshot: LeaseSnapshot;
  expectedKind: IngestJobKind;
  nowMs: number;
  token: string;
  ttlMs: number;
}): { claimed: boolean; snapshot: LeaseSnapshot } {
  if (observationAction(input.snapshot, input.expectedKind, input.nowMs) !== "claim") {
    return { claimed: false, snapshot: input.snapshot };
  }
  return {
    claimed: true,
    snapshot: {
      ...input.snapshot,
      leaseToken: input.token,
      leaseExpiresAtMs: input.nowMs + input.ttlMs,
    },
  };
}

export function reapExpiredLease(
  snapshot: LeaseSnapshot,
  nowMs: number,
): LeaseSnapshot {
  const expired = snapshot.leaseToken != null
    && snapshot.leaseExpiresAtMs != null
    && snapshot.leaseExpiresAtMs <= nowMs;
  if (!expired) return snapshot;
  return {
    ...snapshot,
    leaseToken: null,
    leaseExpiresAtMs: null,
  };
}
