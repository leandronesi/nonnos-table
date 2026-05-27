/**
 * Sessione giornaliera — stato + persistenza localStorage.
 *
 * Modello mentale: la sessione è un OBIETTIVO QUOTIDIANO. Ne fai una al giorno,
 * non scegli tu quanto. Apri l'app → ti dico "5 puzzle + 2 bivi + 1 partita".
 * Quando finisci, vedi punti e streak. Il giorno dopo se ne fai un'altra +1.
 * Se torni nello stesso giorno, vedi il riassunto della sessione già fatta.
 */

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
}

export const SESSION_SCHEMA = 3;

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
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as SessionState;
    // Invalida session vecchie (schema cambiato)
    if ((parsed.schema ?? 1) < SESSION_SCHEMA) {
      localStorage.removeItem(STORAGE_KEY);
      return null;
    }
    // Invalida session con step non più supportato (es. "review", "warmup",
    // "bivio" dell'architettura precedente: contenuto blank perché nessun
    // ramo del render matcha).
    if (!VALID_STEPS.has(parsed.step)) {
      localStorage.removeItem(STORAGE_KEY);
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function saveSession(s: SessionState): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
  } catch {
    // localStorage pieno o disabilitato → silent
  }
}

export function clearSession(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch { /* ignore */ }
}

export function loadStreak(): DailyStreak {
  try {
    const raw = localStorage.getItem(STREAK_KEY);
    if (raw) return { current: 0, best: 0, lastDate: "", totalSessions: 0, totalPoints: 0, ...JSON.parse(raw) };
  } catch { /* ignore */ }
  return { current: 0, best: 0, lastDate: "", totalSessions: 0, totalPoints: 0 };
}

function saveStreak(s: DailyStreak): void {
  try {
    localStorage.setItem(STREAK_KEY, JSON.stringify(s));
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

  // streak update
  const prev = loadStreak();
  const today = todayUTC();
  let current = prev.current;
  let streakKind: "up" | "broken" | "same" = "same";
  if (prev.lastDate === today) {
    streakKind = "same";
  } else if (prev.lastDate === yesterdayUTC()) {
    current = prev.current + 1;
    streakKind = "up";
  } else if (prev.lastDate !== "") {
    current = 1;
    streakKind = "broken";
  } else {
    current = 1;
    streakKind = "up";
  }
  const next: DailyStreak = {
    current,
    best: Math.max(prev.best, current),
    lastDate: today,
    totalSessions: prev.totalSessions + (prev.lastDate === today ? 0 : 1),
    totalPoints: prev.totalPoints + finished.points,
  };
  saveStreak(next);

  // Journal: scrivi entries per la sessione + streak. Import lazy per evitare
  // cicli (journal.ts → store.ts → journal.ts).
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  import("./journal").then(({ writeEntry, bodyForStreakMilestone, hasEntryToday }) => {
    if (!hasEntryToday("session_done")) {
      writeEntry({
        kind: "session_done",
        body: `Sessione di oggi: ${finished.points} punti.`,
        meta: { points: finished.points },
      });
    }
    if (streakKind === "up" && !hasEntryToday("streak_up")) {
      writeEntry({
        kind: "streak_up",
        body: `Streak a ${current} ${current === 1 ? "giorno" : "giorni"}.`,
        meta: { current },
      });
      if ([7, 14, 30, 60, 100].includes(current) && !hasEntryToday("streak_milestone")) {
        writeEntry({
          kind: "streak_milestone",
          body: bodyForStreakMilestone(current),
          meta: { days: current },
        });
      }
    } else if (streakKind === "broken" && !hasEntryToday("streak_broken")) {
      writeEntry({
        kind: "streak_broken",
        body: `Hai saltato qualche giorno. Si ricomincia da uno.`,
        meta: { previous: prev.current },
      });
    }
  }).catch(() => { /* silent */ });

  return { session: finished, streak: next };
}

// ---------------------------------------------------------------------------
// Selectors
// ---------------------------------------------------------------------------

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
