import { Chessboard } from "react-chessboard";
import type { Color } from "../types";

interface Props {
  fen: string;
  size?: number;
  orientation?: Color;
  /** Square highlights, e.g. for "from" / "to" of the played and best move. */
  highlights?: { square: string; color: string }[];
  /** Arrows: from → to, optional color. */
  arrows?: { from: string; to: string; color?: string }[];
  onSquareClick?: (square: string) => void;
}

export function BoardView({
  fen,
  size = 320,
  orientation = "white",
  highlights,
  arrows,
  onSquareClick,
}: Props) {
  const squareStyles: Record<string, React.CSSProperties> = {};
  if (highlights) {
    for (const h of highlights) {
      squareStyles[h.square] = {
        background: `radial-gradient(circle, ${h.color} 0%, ${h.color}88 60%, transparent 70%)`,
        boxSizing: "border-box",
      };
    }
  }

  return (
    <div style={{ width: size, height: size }}>
      <Chessboard
        options={{
          position: fen,
          boardOrientation: orientation,
          allowDragging: false,
          showNotation: true,
          darkSquareStyle: { backgroundColor: "#2c3a55" },
          lightSquareStyle: { backgroundColor: "#a7b2c7" },
          boardStyle: {
            borderRadius: 10,
            boxShadow: "0 10px 30px rgba(0,0,0,0.4)",
          },
          squareStyles,
          arrows: (arrows || []).map((a) => ({
            startSquare: a.from,
            endSquare: a.to,
            color: a.color || "#22c55e",
          })),
          onSquareClick: onSquareClick
            ? ({ square }) => onSquareClick(square)
            : undefined,
        }}
      />
    </div>
  );
}
