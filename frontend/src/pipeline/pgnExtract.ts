import { Chess } from "chess.js";

function parseClkSeconds(clk: string): number | null {
  const match = clk.trim().match(/^(\d+):(\d{2}):(\d{2}(?:\.\d+)?)$/);
  if (!match) return null;
  const hours = Number.parseInt(match[1], 10);
  const minutes = Number.parseInt(match[2], 10);
  const seconds = Number.parseFloat(match[3]);
  if (minutes >= 60 || seconds >= 60) return null;
  return hours * 3600 + minutes * 60 + seconds;
}

function clockFromComment(comment: string | undefined): number | null {
  if (!comment) return null;
  const match = comment.match(/\[%clk\s+([^\]]+)\]/);
  return match ? parseClkSeconds(match[1]) : null;
}

/**
 * Scorre il movetext raw e associa i commenti clock ai ply mainline in ordine.
 * Non usa il comment store FEN-keyed di chess.js: una ripetizione puo' visitare
 * la stessa FEN con clock diversi. Varianti tra parentesi e commenti `;` sono
 * ignorati senza alterare l'allineamento.
 */
function extractMainlineClocks(pgn: string): Array<number | null> {
  const movetext = pgn.replace(/^\s*\[[^\r\n]*\]\s*$/gm, " ");
  const clocks: Array<number | null> = [];
  let variationDepth = 0;
  let token = "";
  let lastMoveIndex = -1;

  const flushToken = () => {
    if (variationDepth > 0 || token.length === 0) {
      token = "";
      return;
    }
    let candidate = token.trim();
    token = "";
    candidate = candidate.replace(/^\d+\.(?:\.\.)?/, "");
    if (
      candidate.length === 0 ||
      candidate.startsWith("$") ||
      candidate === "..." ||
      candidate === "e.p." ||
      candidate === "ep" ||
      /^(?:1-0|0-1|1\/2-1\/2|\*)$/.test(candidate)
    ) {
      return;
    }
    clocks.push(null);
    lastMoveIndex = clocks.length - 1;
  };

  for (let i = 0; i < movetext.length; i++) {
    const ch = movetext[i];
    if (ch === "{") {
      flushToken();
      const end = movetext.indexOf("}", i + 1);
      const stop = end >= 0 ? end : movetext.length - 1;
      if (variationDepth === 0 && lastMoveIndex >= 0) {
        const clock = clockFromComment(movetext.slice(i + 1, stop));
        if (clock !== null) clocks[lastMoveIndex] = clock;
      }
      i = stop;
      continue;
    }
    if (ch === ";") {
      flushToken();
      const end = movetext.indexOf("\n", i + 1);
      i = end >= 0 ? end : movetext.length;
      continue;
    }
    if (ch === "(") {
      flushToken();
      variationDepth++;
      continue;
    }
    if (ch === ")") {
      token = "";
      variationDepth = Math.max(0, variationDepth - 1);
      continue;
    }
    if (/\s/.test(ch)) {
      flushToken();
      continue;
    }
    if (variationDepth === 0) token += ch;
  }
  flushToken();
  return clocks;
}

/**
 * Estrae mainline, header e un clock per ogni ply. L'allineamento deriva dal
 * movetext mainline raw (non dal FEN), quindi gestisce ripetizioni e tag mancanti.
 */
export function extractMoves(pgn: string): {
  sanList: string[];
  headers: Record<string, string>;
  clocks: Array<number | null>;
} {
  const chess = new Chess();
  try {
    chess.loadPgn(pgn, { strict: false });
  } catch {
    return { sanList: [], headers: {}, clocks: [] };
  }

  const history = chess.history({ verbose: true });
  const sanList = history.map((move) => move.san);
  const rawClocks = extractMainlineClocks(pgn);

  return {
    sanList,
    headers: chess.header() as Record<string, string>,
    clocks: sanList.map((_, index) => rawClocks[index] ?? null),
  };
}
