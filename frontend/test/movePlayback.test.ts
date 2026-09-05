import { describe, it, expect } from "vitest";
import { Chess } from "chess.js";
import { playbackFrames } from "../src/session/movePlayback";
describe("legal board playback", () => {
 it.each([
  ["r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1", "e1g1", "g1", "k", "f1", "r"],
  ["4k3/P7/8/8/8/8/8/4K3 w - - 0 1", "a7a8n", "a8", "n", "a7", null],
  ["4k3/8/8/3pP3/8/8/8/4K3 w - d6 0 1", "e5d6", "d6", "p", "d5", null],
 ])("applies special moves from %s", (fen, move, square, piece, other, otherPiece) => {
  const frames=playbackFrames(fen!,[move]);expect(frames).toHaveLength(2);
  const result=new Chess(frames[1].fen);
  expect(result.get(square as any)?.type ?? null).toBe(piece);
  expect(result.get(other as any)?.type ?? null).toBe(otherPiece);
  expect(frames[0].fen).toBe(fen);
 });
 it("stops at an illegal or missing continuation",()=>{
  const fen=new Chess().fen();
  expect(playbackFrames(fen,["e2e4","e7e3","g1f3"])).toHaveLength(2);
  expect(playbackFrames(fen,["e2e4",null,"g1f3"])).toHaveLength(2);
 });
});
