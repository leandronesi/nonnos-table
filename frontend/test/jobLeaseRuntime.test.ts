import { afterEach, describe, expect, it, vi } from "vitest";

const { rpcMock, fromMock } = vi.hoisted(() => ({ rpcMock: vi.fn(), fromMock: vi.fn() }));

vi.mock("../src/auth/supabaseClient", () => ({
  supabase: { rpc: rpcMock, from: fromMock },
}));

import { acquireOrObserveIngestJob } from "../src/pipeline/jobLease";

describe("ingest job lease runtime", () => {
  afterEach(() => {
    rpcMock.mockReset();
    fromMock.mockReset();
    vi.useRealTimers();
  });

  it("observes only the current 100 games and excludes unfinished or missing analyses", async () => {
    const controller = new AbortController();
    const job = { id: "job-1", kind: "main", status: "coaching_first", lease_token: "other-tab", lease_expires_at: new Date(Date.now() + 90_000).toISOString() };
    rpcMock.mockResolvedValue({ data: [{ job_id: "job-1", claimed: false, job_kind: "main", job_status: "coaching_first" }], error: null });
    const rows = Array.from({ length: 297 }, (_, i) => ({ analysis_status: i < 5 ? "pending" : "done", analysis_path: i < 10 ? null : "saved.json" }));
    const order = vi.fn();
    const limit = vi.fn();
    fromMock.mockImplementation((table: string) => {
      const query: any = {
        select: () => query, eq: () => query,
        maybeSingle: async () => ({ data: table === "profiles" ? { onboarding_state: "coaching" } : job, error: null }),
        order: (...args: unknown[]) => { order(...args); return query; },
        limit: async (n: number) => { limit(n); return { data: rows.slice(0, n), error: null }; },
      };
      return query;
    });
    const observed = vi.fn(() => controller.abort());
    await expect(acquireOrObserveIngestJob({ jobId: "job-1", userId: "user-1", goalTimeClass: "blitz", expectedKind: "main", signal: controller.signal, onObserved: observed })).rejects.toMatchObject({ name: "AbortError" });
    expect(order).toHaveBeenCalledWith("played_at", { ascending: false });
    expect(limit).toHaveBeenCalledWith(100);
    expect(observed).toHaveBeenCalledWith(job, "coaching", 90, 100);
  });

  it("releases an in-flight successful claim on abort without starting a heartbeat", async () => {
    vi.useFakeTimers();
    let resolveClaim!: (value: unknown) => void;
    rpcMock
      .mockImplementationOnce(() => new Promise((resolve) => { resolveClaim = resolve; }))
      .mockResolvedValueOnce({ data: true, error: null });

    const controller = new AbortController();
    const acquisition = acquireOrObserveIngestJob({
      jobId: "job-1",
      userId: "user-1",
      goalTimeClass: "rapid",
      expectedKind: "main",
      signal: controller.signal,
    });
    controller.abort();
    resolveClaim({
      data: [{
        job_id: "job-1",
        claimed: true,
        lease_token: "lease-1",
        lease_expires_at: new Date(Date.now() + 90_000).toISOString(),
        job_status: "queued",
        job_kind: "main",
      }],
      error: null,
    });

    await expect(acquisition).rejects.toMatchObject({ name: "AbortError" });
    expect(rpcMock).toHaveBeenNthCalledWith(1, "claim_ingest_job_lease", {
      p_job_id: "job-1",
      p_lease_seconds: 90,
      p_allow_terminal: false,
    });
    expect(rpcMock).toHaveBeenNthCalledWith(2, "release_ingest_job_lease", {
      p_job_id: "job-1",
      p_lease_token: "lease-1",
    });

    await vi.advanceTimersByTimeAsync(100_000);
    expect(rpcMock).toHaveBeenCalledTimes(2);
  });
});
