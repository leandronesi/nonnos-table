import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { setStorageUserScope } from "../src/auth/userStorage";
import type { PositionExample } from "../src/pipeline/aggregate";
import {
  restoreAdaptiveSelection,
  shouldBlockAggregateRefreshFailure,
} from "../src/session/selectionPersistence";
import {
  buildSessionSelectionSeed,
  completeSession,
  decideSessionInitialization,
  decideSessionEntry,
  loadSession,
  saveSession,
  SESSION_SCHEMA,
  startNewSession,
  sessionInitializationKey,
  todayUTC,
  upgradeSessionWithPositionSnapshots,
} from "../src/session/store";

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>();
  get length() { return this.values.size; }
  clear() { this.values.clear(); }
  getItem(key: string) { return this.values.get(key) ?? null; }
  key(index: number) { return [...this.values.keys()][index] ?? null; }
  removeItem(key: string) { this.values.delete(key); }
  setItem(key: string, value: string) { this.values.set(key, value); }
}

function position(
  id: string,
  errorType: string,
  fen = `fen-${id}`,
): PositionExample {
  return {
    position_id: id,
    source_game_id: `game-${id}`,
    fen_before: fen,
    ply: 1,
    error_type: errorType,
    color: "white",
    phase: "middlegame",
    san: "e4",
    played_uci: "e2e4",
    best_uci: "e2e4",
    cp_loss: 100,
    score_before_cp: 0,
    score_after_cp: -100,
    category: "mistake",
  };
}

