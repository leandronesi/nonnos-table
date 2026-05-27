/**
 * Journal automatico — il diario di Nonno O. che si scrive da solo.
 *
 * Modello mentale: ogni volta che succede qualcosa di significativo (drill
 * completato, streak avanzato, pattern dominato, regressione...) scriviamo
 * UNA voce breve nel quaderno. Nonno le mostra in /coach in ordine
 * cronologico inverso, come pagine di un quaderno reale.
 *
 * Niente LLM qui — sono entry deterministiche basate sull'attività.
 * Quando aggiungeremo l'LLM (Phase 3), userà queste entry come contesto
 * per generare narrativa piu` ricca.
 *
 * Persistenza: localStorage `mygotham_journal`. Schema versionato.
 */

import { todayUTC } from "./store";

const STORAGE_KEY = "mygotham_journal";
const SCHEMA = 1;
const MAX_ENTRIES = 200; // cap per non gonfiare localStorage

export type JournalKind =
  | "drill_completed"     // hai finito una run di drill su un pattern
  | "session_done"        // hai chiuso una sessione del giorno
  | "streak_up"           // streak avanzato (+1 giorno)
  | "streak_milestone"    // streak raggiunto 7 / 14 / 30 / 60
  | "streak_broken"       // streak interrotto
  | "pattern_mastered"    // pattern marcato come dominato (SRS)
  | "pattern_regressed"   // pattern peggiorato (trend worsening rilevante)
  | "first_drill"         // prima volta che drilli un pattern specifico
  | "goal_updated";       // utente ha cambiato target/time_class

export interface JournalEntry {
  /** Epoch ms. */
  at: number;
  /** "YYYY-MM-DD" UTC della giornata di scrittura (per raggruppamento). */
  date: string;
  kind: JournalKind;
  /** Pattern key se la entry riguarda un pattern specifico. */
  pattern_key?: string;
  /** Testo umano-leggibile, scritto da Nonno. */
  body: string;
  /** Dettagli numerici opzionali (perfette/ok/sbagliate, streak count, ecc.). */
  meta?: Record<string, number | string | boolean>;
}

interface JournalStore {
  schema: number;
  entries: JournalEntry[];
}

function loadRaw(): JournalStore {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { schema: SCHEMA, entries: [] };
    const parsed = JSON.parse(raw) as JournalStore;
    if ((parsed.schema ?? 0) < SCHEMA) {
      localStorage.removeItem(STORAGE_KEY);
      return { schema: SCHEMA, entries: [] };
    }
    return parsed;
  } catch {
    return { schema: SCHEMA, entries: [] };
  }
}

function saveRaw(store: JournalStore) {
  try {
    // Cap: tieni solo le MAX_ENTRIES piu` recenti
    if (store.entries.length > MAX_ENTRIES) {
      store.entries = store.entries.slice(-MAX_ENTRIES);
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
  } catch { /* ignore */ }
}

export function writeEntry(e: Omit<JournalEntry, "at" | "date">): JournalEntry {
  const store = loadRaw();
  const full: JournalEntry = {
    ...e,
    at: Date.now(),
    date: todayUTC(),
  };
  store.entries.push(full);
  saveRaw(store);
  return full;
}

/** Tutte le entry ordinate desc (piu` recenti prima). */
export function readEntries(limit?: number): JournalEntry[] {
  const store = loadRaw();
  const sorted = store.entries.slice().sort((a, b) => b.at - a.at);
  return limit != null ? sorted.slice(0, limit) : sorted;
}

/** L'entry piu` recente (per la frase "ieri Nonno..." in Home). */
export function lastEntry(): JournalEntry | null {
  const e = readEntries(1);
  return e[0] ?? null;
}

/** Entries raggruppate per data (UTC), desc. */
export function entriesByDate(): { date: string; entries: JournalEntry[] }[] {
  const all = readEntries();
  const map = new Map<string, JournalEntry[]>();
  for (const e of all) {
    const arr = map.get(e.date) ?? [];
    arr.push(e);
    map.set(e.date, arr);
  }
  return Array.from(map.entries())
    .sort((a, b) => b[0].localeCompare(a[0]))
    .map(([date, entries]) => ({ date, entries }));
}

/** Esiste già una entry con questo kind+pattern_key per oggi? (dedup helper) */
export function hasEntryToday(kind: JournalKind, pattern_key?: string): boolean {
  const today = todayUTC();
  const store = loadRaw();
  return store.entries.some(
    (e) => e.date === today && e.kind === kind && e.pattern_key === pattern_key,
  );
}

// ---------------------------------------------------------------------------
// Helpers di scrittura "Nonno-style"
// ---------------------------------------------------------------------------

/**
 * Compone una frase Nonno per il risultato di una drill run.
 * Tutto deterministico — niente LLM qui.
 */
export function bodyForDrillRun(
  patternName: string,
  perfect: number,
  ok: number,
  wrong: number,
): string {
  const total = perfect + ok + wrong;
  if (perfect === total && total > 0) {
    return `Allenato "${patternName}" — ${total} su ${total} perfette. Bravo.`;
  }
  if (wrong === 0 && total > 0) {
    return `Allenato "${patternName}" — ${perfect} perfette, ${ok} giocabili. Buon lavoro.`;
  }
  if (perfect >= ok + wrong && total > 0) {
    return `Allenato "${patternName}" — ${perfect}/${total} perfette, ${wrong} sbagliate. Ci stiamo arrivando.`;
  }
  return `Allenato "${patternName}" — ${perfect}/${total} perfette, ${wrong} sbagliate. Da rivedere.`;
}

export function bodyForStreakMilestone(days: number): string {
  if (days === 7) return "Sette giorni di fila al tavolo. Si comincia a vedere.";
  if (days === 14) return "Due settimane senza saltare un giorno. La testa si sta facendo.";
  if (days === 30) return "Trenta giorni. Adesso sì che si lavora sul serio.";
  if (days === 60) return "Sessanta giorni. Pochi arrivano qui.";
  if (days === 100) return "Cento giorni. Sei un altro giocatore, lo vediamo nei dati.";
  return `${days} giorni di fila. Continua così.`;
}

export function bodyForPatternMastered(patternName: string): string {
  return `"${patternName}" non lo sbagli più. Per oggi non te lo propongo più — lo rivediamo tra qualche giorno per essere sicuri.`;
}

export function bodyForFirstDrill(patternName: string): string {
  return `Primo allenamento su "${patternName}". Questo è uno dei tuoi freni — lo rivedremo finché non lo togliamo.`;
}

export function bodyForGoalUpdated(target: number, timeClass: string): string {
  return `Hai aggiornato l'obiettivo: ${target} ${timeClass}. Da qui in poi tutto è tarato su quello.`;
}
