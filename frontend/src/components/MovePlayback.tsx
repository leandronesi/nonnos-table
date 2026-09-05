import { useState } from "react";
import { playbackFrames } from "../session/movePlayback";
import { BoardView } from "./BoardView";
import { tr } from "../i18n/lang";

export interface PlaybackLine { label: string; moves: (string | null | undefined)[] }

/** Replay only supplied legal moves. Never fabricate a continuation. */
export function MovePlayback({ fen, orientation, lines, initialPly = 0 }: {
  fen: string; orientation: "white" | "black"; lines: PlaybackLine[]; initialPly?: number;
}) {
  const [selected, setSelected] = useState(0);
  const [ply, setPly] = useState(initialPly);
  const frames = playbackFrames(fen, (lines[selected] ?? lines[0])?.moves ?? []);
  const index = Math.min(ply, frames.length - 1);
  const current = frames[index];
  return <div className="move-playback" data-position={current.fen} tabIndex={0} aria-label={tr("Riproduzione delle mosse", "Move playback")}
    onKeyDown={event => {
      if (event.key === "ArrowRight") { event.preventDefault(); setPly(Math.min(index + 1, frames.length - 1)); }
      if (event.key === "ArrowLeft") { event.preventDefault(); setPly(Math.max(0, index - 1)); }
    }}>
    {lines.length > 1 && <div className="pattern-choice-row">{lines.map((line, i) =>
      <button type="button" key={line.label} aria-pressed={selected === i} onClick={() => { setSelected(i); setPly(0); }}>{line.label}</button>)}</div>}
    <BoardView fen={current.fen} orientation={orientation} size={520} animate
      highlights={current.from ? [current.from, current.to].map(square => ({ square, color: "#c28b40" })) : []} />
    <div className="playback-controls">
      <button type="button" aria-label={tr("Mossa precedente", "Previous move")} disabled={index === 0} onClick={() => setPly(index - 1)}>←</button>
      <span role="status">{index === 0 ? tr("Prima della scelta", "Before the choice") : index === 1 ? tr("La mossa", "The move") : tr("La risposta", "The reply")}</span>
      <button type="button" aria-label={tr("Mossa successiva", "Next move")} disabled={index === frames.length - 1} onClick={() => setPly(index + 1)}>→</button>
    </div>
  </div>;
}
