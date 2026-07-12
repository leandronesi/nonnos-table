/**
 * Sessione giornaliera — stato + persistenza localStorage.
 *
 * Modello mentale: la sessione è un OBIETTIVO QUOTIDIANO. Ne fai una al giorno,
 * non scegli tu quanto. Apri l'app → ti dico "5 puzzle + 2 bivi + 1 partita".
 * Quando finisci, vedi punti e streak. Il giorno dopo se ne fai un'altra +1.
 * Se torni nello stesso giorno, vedi il riassunto della sessione già fatta.
 */

import { scopedStorage } from "../auth/userStorage";
import type { PositionExample } from "../pipeline/aggregate";
import type {
  OpponentFallbackReason,
  OpponentSource,
  OpponentUnavailableReason,
} from "./opponentPolicy";
import type {
  CorpusFallbackCode,
  PositionNovelty,
  SessionPhaseKey,
  WhyTodayCode,
} from "./adaptiveSelector";

export type StepKey =
  // Nuova architettura 4 fasi
  | "intro" | "tema" | "warmup_guidato" | "drill" | "play" | "outro"
  // Back-compat (vecchi nomi, ancora gestiti da loadSession)
  | "review" | "warmup" | "bivio" | "recap";
export type DrillVerdict = "perfect" | "ok" | "wrong";

export interface DrillResult {
  drillId: string;       // "<game_id>:<ply>"
  verdict: DrillVerdict;
  cp_loss: number;
  played_san: string | null;
  attempts: number;
}

export interface BivioResult {
  tpId: string;          // "<game_id>:<ply>"
  revealed: boolean;
}

export interface PlayResult {
  outcome: "win" | "draw" | "loss" | "abandoned";
  moves_played: number;
  finished_at: number;   // epoch ms
  /** Fonte realmente usata nell'ultimo turno avversario. */
  opponent_source?: OpponentSource;
  opponent_fallback_reason?: OpponentFallbackReason | null;
  opponent_unavailable_reason?: OpponentUnavailableReason | null;
}

export const SESSION_SCHEMA = 6;
const MIN_RESUMABLE_SESSION_SCHEMA = 5;

export interface SessionState {
  schema?: number;       // versione schema; serve per invalidare le session vecchie
  date: string;          // "YYYY-MM-DD" UTC — la chiave del giorno
  startedAt: number;     // epoch ms
  finishedAt?: number;   // epoch ms
  step: StepKey;
  // Inputs (gli ID che la sessione di oggi userà — fissati all'avvio)
  drillIds: string[];
  bivioIds: string[];
  playFen?: string;
  playMyColor?: "white" | "black";   // colore del giocatore nella posizione di partenza
  // Nuova architettura: posizioni per fase (opzionali per back-compat)
  temaPositionId?: string;       // "<game_id>:<ply>" della posizione Tema
  warmupPositionId?: string;     // idem per Warmup
  drillPositionId?: string;      // idem per Drill
  // Selezione adattiva fissata per utente/giorno.
  anchorKey?: string;
  anchorLabel?: string;
  whyTodayCode?: WhyTodayCode;
  whyCurrentSupport?: boolean;
  whyTargetRelevant?: boolean;
  whyRelativePriority?: number | null;
  whyNextReviewAt?: string | null;
  whyObservedWrongAttempts?: number;
  whyObservedHintUses?: number;
  distinctPositions?: number;
  selectionSeed?: string;
  phaseAnchorKeys?: Record<SessionPhaseKey, string>;
  phaseAnchorLabels?: Record<SessionPhaseKey, string>;
  phaseNovelty?: Record<SessionPhaseKey, PositionNovelty>;
  supplementalAnchorKeys?: string[];
  supplementalAnchorLabels?: string[];
  corpusFallbackCode?: CorpusFallbackCode | null;
  corpusPrimaryPositionsAvailable?: number;
  difficultyProgression?: "ascending" | "focus_override" | "evidence_first" | "secondary_fallback" | "limited_corpus";
  /** Snapshot renderizzabile: il refresh 10 -> 100 non puo' cambiare le tre posizioni in corso. */
  positionSnapshots?: Record<SessionPhaseKey, PositionExample>;
  // Risultati
  drills: DrillResult[];
  bivi: BivioResult[];
  play?: PlayResult;
  // Score derivato
  points: number;
}

