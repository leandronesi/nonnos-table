import { useMemo } from "react";
import { Link, useParams, Navigate } from "react-router-dom";
import { ChevronRight, ExternalLink, Layers, BookOpen, Target } from "lucide-react";
import type { PlayerModel, PawnStructure } from "../types";
import { PageShell } from "./PageShell";
import { BoardView } from "../components/BoardView";

interface Props {
  pm: PlayerModel;
}

/**
 * StructureDetail — la struttura pedonale come oggetto navigabile.
 *
 * URL: /strutture/:key
 *
 * Risponde alla domanda: "cosa significa questa posizione? quali aperture mi
 * ci portano? in quali partite ci sono finito? quali sono le posizioni
 * concrete in cui ho sbagliato?"
 *
 * Sezioni:
 *   1. Hero (label + win-rate + n_games + dominant_motif)
 *   2. Sample board (prima sample_position = la "faccia" della struttura)
 *   3. Aperture che ti ci portano (openings_breakdown, top 8)
 *   4. Le partite recenti (games_sample, link a Chess.com)
 *   5. Le posizioni concrete (sample_positions, click → /positions/:gameId/:ply)
 */
export function StructureDetail({ pm }: Props) {
  const { key } = useParams<{ key: string }>();
  const structure = useMemo<PawnStructure | null>(() => {
    if (!key || !pm.pawn_structures) return null;
    return pm.pawn_structures.find((s) => s.key === key) ?? null;
  }, [pm, key]);

  if (!structure) return <Navigate to="/patterns" replace />;

  const wrPct = structure.win_rate != null ? Math.round(structure.win_rate * 100) : null;
  const wrTone = wrPct == null ? "neutral" : wrPct < 35 ? "bad" : wrPct < 50 ? "warn" : "good";
  const cpLossPawns = (structure.avg_cp_loss / 100).toFixed(1);

  const sample = structure.sample_positions?.[0] ?? null;
  const openings = structure.openings_breakdown ?? [];
  const games = structure.games_sample ?? [];
  const positions = structure.sample_positions ?? [];

  const subtitle = `${structure.n_games} partite · ${structure.n_positions} posizioni di mediogioco`;

  return (
    <PageShell title={structure.label_it} subtitle={subtitle}>
      <nav className="pattern-detail-breadcrumb" aria-label="Breadcrumb">
        <Link to="/patterns">Freni</Link>
        <ChevronRight size={14} aria-hidden="true" />
        <span>Strutture</span>
        <ChevronRight size={14} aria-hidden="true" />
        <span>{structure.label_it}</span>
      </nav>

      <section className={`structure-detail-hero structure-row-${wrTone}`}>
        <div className="structure-detail-hero-text">
          <div className="label-eyebrow">Struttura pedonale</div>
          <h1 className="display-medium mt-2">{structure.label_it}</h1>
          <p className="structure-detail-hero-meta">
            <strong>{structure.n_games}</strong> partite la attraversano ·
            <strong> {structure.n_positions}</strong> posizioni di mediogioco
            {structure.dominant_motif && (
              <> · l'errore tipico è <strong>{structure.dominant_motif.toLowerCase()}</strong></>
            )}
          </p>
          <div className="structure-detail-hero-stats">
            {wrPct != null && (
              <div className={`structure-stat structure-stat-${wrTone}`}>
                <div className="structure-stat-val">{wrPct}%</div>
                <div className="structure-stat-lbl">win-rate</div>
              </div>
            )}
            <div className="structure-stat">
              <div className="structure-stat-val">−{cpLossPawns}</div>
              <div className="structure-stat-lbl">cp_loss medio</div>
            </div>
            <div className="structure-stat">
              <div className="structure-stat-val">{structure.wins}–{structure.draws}–{structure.losses}</div>
              <div className="structure-stat-lbl">W–D–L</div>
            </div>
          </div>
        </div>
        {sample && (
          <Link
            to={`/positions/${sample.game_id}/${sample.ply}`}
            className="structure-detail-hero-board"
            aria-label="Vai alla posizione di esempio"
          >
            <BoardView
              fen={sample.fen_before}
              resetKey={`struct-hero-${structure.key}`}
              orientation={sample.my_color}
              size={260}
            />
            <span className="structure-detail-hero-board-cap">
              Una posizione tipica · {sample.date ?? ""}
            </span>
          </Link>
        )}
      </section>

      {openings.length > 0 && (
        <section className="structure-detail-section">
          <header className="structure-detail-section-head">
            <BookOpen size={18} aria-hidden="true" />
            <h2 className="display-small">Aperture che ti ci portano</h2>
          </header>
          <p className="structure-detail-section-desc">
            Le ECO da cui parte la maggior parte delle partite che attraversano questa struttura.
            Da qui capisci dove agganciare il lavoro: prevenire la struttura, o gestirla meglio.
          </p>
          <div className="structure-openings-table">
            <div className="structure-openings-head">
              <span>ECO · Apertura</span>
              <span className="num">Partite</span>
              <span className="num">W–D–L</span>
              <span className="num">Win-rate</span>
            </div>
            {openings.map((o) => {
              const wr = o.win_rate != null ? Math.round(o.win_rate * 100) : null;
              const tone = wr == null ? "neutral" : wr < 35 ? "bad" : wr < 50 ? "warn" : "good";
              return (
                <div key={`${o.eco}-${o.opening}`} className="structure-openings-row">
                  <span className="structure-openings-name">
                    <span className="structure-openings-eco">{o.eco}</span>
                    <span>{o.opening}</span>
                  </span>
                  <span className="num">{o.n_games}</span>
                  <span className="num mono">{o.wins}–{o.draws}–{o.losses}</span>
                  <span className={`num structure-openings-wr structure-openings-wr-${tone}`}>
                    {wr != null ? `${wr}%` : "—"}
                  </span>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {games.length > 0 && (
        <section className="structure-detail-section">
          <header className="structure-detail-section-head">
            <Layers size={18} aria-hidden="true" />
            <h2 className="display-small">Le partite in serie</h2>
          </header>
          <p className="structure-detail-section-desc">
            Le partite recenti che hanno toccato questa struttura. Apri la partita su Chess.com
            per rivederla, o vai alla posizione concreta dove hai sbagliato di più.
          </p>
          <div className="structure-games-list">
            {games.map((g) => {
              const resultTone =
                g.result === "win" ? "good" : g.result === "loss" ? "bad" : "neutral";
              const resultLbl =
                g.result === "win" ? "Vinta" : g.result === "loss" ? "Persa" : "Patta";
              return (
                <article key={g.game_id} className="structure-game-row">
                  <div className="structure-game-main">
                    <div className="structure-game-line1">
                      <span className={`structure-game-result structure-game-result-${resultTone}`}>
                        {resultLbl}
                      </span>
                      <span className="structure-game-date">{g.date ?? "?"}</span>
                      <span className="structure-game-color">
                        {g.my_color === "white" ? "bianco" : "nero"}
                      </span>
                      {g.opp_rating != null && (
                        <span className="structure-game-opp">vs {g.opp_rating}</span>
                      )}
                    </div>
                    <div className="structure-game-line2">
                      <span className="structure-game-eco">{g.eco ?? "—"}</span>
                      <span className="structure-game-opening">{g.opening ?? "—"}</span>
                    </div>
                  </div>
                  <div className="structure-game-stats">
                    <div className="structure-game-stat">
                      <div className="structure-game-stat-val">{g.n_positions_in_struct}</div>
                      <div className="structure-game-stat-lbl">posizioni</div>
                    </div>
                    <div className="structure-game-stat">
                      <div className="structure-game-stat-val">−{(g.worst_cp_loss / 100).toFixed(1)}</div>
                      <div className="structure-game-stat-lbl">peggior cp_loss</div>
                    </div>
                  </div>
                  {g.url && (
                    <a
                      href={g.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="structure-game-link"
                      aria-label="Apri partita su Chess.com"
                    >
                      <ExternalLink size={14} aria-hidden="true" /> Chess.com
                    </a>
                  )}
                </article>
              );
            })}
          </div>
        </section>
      )}

      {positions.length > 0 && (
        <section className="structure-detail-section">
          <header className="structure-detail-section-head">
            <Target size={18} aria-hidden="true" />
            <h2 className="display-small">Le posizioni concrete</h2>
          </header>
          <p className="structure-detail-section-desc">
            Dove hai sbagliato dentro la struttura. Una posizione per partita, ordinate per
            gravità dell'errore. Clicca per aprire l'analisi completa.
          </p>
          <div className="structure-positions-grid">
            {positions.map((p) => (
              <Link
                key={`${p.game_id}-${p.ply}`}
                to={`/positions/${p.game_id}/${p.ply}`}
                className="structure-position-card"
              >
                <div className="structure-position-board">
                  <BoardView
                    fen={p.fen_before}
                    resetKey={`struct-pos-${p.game_id}-${p.ply}`}
                    orientation={p.my_color}
                    size={200}
                  />
                </div>
                <div className="structure-position-meta">
                  <div className="structure-position-move">
                    {p.move_number}. {p.my_color === "black" ? "..." : ""}{p.san}
                    {p.best_san_sf && p.best_san_sf !== p.san && (
                      <span className="structure-position-best"> → {p.best_san_sf}</span>
                    )}
                  </div>
                  <div className="structure-position-loss">−{(p.cp_loss / 100).toFixed(1)} pedoni</div>
                  {p.motif_label_it && (
                    <div className="structure-position-motif">{p.motif_label_it}</div>
                  )}
                  <div className="structure-position-context">
                    {p.date ?? "?"} · {p.eco ?? "—"}
                  </div>
                </div>
              </Link>
            ))}
          </div>
        </section>
      )}
    </PageShell>
  );
}
