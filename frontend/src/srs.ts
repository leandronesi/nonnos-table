/**
 * Spaced Repetition System (minimal) per i drill.
 *
 * Algoritmo semplificato (Leitner-style):
 *   - Nuova posizione → box 0 (intervallo: subito)
 *   - Verdict "perfect" → +1 box, intervallo raddoppia
 *   - Verdict "ok"      → +0 (resta), intervallo +1 giorno
 *   - Verdict "wrong"   → reset a box 0 (intervallo 1 giorno)
 *
 * Box → giorni: [0, 1, 3, 7, 14, 30, 60]
 *
 * Storage: localStorage key `mygotham_srs_v1`, valore JSON
 *   { "<game_id>:<ply>": { box, lastSeen, nextDue, attempts, lastVerdict } }
 *
 * Tutto frontend-only. Quando passeremo SaaS, lo migreremo a tabella DB.
 */

export type SrsVerdict = "perfect" | "ok" | "wrong";

export interface SrsCard {
  box: number;
  lastSeen: number;   // epoch ms
  nextDue: number;    // epoch ms
  attempts: number;
  lastVerdict: SrsVerdict | null;
}

const STORAGE_KEY = "mygotham_srs_v1";
const BOX_INTERVALS_DAYS = [0, 1, 3, 7, 14, 30, 60];
const MS_PER_DAY = 86_400_000;

function readAll(): Record<string, SrsCard> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    return JSON.parse(raw) as Record<string, SrsCard>;
  } catch {
    return {};
  }
}

function writeAll(all: Record<string, SrsCard>): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
  } catch {
    // localStorage pieno → silent
  }
}

export function getCard(id: string): SrsCard | null {
  const all = readAll();
  return all[id] ?? null;
}

export function recordVerdict(id: string, verdict: SrsVerdict): SrsCard {
  const all = readAll();
  const prev = all[id] ?? {
    box: 0, lastSeen: 0, nextDue: 0, attempts: 0, lastVerdict: null as SrsVerdict | null,
  };
  let nextBox = prev.box;
  if (verdict === "perfect") {
    nextBox = Math.min(prev.box + 1, BOX_INTERVALS_DAYS.length - 1);
  } else if (verdict === "wrong") {
    nextBox = 0;
  } // ok = resta

  const intervalDays = BOX_INTERVALS_DAYS[nextBox];
  const now = Date.now();
  const next: SrsCard = {
    box: nextBox,
    lastSeen: now,
    nextDue: now + intervalDays * MS_PER_DAY,
    attempts: prev.attempts + 1,
    lastVerdict: verdict,
  };
  all[id] = next;
  writeAll(all);
  return next;
}

/**
 * Riordina i drill: prima i "due" (nextDue <= now), poi i "nuovi" (mai visti),
 * poi quelli non-due ordinati per box ascendente (i piu` recenti sopra).
 *
 * Pure function — non tocca localStorage.
 */
export function rankDrills<T extends { game_id: string; ply: number }>(drills: T[]): T[] {
  const all = readAll();
  const now = Date.now();
  const annotated = drills.map((d) => {
    const id = `${d.game_id}:${d.ply}`;
    const card = all[id];
    const status = !card ? "new" : card.nextDue <= now ? "due" : "future";
    return { d, card, status };
  });
  const order = { due: 0, new: 1, future: 2 } as const;
  annotated.sort((a, b) => {
    const oa = order[a.status as keyof typeof order];
    const ob = order[b.status as keyof typeof order];
    if (oa !== ob) return oa - ob;
    // dentro lo stesso status: due prima (piu` overdue) | future (meno overdue)
    if (a.status === "due") return (a.card?.nextDue ?? 0) - (b.card?.nextDue ?? 0);
    if (a.status === "future") return (a.card?.box ?? 0) - (b.card?.box ?? 0);
    return 0;
  });
  return annotated.map((x) => x.d);
}

/**
 * Etichetta humano-leggibile per un drill (per chip UI).
 */
export function srsLabel(id: string): { text: string; tone: "new" | "due" | "future" } {
  const card = getCard(id);
  if (!card) return { text: "nuovo", tone: "new" };
  const now = Date.now();
  if (card.nextDue <= now) return { text: `da ripassare`, tone: "due" };
  const days = Math.max(1, Math.ceil((card.nextDue - now) / MS_PER_DAY));
  return { text: `box ${card.box} · tra ${days}g`, tone: "future" };
}

export function resetSrs(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch { /* ignore */ }
}