const STORAGE_KEY = "mygotham_session";
const STREAK_KEY = "mygotham_daily_streak";

export interface DailyStreak {
  current: number;       // giorni consecutivi
  best: number;
  lastDate: string;      // "YYYY-MM-DD" UTC, ultima sessione completata
  totalSessions: number; // lifetime
  totalPoints: number;   // lifetime
}

// ---------------------------------------------------------------------------
// Utility data
// ---------------------------------------------------------------------------

export function todayUTC(): string {
  return new Date().toISOString().slice(0, 10);
}

export function yesterdayUTC(): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------
// Read / write
// ---------------------------------------------------------------------------

// Step canonici nella nuova architettura 4-fase (intro/tema/warmup/drill/play/outro)
// + recap accettato come alias di outro per back-compat soft.
const VALID_STEPS: ReadonlySet<StepKey> = new Set<StepKey>([
  "intro", "tema", "warmup_guidato", "drill", "play", "outro", "recap",
]);

export function loadSession(): SessionState | null {
  try {
    const raw = scopedStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as SessionState;
    // Schema 5 remains readable so the UI can restore from corpus IDs and
    // upgrade it with schema-6 position snapshots without losing progress.
    if ((parsed.schema ?? 1) < MIN_RESUMABLE_SESSION_SCHEMA) {
      scopedStorage.removeItem(STORAGE_KEY);
      return null;
    }
    // Invalida session con step non più supportato (es. "review", "warmup",
    // "bivio" dell'architettura precedente: contenuto blank perché nessun
    // ramo del render matcha).
    if (!VALID_STEPS.has(parsed.step)) {
      scopedStorage.removeItem(STORAGE_KEY);
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function saveSession(s: SessionState): void {
  try {
    scopedStorage.setItem(STORAGE_KEY, JSON.stringify(s));
  } catch {
    // localStorage pieno o disabilitato → silent
  }
}

export function clearSession(): void {
  try {
    scopedStorage.removeItem(STORAGE_KEY);
  } catch { /* ignore */ }
}

export function loadStreak(): DailyStreak {
  try {
    const raw = scopedStorage.getItem(STREAK_KEY);
    if (raw) return { current: 0, best: 0, lastDate: "", totalSessions: 0, totalPoints: 0, ...JSON.parse(raw) };
  } catch { /* ignore */ }
  return { current: 0, best: 0, lastDate: "", totalSessions: 0, totalPoints: 0 };
}

function saveStreak(s: DailyStreak): void {
  try {
    scopedStorage.setItem(STREAK_KEY, JSON.stringify(s));
  } catch { /* ignore */ }
}

// ---------------------------------------------------------------------------
// Score
// ---------------------------------------------------------------------------

const POINTS = {
  drill_perfect: 10,
  drill_ok: 5,
  drill_wrong: 0,
  bivio_revealed: 5,
  play_win: 20,
  play_draw: 8,
  play_loss: 3,
  play_abandoned: 0,
};

export function computePoints(s: SessionState): number {
  let p = 0;
  for (const d of s.drills) {
    if (d.verdict === "perfect") p += POINTS.drill_perfect;
    else if (d.verdict === "ok") p += POINTS.drill_ok;
  }
  p += s.bivi.filter((b) => b.revealed).length * POINTS.bivio_revealed;
  if (s.play) {
    p += POINTS[`play_${s.play.outcome}`];
  }
  return p;
}

// ---------------------------------------------------------------------------
// Logic
// ---------------------------------------------------------------------------

export interface SessionInputs {
  drillIds: string[];      // primi N drill da pm.drills
  bivioIds: string[];      // primi M turning points
  playFen?: string;        // FEN per la partita finale (es. da un turning point)
  playMyColor?: "white" | "black";
  // Nuova architettura: posizioni per fase
  temaPositionId?: string;
  warmupPositionId?: string;
  drillPositionId?: string;
  anchorKey?: string;
  anchorLabel?: string;
  whyTodayCode?: WhyTodayCode;
  whyCurrentSupport?: boolean;
  whyTargetRelevant?: boolean;
  whyRelativePriority?: number | null;
  whyNextReviewAt?: string | null;
  whyObservedWrongAttempts?: number;
  whyObservedHintUses?: number;
  distinctPositions?: number;
  selectionSeed?: string;
  phaseAnchorKeys?: Record<SessionPhaseKey, string>;
  phaseAnchorLabels?: Record<SessionPhaseKey, string>;
  phaseNovelty?: Record<SessionPhaseKey, PositionNovelty>;
  supplementalAnchorKeys?: string[];
  supplementalAnchorLabels?: string[];
  corpusFallbackCode?: CorpusFallbackCode | null;
  corpusPrimaryPositionsAvailable?: number;
  difficultyProgression?: "ascending" | "focus_override" | "evidence_first" | "secondary_fallback" | "limited_corpus";
  positionSnapshots?: Record<SessionPhaseKey, PositionExample>;
}

export function startNewSession(inputs: SessionInputs): SessionState {
  const s: SessionState = {
    schema: SESSION_SCHEMA,
    date: todayUTC(),
    startedAt: Date.now(),
    step: "intro",
    drillIds: inputs.drillIds,
    bivioIds: inputs.bivioIds,
    playFen: inputs.playFen,
    playMyColor: inputs.playMyColor,
    temaPositionId: inputs.temaPositionId,
    warmupPositionId: inputs.warmupPositionId,
    drillPositionId: inputs.drillPositionId,
    anchorKey: inputs.anchorKey,
    anchorLabel: inputs.anchorLabel,
    whyTodayCode: inputs.whyTodayCode,
    whyCurrentSupport: inputs.whyCurrentSupport,
    whyTargetRelevant: inputs.whyTargetRelevant,
    whyRelativePriority: inputs.whyRelativePriority,
    whyNextReviewAt: inputs.whyNextReviewAt,
    whyObservedWrongAttempts: inputs.whyObservedWrongAttempts,
    whyObservedHintUses: inputs.whyObservedHintUses,
    distinctPositions: inputs.distinctPositions,
    selectionSeed: inputs.selectionSeed,
    phaseAnchorKeys: inputs.phaseAnchorKeys,
    phaseAnchorLabels: inputs.phaseAnchorLabels,
    phaseNovelty: inputs.phaseNovelty,
    supplementalAnchorKeys: inputs.supplementalAnchorKeys,
    supplementalAnchorLabels: inputs.supplementalAnchorLabels,
    corpusFallbackCode: inputs.corpusFallbackCode,
    corpusPrimaryPositionsAvailable: inputs.corpusPrimaryPositionsAvailable,
    difficultyProgression: inputs.difficultyProgression,
    positionSnapshots: inputs.positionSnapshots,
    drills: [],
    bivi: [],
    points: 0,
  };
  saveSession(s);
  return s;
}

export function completeSession(s: SessionState): { session: SessionState; streak: DailyStreak } {
  const finished: SessionState = {
    ...s,
    finishedAt: Date.now(),
    step: "outro",
    points: computePoints(s),
  };
  saveSession(finished);

  // streak bookkeeping — maintains totalSessions / totalPoints / best / lastDate.
  // Streak display is forbidden (lista del NO). Journal entries for streak are removed.
  const prev = loadStreak();
  const today = todayUTC();
  let current = prev.current;
  if (prev.lastDate !== today) {
    if (prev.lastDate === yesterdayUTC()) {
      current = prev.current + 1;
    } else {
      current = 1;
    }
  }
  const next: DailyStreak = {
    current,
    best: Math.max(prev.best, current),
    lastDate: today,
    totalSessions: prev.totalSessions + (prev.lastDate === today ? 0 : 1),
    totalPoints: prev.totalPoints + finished.points,
  };
  saveStreak(next);

  // Journal entry for session_done is written by NonnoSession.handlePlayDone
  // (only on full completion, with guard hasEntryToday). Streak journal entries
  // are removed: streak is a forbidden attribute (DESIGN.md / lista del NO).

  return { session: finished, streak: next };
}

// ---------------------------------------------------------------------------
// Selectors
// ---------------------------------------------------------------------------

export type SessionEntryDecision = "start" | "resume" | "completed";

export interface SessionSelectionIdentity {
  selectionSeed: string;
  temaPositionId: string;
  warmupPositionId: string;
  drillPositionId: string;
  anchorKey: string;
}

export function upgradeSessionWithPositionSnapshots(
  session: SessionState,
  snapshots: Record<SessionPhaseKey, PositionExample>,
): SessionState {
  return {
    ...session,
    schema: SESSION_SCHEMA,
    positionSnapshots: snapshots,
  };
}

export type SessionInitializationDecision = "start" | "keep" | "block";

export function buildSessionSelectionSeed(input: {
  userId: string;
  date: string;
  explicitStartRequested: boolean;
  focusKey?: string | null;
  navigationKey: string;
}): string {
  if (!input.explicitStartRequested) return `${input.userId}:${input.date}:daily`;
  return `${input.userId}:${input.date}:choice:${input.focusKey ?? "manual"}:${input.navigationKey}`;
}

/** Stable for rerenders/data refreshes, distinct for a new explicit navigation. */
export function sessionInitializationKey(identity: SessionSelectionIdentity): string {
  return [
    identity.selectionSeed,
    identity.anchorKey,
    identity.temaPositionId,
    identity.warmupPositionId,
    identity.drillPositionId,
  ].join("\u001f");
}

/**
 * A data refresh must never overwrite today's active/completed session. An
 * explicit choice may replace it only when it carries a genuinely new key.
 */
export function decideSessionInitialization(input: {
  initializedKey: string | null;
  currentSession: SessionState | null;
  date: string;
  identity: SessionSelectionIdentity;
  explicitStartRequested: boolean;
  allowRestore: boolean;
}): SessionInitializationDecision {
  const nextKey = sessionInitializationKey(input.identity);
  if (input.initializedKey === nextKey) return "keep";

  const current = input.currentSession;
  if (!current || current.date !== input.date) return "start";
  if (!current.temaPositionId
    || !current.warmupPositionId
    || !current.drillPositionId
    || !current.anchorKey) {
    return input.explicitStartRequested && !input.allowRestore ? "start" : "block";
  }
  const sameContent = current.temaPositionId === input.identity.temaPositionId
    && current.warmupPositionId === input.identity.warmupPositionId
    && current.drillPositionId === input.identity.drillPositionId
    && current.anchorKey === input.identity.anchorKey;
  const sameSeed = current.selectionSeed === input.identity.selectionSeed;
  if (sameContent && (sameSeed || input.allowRestore)) return "keep";
  if (input.explicitStartRequested && !input.allowRestore) return "start";
  return "block";
}

/** Pure gate: a completed daily session never starts over without an explicit choice. */
export function decideSessionEntry(
  session: SessionState | null,
  date: string,
  explicitStart: boolean,
): SessionEntryDecision {
  if (explicitStart) return "start";
  if (!session || session.date !== date) return "start";
  return session.finishedAt ? "completed" : "resume";
}

export function sessionIsTodayAndDone(s: SessionState | null): boolean {
  if (!s) return false;
  if (s.date !== todayUTC()) return false;
  return !!s.finishedAt;
}

export function sessionIsTodayAndInProgress(s: SessionState | null): boolean {
  if (!s) return false;
  if (s.date !== todayUTC()) return false;
  return !s.finishedAt;
}
