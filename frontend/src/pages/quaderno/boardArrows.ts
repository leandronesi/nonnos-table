import { Chess } from "chess.js";

/** Converte una mossa UCI (es. "f1d1") in SAN ("Rd1") data la posizione FEN. Best-effort: se fallisce torna l'UCI. */
export function uciToSan(fenBefore: string, uci: string | null): string {
  if (!uci || uci.length < 4) return uci ?? "—";
  try {
    const c = new Chess(fenBefore);
    const mv = c.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci.length > 4 ? uci.slice(4, 5) : undefined });
    return (mv as unknown as { san: string }).san ?? uci;
  } catch {
    return uci;
  }
}

/** UCI "g1f3" → caselle from/to per le frecce di BoardView. */
export function uciToArrow(
  uci: string | null,
  color: string,
): { from: string; to: string; color: string } | null {
  if (!uci || uci.length < 4) return null;
  return { from: uci.slice(0, 2), to: uci.slice(2, 4), color };
}

/** cp_loss → pedoni, cappato a 10 (anche dati vecchi non-cappati restano leggibili). */
export function cpToPawns(cp: number): string {
  return (Math.min(1000, Math.max(0, cp)) / 100).toFixed(1);
}
