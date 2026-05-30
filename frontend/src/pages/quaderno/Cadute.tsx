/**
 * Cadute — galleria visuale delle posizioni dove l'utente ha perso valore.
 * Design: scacchiere dominanti, chip coerenti col sistema, riga comparativa
 * leggibile in mono, niente badge che competono per attenzione.
 */

import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { PageShell } from "../PageShell";
import { BoardView } from "../../components/BoardView";
import { useAuth } from "../../auth/AuthContext";
import { downloadJson, quadernoPath } from "../../auth/storage";
import { PRODUCT_NAME } from "../../coaching";
import type { Aggregates, PositionExample } from "../../pipeline/aggregate";
import { uciToArrow, cpToPawns, uciToSan } from "./boardArrows";

const MOTIF_LABEL: Record<string, string> = {
  pezzo_in_presa: "Pezzo in presa",
};

type PhaseFilter    = "all" | "apertura" | "mediogioco" | "finale";
type SeverityFilter = "all" | "blunder" | "mistake";

// ── Chip filtro (segmented-control style) ─────────────────────────────────────

function FilterChip({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="pill"
      style={{
        background:   active ? "var(--color-brand)"     : "rgba(255,255,255,0.04)",
        borderColor:  active ? "var(--color-brand)"     : "var(--color-line)",
        color:        active ? "#fff"                   : "var(--color-text-soft)",
        cursor: "pointer",
        transition: "background 160ms var(--ease-out), color 160ms var(--ease-out), border-color 160ms var(--ease-out)",
      }}
    >
      {label}
    </button>
  );
}

// ── Determina il badge evitabile/difficile (unico, non duplicato) ─────────────

function avoidabilityLabel(c: PositionExample): "evitabile" | "difficile" | null {
  // Maia-based: priorità al campo esplicito
  if (c.avoidable === true || (c.priority_score != null && c.priority_score >= 2)) return "evitabile";
  if (c.move_difficulty != null) {
    return c.move_difficulty >= 0.6 ? "difficile" : c.move_difficulty < 0.5 ? "evitabile" : null;
  }
  return null;
}

