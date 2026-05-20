import { Chess } from "chess.js";

/** Given a FEN + a SAN, returns the from/to squares (or null if illegal). */
export function squaresOfSan(fen: string, san: string): { from: string; to: string } | null {
  try {
    const c = new Chess(fen);
    const move = c.move(san, { strict: false } as never);
    if (!move) return null;
    return { from: move.from, to: move.to };
  } catch {
    return null;
  }
}

/** From which color moves in this FEN. */
export function turnFromFen(fen: string): "white" | "black" {
  const parts = fen.split(" ");
  return parts[1] === "b" ? "black" : "white";
}

/** Apply a list of SAN strings to a FEN, returning the resulting FEN. */
export function applyPv(fen: string, sans: string[]): string {
  try {
    const c = new Chess(fen);
    for (const s of sans) {
      const ok = c.move(s, { strict: false } as never);
      if (!ok) break;
    }
    return c.fen();
  } catch {
    return fen;
  }
}

/** Apply a list of SAN moves and return the FEN after each (length = sans.length + 1). */
export function fensOfGameSans(sans: string[]): string[] {
  const c = new Chess();
  const out: string[] = [c.fen()];
  for (const s of sans) {
    try {
      const ok = c.move(s, { strict: false } as never);
      if (!ok) break;
    } catch {
      break;
    }
    out.push(c.fen());
  }
  return out;
}

/** Format centipawn eval as +/-X.XX or '#N' for mates. */
export function fmtEval(cp: number): string {
  if (cp >= 1000) return "+M";
  if (cp <= -1000) return "-M";
  const v = cp / 100;
  if (v === 0) return "0.00";
  return (v > 0 ? "+" : "") + v.toFixed(2);
}
