import { FREE_GAME_CAP } from "./config";
import { supabase } from "../auth/supabaseClient";
import type {
  IngestJobKind,
  IngestJobLeaseClaimRow,
  IngestJobRow,
  OnboardingState,
} from "../auth/db.types";
import {
  observedWorkFingerprint,
  shouldTreatObservedJobAsTerminal,
  type LeaseSnapshot,
} from "./jobLeaseSemantics";

const LEASE_SECONDS = 90;
const HEARTBEAT_MS = 25_000;
const POLL_MS = 2_000;
const MAX_IDLE_OBSERVE_MS = 15 * 60_000;
const MAX_WORK_STALL_MS = 10 * 60_000;
const DB_CALL_TIMEOUT_MS = 15_000;

function monotonicNow(): number {
  return globalThis.performance?.now() ?? Date.now();
}

export class LeaseOwnershipLostError extends Error {
  constructor(message = "ingest_job_lease_lost") {
    super(message);
    this.name = "LeaseOwnershipLostError";
  }
}

function delay(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = globalThis.setTimeout(finish, ms);
    function finish(): void {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }
    function onAbort(): void {
      globalThis.clearTimeout(timer);
      finish();
    }
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

function bounded<T>(operation: PromiseLike<T>, code: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = globalThis.setTimeout(
      () => reject(new Error(`${code}:timeout`)),
      DB_CALL_TIMEOUT_MS,
    );
    Promise.resolve(operation).then(
      (value) => {
        globalThis.clearTimeout(timer);
        resolve(value);
      },
      (cause) => {
        globalThis.clearTimeout(timer);
        reject(cause);
      },
    );
  });
}

function parseTime(value: string | null | undefined): number | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function leaseSnapshot(job: IngestJobRow): LeaseSnapshot {
  return {
    kind: job.kind,
    status: job.status,
    leaseToken: job.lease_token,
    leaseExpiresAtMs: parseTime(job.lease_expires_at),
    createdAtMs: parseTime(job.created_at) ?? 0,
  };
}

function firstClaimRow(value: unknown): IngestJobLeaseClaimRow | null {
  const row = Array.isArray(value) ? value[0] : value;
  if (!row || typeof row !== "object") return null;
  const candidate = row as Record<string, unknown>;
  if (typeof candidate.job_id !== "string"
    || typeof candidate.claimed !== "boolean"
    || typeof candidate.job_status !== "string"
    || (candidate.job_kind !== "main" && candidate.job_kind !== "silent")) return null;
  return candidate as IngestJobLeaseClaimRow;
}

async function claim(jobId: string, allowTerminal: boolean): Promise<IngestJobLeaseClaimRow> {
  const { data, error } = await bounded(
    supabase.rpc("claim_ingest_job_lease", {
      p_job_id: jobId,
      p_lease_seconds: LEASE_SECONDS,
      p_allow_terminal: allowTerminal,
    }),
    "ingest_job_lease_claim_failed",
  );
  const row = firstClaimRow(data);
  if (error || !row) {
    throw new Error(`ingest_job_lease_claim_failed:${error?.message ?? "invalid_response"}`);
  }
  return row;
}

async function releaseClaimToken(jobId: string, token: string): Promise<boolean> {
  const { data, error } = await bounded(
    supabase.rpc("release_ingest_job_lease", {
      p_job_id: jobId,
      p_lease_token: token,
    }),
    "ingest_job_lease_release_failed",
  );
  if (error) throw new Error(`ingest_job_lease_release_failed:${error.message}`);
  return data === true;
}

async function readObservedState(
  jobId: string,
  userId: string,
  goalTimeClass: "rapid" | "blitz",
): Promise<{
  job: IngestJobRow;
  profileState: OnboardingState;
  gamesAnalyzed: number;
  gamesTotal: number;
}> {
  const [jobResult, profileResult, analyzedResult] = await Promise.all([
    bounded(
      supabase.from("ingest_jobs").select("*").eq("id", jobId).eq("user_id", userId).maybeSingle(),
      "ingest_job_observe_failed",
    ),
    bounded(
      supabase.from("profiles").select("onboarding_state").eq("user_id", userId).maybeSingle(),
      "profile_observe_failed",
    ),
    bounded(
      supabase.from("games")
        .select("analysis_status,analysis_path")
        .eq("user_id", userId)
        .eq("time_class", goalTimeClass)
        .order("played_at", { ascending: false })
        .limit(FREE_GAME_CAP),
      "analysis_success_observe_failed",
    ),
  ]);
  if (jobResult.error || !jobResult.data) {
    throw new Error(`ingest_job_observe_failed:${jobResult.error?.message ?? "missing_job"}`);
  }
  if (profileResult.error || !profileResult.data) {
    throw new Error(`profile_observe_failed:${profileResult.error?.message ?? "missing_profile"}`);
  }
  if (analyzedResult.error || analyzedResult.data == null) {
    throw new Error(
      `analysis_success_observe_failed:${analyzedResult.error?.message ?? "missing_count"}`,
    );
  }
  return {
    job: jobResult.data as IngestJobRow,
    profileState: profileResult.data.onboarding_state,
    gamesAnalyzed: analyzedResult.data.filter(row => row.analysis_status === "done" && row.analysis_path).length,
    gamesTotal: analyzedResult.data.length,
  };
}

