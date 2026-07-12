import { describe, expect, it } from "vitest";

import {
  FREE_GAME_CAP,
  completedGameProgress,
  goalAnalysisScope,
  selectRecentGoalGames,
} from "../src/pipeline/config";
import { buildPlayerModelLite } from "../src/pipeline/playerModelLite";
import { classifyInsertOutcome } from "../src/pipeline/ingestSemantics";
import type { GameRow, ProfileRow } from "../src/auth/db.types";
import type { GameAnalysis } from "../src/pipeline/analyze";

describe("goal time-class analysis scope", () => {
  it("selects up to 100 recent games from the chosen cadence and excludes the other", () => {
    const mixed = Array.from({ length: 210 }, (_, index) => ({
      id: `game-${index}`,
      time_class: index % 2 === 0 ? "rapid" : "blitz",
      played_at: new Date(Date.UTC(2026, 0, 1 + index)).toISOString(),
    }));

    const selected = selectRecentGoalGames(mixed, goalAnalysisScope("rapid"));

    expect(selected).toHaveLength(FREE_GAME_CAP);
    expect(selected.every((game) => game.time_class === "rapid")).toBe(true);
    expect(selected[0].played_at >= selected[1].played_at).toBe(true);
    expect(selected.some((game) => game.time_class === "blitz")).toBe(false);
  });

  it("fails closed instead of silently mixing an unsupported goal cadence", () => {
    expect(() => goalAnalysisScope("classical")).toThrow(
      "unsupported_goal_time_class:classical",
    );
  });

  it("reports the effective final corpus instead of a fake 100-game total", () => {
    expect(completedGameProgress(37)).toEqual({ gamesTotal: 37, gamesDone: 37 });
    expect(completedGameProgress(10, 10)).toEqual({ gamesTotal: 10, gamesDone: 10 });
    expect(completedGameProgress(140)).toEqual({
      gamesTotal: FREE_GAME_CAP,
      gamesDone: FREE_GAME_CAP,
    });
  });

  it("keeps rating curves separated but builds coaching metrics only from goal_time_class", () => {
    const rapidGame = game("rapid-1", "rapid", 1200, "2026-07-10T10:00:00.000Z");
    const blitzGame = game("blitz-1", "blitz", 1500, "2026-07-11T10:00:00.000Z");
    const profile: ProfileRow = {
      user_id: "user-1",
      chess_com_username: "redacted-for-test",
      goal_rating: 1400,
      goal_horizon_weeks: 12,
      goal_time_class: "rapid",
      weekly_minutes: 60,
      onboarding_state: "ready",
      goal_deadline: null,
      created_at: "2026-07-01T00:00:00.000Z",
      updated_at: "2026-07-01T00:00:00.000Z",
    };

    const model = buildPlayerModelLite(
      [rapidGame, blitzGame],
      [analysis("rapid-1", "rapid", 12), analysis("blitz-1", "blitz", 480)],
      profile,
      1180,
    );

    expect(model.rating_curve.rapid).toHaveLength(1);
    expect(model.rating_curve.blitz).toHaveLength(1);
    expect(model.identity.rating_by_time_class).toMatchObject({ rapid: 1200, blitz: 1500 });
    expect(model.current_rating).toBe(1200);
    const opening = model.by_phase.find((phase) => phase.phase === "opening");
    expect(opening?.positions).toBe(1);
    expect(opening?.avg_cp_loss).toBe(12);
    expect(model.identity.goal.points_gained_since_start).toBe(20);
  });

  it("keeps a legacy analysis without time_class when it joins a goal-cadence game", () => {
    const rapidGame = game("rapid-legacy", "rapid", 1200, "2026-07-10T10:00:00.000Z");
    const legacyAnalysis = analysis("rapid-legacy", "rapid", 42);
    delete (legacyAnalysis as Partial<GameAnalysis>).time_class;
    const profile: ProfileRow = {
      user_id: "user-1",
      chess_com_username: "redacted-for-test",
      goal_rating: 1400,
      goal_horizon_weeks: 12,
      goal_time_class: "rapid",
      weekly_minutes: 60,
      onboarding_state: "ready",
      goal_deadline: null,
      created_at: "2026-07-01T00:00:00.000Z",
      updated_at: "2026-07-01T00:00:00.000Z",
    };

    const model = buildPlayerModelLite([rapidGame], [legacyAnalysis], profile, 1200);
    const opening = model.by_phase.find((phase) => phase.phase === "opening");

    expect(opening?.positions).toBe(1);
    expect(opening?.avg_cp_loss).toBe(42);
  });

  it("keeps rating progress signed instead of hiding a decline", () => {
    const rapidGame = game("rapid-1", "rapid", 1200, "2026-07-10T10:00:00.000Z");
    const profile: ProfileRow = {
      user_id: "user-1",
      chess_com_username: "redacted-for-test",
      goal_rating: 1400,
      goal_horizon_weeks: 12,
      goal_time_class: "rapid",
      weekly_minutes: 60,
      onboarding_state: "ready",
      goal_deadline: null,
      created_at: "2026-07-01T00:00:00.000Z",
      updated_at: "2026-07-01T00:00:00.000Z",
    };

    const model = buildPlayerModelLite(
      [rapidGame],
      [analysis("rapid-1", "rapid", 12)],
      profile,
      1300,
    );

    expect(model.identity.goal.points_gained_since_start).toBe(-100);
  });

  it("honors explicit critical=false while deriving the legacy fallback", () => {
    const rapidGame = game("rapid-critical", "rapid", 1200, "2026-07-10T10:00:00.000Z");
    const rapidAnalysis = analysis("rapid-critical", "rapid", 100);
    rapidAnalysis.total_player_moves = 3;
    rapidAnalysis.moves = [
      { ply: 20, scoreBeforeCp: 0, isCritical: false, cpLoss: 300, category: "blunder" },
      { ply: 20, scoreBeforeCp: 0, cpLoss: 40, category: "ok" },
      { ply: 20, scoreBeforeCp: 500, cpLoss: 80, category: "mistake" },
    ] as unknown as GameAnalysis["moves"];
    const profile: ProfileRow = {
      user_id: "user-1",
      chess_com_username: "redacted-for-test",
      goal_rating: 1400,
      goal_horizon_weeks: 12,
      goal_time_class: "rapid",
      weekly_minutes: 60,
      onboarding_state: "ready",
      goal_deadline: null,
      created_at: "2026-07-01T00:00:00.000Z",
      updated_at: "2026-07-01T00:00:00.000Z",
    };

    const model = buildPlayerModelLite([rapidGame], [rapidAnalysis], profile, 1200);

    expect(model.kpi.critical_positions).toBe(1);
    expect(model.kpi.blunders_critical).toBe(0);
    expect(model.kpi.avg_cp_loss_on_critical).toBe(40);
  });

  it("caps behavioral slices at the 100 newest goal-cadence games", () => {
    const rapidGames = Array.from({ length: 101 }, (_, index) =>
      game(
        `rapid-${index}`,
        "rapid",
        1200 + index,
        new Date(Date.UTC(2026, 0, 1 + index)).toISOString(),
      ),
    );
    const rapidAnalyses = rapidGames.map((row, index) =>
      analysis(row.chess_com_uuid, "rapid", index === 0 ? 999 : 10),
    );
    const profile: ProfileRow = {
      user_id: "user-1",
      chess_com_username: "redacted-for-test",
      goal_rating: 1400,
      goal_horizon_weeks: 12,
      goal_time_class: "rapid",
      weekly_minutes: 60,
      onboarding_state: "ready",
      goal_deadline: null,
      created_at: "2026-07-01T00:00:00.000Z",
      updated_at: "2026-07-01T00:00:00.000Z",
    };

    const model = buildPlayerModelLite(rapidGames, rapidAnalyses, profile, 1200);
    const opening = model.by_phase.find((phase) => phase.phase === "opening");

    // Le curve conservano la serie separata completa; il coaching usa la quota.
    expect(model.rating_curve.rapid).toHaveLength(101);
    expect(opening?.positions).toBe(FREE_GAME_CAP);
    expect(opening?.avg_cp_loss).toBe(10);
  });

  it("advances ingest only for a successful insert or a confirmed duplicate", () => {
    expect(classifyInsertOutcome(null)).toBe("inserted");
    expect(classifyInsertOutcome({ code: "23505", message: "conflict" })).toBe(
      "duplicate",
    );
    expect(
      classifyInsertOutcome({
        message: "duplicate key value violates unique constraint games_uuid_key",
      }),
    ).toBe("duplicate");
    expect(classifyInsertOutcome({ code: "42501", message: "unique policy denied" })).toBe(
      "failed",
    );
  });
});

