/**
 * MomentoDelGiorno — the "spine made position" block on TavoloHome.
 *
 * Selects the single best Momento from aggregates.cadute (or .examples)
 * and displays it with a mini board + deterministic Nonno voice triplet.
 *
 * Selection logic (from SPRINT_OOUX.md §5 block 3):
 *   1. Among examples with priority_score === 3, pick max drill_value.
 *   2. Fallback (no Maia): pick max cp_loss from all examples.
 *
 * Voice triplet — shown only when the underlying data is present:
 *   a) tempo: spent_seconds when not null.
 *   b) Avversario: p_target_plays_best_sf AND p_mine_plays_best_sf when both not null.
 *   c) best move: always shown when best_uci is present.
 *
 * Clicking the card navigates to /sessione (the "COME" antipasto).
 */

import { useNavigate } from "react-router-dom";
import type { PositionExample } from "../pipeline/aggregate";
import { BoardView } from "./BoardView";
import { uciToArrow, uciToSan } from "../pages/quaderno/boardArrows";

// ── Selection ─────────────────────────────────────────────────────────────────

/**
 * Picks the best Momento from a pool.
 * Returns null only if the pool is empty.
 */
export function selectMomento(
  pool: PositionExample[],
): PositionExample | null {
  if (pool.length === 0) return null;

  // Path 1: Maia ran — priority_score === 3, max drill_value.
  const moneyPool = pool.filter(
    (p) => p.priority_score === 3 && p.drill_value != null,
  );
  if (moneyPool.length > 0) {
    return moneyPool.reduce((best, p) =>
      (p.drill_value ?? -Infinity) > (best.drill_value ?? -Infinity) ? p : best,
    );
  }

  // Path 2: Maia not available (or no priority_score === 3) — max cp_loss.
  return pool.reduce((best, p) => (p.cp_loss > best.cp_loss ? p : best));
}

// ── Voice lines (deterministic from data) ─────────────────────────────────────

function buildTempoLine(spent_seconds: number | null | undefined): string | null {
  if (spent_seconds == null) return null;
  return `In ${spent_seconds} secondi.`;
}

function buildAvversarioLine(
  p_target: number | null | undefined,
  p_mine: number | null | undefined,
  targetRating: number | null,
): string | null {
  if (p_target == null || p_mine == null) return null;
  const targetN = Math.round(p_target * 10);
  const mineN = Math.round(p_mine * 10);
  const opener =
    targetRating != null && targetRating > 0
      ? `Uno al tuo ${targetRating} la trova ${targetN} volte su 10.`
      : `Il giocatore che vuoi diventare la trova ${targetN} volte su 10.`;
  const mineClause =
    mineN === 0
      ? "Tu, oggi, nemmeno una."
      : mineN === 1
        ? "Tu, oggi, una."
        : `Tu, oggi, ${mineN}.`;
  return `${opener} ${mineClause}`;
}

function buildBestMoveLine(
  fenBefore: string,
  best_uci: string | null | undefined,
): string | null {
  if (!best_uci) return null;
  const san = uciToSan(fenBefore, best_uci);
  return `La mossa era ${san}.`;
}

// ── Component ─────────────────────────────────────────────────────────────────

interface MomentoDelGiornoProps {
  /**
   * Combined pool: prefer aggregates.cadute, fallback to aggregates.examples.
   * The component itself runs the selection logic.
   */
  pool: PositionExample[];
  /** Player's goal target rating, used in the Avversario voice line. */
  targetRating: number | null;
}