export class IngestJobLease {
  readonly jobId: string;
  readonly token: string;
  readonly kind: IngestJobKind;
  private localDeadlineMs: number;
  private readonly heartbeatAbort = new AbortController();
  private readonly heartbeatPromise: Promise<void>;
  private lost: Error | null = null;
  private closed = false;
  private lastWorkPulseMs = monotonicNow();
  private lastServerFenceWallMs = Date.now();

  constructor(input: {
    jobId: string;
    token: string;
    kind: IngestJobKind;
    expiresAt: string;
  }) {
    this.jobId = input.jobId;
    this.token = input.token;
    this.kind = input.kind;
    if (parseTime(input.expiresAt) == null) {
      throw new Error("ingest_job_lease_claim_failed:invalid_expiry");
    }
    // Do not compare a server timestamp with the device wall clock. A local
    // monotonic deadline is only a fail-safe; renew/guard always ask Postgres.
    this.localDeadlineMs = monotonicNow() + LEASE_SECONDS * 1_000;
    this.heartbeatPromise = this.heartbeatLoop();
  }

  private async heartbeatLoop(): Promise<void> {
    while (!this.heartbeatAbort.signal.aborted) {
      await delay(HEARTBEAT_MS, this.heartbeatAbort.signal);
      if (this.heartbeatAbort.signal.aborted) return;
      if (monotonicNow() - this.lastWorkPulseMs > MAX_WORK_STALL_MS) {
        this.lost = new LeaseOwnershipLostError("ingest_job_work_stalled");
        this.heartbeatAbort.abort();
        return;
      }
      try {
        await this.renew();
      } catch (cause) {
        this.lost = cause instanceof Error ? cause : new LeaseOwnershipLostError();
        this.heartbeatAbort.abort();
      }
    }
  }

  assertOwned(): void {
    if (this.closed || this.lost || this.localDeadlineMs <= monotonicNow()) {
      throw this.lost ?? new LeaseOwnershipLostError();
    }
  }

  private assertOpen(): void {
    if (this.closed || this.lost) {
      throw this.lost ?? new LeaseOwnershipLostError();
    }
  }

  /** Called only at real pipeline checkpoints; heartbeat alone is not progress. */
  touch(): void {
    this.assertOwned();
    this.lastWorkPulseMs = monotonicNow();
  }

  /** Cheap per-unit pulse; heartbeat/DB guards remain the ownership authority. */
  async pulse(): Promise<void> {
    this.touch();
    // performance.now can pause during OS sleep on some platforms. Wall time
    // never decides ownership, but a large jump forces a server-authoritative
    // renew before Stockfish continues.
    if (Date.now() - this.lastServerFenceWallMs > HEARTBEAT_MS * 2) {
      await this.renew();
      this.touch();
    }
  }

  async renew(): Promise<void> {
    // The DB, not the device wall clock, decides whether the lease is live.
    this.assertOpen();
    const { data, error } = await bounded(
      supabase.rpc("renew_ingest_job_lease", {
        p_job_id: this.jobId,
        p_lease_token: this.token,
        p_lease_seconds: LEASE_SECONDS,
      }),
      "ingest_job_lease_renew_failed",
    );
    const renewedAt = typeof data === "string" ? parseTime(data) : null;
    if (error || renewedAt == null) {
      throw new LeaseOwnershipLostError(
        `ingest_job_lease_renew_failed:${error?.message ?? "ownership_lost"}`,
      );
    }
    this.localDeadlineMs = monotonicNow() + LEASE_SECONDS * 1_000;
    this.lastServerFenceWallMs = Date.now();
  }

  /** DB-backed fence used immediately before and after expensive work. */
  async guard(): Promise<void> {
    await this.renew();
    this.assertOwned();
    this.touch();
  }

  private async stopHeartbeat(): Promise<void> {
    if (!this.heartbeatAbort.signal.aborted) this.heartbeatAbort.abort();
    await this.heartbeatPromise;
  }

  async release(): Promise<boolean> {
    if (this.closed) return true;
    await this.stopHeartbeat();
    const released = await releaseClaimToken(this.jobId, this.token);
    this.closed = released;
    if (!released) {
      this.lost ??= new LeaseOwnershipLostError("ingest_job_lease_release_denied");
      return false;
    }
    return true;
  }

