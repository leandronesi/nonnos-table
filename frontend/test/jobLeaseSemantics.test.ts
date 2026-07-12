import { describe, expect, it } from "vitest";

import {
  applyLeaseClaim,
  observationAction,
  observedLifecycleTransition,
  observedWorkFingerprint,
  reapExpiredLease,
  shouldAdoptJob,
  shouldNotifyObservedBackgroundDone,
  shouldTreatObservedJobAsTerminal,
  type LeaseSnapshot,
} from "../src/pipeline/jobLeaseSemantics";

const NOW = 1_000_000;

function snapshot(patch: Partial<LeaseSnapshot> = {}): LeaseSnapshot {
  return {
    kind: "main",
    status: "fetching",
    leaseToken: null,
    leaseExpiresAtMs: null,
    createdAtMs: NOW - 1_000,
    ...patch,
  };
}

describe("ingest job lease semantics", () => {
  it("elects one winner and denies a second claimant while its lease is live", () => {
    const first = applyLeaseClaim({
      snapshot: snapshot(),
      expectedKind: "main",
      nowMs: NOW,
      token: "winner",
      ttlMs: 90_000,
    });
    const second = applyLeaseClaim({
      snapshot: first.snapshot,
      expectedKind: "main",
      nowMs: NOW + 1,
      token: "loser",
      ttlMs: 90_000,
    });

    expect(first.claimed).toBe(true);
    expect(first.snapshot.leaseToken).toBe("winner");
    expect(second.claimed).toBe(false);
    expect(second.snapshot.leaseToken).toBe("winner");
  });

  it("waits on an active lease but permits stale takeover", () => {
    const active = snapshot({
      leaseToken: "active",
      leaseExpiresAtMs: NOW + 10_000,
    });
    expect(observationAction(active, "main", NOW)).toBe("wait");
    expect(applyLeaseClaim({
      snapshot: active,
      expectedKind: "main",
      nowMs: NOW,
      token: "denied",
      ttlMs: 90_000,
    }).claimed).toBe(false);

    const stale = { ...active, leaseExpiresAtMs: NOW - 1 };
    const takeover = applyLeaseClaim({
      snapshot: stale,
      expectedKind: "main",
      nowMs: NOW,
      token: "takeover",
      ttlMs: 90_000,
    });
    expect(observationAction(stale, "main", NOW)).toBe("claim");
    expect(takeover.claimed).toBe(true);
    expect(takeover.snapshot.leaseToken).toBe("takeover");
  });

  it("never adopts a silent row as a main job", () => {
    const silent = snapshot({ kind: "silent" });
    expect(shouldAdoptJob("main", "silent")).toBe(false);
    expect(observationAction(silent, "main", NOW)).toBe("wrong_kind");
    expect(applyLeaseClaim({
      snapshot: silent,
      expectedKind: "main",
      nowMs: NOW,
      token: "wrong-kind",
      ttlMs: 90_000,
    }).claimed).toBe(false);
  });

  it("reaps expired ownership while keeping main and silent jobs resumable", () => {
    const expiredMain = reapExpiredLease(snapshot({
      status: "analyzing",
      leaseToken: "old-main",
      leaseExpiresAtMs: NOW - 1,
    }), NOW);
    expect(expiredMain).toMatchObject({
      status: "analyzing",
      leaseToken: null,
      leaseExpiresAtMs: null,
    });

    const expiredSilent = reapExpiredLease(snapshot({
      kind: "silent",
      status: "coaching",
      leaseToken: "old-silent",
      leaseExpiresAtMs: NOW - 1,
    }), NOW);
    expect(expiredSilent).toMatchObject({
      status: "coaching",
      leaseToken: null,
      leaseExpiresAtMs: null,
    });
    expect(applyLeaseClaim({
      snapshot: expiredSilent,
      expectedKind: "silent",
      nowMs: NOW,
      token: "silent-takeover",
      ttlMs: 90_000,
    }).claimed).toBe(true);

    const unclaimedSilent = reapExpiredLease(snapshot({
      kind: "silent",
      status: "queued",
      createdAtMs: NOW - 120_000,
    }), NOW);
    expect(unclaimedSilent.status).toBe("queued");
  });

  it("keeps main errors resumable and makes an explicit done retry wait for ownership", () => {
    expect(observationAction(snapshot({ status: "error" }), "main", NOW)).toBe("claim");
    const done = snapshot({ status: "done" });
    expect(shouldTreatObservedJobAsTerminal({
      snapshot: done,
      expectedKind: "main",
      profileReady: true,
      allowTerminalClaim: false,
    })).toBe(true);
    expect(shouldTreatObservedJobAsTerminal({
      snapshot: done,
      expectedKind: "main",
      profileReady: true,
      allowTerminalClaim: true,
    })).toBe(false);
    expect(shouldTreatObservedJobAsTerminal({
      snapshot: snapshot({ kind: "silent", status: "error" }),
      expectedKind: "silent",
      profileReady: true,
      allowTerminalClaim: false,
    })).toBe(true);
  });

  it("does not mistake heartbeat metadata for real pipeline progress", () => {
    const before = {
      status: "analyzing" as const,
      monthsDone: 3,
      gamesDone: 12,
      profileState: "analyzing",
      leaseExpiresAtMs: NOW + 10_000,
      updatedAt: "before",
    };
    const heartbeatOnly = {
      ...before,
      leaseExpiresAtMs: NOW + 90_000,
      updatedAt: "after",
    };
    expect(observedWorkFingerprint(before)).toBe(
      observedWorkFingerprint(heartbeatOnly),
    );
  });

  it("preserves observer lifecycle callbacks across first-batch and background completion", () => {
    const transition = observedLifecycleTransition({
      readySeen: false,
      profileReady: true,
      status: "analyzing_rest",
    });
    expect(transition).toEqual({
      readySeen: true,
      firstBatchBecameReady: true,
      backgroundWork: true,
    });
    expect(shouldNotifyObservedBackgroundDone({
      backgroundWorkSeen: true,
      profileWasReadyAtStart: false,
      selectedGames: 9,
      firstBatchSize: 10,
    })).toBe(true);
    expect(shouldNotifyObservedBackgroundDone({
      backgroundWorkSeen: false,
      profileWasReadyAtStart: true,
      selectedGames: 100,
      firstBatchSize: 10,
    })).toBe(true);
  });
});
