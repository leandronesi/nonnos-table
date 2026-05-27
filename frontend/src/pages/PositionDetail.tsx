import { useMemo, useState } from "react";
import { Link, useParams, Navigate } from "react-router-dom";
import { ChevronRight, ChevronLeft, ExternalLink, Clock, Layers, Dumbbell, X } from "lucide-react";
import { PositionPuzzle } from "../session/WarmupGuidato";
import type { PlayerModel, PositionRow } from "../types";
import { PageShell } from "./PageShell";
import { BoardView } from "../components/BoardView";
import { InfoHint } from "../components/InfoHint";
import { squaresOfSan, turnFromFen } from "../chess-utils";
import {
  buildPatterns, categoryColor, categoryLabel,
  avoidabilityOf, avoidabilityLabel, avoidabilityColor, drillValueOf,
} from "../patterns";

interface Props {
  pm: PlayerModel;
}

/**
 * Position detail — OOUX object page.
 *
 * URL: /positions/:gameId/:ply
 *
 * Core content visibili (Step 2 OOUX):
 *   - Diagramma + side-to-move
 *   - Contesto partita (data, avversario, apertura, fase)
 *   - Mossa giocata vs mossa giusta (con frecce sulla board)
 *   - Costo dell'errore (cp_loss)
 *   - Pattern collegato (chip linkato)
 *
 * Extra contestuali:
 *   - Mosse precedenti (prev_moves)
 *   - Tempo speso (spent_seconds)
 *   - Alternative "di attesa" Stockfish (waiting_moves)
 *   - Link alla partita su Chess.com
 *   - Difficolta` Maia (move_difficulty)
 */