function game(
  chessComUuid: string,
  timeClass: "rapid" | "blitz",
  rating: number,
  playedAt: string,
): GameRow {
  return {
    id: chessComUuid,
    user_id: "user-1",
    chess_com_uuid: chessComUuid,
    played_at: playedAt,
    time_class: timeClass,
    time_control: timeClass === "rapid" ? "600" : "300",
    color: "white",
    result: "loss",
    player_rating: rating,
    opponent_rating: rating,
    pgn_path: `pgn/${chessComUuid}.pgn`,
    analysis_path: `analysis/${chessComUuid}.json`,
    analysis_status: "done",
    error: null,
    created_at: playedAt,
  };
}

function analysis(
  chessComUuid: string,
  timeClass: "rapid" | "blitz",
  avgCpLoss: number,
): GameAnalysis {
  const emptyPhase = {
    moves: 0,
    blunders: 0,
    mistakes: 0,
    inaccuracies: 0,
    avg_cp_loss: 0,
  };
  return {
    game_id: chessComUuid,
    chess_com_uuid: chessComUuid,
    played_at: "2026-07-10T10:00:00.000Z",
    color: "white",
    result: "loss",
    time_class: timeClass,
    total_player_moves: 1,
    blunders: 0,
    mistakes: 0,
    inaccuracies: 0,
    avg_cp_loss: avgCpLoss,
    by_phase: {
      opening: { ...emptyPhase, moves: 1, avg_cp_loss: avgCpLoss },
      middlegame: { ...emptyPhase },
      endgame: { ...emptyPhase },
    },
    moves: [],
    eco: null,
    opening: null,
    game_url: null,
    time_control_base_seconds: timeClass === "rapid" ? 600 : 300,
    motif_occurrences: [],
  };
}
