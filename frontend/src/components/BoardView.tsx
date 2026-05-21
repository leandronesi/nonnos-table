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
  /** Se vuoi che l'utente possa muovere i pezzi. Drop ritorna true se la mossa è legale/accettata. */
  draggable?: boolean;
  onPieceDrop?: (from: string, to: string, piece: string) => boolean | Promise<boolean>;
  onSquareClick?: (square: string) => void;
  /** Key per forzare re-mount del Chessboard (es. cambio puzzle). Se non passata, usa fen. */
  resetKey?: string;
}

export function BoardView({
  fen,
  size = 320,
  orientation = "white",
  highlights,
  arrows,
  draggable = false,
  onPieceDrop,
  onSquareClick,
  resetKey,
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

  // react-chessboard v5 mantiene gli arrows nel suo state interno quando cambia
  // `position`. Forziamo il reset re-montando il componente con una key dipendente
  // dal FEN, e usiamo anche le opzioni dedicate alla pulizia.
  return (
    <div style={{ width: size, height: size }}>
      <Chessboard
        key={resetKey ?? fen}
        options={{
          position: fen,
          boardOrientation: orientation,
          allowDragging: draggable,
          showNotation: true,
          clearArrowsOnPositionChange: true,
          clearArrowsOnClick: true,
          darkSquareStyle: { backgroundColor: "#2c3a55" },
          lightSquareStyle: { backgroundColor: "#a7b2c7" },
          boardStyle: {
            borderRadius: 12,
            boxShadow: "0 10px 30px rgba(0,0,0,0.4)",
          },
          squareStyles,
          arrows: (arrows || []).map((a) => ({
            startSquare: a.from,
            endSquare: a.to,
            color: a.color || "#22c55e",
          })),
          onSquareClick: onSquareClick ? ({ square }) => onSquareClick(square) : undefined,
          onPieceDrop: onPieceDrop
            ? ({ sourceSquare, targetSquare, piece }) => {
                if (!sourceSquare || !targetSquare) return false;
                const result = onPieceDrop(
                  sourceSquare,
                  targetSquare,
                  (piece as unknown as { pieceType?: string })?.pieceType || "",
                );
                if (typeof result === "boolean") return result;
                // async case: ritorniamo true per accettare l'animazione, l'aggiornamento
                // della posizione avverrà dal parent component
                return true;
              }
            : undefined,
        }}
      />
    </div>
  );
}
