import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setStorageUserScope } from "../src/auth/userStorage";
import {
  createPassiveReviewRecorder,
  loadPassiveReviewAttempts,
} from "../src/session/passiveReviewHistory";
import { getCard } from "../src/srs";

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>();
  get length() { return this.values.size; }
  clear() { this.values.clear(); }
  getItem(key: string) { return this.values.get(key) ?? null; }
  key(index: number) { return [...this.values.keys()][index] ?? null; }
  removeItem(key: string) { this.values.delete(key); }
  setItem(key: string, value: string) { this.values.set(key, value); }
}

const input = {
  sessionIdentity: "user-a:2026-07-12:daily",
  anchorKey: "anchor:hung_piece",
  primaryAnchorKey: "anchor:hung_piece",
  sourceGameId: "game-1",
  positionId: "p1",
  fenBefore: "8/8/8/8/8/8/4K3/7k w - - 0 1",
  reasonCode: "priority_pattern",
  corpusFallbackCode: null,
  phaseNovelty: "fresh",
};

async function flushPromises(): Promise<void> {
  // Yield one task so the complete recordCloud -> catch/finally chain settles.
  // Counting microtasks is brittle when the mocked promise is already rejected.
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
}

describe("passive review history", () => {
  const originalWindow = globalThis.window;

  beforeEach(() => {
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: { localStorage: new MemoryStorage() },
    });
    setStorageUserScope("user-a");
  });

  afterEach(() => {
    setStorageUserScope(null);
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: originalWindow,
    });
  });

  it("records one local watch and one cloud event without touching SRS", async () => {
    const recordCloud = vi.fn().mockResolvedValue({});
    const reportCloudError = vi.fn();
    const recorder = createPassiveReviewRecorder({
      recordCloud,
      reportCloudError,
      now: () => Date.parse("2026-07-12T10:00:00Z"),
    });

    expect(recorder(input)).toBe(true);
    expect(recorder(input)).toBe(false);
    await flushPromises();

    expect(loadPassiveReviewAttempts()).toEqual([expect.objectContaining({
      anchorKey: "anchor:hung_piece",
      positionId: "p1",
      mode: "watch",
      verdict: "skipped",
      correct: null,
      createdAt: "2026-07-12T10:00:00.000Z",
    })]);
    expect(recordCloud).toHaveBeenCalledTimes(1);
    expect(recordCloud).toHaveBeenCalledWith(expect.objectContaining({
      mode: "watch",
      verdict: "skipped",
      correct: null,
      context: expect.objectContaining({
        fen_before: input.fenBefore,
        passive_review: true,
        phase_novelty: "fresh",
      }),
    }));
    expect(reportCloudError).not.toHaveBeenCalled();
    expect(getCard("p1")).toBeNull();

    const remountCloud = vi.fn().mockResolvedValue({});
    const remountedRecorder = createPassiveReviewRecorder({
      recordCloud: remountCloud,
      reportCloudError,
      now: () => Date.parse("2026-07-12T10:01:00Z"),
    });
    expect(remountedRecorder(input)).toBe(false);
    await flushPromises();
    expect(remountCloud).not.toHaveBeenCalled();
  });

  it("keeps offline history locally and retries cloud sync on a later mount", async () => {
    const reportCloudError = vi.fn();
    const offlineRecorder = createPassiveReviewRecorder({
      recordCloud: vi.fn().mockRejectedValue(new Error("offline")),
      reportCloudError,
      now: () => Date.parse("2026-07-12T10:00:00Z"),
    });
    expect(offlineRecorder(input)).toBe(true);
    await flushPromises();
    expect(reportCloudError).toHaveBeenCalledTimes(1);
    expect(loadPassiveReviewAttempts()).toHaveLength(1);

    const retryCloud = vi.fn().mockResolvedValue({});
    const onlineRecorder = createPassiveReviewRecorder({
      recordCloud: retryCloud,
      reportCloudError,
      now: () => Date.parse("2026-07-12T10:05:00Z"),
    });
    expect(onlineRecorder(input)).toBe(false);
    await flushPromises();
    expect(retryCloud).toHaveBeenCalledTimes(1);
    expect(loadPassiveReviewAttempts()).toHaveLength(1);
  });
});
