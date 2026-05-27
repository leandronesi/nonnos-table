import { useMemo } from "react";
import { Link, useParams, Navigate } from "react-router-dom";
import { ChevronRight, ExternalLink, Dumbbell, CheckCircle2 } from "lucide-react";
import type { PlayerModel, PositionRow } from "../types";
import { patternStats } from "../session/drillLog";
import { PageShell } from "./PageShell";
import { BoardView } from "../components/BoardView";
import { PatternSparkline } from "../components/PatternSparkline";
import { StructuresPanel } from "../components/StructuresPanel";
import {
  buildPatterns,
  categoryLabel,
  categoryColor,
  formatSharePct,
  srsColor,
  srsLabel,
  trendArrow,
  trendColor,
  trendLabel,
} from "../patterns";

interface Props {
  pm: PlayerModel;
}

export function PatternDetail({ pm }: Props) {
  const { key } = useParams<{ key: string }>();
  const decodedKey = key ? decodeURIComponent(key) : "";
  const pattern = useMemo(
    () => buildPatterns(pm).find((p) => p.key === decodedKey) ?? null,
    [pm, decodedKey],
  );

  if (!pattern) {
    return <Navigate to="/patterns" replace />;
  }

  const windowDays = pm.growth_delta?.window_days ?? 14;
  const cColor = categoryColor(pattern.category);
  const tColor = trendColor(pattern.trend);
  const sColor = srsColor(pattern.srs_state);
  const hasOccurrences = pattern.positions.length > 0;
  const previewPos = pattern.last_occurrence;
  const deltaShare = (pattern.current_share - pattern.previous_share) * 100;
  const deltaSign = deltaShare > 0.5 ? "+" : "";

  return (
    <PageShell
      title={pattern.name}
      subtitle={`${categoryLabel(pattern.category)} · ${srsLabel(pattern.srs_state)}`}
    >
      <nav className="pattern-detail-breadcrumb" aria-label="Breadcrumb">
        <Link to="/patterns">Pattern</Link>
        <ChevronRight size={14} aria-hidden="true" />
        <span>{pattern.name}</span>
      </nav>

      <section className="pattern-detail-hero">
        <div className="pattern-detail-hero-left">
          <div className="pattern-detail-cat" style={{ color: cColor, borderColor: `${cColor}55` }}>
            <span className="pattern-detail-cat-dot" style={{ background: cColor }} />
            {categoryLabel(pattern.category)}
          </div>
          <h1 className="display-large mt-3">{pattern.name}</h1>
          <p className="pattern-detail-phrase">{pattern.phrase_hint}</p>

          <div className="pattern-detail-meta">
            <span className="pattern-detail-srs" style={{ color: sColor, borderColor: `${sColor}55` }}>
              {srsLabel(pattern.srs_state)}
            </span>
            <span className="pattern-detail-meta-item">
              <strong>{pattern.avoidable_count}</strong> errori evitabili al tuo livello
              <span className="opacity-60"> · su {pattern.positions.length} totali</span>
            </span>
            {pattern.avg_drill_value > 0.1 && (
              <span className="pattern-detail-meta-item pattern-detail-meta-money">
                Drill value medio <strong>+{(pattern.avg_drill_value * 100).toFixed(0)}%</strong>
              </span>
            )}
            {pattern.last_occurrence?.date && (
              <span className="pattern-detail-meta-item">
                Ultima volta <strong>{pattern.last_occurrence.date}</strong>
              </span>
            )}
          </div>

          <div className="pattern-detail-cta-row">
            {hasOccurrences ? (
              <>
                <Link
                  to={`/patterns/${encodeURIComponent(pattern.key)}/drill`}
                  className="btn btn-primary btn-lg inline-flex items-center gap-2"
                >
                  <Dumbbell size={18} aria-hidden="true" />
                  Allena questo pattern
                </Link>
                <a href="#occorrenze" className="btn btn-ghost btn-lg">
                  Vedi le occorrenze
                </a>
              </>
            ) : (
              <span className="text-sm text-[color:var(--color-faint)]">
                Pattern di comportamento — non si allena con posizioni singole, si misura nel tempo.
              </span>
            )}
          </div>

          {(() => {
            const stats = patternStats(pattern.key);
            if (stats.total_runs === 0) return null;
            return (
              <div className="pattern-detail-drill-stats">
                {stats.done_today && (
                  <span className="pattern-detail-drill-today">
                    <CheckCircle2 size={14} aria-hidden="true" /> Allenato oggi
                  </span>
                )}
                <span>
                  Allenato <strong>{stats.total_runs}</strong> volte ·{" "}
                  <span style={{ color: "#34d399" }}>{stats.perfect}</span>/
                  <span style={{ color: "#facc15" }}>{stats.ok}</span>/
                  <span style={{ color: "#f43f5e" }}>{stats.wrong}</span>
                </span>
              </div>
            );
          })()}
        </div>

        <div className="pattern-detail-hero-right">
          <div className="pattern-detail-bigstat">
            <div className="pattern-detail-bigstat-value">{formatSharePct(pattern.current_share)}</div>
            <div className="pattern-detail-bigstat-label">delle partite ultimi {windowDays}gg</div>
          </div>
          <div className="pattern-detail-trend" style={{ color: tColor }}>
            <span className="pattern-detail-trend-arrow" aria-hidden="true">{trendArrow(pattern.trend)}</span>
            <div>
              <div className="pattern-detail-trend-label">{trendLabel(pattern.trend)}</div>
              <div className="pattern-detail-trend-detail">
                era {formatSharePct(pattern.previous_share)} · {deltaSign}{deltaShare.toFixed(0)}% di differenza
              </div>
            </div>
          </div>
          <div className="pattern-detail-sparkline">
            <PatternSparkline
              series={pattern.weekly_series}
              width={320}
              height={80}
              color={tColor}
              ariaLabel={`storico ${pattern.name}`}
            />
            <div className="pattern-detail-sparkline-axis">
              <span>{pattern.weekly_series[0]?.week_iso ?? ""}</span>
              <span>{pattern.weekly_series[pattern.weekly_series.length - 1]?.week_iso ?? ""}</span>
            </div>
          </div>
        </div>
      </section>

      {/* B — Strutture pedonali per phase_middlegame: il mediogioco è strategia */}
      {pattern.key === "phase_middlegame" && pm.pawn_structures && pm.pawn_structures.length > 0 && (
        <StructuresPanel structures={pm.pawn_structures} limit={5} />
      )}

      {hasOccurrences && previewPos && (
        <section className="pattern-detail-preview">
          <header className="pattern-detail-section-head">
            <h2 className="display-small">L'ultima volta</h2>
            <span className="text-sm text-[color:var(--color-text-soft)]">
              {previewPos.date} · vs {previewPos.opp_rating ?? "?"} · {previewPos.opening ?? "?"}
            </span>
          </header>
          <div className="pattern-detail-preview-body">
            <div className="pattern-detail-preview-board">
              <BoardView
                fen={previewPos.fen_before}
                resetKey={`pat-prev-${pattern.key}`}
                orientation={previewPos.my_color}
                size={340}
                draggable={false}
              />
            </div>
            <div className="pattern-detail-preview-text">
              <div className="label-eyebrow">Cosa è successo</div>
              <ul className="pattern-detail-preview-list">
                <li>
                  <span className="label">Hai giocato</span>
                  <span className="value text-rose-300 font-mono">{previewPos.san}</span>
                </li>
                {previewPos.best_san_sf && previewPos.best_san_sf !== previewPos.san && (
                  <li>
                    <span className="label">Mossa giusta</span>
                    <span className="value text-emerald-300 font-mono">{previewPos.best_san_sf}</span>
                  </li>
                )}
                <li>
                  <span className="label">Costo</span>
                  <span className="value font-mono">
                    {(previewPos.cp_loss / 100).toFixed(2)} pedoni
                  </span>
                </li>
                {previewPos.phase && (
                  <li>
                    <span className="label">Fase</span>
                    <span className="value capitalize">{previewPos.phase}</span>
                  </li>
                )}
              </ul>
              {previewPos.url && (
                <a
                  href={previewPos.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="btn btn-ghost btn-sm mt-3 inline-flex items-center gap-1.5"
                >
                  Apri la partita su Chess.com <ExternalLink size={14} />
                </a>
              )}
            </div>
          </div>
        </section>
      )}

      {hasOccurrences && (
        <section className="pattern-detail-occurrences" id="occorrenze">
          <header className="pattern-detail-section-head">
            <h2 className="display-small">Tutte le occorrenze</h2>
            <span className="text-sm text-[color:var(--color-text-soft)]">
              {pattern.positions.length} posizioni dalle tue partite
            </span>
          </header>
          <div className="pattern-detail-occ-list">
            {pattern.positions.map((p) => (
              <OccurrenceRow key={`${p.game_id}:${p.ply}`} p={p} />
            ))}
          </div>
        </section>
      )}

      {!hasOccurrences && (
        <section className="pattern-detail-empty surface surface-padded">
          <h2 className="display-small">Ancora poche occorrenze</h2>
          <p className="text-[color:var(--color-text-soft)] mt-2">
            Questo pattern si vede nelle metriche aggregate ma non ho abbastanza posizioni concrete
            taggate per proporti un allenamento mirato. Continua a giocare e Nonno ne raccoglierà
            altre — appena ce ne saranno 3+ potrai allenarlo qui.
          </p>
        </section>
      )}
    </PageShell>
  );
}

function OccurrenceRow({ p }: { p: PositionRow }) {
  const lossPawns = (p.cp_loss / 100).toFixed(2);
  const positionHref = `/positions/${encodeURIComponent(p.game_id)}/${p.ply}`;
  return (
    <Link to={positionHref} className="pattern-detail-occ-row pattern-detail-occ-link">
      <div className="pattern-detail-occ-board">
        <BoardView
          fen={p.fen_before}
          resetKey={`occ-${p.game_id}-${p.ply}`}
          orientation={p.my_color}
          size={120}
          draggable={false}
        />
      </div>
      <div className="pattern-detail-occ-info">
        <div className="pattern-detail-occ-info-head">
          <span className="pattern-detail-occ-date">{p.date ?? "—"}</span>
          <span className="pattern-detail-occ-opp">vs {p.opp_rating ?? "?"}</span>
          {p.opening && (
            <span className="pattern-detail-occ-opening">
              {p.opening} <span className="opacity-60">({p.eco})</span>
            </span>
          )}
        </div>
        <div className="pattern-detail-occ-moves">
          <span className="text-[color:var(--color-text-soft)] text-xs">Hai giocato</span>
          <span className="font-mono text-rose-300">{p.san}</span>
          {p.best_san_sf && p.best_san_sf !== p.san && (
            <>
              <span className="text-[color:var(--color-text-soft)] text-xs">era</span>
              <span className="font-mono text-emerald-300">{p.best_san_sf}</span>
            </>
          )}
          <span className="pattern-detail-occ-loss font-mono">−{lossPawns}</span>
        </div>
      </div>
      <div className="pattern-detail-occ-cta">
        <ChevronRight size={16} aria-hidden="true" />
      </div>
    </Link>
  );
}