export function Cadute() {
  const { user } = useAuth();
  const [aggregates, setAggregates] = useState<Aggregates | null>(null);
  const [loading, setLoading]       = useState(true);

  const [phase,    setPhase]    = useState<PhaseFilter>("all");
  const [severity, setSeverity] = useState<SeverityFilter>("all");

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    (async () => {
      try {
        const a = await downloadJson<Aggregates>(quadernoPath(user.id, "aggregates.json"));
        if (!cancelled) setAggregates(a);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [user]);

  if (loading) {
    return (
      <PageShell title="Le tue cadute" subtitle="Le posizioni dove hai perso più valore.">
        <div className="text-sm" style={{ color: "var(--color-muted)" }}>Carico…</div>
      </PageShell>
    );
  }

  const raw: PositionExample[] = aggregates?.cadute ?? aggregates?.examples ?? [];

  const filtered = raw.filter((c) => {
    if (phase    !== "all" && c.phase    !== phase)    return false;
    if (severity !== "all" && c.category !== severity) return false;
    return true;
  });

  const phaseChips: { label: string; value: PhaseFilter }[] = [
    { label: "Tutte",      value: "all" },
    { label: "Apertura",   value: "apertura" },
    { label: "Mediogioco", value: "mediogioco" },
    { label: "Finale",     value: "finale" },
  ];

  const severityChips: { label: string; value: SeverityFilter }[] = [
    { label: "Tutte",   value: "all" },
    { label: "Errore grave", value: "blunder" },
    { label: "Errore",  value: "mistake" },
  ];

  return (
    <PageShell title="Le tue cadute" subtitle="Le posizioni dove hai perso più valore.">

      {/* ── Breadcrumb interno ───────────────────────────────────────────── */}
      <div className="flex items-center justify-between mb-6">
        <div className="label-eyebrow" style={{ color: "var(--color-brand-soft)" }}>
          {PRODUCT_NAME}
        </div>
        <Link to="/quaderno" className="btn btn-ghost btn-sm">
          Quaderno
        </Link>
      </div>

      {/* ── Filtri ──────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-3 mb-5">
        {/* Fase */}
        <div className="flex gap-1.5 flex-wrap">
          {phaseChips.map((c) => (
            <FilterChip
              key={c.value}
              label={c.label}
              active={phase === c.value}
              onClick={() => setPhase(c.value)}
            />
          ))}
        </div>

        {/* Divisore verticale */}
        <div
          className="self-stretch"
          style={{ width: "1px", background: "var(--color-line)", minHeight: "1.5rem" }}
        />

        {/* Gravità */}
        <div className="flex gap-1.5 flex-wrap">
          {severityChips.map((c) => (
            <FilterChip
              key={c.value}
              label={c.label}
              active={severity === c.value}
              onClick={() => setSeverity(c.value)}
            />
          ))}
        </div>
      </div>

      {/* ── Conteggio ───────────────────────────────────────────────────── */}
      {filtered.length > 0 && (
        <div
          className="mb-4 font-mono text-xs"
          style={{ color: "var(--color-faint)", fontVariantNumeric: "tabular-nums" }}
        >
          {filtered.length} {filtered.length === 1 ? "caduta" : "cadute"}
        </div>
      )}

      {/* ── Griglia / stati vuoti ────────────────────────────────────────── */}
      {filtered.length === 0 ? (
        raw.length === 0 ? (
          <div className="py-16 text-center">
            <div className="text-sm mb-4" style={{ color: "var(--color-muted)" }}>
              Ancora niente, torna dopo l'analisi.
            </div>
          </div>
        ) : (
          <div className="py-16 text-center">
            <div className="text-sm mb-4" style={{ color: "var(--color-muted)" }}>
              Nessuna caduta per questo filtro.
            </div>
            <button
              onClick={() => { setPhase("all"); setSeverity("all"); }}
              className="btn btn-ghost btn-sm"
            >
              Mostra tutte
            </button>
          </div>
        )
      ) : (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))",
            gap: "1rem",
          }}
        >
          {filtered.map((c, i) => {
            const arrowPlayed = uciToArrow(c.played_uci, "rgba(239,68,68,0.85)");
            const arrowBest   = uciToArrow(c.best_uci ?? null, "rgba(34,197,94,0.85)");
            const arrows = [arrowPlayed, arrowBest].filter(Boolean) as {
              from: string;
              to:   string;
              color: string;
            }[];

            const avoid = avoidabilityLabel(c);

            // Etichetta fase capitalizzata
            const phaseLabel =
              c.phase.charAt(0).toUpperCase() + c.phase.slice(1);

            return (
              <div
                key={i}
                className="surface"
                style={{ padding: "0.75rem" }}
              >
                {/* Scacchiera */}
                <div style={{ display: "flex", justifyContent: "center" }}>
                  <BoardView
                    fen={c.fen_before}
                    orientation={c.color}
                    size={200}
                    arrows={arrows}
                  />
                </div>

                {/* Perdita centipedoni */}
                <div
                  className="font-mono font-bold mt-2"
                  style={{
                    fontSize: "1.35rem",
                    lineHeight: 1,
                    color: "var(--color-danger)",
                    fontVariantNumeric: "tabular-nums",
                  }}
                >
                  -{cpToPawns(c.cp_loss)}
                </div>

                {/* Chip riga */}
                <div className="flex flex-wrap gap-1.5 mt-2">
                  {/* Fase */}
                  <span className="pill" style={{ borderColor: "transparent", background: "rgba(96,165,250,0.10)", color: "var(--color-info)" }}>
                    {phaseLabel}
                  </span>

                  {/* Gravità */}
                  {c.category === "blunder" ? (
                    <span className="pill pill-bad">{c.category === "blunder" ? "Errore grave" : "Errore"}</span>
                  ) : (
                    <span className="pill pill-warn">Errore</span>
                  )}

                  {/* Motif */}
                  {c.motif && (
                    <span className="pill pill-brand">
                      {MOTIF_LABEL[c.motif] ?? c.motif}
                    </span>
                  )}

                  {/* Evitabile / Difficile */}
                  {avoid === "evitabile" && (
                    <span className="pill pill-warn">Evitabile</span>
                  )}
                  {avoid === "difficile" && (
                    <span className="pill" style={{ borderColor: "transparent", background: "rgba(96,165,250,0.10)", color: "var(--color-info)" }}>
                      Difficile
                    </span>
                  )}
                </div>

                {/* Riga comparativa: target vs tu (mono tabular) */}
                {c.p_target_plays_best_sf != null && c.p_mine_plays_best_sf != null && (
                  <div
                    className="mt-2 font-mono"
                    style={{
                      fontSize: "0.72rem",
                      color: "var(--color-muted)",
                      fontVariantNumeric: "tabular-nums",
                      letterSpacing: "0.01em",
                    }}
                  >
                    <span style={{ color: "var(--color-faint)" }}>target </span>
                    <span style={{ color: "var(--color-text-soft)", fontWeight: 600 }}>
                      {Math.round(c.p_target_plays_best_sf * 100)}%
                    </span>
                    <span style={{ color: "var(--color-faint)" }}> · tu </span>
                    <span
                      style={{
                        color:
                          Math.round(c.p_mine_plays_best_sf * 100) >=
                          Math.round(c.p_target_plays_best_sf * 100)
                            ? "var(--color-ok)"
                            : "var(--color-danger)",
                        fontWeight: 600,
                      }}
                    >
                      {Math.round(c.p_mine_plays_best_sf * 100)}%
                    </span>
                  </div>
                )}

                {/* Riga mossa giocata → mossa migliore */}
                <div
                  className="mt-1 font-mono"
                  style={{
                    fontSize: "0.7rem",
                    color: "var(--color-muted)",
                    fontVariantNumeric: "tabular-nums",
                  }}
                >
                  <span style={{ color: "var(--color-danger)", fontWeight: 600 }}>{c.san}</span>
                  <span style={{ color: "var(--color-faint)" }}>{" → "}</span>
                  <span style={{ color: "var(--color-ok)", fontWeight: 600 }}>
                    {uciToSan(c.fen_before, c.best_uci ?? null)}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ── Back ────────────────────────────────────────────────────────── */}
      <div className="mt-10">
        <Link to="/quaderno" className="btn btn-ghost btn-sm">
          Quaderno
        </Link>
      </div>
    </PageShell>
  );
}