  async complete(status: "done" | "error", errorMessage: string | null): Promise<void> {
    if (this.closed) throw new LeaseOwnershipLostError();
    await this.guard();
    await this.stopHeartbeat();
    const { data, error } = await bounded(
      supabase.rpc("complete_ingest_job_lease", {
        p_job_id: this.jobId,
        p_lease_token: this.token,
        p_status: status,
        p_error: errorMessage,
      }),
      "ingest_job_lease_complete_failed",
    );
    if (error || data !== true) {
      if (data !== true) this.lost ??= new LeaseOwnershipLostError();
      throw new LeaseOwnershipLostError(
        `ingest_job_lease_complete_failed:${error?.message ?? "ownership_lost"}`,
      );
    }
    this.closed = true;
  }
}

export type LeaseAcquisition =
  | { outcome: "owned"; lease: IngestJobLease }
  | {
      outcome: "terminal";
      job: IngestJobRow;
      profileState: OnboardingState;
      gamesAnalyzed: number;
    };

export async function acquireOrObserveIngestJob(input: {
  jobId: string;
  userId: string;
  goalTimeClass: "rapid" | "blitz";
  expectedKind: IngestJobKind;
  allowTerminal?: boolean;
  onObserved?: (
    job: IngestJobRow,
    profileState: OnboardingState,
    gamesAnalyzed: number,
    gamesTotal: number,
  ) => void;
  signal?: AbortSignal;
  now?: () => number;
}): Promise<LeaseAcquisition> {
  const now = input.now ?? monotonicNow;
  let idleDeadline = now() + MAX_IDLE_OBSERVE_MS;
  let lastActivity = "";

  while (!input.signal?.aborted) {
    const claimRow = await claim(input.jobId, input.allowTerminal === true);
    if (claimRow.job_kind !== input.expectedKind) {
      throw new Error(`ingest_job_kind_mismatch:${claimRow.job_kind}`);
    }
    if (input.signal?.aborted) {
      if (claimRow.claimed && claimRow.lease_token) {
        // Release before constructing IngestJobLease, so cancellation can
        // never orphan a heartbeat. DB expiry is the bounded fallback.
        try {
          await releaseClaimToken(claimRow.job_id, claimRow.lease_token);
        } catch (releaseError) {
          // eslint-disable-next-line no-console
          console.warn("[jobLease] aborted claim release failed:", releaseError);
        }
      }
      throw new DOMException("Lease observation aborted", "AbortError");
    }
    if (claimRow.claimed) {
      if (!claimRow.lease_token || !claimRow.lease_expires_at) {
        throw new Error("ingest_job_lease_claim_failed:missing_lease");
      }
      if (parseTime(claimRow.lease_expires_at) == null) {
        try {
          await releaseClaimToken(claimRow.job_id, claimRow.lease_token);
        } catch {
          // The server-side expiry remains the fallback; no heartbeat exists.
        }
        throw new Error("ingest_job_lease_claim_failed:invalid_expiry");
      }
      return {
        outcome: "owned",
        lease: new IngestJobLease({
          jobId: claimRow.job_id,
          token: claimRow.lease_token,
          kind: claimRow.job_kind,
          expiresAt: claimRow.lease_expires_at,
        }),
      };
    }

    const observed = await readObservedState(
      input.jobId,
      input.userId,
      input.goalTimeClass,
    );
    if (input.signal?.aborted) {
      throw new DOMException("Lease observation aborted", "AbortError");
    }
    if (observed.job.kind !== input.expectedKind) {
      throw new Error(`ingest_job_kind_mismatch:${observed.job.kind}`);
    }
    input.onObserved?.(observed.job, observed.profileState, observed.gamesAnalyzed, observed.gamesTotal);
    const activity = observedWorkFingerprint({
      status: observed.job.status,
      monthsDone: observed.job.months_done,
      gamesDone: observed.job.games_done,
      profileState: observed.profileState,
    });
    if (activity !== lastActivity) {
      lastActivity = activity;
      idleDeadline = now() + MAX_IDLE_OBSERVE_MS;
    }
    // Staleness is decided by the claim RPC using server time. This helper only
    // applies kind/terminal semantics, avoiding device clock skew.
    const trulyTerminal = shouldTreatObservedJobAsTerminal({
      snapshot: leaseSnapshot(observed.job),
      expectedKind: input.expectedKind,
      profileReady: observed.profileState === "ready",
      allowTerminalClaim: input.allowTerminal === true,
    });
    if (trulyTerminal) return { outcome: "terminal", ...observed };
    if (now() >= idleDeadline) throw new Error("ingest_job_lease_observe_idle_timeout");

    await delay(POLL_MS, input.signal);
  }
  throw new DOMException("Lease observation aborted", "AbortError");
}
