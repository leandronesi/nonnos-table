import { Chess } from "chess.js";
export function playbackFrames(fen: string, moves: (string | null | undefined)[]) {
 const board = new Chess(fen);
 const frames = [{ fen, from: "", to: "" }];
 for (const uci of moves) {
  if (!uci) break;
  try {
   const move = board.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] });
   if (!move) break;
   frames.push({ fen: board.fen(), from: move.from, to: move.to });
  } catch { break; }
 }
 return frames;
}
