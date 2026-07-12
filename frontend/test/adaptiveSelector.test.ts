import { describe, expect, it } from "vitest";
import {
  anchorKeyForPosition,
  mergeRecentSessionAttempts,
  selectAdaptiveSession,
  type SelectableSessionPosition,
} from "../src/session/adaptiveSelector";

function position(
  id: string,
  errorType: string,
  game = `game-${id}`,
  overrides: Partial<SelectableSessionPosition> = {},
): SelectableSessionPosition {
  return {
    position_id: id,
    source_game_id: game,
    fen_before: `fen-${id}`,
    ply: Number(id.replace(/\D/g, "")) || 1,
    error_type: errorType,
    cp_loss: 150,
    training_priority_weight: 0.5,
    ...overrides,
  };
}

const base = { seed: "user:2026-07-11", nowMs: Date.parse("2026-07-11T12:00:00Z") };

describe("selectAdaptiveSession", () => {
  it("keeps review, guided and solo on one anchor and distinct when available", () => {
    const positions = [position("p1", "hung_piece"), position("p2", "hung_piece"), position("p3", "hung_piece")];
    const result = selectAdaptiveSession({ positions, ...base });

    expect(result?.anchorKey).toBe("anchor:hung_piece");
    expect([result?.review, result?.guided, result?.solo].map((p) => p && anchorKeyForPosition(p)))
      .toEqual(["anchor:hung_piece", "anchor:hung_piece", "anchor:hung_piece"]);
    expect(new Set([result?.review.position_id, result?.guided.position_id, result?.solo.position_id]).size).toBe(3);
  });

  it("reuses honestly with two positions and with one position", () => {
    const two = selectAdaptiveSession({ positions: [position("p1", "clock_pressure"), position("p2", "clock_pressure")], ...base });
    expect(two?.distinctPositions).toBe(2);
    expect(two?.reusedPosition).toBe(true);
    expect(two?.guided.position_id).toBe(two?.solo.position_id);

    const one = selectAdaptiveSession({ positions: [position("p1", "clock_pressure")], ...base });
    expect(one?.distinctPositions).toBe(1);
    expect(one?.review.position_id).toBe(one?.guided.position_id);
    expect(one?.guided.position_id).toBe(one?.solo.position_id);
  });

  it("puts an overdue review ahead of the raw top anchor", () => {
    const result = selectAdaptiveSession({
      positions: [position("p1", "hung_piece"), position("p2", "fast_decision")],
      priorities: [
        { anchorKey: "anchor:hung_piece", weightedScore: 100, relativePriority: 0.8 },
        { anchorKey: "anchor:fast_decision", weightedScore: 5, relativePriority: 0.05 },
      ],
      mastery: [{
        anchorKey: "anchor:fast_decision",
        status: "review",
        masteryScore: 0.8,
        nextReviewAt: "2026-07-10T00:00:00Z",
      }],
      recentAttempts: [{
        anchorKey: "anchor:fast_decision",
        positionId: "p2",
        sourceGameId: "game-p2",
        createdAt: "2026-07-11T08:00:00Z",
      }],
      ...base,
    });
    expect(result?.anchorKey).toBe("anchor:fast_decision");
    expect(result?.whyToday.code).toBe("review_due");
  });

  it("puts the exact due position in review, then fills with fresh positions", () => {
    const result = selectAdaptiveSession({
      positions: [
        position("due", "hung_piece", "game-due"),
        position("fresh-1", "hung_piece", "game-fresh-1"),
        position("fresh-2", "hung_piece", "game-fresh-2"),
        position("fresh-3", "hung_piece", "game-fresh-3"),
      ],
      recentAttempts: [{
        anchorKey: "anchor:hung_piece",
        positionId: "due",
        sourceGameId: "game-due",
        nextDueAt: "2026-07-10T12:00:00Z",
        createdAt: "2026-07-10T12:00:00Z",
      }],
      ...base,
    });

    expect(result?.whyToday.code).toBe("review_due");
    expect(result?.review.position_id).toBe("due");
    expect(result?.phaseNovelty.review).toBe("due");
    expect([result?.guided.position_id, result?.solo.position_id]).not.toContain("due");
    expect(result?.difficultyProgression).toBe("evidence_first");
  });

  it("excludes a mastered anchor when a non-mastered alternative exists", () => {
    const result = selectAdaptiveSession({
      positions: [position("p1", "hung_piece"), position("p2", "clock_pressure")],
      priorities: [
        { anchorKey: "anchor:hung_piece", weightedScore: 100 },
        { anchorKey: "anchor:clock_pressure", weightedScore: 1 },
      ],
      mastery: [{ anchorKey: "anchor:hung_piece", status: "mastered", masteryScore: 1 }],
      ...base,
    });
    expect(result?.anchorKey).toBe("anchor:clock_pressure");
  });

  it("honors focus override and starts from the focused position", () => {
    const focused = position("p3", "fast_decision");
    const result = selectAdaptiveSession({
      positions: [position("p1", "hung_piece"), position("p2", "fast_decision"), focused],
      priorities: [{ anchorKey: "anchor:hung_piece", weightedScore: 999 }],
      focusKey: focused.position_id,
      ...base,
    });
    expect(result?.anchorKey).toBe("anchor:fast_decision");
    expect(result?.review.position_id).toBe("p3");
    expect(result?.whyToday.code).toBe("focus_override");
  });

  it("keeps an explicitly focused position when a higher-quality FEN duplicate exists", () => {
    const duplicateFen = "8/8/8/8/8/8/4K3/7k w - - 0 1";
    const focused = position("focus", "hung_piece", "g-focus", {
      fen_before: duplicateFen,
      training_priority_weight: 0.1,
    });
    const result = selectAdaptiveSession({
      positions: [
        focused,
        position("copy", "hung_piece", "g-copy", {
          fen_before: duplicateFen.replace("0 1", "8 42"),
          training_priority_weight: 99,
        }),
        position("p2", "hung_piece"),
        position("p3", "hung_piece"),
      ],
      focusKey: "focus",
      ...base,
    });

    expect(result?.review.position_id).toBe("focus");
    expect([
      result?.review.position_id,
      result?.guided.position_id,
      result?.solo.position_id,
    ]).not.toContain("copy");
  });

  it("is deterministic for the same data and seed", () => {
    const positions = [
      position("p1", "hung_piece"), position("p2", "hung_piece"),
      position("p3", "hung_piece"), position("p4", "hung_piece"),
    ];
    const first = selectAdaptiveSession({ positions, ...base });
    const second = selectAdaptiveSession({ positions: [...positions].reverse(), ...base });
    expect([
      first?.review.position_id, first?.guided.position_id, first?.solo.position_id,
    ]).toEqual([
      second?.review.position_id, second?.guided.position_id, second?.solo.position_id,
    ]);
  });

  it("rotates on the next UTC day while remaining stable within the same day", () => {
    const positions = [
      position("p1", "hung_piece"), position("p2", "hung_piece"),
      position("p3", "hung_piece"), position("p4", "hung_piece"),
    ];
    const today = selectAdaptiveSession({ positions, ...base });
    const todayAgain = selectAdaptiveSession({ positions: [...positions].reverse(), ...base });
    const tomorrow = selectAdaptiveSession({
      positions,
      seed: "user:2026-07-12",
      nowMs: Date.parse("2026-07-12T12:00:00Z"),
    });
    const ids = (value: typeof today) => [
      value?.review.position_id,
      value?.guided.position_id,
      value?.solo.position_id,
    ];

    expect(ids(todayAgain)).toEqual(ids(today));
    expect(ids(tomorrow)).not.toEqual(ids(today));
  });

  it("excludes recently seen positions and games when three fresh alternatives exist", () => {
    const positions = [
      position("p1", "hung_piece", "recent-game-1"),
      position("p2", "hung_piece", "recent-game-2"),
      position("p3", "hung_piece", "recent-game-3"),
      position("p4", "hung_piece", "fresh-game-4"),
      position("p5", "hung_piece", "fresh-game-5"),
      position("p6", "hung_piece", "fresh-game-6"),
    ];
    const result = selectAdaptiveSession({
      positions,
      recentAttempts: [1, 2, 3].map((index) => ({
        anchorKey: "anchor:hung_piece",
        positionId: `p${index}`,
        sourceGameId: `recent-game-${index}`,
        createdAt: "2026-07-05T12:00:00Z",
      })),
      ...base,
    });
    const selectedIds = [
      result?.review.position_id,
      result?.guided.position_id,
      result?.solo.position_id,
    ];

    expect(new Set(selectedIds)).toEqual(new Set(["p4", "p5", "p6"]));
    expect(Object.values(result?.phaseNovelty ?? {})).toEqual([
      "fresh", "fresh", "fresh",
    ]);
  });

  it("treats a source game seen under another anchor as recent", () => {
    const result = selectAdaptiveSession({
      positions: [
        position("p1", "hung_piece", "shared-game"),
        position("p2", "hung_piece", "fresh-game-2"),
        position("p3", "hung_piece", "fresh-game-3"),
        position("p4", "hung_piece", "fresh-game-4"),
      ],
      recentAttempts: [{
        anchorKey: "anchor:another_theme",
        sourceGameId: "shared-game",
        createdAt: "2026-07-10T12:00:00Z",
      }],
      ...base,
    });

    expect(new Set([
      result?.review.position_id,
      result?.guided.position_id,
      result?.solo.position_id,
    ])).toEqual(new Set(["p2", "p3", "p4"]));
  });

  it("deduplicates equivalent FENs even when their position ids differ", () => {
    const duplicateFen = "8/8/8/8/8/8/4K3/7k w - - 0 1";
    const result = selectAdaptiveSession({
      positions: [
        position("p1", "hung_piece", "g1", { fen_before: duplicateFen }),
        position("p1-copy", "hung_piece", "g2", {
          fen_before: duplicateFen.replace("0 1", "7 23"),
        }),
        position("p2", "hung_piece", "g3"),
        position("p3", "hung_piece", "g4"),
        position("p4", "hung_piece", "g5"),
      ],
      ...base,
    });

    const selected = [result!.review, result!.guided, result!.solo];
    expect(new Set(selected.map((item) => item.position_id)).size).toBe(3);
    expect(new Set(selected.map((item) => item.fen_before.split(" ").slice(0, 4).join(" "))).size)
      .toBe(3);
  });

  it("uses a declared secondary anchor before repeating a poor primary corpus", () => {
    const positions = [
      position("p1", "hung_piece"),
      position("p2", "clock_pressure"),
      position("p3", "clock_pressure"),
    ];
    const input = {
      positions,
      priorities: [
        { anchorKey: "anchor:hung_piece", weightedScore: 100, label: "Pezzo in presa" },
        { anchorKey: "anchor:clock_pressure", weightedScore: 1, label: "Gestione tempo" },
      ],
      ...base,
    };
    const first = selectAdaptiveSession(input);
    const second = selectAdaptiveSession({ ...input, positions: [...positions].reverse() });

    expect(first?.corpusFallback).toMatchObject({
      code: "secondary_anchor",
      primaryPositionsAvailable: 1,
      secondaryAnchorKey: "anchor:clock_pressure",
    });
    expect(first?.supplementalAnchors).toEqual([
      { anchorKey: "anchor:clock_pressure", anchorLabel: "Gestione tempo" },
    ]);
    expect(new Set([
      first?.review.position_id,
      first?.guided.position_id,
      first?.solo.position_id,
    ]).size).toBe(3);
    expect(first?.phaseAnchors.review.anchorKey).toBe("anchor:hung_piece");
    expect(first?.phaseAnchors.guided.anchorKey).toBe("anchor:clock_pressure");
    expect(first?.phaseAnchors.solo.anchorKey).toBe("anchor:clock_pressure");
    expect(second).toEqual(first);
  });

  it("declares deterministic position reuse when the whole corpus is exhausted", () => {
    const input = { positions: [position("p1", "clock_pressure")], ...base };
    const first = selectAdaptiveSession(input);
    const second = selectAdaptiveSession(input);

    expect(first?.corpusFallback).toMatchObject({
      code: "position_reuse",
      primaryPositionsAvailable: 1,
    });
    expect(first?.phaseNovelty).toEqual({
      review: "fresh",
      guided: "reused_in_session",
      solo: "reused_in_session",
    });
    expect(second).toEqual(first);
  });

  it("uses additional declared anchors before duplicating when alternatives exist", () => {
    const result = selectAdaptiveSession({
      positions: [
        position("p1", "primary"),
        position("p2", "secondary"),
        position("p3", "tertiary"),
      ],
      priorities: [
        { anchorKey: "anchor:primary", weightedScore: 100 },
        { anchorKey: "anchor:secondary", weightedScore: 10 },
        { anchorKey: "anchor:tertiary", weightedScore: 1 },
      ],
      ...base,
    });

    expect(new Set([
      result?.review.position_id,
      result?.guided.position_id,
      result?.solo.position_id,
    ]).size).toBe(3);
    expect(result?.reusedPosition).toBe(false);
    expect(result?.supplementalAnchors.map((anchor) => anchor.anchorKey)).toEqual([
      "anchor:secondary",
      "anchor:tertiary",
    ]);
    expect(result?.phaseAnchors).toEqual({
      review: expect.objectContaining({ anchorKey: "anchor:primary" }),
      guided: expect.objectContaining({ anchorKey: "anchor:secondary" }),
      solo: expect.objectContaining({ anchorKey: "anchor:tertiary" }),
    });
  });

  it("orders three same-anchor positions from lower to higher observed difficulty", () => {
    const result = selectAdaptiveSession({
      positions: [
        position("hard", "hung_piece", "g-hard", {
          maia_target_acceptable_observed_difficulty: 0.9,
        }),
        position("easy", "hung_piece", "g-easy", {
          maia_target_acceptable_observed_difficulty: 0.1,
        }),
        position("medium", "hung_piece", "g-medium", {
          maia_target_acceptable_observed_difficulty: 0.5,
        }),
      ],
      ...base,
    });

    expect([
      result?.review.position_id,
      result?.guided.position_id,
      result?.solo.position_id,
    ]).toEqual(["easy", "medium", "hard"]);
    expect(result?.difficultyProgression).toBe("ascending");
  });

  it("reacts to recorded wrong attempts and hints after due/mastery gates", () => {
    const result = selectAdaptiveSession({
      positions: [position("p1", "hung_piece"), position("p2", "clock_pressure")],
      priorities: [
        { anchorKey: "anchor:hung_piece", weightedScore: 10 },
        { anchorKey: "anchor:clock_pressure", weightedScore: 10 },
      ],
      recentAttempts: [{
        anchorKey: "anchor:clock_pressure",
        positionId: "p2",
        sourceGameId: "game-p2",
        verdict: "wrong",
        correct: false,
        usedHint: true,
        attempts: 3,
        createdAt: "2026-07-10T12:00:00Z",
      }],
      ...base,
    });

    expect(result?.anchorKey).toBe("anchor:clock_pressure");
    expect(result?.whyToday.code).toBe("recent_errors");
    expect(result?.whyToday.observedWrongAttempts).toBe(1);
    expect(result?.whyToday.observedHintUses).toBe(1);
  });

  it("reviews the exact recent-error position before fresh positions", () => {
    const result = selectAdaptiveSession({
      positions: [
        position("wrong", "hung_piece", "game-wrong"),
        position("fresh-1", "hung_piece", "game-fresh-1"),
        position("fresh-2", "hung_piece", "game-fresh-2"),
        position("fresh-3", "hung_piece", "game-fresh-3"),
      ],
      recentAttempts: [{
        anchorKey: "anchor:hung_piece",
        positionId: "wrong",
        sourceGameId: "game-wrong",
        verdict: "wrong",
        correct: false,
        createdAt: "2026-07-10T12:00:00Z",
      }],
      ...base,
    });

    expect(result?.whyToday.code).toBe("recent_errors");
    expect(result?.review.position_id).toBe("wrong");
    expect([result?.guided.position_id, result?.solo.position_id]).not.toContain("wrong");
  });

  it("does not present old struggle evidence as a recent error", () => {
    const result = selectAdaptiveSession({
      positions: [position("p1", "hung_piece")],
      recentAttempts: [{
        anchorKey: "anchor:hung_piece",
        positionId: "p1",
        verdict: "wrong",
        correct: false,
        createdAt: "2026-05-01T12:00:00Z",
      }],
      ...base,
    });

    expect(result?.whyToday.code).toBe("fallback");
    expect(result?.whyToday.observedWrongAttempts).toBe(0);
  });

  it("rotates away from a recently practised anchor when neither anchor is due", () => {
    const result = selectAdaptiveSession({
      positions: [position("p1", "hung_piece"), position("p2", "clock_pressure")],
      priorities: [
        { anchorKey: "anchor:hung_piece", weightedScore: 100 },
        { anchorKey: "anchor:clock_pressure", weightedScore: 10 },
      ],
      recentAttempts: [{
        anchorKey: "anchor:hung_piece",
        positionId: "p1",
        sourceGameId: "game-p1",
        createdAt: "2026-07-11T08:00:00Z",
      }],
      ...base,
    });
    expect(result?.anchorKey).toBe("anchor:clock_pressure");
  });

  it("does not bring back a one-position primary anchor the day after passive review", () => {
    const result = selectAdaptiveSession({
      positions: [
        position("only-primary", "primary", "game-primary"),
        position("alternative", "alternative", "game-alternative"),
      ],
      priorities: [
        { anchorKey: "anchor:primary", weightedScore: 100 },
        { anchorKey: "anchor:alternative", weightedScore: 1 },
      ],
      recentAttempts: [{
        anchorKey: "anchor:primary",
        positionId: "only-primary",
        sourceGameId: "game-primary",
        mode: "watch",
        verdict: "skipped",
        correct: null,
        createdAt: "2026-07-10T12:00:00Z",
      }],
      ...base,
    });

    expect(result?.anchorKey).toBe("anchor:alternative");
    expect(result?.whyToday.observedWrongAttempts).toBe(0);
  });
});

describe("mergeRecentSessionAttempts", () => {
  const local = {
    anchorKey: "anchor:hung_piece",
    positionId: "p1",
    fenBefore: "8/8/8/8/8/8/4K3/7k w - - 0 1",
    verdict: "wrong" as const,
    correct: false,
    createdAt: "2026-07-11T12:00:00Z",
  };

  it("does not double count the local snapshot represented by a cloud event", () => {
    const cloud = {
      ...local,
      createdAt: "2026-07-11T12:00:02Z",
      usedHint: true,
    };

    expect(mergeRecentSessionAttempts([local], [cloud])).toEqual([cloud]);
  });

  it("retains a meaningfully newer local snapshot after an offline attempt", () => {
    const cloud = {
      ...local,
      createdAt: "2026-07-11T11:00:00Z",
    };

    expect(mergeRecentSessionAttempts([local], [cloud])).toEqual([cloud, local]);
  });
});
