import { describe, expect, it } from "vitest";

import {
  advanceAnalysisProgress,
  analysisWorkItems,
  buildAnalysisCoverage,
  canPublishFirstReading,
  countNewGoalGames,
  isPersistedAnalysisSuccess,
  parsePartialAnalysis,
  requireAnalysisRows,
  requireExactCount,
  selectedGamesForDisplay,
  serializePartialAnalysis,
} from "../src/pipeline/analysisRunSemantics";
import { pipelineErrorMessage } from "../src/pipeline/pipelineErrors";
import { shouldBuildRestCorpus } from "../src/pipeline/config";

describe("two-stage analysis hardening", () => {
  it("separates processed attempts from successful persisted analyses", () => {
    const initial = { processed: 3, total: 10, succeeded: 2 };
    expect(advanceAnalysisProgress(initial, false)).toEqual({
      processed: 4,
      total: 10,
      succeeded: 2,
    });
    expect(advanceAnalysisProgress(initial, true)).toEqual({
      processed: 4,
      total: 10,
      succeeded: 3,
    });
  });

  it("retries errors and incomplete done rows, skipping only durable successes", () => {
    const rows = [
      { id: "success", analysis_status: "done", analysis_path: "analysis/success.json" },
      { id: "error", analysis_status: "error", analysis_path: null },
      { id: "partial", analysis_status: "done", analysis_path: null },
      { id: "pending", analysis_status: "pending", analysis_path: null },
    ];

    expect(isPersistedAnalysisSuccess(rows[0])).toBe(true);
    expect(analysisWorkItems(rows).map((row) => row.id)).toEqual([
      "error",
      "partial",
      "pending",
    ]);
  });

  it("never publishes an empty first reading", () => {
    expect(canPublishFirstReading(0)).toBe(false);
    expect(canPublishFirstReading(Number.NaN)).toBe(false);
    expect(canPublishFirstReading(1)).toBe(true);
  });

  it("builds the rest corpus for a saturated first pass or any retryable error", () => {
    expect(shouldBuildRestCorpus(10, 0)).toBe(true);
    expect(shouldBuildRestCorpus(4, 1)).toBe(true);
    expect(shouldBuildRestCorpus(4, 0)).toBe(false);
  });

  it("persists partial coverage as terminal truth without claiming full completion", () => {
    const partial = buildAnalysisCoverage(100, 97);
    expect(partial).toEqual({ selected: 100, succeeded: 97, failed: 3 });
    expect(serializePartialAnalysis(partial)).toBe(
      "background_analysis_partial:97/100",
    );
    expect(parsePartialAnalysis(serializePartialAnalysis(partial))).toEqual(partial);
    expect(serializePartialAnalysis(buildAnalysisCoverage(100, 100))).toBeNull();
  });

  it("recognizes legacy incomplete jobs without scheduling an automatic retry", () => {
    expect(parsePartialAnalysis("background_analysis_incomplete:8/10")).toEqual({
      selected: 10,
      succeeded: 8,
      failed: 2,
    });
  });

  it("does not present the scan cap as a finalized selected corpus", () => {
    expect(selectedGamesForDisplay({ gamesTotal: 100, corpusFinalized: false }, null))
      .toBeNull();
    expect(selectedGamesForDisplay({ gamesTotal: 23, corpusFinalized: true }, null))
      .toBe(23);
    expect(selectedGamesForDisplay(
      { gamesTotal: 100, corpusFinalized: false },
      { selected: 23, succeeded: 21, failed: 2 },
    )).toBe(23);
  });

  it("never turns a failed quota SELECT into a completed 0/0 corpus", () => {
    expect(() => requireAnalysisRows(null, { message: "network unavailable" }))
      .toThrow("analysis_games_select_failed:network unavailable");
    expect(requireAnalysisRows([], null)).toEqual([]);
  });

  it("fails closed when a recovery count is unavailable", () => {
    expect(() => requireExactCount(null, null, "recovery_count_failed"))
      .toThrow("recovery_count_failed:missing_count");
    expect(() => requireExactCount(null, { message: "offline" }, "recovery_count_failed"))
      .toThrow("recovery_count_failed:offline");
    expect(requireExactCount(0, null, "recovery_count_failed")).toBe(0);
  });

  it("treats a refresh with zero newer games as a verifiable no-op", () => {
    const games = [
      { end_time: 100, time_class: "rapid" },
      { end_time: 101, time_class: "blitz" },
    ];
    expect(countNewGoalGames(games, "rapid", 100, 100)).toBe(0);
    expect(countNewGoalGames([...games, { end_time: 102, time_class: "rapid" }], "rapid", 100, 100))
      .toBe(1);
  });

  it("maps corpus failures to actionable copy instead of raw codes", () => {
    expect(pipelineErrorMessage("no_games_found_for_goal_time_class", "it"))
      .toContain("Non ho trovato partite");
    expect(pipelineErrorMessage("no_analyzable_games", "en"))
      .toContain("could not complete a reliable first analysis");
  });
});