export function MomentoDelGiorno({ pool, targetRating }: MomentoDelGiornoProps) {
  const nav = useNavigate();
  const momento = selectMomento(pool);

  if (!momento) return null;

  // Board arrows: played = red, best = green.
  const arrowPlayed = uciToArrow(momento.played_uci, "rgba(239,68,68,0.85)");
  const arrowBest = uciToArrow(momento.best_uci ?? null, "rgba(34,197,94,0.85)");
  const arrows = [arrowPlayed, arrowBest].filter(
    Boolean,
  ) as { from: string; to: string; color: string }[];

  // Voice triplet — only lines that are truly available.
  const tempoLine = buildTempoLine(momento.spent_seconds);
  const avversarioLine = buildAvversarioLine(
    momento.p_target_plays_best_sf,
    momento.p_mine_plays_best_sf,
    targetRating,
  );
  const bestMoveLine = buildBestMoveLine(momento.fen_before, momento.best_uci);

  const hasVoice = tempoLine || avversarioLine || bestMoveLine;

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => nav("/sessione", { state: { focusKey: `${momento.fen_before}:${momento.ply}` } })}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") nav("/sessione", { state: { focusKey: `${momento.fen_before}:${momento.ply}` } });
      }}
      style={{
        background: "var(--color-surface)",
        border: "1px solid var(--color-line)",
        borderRadius: "14px",
        padding: "clamp(20px, 4vw, 28px)",
        cursor: "pointer",
        transition: "border-color 160ms cubic-bezier(0.23,1,0.32,1)",
      }}
      onMouseEnter={(e) => {
        (e.currentTarget as HTMLDivElement).style.borderColor =
          "var(--color-line-strong)";
      }}
      onMouseLeave={(e) => {
        (e.currentTarget as HTMLDivElement).style.borderColor =
          "var(--color-line)";
      }}
    >
      {/* Eyebrow */}
      <div className="tt-eyebrow" style={{ marginBottom: "1rem" }}>
        Il momento di oggi
      </div>

      {/* Board + voice side by side on wider screens */}
      <div
        style={{
          display: "flex",
          gap: "1.25rem",
          alignItems: "flex-start",
          flexWrap: "wrap",
        }}
      >
        {/* Board */}
        <div style={{ flexShrink: 0 }}>
          <BoardView
            fen={momento.fen_before}
            orientation={momento.color}
            size={160}
            arrows={arrows}
          />
        </div>

        {/* Voice + meta */}
        <div style={{ flex: 1, minWidth: "180px" }}>
          {/* Phase chip */}
          <div style={{ marginBottom: "0.75rem" }}>
            <span
              className="tt-chip"
              style={{
                background: "rgba(96,165,250,0.1)",
                color: "var(--color-info, #60a5fa)",
                textTransform: "capitalize",
              }}
            >
              {momento.phase}
            </span>
          </div>

          {/* Voice triplet */}
          {hasVoice && (
            <div
              style={{
                fontSize: "0.88rem",
                lineHeight: 1.65,
                color: "var(--color-text-soft)",
                display: "flex",
                flexDirection: "column",
                gap: "0.35rem",
              }}
            >
              {/* a) tempo */}
              {tempoLine && (
                <p style={{ margin: 0, color: "var(--color-text-soft)" }}>
                  {tempoLine}
                </p>
              )}

              {/* b) Avversario — twilight tint when drill_value data present */}
              {avversarioLine && (
                <p
                  style={{
                    margin: 0,
                    color: momento.drill_value != null
                      ? "var(--color-brand-soft)"
                      : "var(--color-text-soft)",
                  }}
                >
                  {avversarioLine}
                </p>
              )}

              {/* c) best move — mono */}
              {bestMoveLine && (
                <p style={{ margin: 0, color: "var(--color-text)" }}>
                  <span className="font-mono" style={{ fontWeight: 600 }}>
                    {bestMoveLine}
                  </span>
                </p>
              )}
            </div>
          )}

        </div>
      </div>

      {/* Subtle CTA hint */}
      <div
        style={{
          marginTop: "1rem",
          fontSize: "0.72rem",
          color: "var(--color-muted)",
          letterSpacing: "0.08em",
          textTransform: "uppercase",
          fontWeight: 700,
        }}
      >
        Sediamoci su questa
      </div>
    </div>
  );
}
