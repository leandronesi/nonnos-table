/**
 * Drill queue — coda di pattern selezionati dall'utente per un allenamento
 * sequenziale. Vive in localStorage per sopravvivere ai refresh durante
 * l'allenamento.
 *
 * Workflow:
 *   1. utente seleziona N pattern in /patterns
 *   2. click "Inizia allenamento" → setQueue([key1, key2, ...]) + naviga a /patterns/key1/drill
 *   3. fine drill di key1 → consumeCurrent() rimuove key1 → naviga a /patterns/key2/drill
 *   4. coda vuota → recap finale, clearQueue()
 */

const STORAGE_KEY = "mygotham_drill_queue";

export interface DrillQueue {
  /** Array di pattern key in ordine di esecuzione. Il primo è il "current". */
  keys: string[];
  /** Chiavi gia` completate in questo run (per recap finale). */
  completed: string[];
  /** Quando la coda è stata avviata. */
  started_at: number;
}

export function loadQueue(): DrillQueue | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as DrillQueue;
    if (!parsed.keys || parsed.keys.length === 0) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function saveQueue(q: DrillQueue) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(q));
  } catch { /* ignore */ }
}

export function startQueue(keys: string[]): DrillQueue {
  const q: DrillQueue = {
    keys: keys.slice(),
    completed: [],
    started_at: Date.now(),
  };
  saveQueue(q);
  return q;
}

/**
 * Marca il pattern corrente come completato e ritorna il prossimo da fare.
 * Se non c'è un prossimo, ritorna null e clearQueue().
 */
export function advanceQueue(currentKey: string): { next: string | null; completed: string[] } {
  const q = loadQueue();
  if (!q) return { next: null, completed: [currentKey] };
  // Rimuovi currentKey dalle keys (se è in testa)
  const idx = q.keys.indexOf(currentKey);
  const remaining = idx >= 0 ? q.keys.slice(idx + 1) : q.keys.slice();
  const completed = [...q.completed, currentKey];
  if (remaining.length === 0) {
    clearQueue();
    return { next: null, completed };
  }
  const next: DrillQueue = { keys: remaining, completed, started_at: q.started_at };
  saveQueue(next);
  return { next: remaining[0], completed };
}

export function clearQueue() {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch { /* ignore */ }
}

/** Ritorna posizione 1-based dell'elemento nella sequenza completa, e totale. */
export function queuePosition(currentKey: string): { current: number; total: number } | null {
  const q = loadQueue();
  if (!q) return null;
  const total = q.completed.length + q.keys.length;
  const idx = q.keys.indexOf(currentKey);
  if (idx < 0) return null;
  return { current: q.completed.length + idx + 1, total };
}
