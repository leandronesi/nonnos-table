import { describe, expect, it, vi } from "vitest";
import { createEvaluatedAttemptRecorder } from "../src/session/attemptRecorder";

describe("createEvaluatedAttemptRecorder", () => {
  it("records one evaluated attempt and deduplicates repeated callbacks", async () => {
    const recordLocal = vi.fn();
    const recordCloud = vi.fn().mockResolvedValue({});
    const reportCloudError = vi.fn();
    const record = createEvaluatedAttemptRecorder({ recordLocal, recordCloud, reportCloudError });
    const attempt = {
      anchorKey: "anchor:hung_piece",
      sourceGameId: "game-1",
      positionId: "game-1:12",
      fenBefore: "8/8/8/8/8/8/4K3/7k w - - 0 1",
      mode: "guided" as const,
      verdict: "perfect" as const,
      attempts: 1,
      playedUci: "e2e4",
      usedHint: true,
      responseMs: 1200,
      reasonCode: "review_due",
      primaryAnchorKey: "anchor:hung_piece",
      corpusFallbackCode: "secondary_anchor",
      phaseNovelty: "fresh",
    };

    expect(record(attempt)).toBe(true);
    expect(record(attempt)).toBe(false);
    await Promise.resolve();

    expect(recordLocal).toHaveBeenCalledTimes(1);
    expect(recordCloud).toHaveBeenCalledTimes(1);
    expect(recordCloud).toHaveBeenCalledWith(expect.objectContaining({
      mode: "guided",
      verdict: "perfect",
      correct: true,
      usedHint: true,
      context: expect.objectContaining({
        selection_reason: "review_due",
        fen_before: "8/8/8/8/8/8/4K3/7k w - - 0 1",
        primary_anchor_key: "anchor:hung_piece",
        corpus_fallback: "secondary_anchor",
        phase_novelty: "fresh",
      }),
    }));
  });

  it("never treats watch or skipped as an evaluated failure", () => {
    const recordLocal = vi.fn();
    const recordCloud = vi.fn().mockResolvedValue({});
    const record = createEvaluatedAttemptRecorder({
      recordLocal,
      recordCloud,
      reportCloudError: vi.fn(),
    });

    expect(record({
      anchorKey: "anchor:hung_piece",
      positionId: "p1",
      mode: "watch",
      verdict: "wrong",
      attempts: 1,
      usedHint: false,
      reasonCode: "fallback",
    })).toBe(false);
    expect(record({
      anchorKey: "anchor:hung_piece",
      positionId: "p1",
      mode: "review",
      verdict: "skipped",
      attempts: 1,
      usedHint: false,
      reasonCode: "fallback",
    })).toBe(false);

    expect(recordLocal).not.toHaveBeenCalled();
    expect(recordCloud).not.toHaveBeenCalled();
  });
});
