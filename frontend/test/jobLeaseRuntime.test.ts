import { afterEach, describe, expect, it, vi } from "vitest";

const { rpcMock } = vi.hoisted(() => ({ rpcMock: vi.fn() }));

vi.mock("../src/auth/supabaseClient", () => ({
  supabase: { rpc: rpcMock },
}));

import { acquireOrObserveIngestJob } from "../src/pipeline/jobLease";

describe("ingest job lease runtime", () => {
  afterEach(() => {
    rpcMock.mockReset();
    vi.useRealTimers();
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
