import { beforeEach, describe, expect, it, vi } from "vitest";

const mock = vi.hoisted(() => ({ getSession: vi.fn(), from: vi.fn(), single: vi.fn(), insert: vi.fn(), select: vi.fn(), eq: vi.fn() }));
vi.mock("../src/auth/supabaseClient", () => ({ supabase: { auth: { getSession: mock.getSession }, from: mock.from } }));
import { recordTrainingAttempt } from "../src/trainingProgress";

beforeEach(() => {
  vi.resetAllMocks();
  const chain = { insert: mock.insert, select: mock.select, eq: mock.eq, single: mock.single };
  mock.from.mockReturnValue(chain); mock.insert.mockReturnValue(chain); mock.select.mockReturnValue(chain); mock.eq.mockReturnValue(chain);
  mock.getSession.mockResolvedValue({ data: { session: { user: { id: "owner" } } } });
});

describe("retryable evaluated practice saves", () => {
  it("recovers an already accepted UUID after the client lost the first response", async () => {
    const original = { id: "attempt", anchor_key: "pattern", position_id: "game:21", move_uci: "e2e4", created_at: "2026-09-05T12:00:00Z" };
    mock.single.mockResolvedValueOnce({ data: null, error: { code: "23505" } }).mockResolvedValueOnce({ data: original, error: null });
    const result = await recordTrainingAttempt({ clientAttemptId: "attempt", expectedUserId: "owner", anchorKey: "pattern", positionId: "game:21", playedUci: "e2e4", mode: "drill" });
    expect(result).toBe(original);
    expect(mock.insert).toHaveBeenCalledTimes(1);
    expect(mock.eq).toHaveBeenCalledWith("user_id", "owner");
  });
  it("does not save an old session into a newly signed-in account", async () => {
    await expect(recordTrainingAttempt({ expectedUserId: "previous-owner", anchorKey: "pattern", mode: "drill" })).rejects.toThrow("account changed");
    expect(mock.from).not.toHaveBeenCalled();
  });
  it("does not acknowledge an unrelated collision or hide a real server failure", async () => {
    mock.single.mockResolvedValueOnce({ data: null, error: { code: "23505" } }).mockResolvedValueOnce({ data: { anchor_key: "other" }, error: null });
    await expect(recordTrainingAttempt({ clientAttemptId: "attempt", anchorKey: "pattern", mode: "drill" })).rejects.toThrow("identity mismatch");
    mock.single.mockResolvedValueOnce({ data: null, error: new Error("offline") });
    await expect(recordTrainingAttempt({ anchorKey: "pattern", mode: "drill" })).rejects.toThrow("offline");
  });
});
