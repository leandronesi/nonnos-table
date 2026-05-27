import { useEffect, useCallback } from "react";
import type { PlayerModel, PositionRow } from "../types";
import { BoardView } from "./BoardView";

// ============================================================================
// Helper: pick the worst positions from drills/turning_points
// ============================================================================

function pickMistakes(pm: PlayerModel): PositionRow[] {
  const all = [...(pm.drills || []), ...(pm.turning_points || [])];

  // Deduplicate by game_id+ply
  const seen = new Set<string>();
  const deduped = all.filter((p) => {
    const key = `${p.game_id}:${p.ply}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  // Filter real errors, relax threshold if not enough
  let filtered = deduped.filter((p) => p.cp_loss >= 200);
  if (filtered.length < 5) {
    filtered = deduped.filter((p) => p.cp_loss >= 100);
  }
  if (filtered.length === 0) {
    filtered = deduped;
  }

  // Sort worst first, take 7
  return [...filtered].sort((a, b) => b.cp_loss - a.cp_loss).slice(0, 7);
}

// ============================================================================
// Template-based coach line (no LLM call)
// ============================================================================

function mistakeCoachLine(p: PositionRow): string {
  const moveN = p.move_number;
  const san = p.san;
  const best = p.best_san_sf || "diversa";
  if (p.motif_hanging_piece) {
    return `Mossa ${moveN}: hai giocato ${san}, e quel pezzo è rimasto in presa. Lo perdi.`;
  }
  if (p.motif_fork) {
    return `Mossa ${moveN}: ${san} ha permesso la forchetta. Stesso tipo di errore.`;
  }
  if (p.motif_removed_defender) {
    return `Mossa ${moveN}: ${san} ha tolto il difensore di un pezzo. Poi non lo proteggevi più.`;
  }
  if (p.motif_back_rank) {
    return `Mossa ${moveN}: dopo ${san}, l'ottava era scoperta. Matto in vista.`;
  }
  if (p.motif_discovered_attack) {
    return `Mossa ${moveN}: ${san} ha aperto una linea che non vedevi. L'avversario è entrato.`;
  }
  return `Mossa ${moveN}: hai giocato ${san}. La mossa giusta era ${best}.`;
}

// ============================================================================
// Date formatter
// ============================================================================

function formatDateIt(iso: string | null): string {
  if (!iso) return "—";
  try {
    const d = new Date(iso);
    return d.toLocaleDateString("it-IT", { day: "numeric", month: "short" });
  } catch {
    return iso;
  }
}

// ============================================================================
// Highlights for last-opp-move (same as Home.tsx)
// ============================================================================

function buildHighlights(p: PositionRow) {
  if (p.last_opp_from && p.last_opp_to) {
    return [
      { square: p.last_opp_from, color: "#f4c95d44" },
      { square: p.last_opp_to, color: "#f4c95d88" },
    ];
  }
  return [];
}

function buildArrows(p: PositionRow) {
  if (p.last_opp_from && p.last_opp_to) {
    return [{ from: p.last_opp_from, to: p.last_opp_to, color: "#f4c95d" }];
  }
  return [];
}

// ============================================================================
// Main component
// ============================================================================

interface Props {
  pm: PlayerModel;
  currentIndex: number;
  onIndexChange: (i: number) => void;
  onClose: () => void;
}

export function MyMistakes({ pm, currentIndex, onIndexChange, onClose }: Props) {
  const mistakes = pickMistakes(pm);
  const total = mistakes.length;
  const position = mistakes[currentIndex] ?? null;

  const prev = useCallback(() => {
    onIndexChange(Math.max(0, currentIndex - 1));
  }, [currentIndex, onIndexChange]);

  const next = useCallback(() => {
    onIndexChange(Math.min(total - 1, currentIndex + 1));
  }, [currentIndex, total, onIndexChange]);

  // Keyboard navigation
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "ArrowLeft") { e.preventDefault(); prev(); }
      if (e.key === "ArrowRight") { e.preventDefault(); next(); }
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [prev, next, onClose]);

  if (total === 0) {
    return (
      <div className="mm-overlay" role="dialog" aria-modal="true" aria-label="Le tue cadute">
        <div className="mm-modal">
          <div className="mm-header">
            <span className="mm-chip">Nonno O.</span>
            <h2 className="mm-title">Le tue cadute</h2>
          </div>
          <p className="mm-empty">Nessuna posizione critica trovata nel player model.</p>
          <div className="mm-footer">
            <button type="button" className="mm-btn-close" onClick={onClose}>Chiudi</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      className="mm-overlay"
      role="dialog"
      aria-modal="true"
      aria-label="Le tue cadute"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="mm-modal">
        {/* Header */}
        <div className="mm-header">
          <div className="mm-header-top">
            <span className="mm-chip">Nonno O.</span>
            <span className="mm-counter" aria-live="polite">{currentIndex + 1} / {total}</span>
          </div>
          <h2 className="mm-title">Le tue cadute</h2>
          <p className="mm-subtitle">
            {total === 7 ? "Sette" : String(total)} posizioni che ti hanno fatto perdere materiale
          </p>
        </div>

        {/* Body */}
        {position && (
          <div className="mm-body">
            {/* Board */}
            <div className="mm-board-wrap">
              <BoardView
                fen={position.fen_before}
                orientation={position.my_color}
                size={280}
                resetKey={`mm:${position.game_id}:${position.ply}`}
                highlights={buildHighlights(position)}
                arrows={buildArrows(position)}
              />
            </div>

            {/* Info */}
            <div className="mm-info">
              <div className="mm-meta">
                <span className="mm-meta-date">{formatDateIt(position.date)}</span>
                {position.opp_rating != null && (
                  <span className="mm-meta-opp">vs {position.opp_rating}</span>
                )}
              </div>

              <div className="mm-moves">
                <div className="mm-move-row">
                  <span className="mm-move-label">Hai giocato</span>
                  <span className="mm-move-san mm-move-bad">{position.san}</span>
                </div>
                <div className="mm-move-row">
                  <span className="mm-move-label">Il giusto era</span>
                  <span className="mm-move-san mm-move-good">
                    {position.best_san_sf ?? "…"}
                  </span>
                </div>
              </div>

              {position.cp_loss > 0 && (
                <div className="mm-cploss">
                  <span className="mm-cploss-label">perdita</span>
                  <span className="mm-cploss-val">−{position.cp_loss} cp</span>
                </div>
              )}

              <p className="mm-voice">{mistakeCoachLine(position)}</p>

              {position.motif_label_it && (
                <span className="mm-motif-badge">{position.motif_label_it}</span>
              )}
            </div>
          </div>
        )}

        {/* Navigation */}
        <div className="mm-nav">
          <button
            type="button"
            className="mm-btn-nav"
            onClick={prev}
            disabled={currentIndex === 0}
            aria-label="Posizione precedente"
          >
            ◀ Precedente
          </button>

          <div className="mm-dots" aria-hidden="true">
            {mistakes.map((_, i) => (
              <button
                key={i}
                type="button"
                className={`mm-dot${i === currentIndex ? " mm-dot-active" : ""}`}
                onClick={() => onIndexChange(i)}
                aria-label={`Vai alla posizione ${i + 1}`}
              />
            ))}
          </div>

          <button
            type="button"
            className="mm-btn-nav"
            onClick={next}
            disabled={currentIndex === total - 1}
            aria-label="Posizione successiva"
          >
            Successiva ▶
          </button>
        </div>

        {/* Footer */}
        <div className="mm-footer">
          <button type="button" className="mm-btn-close" onClick={onClose}>
            Chiudi
          </button>
        </div>
      </div>
    </div>
  );
}
