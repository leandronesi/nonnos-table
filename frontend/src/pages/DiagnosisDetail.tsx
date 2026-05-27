import { useMemo } from "react";
import { Link, useParams, Navigate } from "react-router-dom";
import { ChevronRight, AlertCircle, ExternalLink, Compass } from "lucide-react";
import type { PlayerModel } from "../types";
import { PageShell } from "./PageShell";
import { buildPatterns, categoryColor, categoryLabel } from "../patterns";

interface Props {
  pm: PlayerModel;
}

/**
 * Diagnosis detail — narrazione + evidenza + prescrizione.
 *
 * Tenta di linkare la diagnosi al Pattern corrispondente:
 *   - "motif_<x>"  → /patterns/motif_<x>
 *   - "phase_<x>"  → /patterns/phase_<x>
 *   - "tilt"       → /patterns/tilt_post_blunder (best-effort)
 *   - "time_management" → /patterns/time_overthinking
 */
export function DiagnosisDetail({ pm }: Props) {
  const { key } = useParams<{ key: string }>();
  const decoded = key ? decodeURIComponent(key) : "";
  const diagnosis = (pm.diagnoses ?? []).find((d) => d.key === decoded) ?? null;
  if (!diagnosis) return <Navigate to="/diagnoses" replace />;

  const linkedPattern = useMemo(() => mapDiagnosisToPattern(pm, diagnosis.key), [pm, diagnosis.key]);
  const confLabel = ({ low: "bassa", medium: "media", high: "alta" } as const)[diagnosis.confidence];

  return (
    <PageShell title={diagnosis.title} subtitle={`Diagnosi · priorita ${diagnosis.priority} · confidenza ${confLabel}`}>
      <nav className="pattern-detail-breadcrumb" aria-label="Breadcrumb">
        <Link to="/diagnoses">Diagnosi</Link>
        <ChevronRight size={14} aria-hidden="true" />
        <span>{diagnosis.title}</span>
      </nav>

      <section className="diagnosis-detail-hero">
        <div className="diagnosis-detail-hero-left">
          <div className="diagnosis-detail-icon" aria-hidden="true">
            <AlertCircle size={24} />
          </div>
          <h1 className="display-large mt-3">{diagnosis.title}</h1>
          <p className="diagnosis-detail-evidence">{diagnosis.evidence}</p>
        </div>
        <div className="diagnosis-detail-hero-right">
          <div className="diagnosis-detail-priostat">
            <div className="diagnosis-detail-priostat-num">{diagnosis.priority}</div>
            <div className="diagnosis-detail-priostat-label">priorità</div>
          </div>
          <div className="diagnosis-detail-confidence">
            <div className="label-eyebrow">Confidenza</div>
            <div className="diagnosis-detail-confidence-val">{confLabel}</div>
          </div>
        </div>
      </section>

      <section className="diagnosis-detail-prescription">
        <div className="diagnosis-detail-prescription-head">
          <Compass size={18} aria-hidden="true" />
          <h2 className="display-small">Come si allena</h2>
        </div>
        <p className="diagnosis-detail-prescription-body">{diagnosis.trainable}</p>
        {diagnosis.lichess_theme && (
          <a
            href={`https://lichess.org/training/${encodeURIComponent(diagnosis.lichess_theme)}`}
            target="_blank"
            rel="noopener noreferrer"
            className="btn btn-ghost btn-sm mt-3 inline-flex items-center gap-1.5"
          >
            Allenati su Lichess: tema "{diagnosis.lichess_theme}"
            <ExternalLink size={14} />
          </a>
        )}
      </section>

      {linkedPattern && (
        <section className="diagnosis-detail-linked">
          <div className="label-eyebrow">Pattern collegato</div>
          <Link
            to={`/patterns/${encodeURIComponent(linkedPattern.key)}`}
            className="diagnosis-detail-linked-card"
          >
            <div className="diagnosis-detail-linked-cat" style={{ color: categoryColor(linkedPattern.category) }}>
              <span
                className="diagnosis-detail-linked-cat-dot"
                style={{ background: categoryColor(linkedPattern.category) }}
              />
              {categoryLabel(linkedPattern.category)}
            </div>
            <h3 className="diagnosis-detail-linked-name">{linkedPattern.name}</h3>
            <p className="diagnosis-detail-linked-hint">{linkedPattern.phrase_hint}</p>
            <div className="diagnosis-detail-linked-cta">
              Vai al pattern <ChevronRight size={14} aria-hidden="true" />
            </div>
          </Link>
        </section>
      )}
    </PageShell>
  );
}

function mapDiagnosisToPattern(pm: PlayerModel, diagKey: string) {
  const all = buildPatterns(pm);
  // Match diretto
  let p = all.find((x) => x.key === diagKey);
  if (p) return p;
  // Match short key (es. diag "motif_hanging_piece" e pattern "motif_hanging_piece")
  if (diagKey.startsWith("motif_")) {
    p = all.find((x) => x.key === diagKey);
    if (p) return p;
  }
  // Mapping euristici per diagnosi non-1:1
  const map: Record<string, string> = {
    motif_material_loss: "motif_hanging_piece",
    tilt: "tilt_post_blunder",
    time_management: "time_overthinking",
    phase_middlegame: "phase_middlegame",
  };
  const target = map[diagKey];
  if (target) {
    p = all.find((x) => x.key === target);
    if (p) return p;
  }
  return null;
}