describe("adaptive session persistence", () => {
  const originalWindow = globalThis.window;

  beforeEach(() => {
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: { localStorage: new MemoryStorage() },
    });
  });

  afterEach(() => {
    setStorageUserScope(null);
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: originalWindow,
    });
  });

  it("restores the same daily selection only for its authenticated owner", () => {
    setStorageUserScope("user-a");
    startNewSession({
      drillIds: ["p2", "p3"],
      bivioIds: [],
      temaPositionId: "p1",
      warmupPositionId: "p2",
      drillPositionId: "p3",
      anchorKey: "anchor:hung_piece",
      anchorLabel: "Pezzi in presa",
      whyTodayCode: "priority_pattern",
      distinctPositions: 3,
      selectionSeed: `user-a:${todayUTC()}`,
      phaseAnchorKeys: {
        review: "anchor:hung_piece",
        guided: "anchor:clock_pressure",
        solo: "anchor:clock_pressure",
      },
      phaseAnchorLabels: {
        review: "Pezzi in presa",
        guided: "Gestione tempo",
        solo: "Gestione tempo",
      },
      phaseNovelty: { review: "fresh", guided: "fresh", solo: "fresh" },
      supplementalAnchorKeys: ["anchor:clock_pressure"],
      supplementalAnchorLabels: ["Gestione tempo"],
      corpusFallbackCode: "secondary_anchor",
      corpusPrimaryPositionsAvailable: 1,
      difficultyProgression: "secondary_fallback",
    });
    expect(loadSession()).toMatchObject({
      date: todayUTC(),
      anchorKey: "anchor:hung_piece",
      temaPositionId: "p1",
      warmupPositionId: "p2",
      drillPositionId: "p3",
      phaseAnchorKeys: {
        review: "anchor:hung_piece",
        guided: "anchor:clock_pressure",
        solo: "anchor:clock_pressure",
      },
      corpusFallbackCode: "secondary_anchor",
    });

    setStorageUserScope("user-b");
    expect(loadSession()).toBeNull();

    setStorageUserScope("user-a");
    expect(loadSession()?.anchorKey).toBe("anchor:hung_piece");
  });

  it("never starts a completed daily session again without an explicit choice", () => {
    setStorageUserScope("user-a");
    const started = startNewSession({ drillIds: [], bivioIds: [] });
    expect(decideSessionEntry(started, todayUTC(), false)).toBe("resume");

    const completed = completeSession(started).session;
    expect(decideSessionEntry(completed, todayUTC(), false)).toBe("completed");
    expect(decideSessionEntry(completed, todayUTC(), true)).toBe("start");
  });

  it("restores the truthful per-phase persisted mapping", () => {
    setStorageUserScope("user-a");
    const stored = startNewSession({
      drillIds: ["p2", "p3"],
      bivioIds: [],
      temaPositionId: "p1",
      warmupPositionId: "p2",
      drillPositionId: "p3",
      anchorKey: "anchor:primary",
      anchorLabel: "Principale",
      whyTodayCode: "recent_errors",
      whyObservedWrongAttempts: 2,
      whyObservedHintUses: 1,
      phaseAnchorKeys: {
        review: "anchor:primary",
        guided: "anchor:secondary",
        solo: "anchor:tertiary",
      },
      phaseAnchorLabels: {
        review: "Principale",
        guided: "Secondario",
        solo: "Terziario",
      },
      phaseNovelty: { review: "due", guided: "fresh", solo: "fresh" },
      supplementalAnchorKeys: ["anchor:secondary", "anchor:tertiary"],
      supplementalAnchorLabels: ["Secondario", "Terziario"],
      corpusFallbackCode: "secondary_anchor",
      corpusPrimaryPositionsAvailable: 1,
      difficultyProgression: "secondary_fallback",
    });
    const restored = restoreAdaptiveSelection([
      position("p1", "primary"),
      position("p2", "secondary"),
      position("p3", "tertiary"),
    ], stored, todayUTC());

    expect(restored?.phaseAnchors).toEqual({
      review: { anchorKey: "anchor:primary", anchorLabel: "Principale" },
      guided: { anchorKey: "anchor:secondary", anchorLabel: "Secondario" },
      solo: { anchorKey: "anchor:tertiary", anchorLabel: "Terziario" },
    });
    expect(restored?.supplementalAnchors.map((anchor) => anchor.anchorKey)).toEqual([
      "anchor:secondary",
      "anchor:tertiary",
    ]);
    expect(restored?.corpusFallback).toMatchObject({
      code: "secondary_anchor",
      primaryPositionsAvailable: 1,
    });
    expect(restored?.whyToday).toMatchObject({
      code: "recent_errors",
      observedWrongAttempts: 2,
      observedHintUses: 1,
    });
  });

  it("declares an equivalent-FEN restore as an in-session reuse", () => {
    setStorageUserScope("user-a");
    const fen = "8/8/8/8/8/8/4K3/7k w - - 0 1";
    const stored = startNewSession({
      drillIds: ["p2", "p3"],
      bivioIds: [],
      temaPositionId: "p1",
      warmupPositionId: "p2",
      drillPositionId: "p3",
      anchorKey: "anchor:primary",
      phaseAnchorKeys: {
        review: "anchor:primary",
        guided: "anchor:primary",
        solo: "anchor:primary",
      },
      phaseNovelty: { review: "fresh", guided: "fresh", solo: "fresh" },
    });
    const restored = restoreAdaptiveSelection([
      position("p1", "primary", fen),
      position("p2", "primary", fen.replace("0 1", "9 50")),
      position("p3", "primary"),
    ], stored, todayUTC());

    expect(restored?.distinctPositions).toBe(2);
    expect(restored?.reusedPosition).toBe(true);
    expect(restored?.phaseNovelty.guided).toBe("reused_in_session");
    expect(restored?.corpusFallback?.code).toBe("position_reuse");
  });

  it("does not reset an explicit session when aggregates refresh", () => {
    setStorageUserScope("user-a");
    const identity = {
      selectionSeed: "user-a:2026-07-12:choice:p1:route-a",
      temaPositionId: "p1",
      warmupPositionId: "p2",
      drillPositionId: "p3",
      anchorKey: "anchor:primary",
    };
    expect(decideSessionInitialization({
      initializedKey: null,
      currentSession: null,
      date: todayUTC(),
      identity,
      explicitStartRequested: true,
      allowRestore: false,
    })).toBe("start");

    const started = startNewSession({
      drillIds: ["p2", "p3"],
      bivioIds: [],
      ...identity,
    });
    const progressed = {
      ...started,
      step: "drill" as const,
      drills: [{
        drillId: "p2",
        verdict: "perfect" as const,
        cp_loss: 0,
        played_san: "e4",
        attempts: 1,
      }],
      points: 10,
    };

    // Simulates the 10 -> 100 aggregates update: the selection identity is
    // unchanged, but the effect is evaluated again.
    expect(decideSessionInitialization({
      initializedKey: sessionInitializationKey(identity),
      currentSession: progressed,
      date: todayUTC(),
      identity,
      explicitStartRequested: true,
      allowRestore: false,
    })).toBe("keep");
    // It is still safe after a real remount where the ref starts empty.
    expect(decideSessionInitialization({
      initializedKey: null,
      currentSession: progressed,
      date: todayUTC(),
      identity,
      explicitStartRequested: true,
      allowRestore: false,
    })).toBe("keep");
    expect(progressed.step).toBe("drill");
    expect(progressed.drills).toHaveLength(1);
  });

  it("gives each explicit navigation a new seed and permits that new choice", () => {
    const common = {
      userId: "user-a",
      date: todayUTC(),
      explicitStartRequested: true,
      focusKey: "p1",
    };
    const firstSeed = buildSessionSelectionSeed({ ...common, navigationKey: "route-a" });
    const secondSeed = buildSessionSelectionSeed({ ...common, navigationKey: "route-b" });
    expect(secondSeed).not.toBe(firstSeed);

    const current = startNewSession({
      drillIds: ["p2", "p3"],
      bivioIds: [],
      selectionSeed: firstSeed,
      temaPositionId: "p1",
      warmupPositionId: "p2",
      drillPositionId: "p3",
      anchorKey: "anchor:primary",
    });
    expect(decideSessionInitialization({
      initializedKey: null,
      currentSession: current,
      date: todayUTC(),
      identity: {
        selectionSeed: secondSeed,
        temaPositionId: "p1",
        warmupPositionId: "p2",
        drillPositionId: "p3",
        anchorKey: "anchor:primary",
      },
      explicitStartRequested: true,
      allowRestore: false,
    })).toBe("start");
  });

  it("blocks an automatic mismatched resume instead of mixing old results with new positions", () => {
    setStorageUserScope("user-a");
    const current = startNewSession({
      drillIds: ["p2", "p3"],
      bivioIds: [],
      selectionSeed: "user-a:today:daily",
      temaPositionId: "p1",
      warmupPositionId: "p2",
      drillPositionId: "p3",
      anchorKey: "anchor:primary",
    });
    expect(decideSessionInitialization({
      initializedKey: null,
      currentSession: current,
      date: todayUTC(),
      identity: {
        selectionSeed: "user-a:today:daily",
        temaPositionId: "new-1",
        warmupPositionId: "new-2",
        drillPositionId: "new-3",
        anchorKey: "anchor:other",
      },
      explicitStartRequested: false,
      allowRestore: true,
    })).toBe("block");
  });

  it("resumes from the frozen snapshot when refreshed corpus drops saved positions", () => {
    setStorageUserScope("user-a");
    const snapshots = {
      review: position("p1", "primary"),
      guided: position("p2", "primary"),
      solo: position("p3", "primary"),
    };
    const stored = startNewSession({
      drillIds: ["p2", "p3"],
      bivioIds: [],
      selectionSeed: "user-a:today:daily",
      temaPositionId: "p1",
      warmupPositionId: "p2",
      drillPositionId: "p3",
      anchorKey: "anchor:primary",
      anchorLabel: "Principale",
      phaseAnchorKeys: {
        review: "anchor:primary",
        guided: "anchor:primary",
        solo: "anchor:primary",
      },
      phaseAnchorLabels: {
        review: "Principale",
        guided: "Principale",
        solo: "Principale",
      },
      phaseNovelty: { review: "fresh", guided: "fresh", solo: "fresh" },
      positionSnapshots: snapshots,
    });
    const progressed = {
      ...stored,
      step: "drill" as const,
      drills: [{
        drillId: "p2",
        verdict: "ok" as const,
        cp_loss: 20,
        played_san: "e4",
        attempts: 2,
      }],
    };

    const restored = restoreAdaptiveSelection([
      position("new-1", "other"),
      position("new-2", "other"),
      position("new-3", "other"),
    ], progressed, todayUTC());

    expect([
      restored?.review.position_id,
      restored?.guided.position_id,
      restored?.solo.position_id,
    ]).toEqual(["p1", "p2", "p3"]);
    expect(progressed.step).toBe("drill");
    expect(progressed.drills).toHaveLength(1);
  });

  it("restores a completed schema-6 recap on a cold reload without aggregates", () => {
    setStorageUserScope("user-a");
    const snapshots = {
      review: position("p1", "primary"),
      guided: position("p2", "primary"),
      solo: position("p3", "primary"),
    };
    const completed = completeSession(startNewSession({
      drillIds: ["p2", "p3"],
      bivioIds: [],
      selectionSeed: "user-a:today:daily",
      temaPositionId: "p1",
      warmupPositionId: "p2",
      drillPositionId: "p3",
      anchorKey: "anchor:primary",
      phaseAnchorKeys: {
        review: "anchor:primary",
        guided: "anchor:primary",
        solo: "anchor:primary",
      },
      positionSnapshots: snapshots,
    })).session;

    expect(decideSessionEntry(completed, todayUTC(), false)).toBe("completed");
    const restored = restoreAdaptiveSelection([], completed, todayUTC());
    expect(restored).not.toBeNull();
    expect(restored?.review.position_id).toBe("p1");
    expect(completed.step).toBe("outro");
    expect(shouldBlockAggregateRefreshFailure(restored != null)).toBe(false);
  });

  it("treats aggregate download failure as blocking only without a frozen selection", () => {
    expect(shouldBlockAggregateRefreshFailure(true)).toBe(false);
    expect(shouldBlockAggregateRefreshFailure(false)).toBe(true);
  });

  it("keeps and upgrades an in-progress schema-5 session without losing results", () => {
    setStorageUserScope("user-a");
    const snapshots = {
      review: position("p1", "primary"),
      guided: position("p2", "primary"),
      solo: position("p3", "primary"),
    };
    const current = startNewSession({
      drillIds: ["p2", "p3"],
      bivioIds: [],
      selectionSeed: "user-a:today:daily",
      temaPositionId: "p1",
      warmupPositionId: "p2",
      drillPositionId: "p3",
      anchorKey: "anchor:primary",
      phaseAnchorKeys: {
        review: "anchor:primary",
        guided: "anchor:primary",
        solo: "anchor:primary",
      },
    });
    const schema5 = {
      ...current,
      schema: 5,
      step: "drill" as const,
      drills: [{
        drillId: "p2",
        verdict: "perfect" as const,
        cp_loss: 0,
        played_san: "e4",
        attempts: 1,
      }],
      positionSnapshots: undefined,
    };
    saveSession(schema5);

    const loaded = loadSession();
    expect(loaded?.schema).toBe(5);
    const restored = restoreAdaptiveSelection(Object.values(snapshots), loaded, todayUTC());
    expect(restored?.guided.position_id).toBe("p2");
    const upgraded = upgradeSessionWithPositionSnapshots(loaded!, snapshots);
    expect(upgraded.schema).toBe(SESSION_SCHEMA);
    expect(upgraded.step).toBe("drill");
    expect(upgraded.drills).toHaveLength(1);
    expect(upgraded.positionSnapshots?.solo.position_id).toBe("p3");
  });
});
