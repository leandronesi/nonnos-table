/**
 * Freni — "Le tue ancore". Lista calma, ogni ancora con upside in Miele,
 * barra del peso, categoria in pill. Numeri solo dove Nonno li cita.
 */

import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { PageShell } from "../PageShell";
import { useAuth } from "../../auth/AuthContext";
import { downloadJson, quadernoPath } from "../../auth/storage";
import { PRODUCT_NAME } from "../../coaching";
import type { Aggregates, Anchor } from "../../pipeline/aggregate";

interface CoachBrief {
  top_3_freni: Array<{ title: string; evidence: string; next_step: string }>;
}

// ── Barra fase (orizzontale, comparativa) ─────────────────────────────────────

function HBar({
  pct,
  danger,
  label,
  sub,
}: {
  pct: number;
  danger: boolean;
  label: string;
  sub: string;
}) {
  const capped = Math.min(100, pct * 5); // 5× so 20% fills the bar
  return (
    <div className="flex items-center gap-3 py-2">
      <div
        className="font-mono text-xs shrink-0 w-20 text-right"
        style={{ color: "var(--color-muted)" }}
      >
        {label}
      </div>
      <div
        className="flex-1 rounded-full overflow-hidden"
        style={{ height: "0.375rem", background: "rgba(255,255,255,0.06)" }}
      >
        <div
          style={{
            width: `${capped}%`,
            height: "100%",
            borderRadius: "999px",
            background: danger
              ? "var(--color-danger)"
              : "linear-gradient(90deg, var(--color-brand), var(--color-brand-soft))",
            transition: "width 600ms cubic-bezier(0.22,1,0.36,1)",
          }}
        />
      </div>
      <div
        className="font-mono font-bold shrink-0 w-14 text-right"
        style={{
          fontSize: "1rem",
          lineHeight: 1,
          color: danger ? "var(--color-danger)" : "var(--color-text)",
          fontVariantNumeric: "tabular-nums",
        }}
      >
        {pct.toFixed(1)}%
      </div>
      <div
        className="font-mono text-xs shrink-0 w-20"
        style={{ color: "var(--color-faint)" }}
      >
        {sub}
      </div>
    </div>
  );
}

// ── Colori per categoria ancora ───────────────────────────────────────────────

const CATEGORY_PILL: Record<string, { bg: string; color: string }> = {
  tattica:       { bg: "rgba(244,63,94,0.12)",  color: "var(--color-danger)" },
  timing:        { bg: "rgba(251,146,60,0.12)", color: "var(--color-mistake, #fb923c)" },
  tecnica:       { bg: "rgba(161,139,255,0.14)", color: "var(--color-brand-soft)" },
  comportamento: { bg: "rgba(96,165,250,0.12)", color: "var(--color-info)" },
};

const DEFAULT_PILL = { bg: "rgba(255,255,255,0.07)", color: "var(--color-text-soft)" };

// ── Lista ancore ──────────────────────────────────────────────────────────────