export function PositionDetail({ pm }: Props) {
  const { gameId, ply } = useParams<{ gameId: string; ply: string }>();
  const plyNum = ply ? parseInt(ply, 10) : NaN;
  const position = useMemo<PositionRow | null>(() => {
    if (!gameId || !Number.isFinite(plyNum)) return null;
    const fromDrills = [...pm.drills, ...pm.turning_points].find(
      (p) => p.game_id === gameId && p.ply === plyNum,
    );
    if (fromDrills) return fromDrills;
    // Fallback: cerca tra le sample_positions delle pawn_structures (per la
    // pagina StructureDetail che linka a /positions/:gameId/:ply).
    const fromStructures = (pm.pawn_structures ?? [])
      .flatMap((s) => s.sample_positions ?? [])
      .find((p) => p.game_id === gameId && p.ply === plyNum);
    return (fromStructures as PositionRow | undefined) ?? null;
  }, [pm, gameId, plyNum]);

  const [retryOpen, setRetryOpen] = useState(false);

  // Se questa posizione appartiene alle sample_positions di una pawn_structure,
  // esponi prev/next per scorrere "in fila" le posizioni della serie.
  const seriesContext = useMemo(() => {
    if (!gameId || !Number.isFinite(plyNum)) return null;
    for (const s of pm.pawn_structures ?? []) {
      const samples = s.sample_positions ?? [];
      const idx = samples.findIndex((p) => p.game_id === gameId && p.ply === plyNum);
      if (idx !== -1) {
        return {
          structureKey: s.key,
          structureLabel: s.label_it,
          index: idx,
          total: samples.length,
          prev: idx > 0 ? samples[idx - 1] : null,
          next: idx < samples.length - 1 ? samples[idx + 1] : null,
        };
      }
    }
    return null;
  }, [pm, gameId, plyNum]);

  if (!position) return <Navigate to="/patterns" replace />;

  // Match pattern (se motif_label_it == pattern.label_it)
  const linkedPattern = useMemo(() => {
    if (!position.motif) return null;
    const all = buildPatterns(pm);
    return all.find((p) => p.shortKey === position.motif) ?? null;
  }, [pm, position]);

  const sideToMove = turnFromFen(position.fen_before);
  const playedSquares = squaresOfSan(position.fen_before, position.san);
  const bestSquares = position.best_san_sf
    ? squaresOfSan(position.fen_before, position.best_san_sf)
    : null;
  const lossPawns = (position.cp_loss / 100).toFixed(2);
  const diff = position.best_san_sf && position.best_san_sf !== position.san;

  const highlights: { square: string; color: string }[] = [];
  if (position.last_opp_from && position.last_opp_to) {
    highlights.push({ square: position.last_opp_from, color: "#fde04755" });
    highlights.push({ square: position.last_opp_to, color: "#fde04788" });
  }
  if (playedSquares) {
    highlights.push({ square: playedSquares.from, color: "#f43f5e44" });
    highlights.push({ square: playedSquares.to, color: "#f43f5e88" });
  }
  if (bestSquares && diff) {
    highlights.push({ square: bestSquares.from, color: "#34d39944" });
    highlights.push({ square: bestSquares.to, color: "#34d39988" });
  }
  const arrows: { from: string; to: string; color?: string }[] = [];
  if (position.last_opp_from && position.last_opp_to) {
    arrows.push({ from: position.last_opp_from, to: position.last_opp_to, color: "#fde047" });
  }
  if (playedSquares) {
    arrows.push({ from: playedSquares.from, to: playedSquares.to, color: "#f43f5e" });
  }
  if (bestSquares && diff) {
    arrows.push({ from: bestSquares.from, to: bestSquares.to, color: "#34d399" });
  }

  const moveNumber = position.move_number;
  const sideLabel = sideToMove === "white" ? "bianco" : "nero";
  const phaseLabel = ({
    opening: "Apertura",
    middlegame: "Mediogioco",
    endgame: "Finale",
  } as const)[position.phase];

  const subtitle =
    `${position.date ?? "?"} · vs ${position.opp_rating ?? "?"} · ` +
    `${position.opening ?? "?"} (${position.eco ?? "—"})`;

  return (
    <PageShell title={`Posizione ${moveNumber}. ${position.san}`} subtitle={subtitle}>
      <nav className="pattern-detail-breadcrumb" aria-label="Breadcrumb">
        {seriesContext ? (
          <>
            <Link to="/patterns">Freni</Link>
            <ChevronRight size={14} aria-hidden="true" />
            <Link to={`/strutture/${encodeURIComponent(seriesContext.structureKey)}`}>
              {seriesContext.structureLabel}
            </Link>
            <ChevronRight size={14} aria-hidden="true" />
          </>
        ) : linkedPattern ? (
          <>
            <Link to="/patterns">Pattern</Link>
            <ChevronRight size={14} aria-hidden="true" />
            <Link to={`/patterns/${encodeURIComponent(linkedPattern.key)}`}>{linkedPattern.name}</Link>
            <ChevronRight size={14} aria-hidden="true" />
          </>
        ) : (
          <>
            <Link to="/patterns">Pattern</Link>
            <ChevronRight size={14} aria-hidden="true" />
          </>
        )}
        <span>Mossa {moveNumber}</span>
      </nav>

      {seriesContext && (
        <nav className="position-series-nav" aria-label="Navigazione serie posizioni">
          {seriesContext.prev ? (
            <Link
              to={`/positions/${seriesContext.prev.game_id}/${seriesContext.prev.ply}`}
              className="position-series-btn"
              aria-label="Posizione precedente"
            >
              <ChevronLeft size={16} aria-hidden="true" />
              <span>Precedente</span>
            </Link>
          ) : (
            <span className="position-series-btn position-series-btn-disabled">
              <ChevronLeft size={16} aria-hidden="true" />
              <span>Precedente</span>
            </span>
          )}
          <div className="position-series-counter">
            <span className="position-series-counter-num">
              {seriesContext.index + 1} <span className="position-series-counter-tot">di {seriesContext.total}</span>
            </span>
            <span className="position-series-counter-lbl">in {seriesContext.structureLabel}</span>
          </div>
          {seriesContext.next ? (
            <Link
              to={`/positions/${seriesContext.next.game_id}/${seriesContext.next.ply}`}
              className="position-series-btn"
              aria-label="Posizione successiva"
            >
              <span>Successiva</span>
              <ChevronRight size={16} aria-hidden="true" />
            </Link>
          ) : (
            <span className="position-series-btn position-series-btn-disabled">
              <span>Successiva</span>
              <ChevronRight size={16} aria-hidden="true" />
            </span>
          )}
        </nav>
      )}

      <div className="position-detail-grid">
        <div className="position-detail-board-col">
          <div className="position-detail-board-wrap">
            <BoardView
              fen={position.fen_before}
              resetKey={`pos-${position.game_id}-${position.ply}`}
              orientation={position.my_color}
              size={460}
              draggable={false}
              highlights={highlights}
              arrows={arrows}
            />
          </div>
          <div className="position-detail-arrow-legend">
            {position.last_opp_from && (
              <span className="position-detail-arrow-item">
                <span className="position-detail-arrow-swatch" style={{ background: "#fde047" }} />
                Ultima mossa avversario {position.last_opp_san ? `(${position.last_opp_san})` : ""}
              </span>
            )}
            <span className="position-detail-arrow-item">
              <span className="position-detail-arrow-swatch" style={{ background: "#f43f5e" }} />
              Tu hai giocato {position.san}
            </span>
            {diff && position.best_san_sf && (
              <span className="position-detail-arrow-item">
                <span className="position-detail-arrow-swatch" style={{ background: "#34d399" }} />
                La mossa giusta era {position.best_san_sf}
              </span>
            )}
          </div>
        </div>

        <div className="position-detail-info-col">
          {/* HERO: side-to-move + costo */}
          <div className="position-detail-hero-card">
            <div className="label-eyebrow">Tocca a te</div>
            <h1 className="display-medium mt-2">Muove il {sideLabel}</h1>
            <p className="text-[color:var(--color-text-soft)] mt-1">
              {moveNumber}. {sideToMove === "white" ? "" : "..."} — mossa {position.ply}
            </p>

            {diff ? (
              <div className="position-detail-cost">
                <div>
                  <div className="position-detail-cost-num">−{lossPawns}</div>
                  <div className="position-detail-cost-label">
                    pedoni persi
                    <InfoHint text="Quanto la tua mossa ha peggiorato la valutazione della posizione (in valore di pedoni). Sotto 0.5 = imprecisione. Sopra 2 = errore grave." />
                  </div>
                </div>
                {(() => {
                  const av = avoidabilityOf(position);
                  if (av === "neutral") return null;
                  const col = avoidabilityColor(av);
                  return (
                    <div className="position-detail-avoidability" style={{ color: col, borderColor: `${col}55`, background: `${col}10` }}>
                      <div className="position-detail-avoidability-label">{avoidabilityLabel(av)}</div>
                      {drillValueOf(position) > 0 && (
                        <div className="position-detail-avoidability-dv">
                          drill value <strong>+{(drillValueOf(position) * 100).toFixed(0)}%</strong>
                        </div>
                      )}
                    </div>
                  );
                })()}
              </div>
            ) : (
              <div className="position-detail-cost position-detail-cost-ok">
                <div className="position-detail-cost-num" style={{ color: "#34d399" }}>OK</div>
                <div className="position-detail-cost-label">era proprio la mossa giusta</div>
              </div>
            )}
          </div>

          {/* MOVE DIFF */}
          {diff && (
            <div className="position-detail-diff">
              <div className="position-detail-diff-row position-detail-diff-mine">
                <div className="label-eyebrow">Hai giocato</div>
                <div className="position-detail-diff-san">{position.san}</div>
              </div>
              <div className="position-detail-diff-arrow">↓</div>
              <div className="position-detail-diff-row position-detail-diff-best">
                <div className="label-eyebrow">Era</div>
                <div className="position-detail-diff-san">{position.best_san_sf}</div>
                {position.pv_san_sf && (
                  <div className="position-detail-pv">
                    <div className="position-detail-pv-label">come continuava la linea giusta</div>
                    <div className="position-detail-pv-line">
                      {renderPv(position.pv_san_sf, position.move_number, position.my_color)}
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* CONTEXT */}
          <div className="position-detail-context">
            {linkedPattern && (
              <Link
                to={`/patterns/${encodeURIComponent(linkedPattern.key)}`}
                className="position-detail-chip"
                style={{
                  color: categoryColor(linkedPattern.category),
                  borderColor: `${categoryColor(linkedPattern.category)}55`,
                }}
              >
                <span
                  className="position-detail-chip-dot"
                  style={{ background: categoryColor(linkedPattern.category) }}
                />
                {linkedPattern.name}
                <span className="position-detail-chip-meta">
                  · {categoryLabel(linkedPattern.category)}
                </span>
              </Link>
            )}
            {!linkedPattern && position.motif_label_it && (
              <span className="position-detail-chip" style={{ color: "var(--color-text-soft)" }}>
                {position.motif_label_it}
              </span>
            )}
            <span className="position-detail-meta-pill">
              <Layers size={12} aria-hidden="true" /> {phaseLabel}
            </span>
            {typeof position.spent_seconds === "number" && (
              <span className="position-detail-meta-pill">
                <Clock size={12} aria-hidden="true" /> {position.spent_seconds}s
              </span>
            )}
            {typeof position.move_difficulty === "number" && (
              <span className="position-detail-meta-pill">
                Difficoltà {(position.move_difficulty * 100).toFixed(0)}%
                <InfoHint text="Percentuale di giocatori al tuo livello obiettivo che NON trovano la mossa giusta. Più alta = più difficile anche per chi vuoi diventare." />
              </span>
            )}
          </div>

          {/* PREV MOVES */}
          {position.prev_moves && position.prev_moves.length > 0 && (
            <div className="position-detail-prev">
              <div className="label-eyebrow">Le ultime mosse prima</div>
              <div className="position-detail-prev-line">
                {position.prev_moves.map((m, i) => (
                  <span key={i} className="position-detail-prev-san">{m}</span>
                ))}
                <span className="position-detail-prev-current">{position.san}</span>
              </div>
            </div>
          )}

          {/* WAITING MOVES */}
          {position.waiting_moves && position.waiting_moves.length > 0 && (
            <div className="position-detail-waiting">
              <div className="label-eyebrow">Alternative ragionevoli</div>
              <p className="text-xs text-[color:var(--color-text-soft)] mb-2">
                Se la mossa giusta era troppo difficile, queste perdono poco.
              </p>
              <div className="position-detail-waiting-list">
                {position.waiting_moves.map((wm, i) => (
                  <div key={i} className="position-detail-waiting-item">
                    <span className="font-mono font-semibold">{wm.san}</span>
                    <span className="text-xs text-[color:var(--color-text-soft)] font-mono">
                      −{(wm.cp_loss / 100).toFixed(2)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* CTA */}
          <div className="position-detail-cta-row">
            <button
              onClick={() => setRetryOpen(true)}
              className="btn btn-primary btn-lg inline-flex items-center gap-2"
            >
              <Dumbbell size={18} aria-hidden="true" />
              Riprova questa posizione
            </button>
            {position.url && (
              <a
                href={position.url}
                target="_blank"
                rel="noopener noreferrer"
                className="btn btn-ghost btn-lg inline-flex items-center gap-2"
              >
                Apri su Chess.com
                <ExternalLink size={14} />
              </a>
            )}
            {linkedPattern && (
              <Link
                to={`/patterns/${encodeURIComponent(linkedPattern.key)}`}
                className="btn btn-ghost btn-lg"
              >
                Vedi altre occorrenze
              </Link>
            )}
          </div>
        </div>
      </div>

      {retryOpen && (
        <div
          className="position-retry-overlay"
          role="dialog"
          aria-modal="true"
          aria-label="Riprova posizione"
          onClick={(e) => { if (e.target === e.currentTarget) setRetryOpen(false); }}
        >
          <div className="position-retry-panel">
            <button
              className="position-retry-close"
              onClick={() => setRetryOpen(false)}
              aria-label="Chiudi"
            >
              <X size={20} />
            </button>
            <PositionPuzzle
              position={position}
              patternLabel={linkedPattern?.name ?? position.motif_label_it ?? "Posizione"}
              withHint={false}
              introLines={["Riprova. Senza fretta — guarda i difensori prima di muovere."]}
              onNext={() => setRetryOpen(false)}
            />
          </div>
        </div>
      )}
    </PageShell>
  );
}

/**
 * Renderizza pv_san_sf (es. "Bb5 Nc6 O-O Bd6") come linea PGN numerata
 * "12... Bb5 13.Nc6 13...O-O 14.Bd6" partendo dal numero di mossa corrente.
 */
function renderPv(pv: string, startMoveNumber: number, myColor: "white" | "black") {
  const tokens = pv.split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return null;
  const elements: React.ReactNode[] = [];
  let moveNum = startMoveNumber;
  let sideIsWhite = myColor === "white";
  for (let i = 0; i < tokens.length; i++) {
    if (sideIsWhite) {
      elements.push(<span key={`n${i}`} className="position-detail-pv-num">{moveNum}.</span>);
    } else if (i === 0) {
      elements.push(<span key={`n${i}`} className="position-detail-pv-num">{moveNum}...</span>);
    }
    elements.push(<span key={`s${i}`} className="position-detail-pv-san">{tokens[i]}</span>);
    if (!sideIsWhite) moveNum += 1;
    sideIsWhite = !sideIsWhite;
  }
  return <>{elements}</>;
}
