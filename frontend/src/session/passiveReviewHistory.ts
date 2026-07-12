import { scopedStorage } from "../auth/userStorage";
import type { TrainingAttemptInput } from "../trainingProgress";
import type { RecentSessionAttempt } from "./adaptiveSelector";

const STORAGE_KEY = "mygotham_passive_reviews_v1";
const MAX_RECORDS = 400;

export interface PassiveReviewInput {
  sessionIdentity: string;
  anchorKey: string;
  primaryAnchorKey: string;
  sourceGameId?: string | null;
  positionId: string;
  fenBefore: string;
  reasonCode: string;
  corpusFallbackCode?: string | null;
  phaseNovelty?: string | null;
}

export interface PassiveReviewRecord extends PassiveReviewInput {
  eventToken: string;
  date: string;
  shownAt: number;
  cloudSyncedAt?: number;
}

interface PassiveReviewRecorderDependencies {
  recordCloud: (attempt: TrainingAttemptInput) => Promise<unknown>;
  reportCloudError: (error: unknown) => void;
  now?: () => number;
}

function hash(value: string): number {
  let result = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    result ^= value.charCodeAt(index);
    result = Math.imul(result, 16777619);
  }
  return result >>> 0;
}

function bounded(value: string, max: number): string {
  return value.trim().slice(0, max);
}

function normalizeInput(input: PassiveReviewInput): PassiveReviewInput {
  return {
    sessionIdentity: bounded(input.sessionIdentity, 320),
    anchorKey: bounded(input.anchorKey, 160),
    primaryAnchorKey: bounded(input.primaryAnchorKey, 160),
    sourceGameId: input.sourceGameId ? bounded(input.sourceGameId, 160) : null,
    positionId: bounded(input.positionId, 240),
    fenBefore: bounded(input.fenBefore, 120),
    reasonCode: bounded(input.reasonCode, 80),
    corpusFallbackCode: input.corpusFallbackCode
      ? bounded(input.corpusFallbackCode, 80)
      : null,
    phaseNovelty: input.phaseNovelty ? bounded(input.phaseNovelty, 80) : null,
  };
}

function isRecord(value: unknown): value is PassiveReviewRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const row = value as Record<string, unknown>;
  return typeof row.eventToken === "string"
    && typeof row.date === "string"
    && typeof row.shownAt === "number"
    && typeof row.sessionIdentity === "string"
    && typeof row.anchorKey === "string"
    && typeof row.primaryAnchorKey === "string"
    && typeof row.positionId === "string"
    && typeof row.fenBefore === "string"
    && typeof row.reasonCode === "string";
}

function readRecords(): PassiveReviewRecord[] {
  try {
    const raw = scopedStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter(isRecord) : [];
  } catch {
    return [];
  }
}

function writeRecords(records: readonly PassiveReviewRecord[]): void {
  try {
    scopedStorage.setItem(STORAGE_KEY, JSON.stringify(records.slice(0, MAX_RECORDS)));
  } catch {
    // Local history is best effort; cloud sync still runs below.
  }
}

function tokenFor(input: PassiveReviewInput, date: string): string {
  const raw = `${date}\u001f${input.sessionIdentity}\u001f${input.positionId}`;
  const reverse = [...raw].reverse().join("");
  return `watch:${date}:${hash(raw).toString(36)}${hash(reverse).toString(36)}`;
}

/** Idempotent per UTC day + session selection + position. */
export function recordPassiveReviewLocally(
  rawInput: PassiveReviewInput,
  nowMs = Date.now(),
): { record: PassiveReviewRecord; created: boolean } {
  const input = normalizeInput(rawInput);
  const date = new Date(nowMs).toISOString().slice(0, 10);
  const records = readRecords();
  const existing = records.find((record) => record.date === date
    && record.sessionIdentity === input.sessionIdentity
    && record.positionId === input.positionId);
  if (existing) return { record: existing, created: false };

  const record: PassiveReviewRecord = {
    ...input,
    eventToken: tokenFor(input, date),
    date,
    shownAt: nowMs,
  };
  writeRecords([record, ...records]);
  return { record, created: true };
}

function markCloudSynced(eventToken: string, syncedAt: number): void {
  const records = readRecords();
  const index = records.findIndex((record) => record.eventToken === eventToken);
  if (index < 0 || records[index].cloudSyncedAt) return;
  records[index] = { ...records[index], cloudSyncedAt: syncedAt };
  writeRecords(records);
}

/** Local watch history feeds novelty even when cloud sync was unavailable. */
export function loadPassiveReviewAttempts(): RecentSessionAttempt[] {
  return readRecords().map((record) => ({
    anchorKey: record.anchorKey,
    positionId: record.positionId,
    sourceGameId: record.sourceGameId ?? null,
    fenBefore: record.fenBefore,
    mode: "watch",
    verdict: "skipped",
    correct: null,
    usedHint: false,
    attempts: 1,
    createdAt: new Date(record.shownAt).toISOString(),
  }));
}

/**
 * Records locally before attempting the cloud write. Repeated effects share a
 * single in-flight write; a failed write remains retryable on the next mount.
 */
export function createPassiveReviewRecorder(deps: PassiveReviewRecorderDependencies) {
  const inFlight = new Set<string>();
  return (input: PassiveReviewInput): boolean => {
    const nowMs = deps.now?.() ?? Date.now();
    const { record, created } = recordPassiveReviewLocally(input, nowMs);
    if (record.cloudSyncedAt || inFlight.has(record.eventToken)) return created;

    inFlight.add(record.eventToken);
    void Promise.resolve().then(() => deps.recordCloud({
      anchorKey: record.anchorKey,
      sourceGameId: record.sourceGameId ?? null,
      positionId: record.positionId,
      mode: "watch",
      attempts: 1,
      verdict: "skipped",
      correct: null,
      usedHint: false,
      context: {
        selection_reason: record.reasonCode,
        fen_before: record.fenBefore,
        primary_anchor_key: record.primaryAnchorKey,
        corpus_fallback: record.corpusFallbackCode ?? null,
        phase_novelty: record.phaseNovelty ?? null,
        passive_review: true,
        passive_review_event: record.eventToken,
      },
    })).then(() => {
      markCloudSynced(record.eventToken, deps.now?.() ?? Date.now());
    }).catch(deps.reportCloudError).finally(() => {
      inFlight.delete(record.eventToken);
    });
    return created;
  };
}