function AnchorList({ anchors }: { anchors: Anchor[] }) {
  const maxScore = Math.max(...anchors.map((a) => a.weighted_score), 1);

  return (
    <div className="grid gap-3">
      {anchors.map((anchor) => {
        const barPct = Math.min(100, (anchor.weighted_score / maxScore) * 100);
        const pill = CATEGORY_PILL[anchor.category] ?? DEFAULT_PILL;

        return (
          <div key={anchor.type} className="surface surface-padded">
            {/* Header: titolo + badge categoria + upside */}
            <div className="flex items-start justify-between gap-3 mb-3">
              <div className="min-w-0 flex-1">
                <div
                  className="font-semibold"
                  style={{ fontSize: "1rem", lineHeight: 1.3, color: "var(--color-text)" }}
                >
                  {anchor.label_it}
                </div>
                <div
                  className="mt-1 text-sm leading-relaxed"
                  style={{ color: "var(--color-text-soft)", maxWidth: "55ch" }}
                >
                  {anchor.meaning_it}
                </div>
              </div>

              {/* Colonna destra: categoria + upside */}
              <div className="flex flex-col items-end gap-2 shrink-0">
                {/* Categoria */}
                <span
                  className="pill"
                  style={{
                    background: pill.bg,
                    color: pill.color,
                    borderColor: "transparent",
                    textTransform: "uppercase",
                    whiteSpace: "nowrap",
                  }}
                >
                  {anchor.category}
                </span>

                {/* Upside in Miele: riservato all'obiettivo */}
                {anchor.rating_upside != null && anchor.rating_upside > 0 && (
                  <span
                    className="font-mono font-bold"
                    style={{
                      fontSize: "0.8rem",
                      color: "var(--color-gold)",
                      fontVariantNumeric: "tabular-nums",
                      whiteSpace: "nowrap",
                    }}
                  >
                    +{anchor.rating_upside} punti
                  </span>
                )}
              </div>
            </div>

            {/* Barra peso relativo */}
            <div
              className="rounded-full overflow-hidden mb-3"
              style={{ height: "0.3rem", background: "rgba(255,255,255,0.06)" }}
            >
              <div
                style={{
                  width: `${barPct}%`,
                  height: "100%",
                  borderRadius: "999px",
                  background: pill.color,
                  opacity: 0.65,
                  transition: "width 600ms cubic-bezier(0.22,1,0.36,1)",
                }}
              />
            </div>

            {/* Meta riga */}
            <div className="flex items-center gap-3 flex-wrap">
              <span
                className="font-mono text-xs"
                style={{ color: "var(--color-muted)", fontVariantNumeric: "tabular-nums" }}
              >
                {anchor.count} {anchor.count === 1 ? "errore" : "errori"} in{" "}
                {anchor.games_with} {anchor.games_with === 1 ? "partita" : "partite"}
              </span>
              <span
                className="font-mono text-xs"
                style={{ color: "var(--color-faint)", fontVariantNumeric: "tabular-nums" }}
              >
                avg -{anchor.avg_cp_loss.toFixed(0)} cp
              </span>
            </div>

            {/* Azione suggerita */}
            {anchor.action_it && (
              <div
                className="mt-2 text-xs leading-relaxed"
                style={{ color: "var(--color-text-soft)", opacity: 0.75 }}
              >
                {anchor.action_it}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── Pagina principale ─────────────────────────────────────────────────────────

export function Freni() {
  const { user } = useAuth();
  const [aggregates, setAggregates] = useState<Aggregates | null>(null);
  const [brief, setBrief] = useState<CoachBrief | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    (async () => {
      try {
        const [a, b] = await Promise.all([
          downloadJson<Aggregates>(quadernoPath(user.id, "aggregates.json")),
          downloadJson<CoachBrief>(quadernoPath(user.id, "coach_brief.json")),
        ]);
        if (!cancelled) {
          setAggregates(a);
          setBrief(b);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [user]);

  if (loading) {
    return (
      <PageShell title="Le tue ancore" subtitle="Cosa ti tiene fermo al tuo livello.">
        <div className="text-sm" style={{ color: "var(--color-muted)" }}>Carico…</div>
      </PageShell>
    );
  }

  if (!aggregates) {
    return (
      <PageShell title="Le tue ancore" subtitle="Cosa ti tiene fermo al tuo livello.">
        <div className="py-16 text-center">
          <div className="text-sm mb-5" style={{ color: "var(--color-muted)" }}>
            Ancora niente: torna dopo l'analisi.
          </div>
          <Link to="/quaderno" className="btn btn-ghost btn-sm">
            Quaderno
          </Link>
        </div>
      </PageShell>
    );
  }

  const phases = [
    { key: "opening"    as const, label: "Apertura",   moves: aggregates.by_phase.opening.moves,    pct: aggregates.by_phase.opening.blunder_pct    },
    { key: "middlegame" as const, label: "Mediogioco", moves: aggregates.by_phase.middlegame.moves,  pct: aggregates.by_phase.middlegame.blunder_pct  },
    { key: "endgame"    as const, label: "Finale",     moves: aggregates.by_phase.endgame.moves,     pct: aggregates.by_phase.endgame.blunder_pct     },
  ];
  const maxPhasePct = Math.max(...phases.map((p) => p.pct));

  return (
    <PageShell title="Le tue ancore" subtitle="Cosa ti tiene fermo al tuo livello.">

      {/* ── Breadcrumb interno ───────────────────────────────────────────── */}
      <div className="flex items-center justify-between mb-8">
        <div className="label-eyebrow" style={{ color: "var(--color-brand-soft)" }}>
          {PRODUCT_NAME}
        </div>
        <Link
          to="/quaderno"
          className="btn btn-ghost btn-sm"
        >
          Quaderno
        </Link>
      </div>

      {/* ── Le tue ancore (lista principale) ────────────────────────────── */}
      {aggregates.anchors != null && aggregates.anchors.length > 0 && (
        <section className="mb-10">
          <div className="label-eyebrow mb-5" style={{ color: "var(--color-muted)" }}>
            Le tue ancore
          </div>
          <AnchorList anchors={aggregates.anchors} />
        </section>
      )}

      {/* ── Dove sbagli (per fase) ───────────────────────────────────────── */}
      <section className="surface surface-padded mb-5">
        <div className="label-eyebrow mb-4" style={{ color: "var(--color-muted)" }}>
          Errori gravi per fase
        </div>
        {phases.map((p) => (
          <HBar
            key={p.key}
            label={p.label}
            pct={p.pct}
            danger={p.pct === maxPhasePct && p.pct > 0}
            sub={`${p.moves} mosse`}
          />
        ))}
      </section>

      {/* ── Bianco vs Nero ───────────────────────────────────────────────── */}
      <section className="surface surface-padded mb-8">
        <div className="label-eyebrow mb-4" style={{ color: "var(--color-muted)" }}>
          Colore
        </div>
        {[
          {
            label: "Bianco",
            pct:   aggregates.by_color.white.blunder_pct,
            moves: aggregates.by_color.white.games,
            danger: aggregates.by_color.white.blunder_pct > aggregates.by_color.black.blunder_pct,
          },
          {
            label: "Nero",
            pct:   aggregates.by_color.black.blunder_pct,
            moves: aggregates.by_color.black.games,
            danger: aggregates.by_color.black.blunder_pct > aggregates.by_color.white.blunder_pct,
          },
        ].map((r) => (
          <HBar
            key={r.label}
            label={r.label}
            pct={r.pct}
            danger={r.danger}
            sub={`${r.moves} partite`}
          />
        ))}
      </section>

      {/* ── Le 3 ancore principali (dal coach) ──────────────────────────── */}
      {brief?.top_3_freni && brief.top_3_freni.length > 0 && (
        <section className="mb-8">
          <div className="label-eyebrow mb-5" style={{ color: "var(--color-muted)" }}>
            Cosa dice Nonno
          </div>
          <div className="grid gap-3">
            {brief.top_3_freni.map((f, i) => (
              <div key={i} className="numbered-item" style={{ paddingLeft: 0 }}>
                <div
                  className="numbered-ord"
                  style={{ fontSize: "2rem", width: "2.25rem" }}
                >
                  {i + 1}
                </div>
                <div className="min-w-0">
                  <div
                    className="font-semibold"
                    style={{ fontSize: "1rem", color: "var(--color-text)", lineHeight: 1.3 }}
                  >
                    {f.title}
                  </div>
                  <div
                    className="mt-1 font-mono"
                    style={{
                      fontSize: "0.82rem",
                      color: "var(--color-text-soft)",
                      fontVariantNumeric: "tabular-nums",
                    }}
                  >
                    {f.evidence}
                  </div>
                  <div
                    className="mt-1.5 text-xs leading-relaxed"
                    style={{ color: "var(--color-muted)" }}
                  >
                    {f.next_step}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* ── CTA ─────────────────────────────────────────────────────────── */}
      <div className="flex items-center gap-3 flex-wrap mt-4">
        <Link to="/cadute" className="btn btn-primary btn-lg">
          Vedi le tue cadute
        </Link>
        <Link to="/quaderno" className="btn btn-ghost btn-sm">
          Quaderno
        </Link>
      </div>
    </PageShell>
  );
}
