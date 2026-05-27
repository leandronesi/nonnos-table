import { Link } from "react-router-dom";
import { ChevronRight, AlertCircle } from "lucide-react";
import type { PlayerModel, Diagnosis } from "../types";
import { PageShell } from "./PageShell";
import { InfoHint } from "../components/InfoHint";

function prioBucket(n: number): "alta" | "media" | "bassa" {
  if (n >= 200) return "alta";
  if (n >= 50) return "media";
  return "bassa";
}

interface Props {
  pm: PlayerModel;
}

/**
 * Diagnoses collection — la narrazione cross-pattern sopra gli errori.
 * Lista ordinata per priority discendente.
 */
export function Diagnoses({ pm }: Props) {
  const diags = (pm.diagnoses ?? []).slice().sort((a, b) => b.priority - a.priority);

  return (
    <PageShell title="Diagnosi" subtitle="Cosa Nonno vede dietro gli errori">
      <section className="diagnoses-intro surface surface-padded mb-6">
        <div className="label-eyebrow">La narrazione di Nonno</div>
        <h2 className="display-medium mt-2">Non solo cosa sbagli, ma <em>perché</em>.</h2>
        <p className="text-[color:var(--color-text-soft)] leading-relaxed mt-3 max-w-2xl">
          I pattern dicono "questo errore ricorre". Le diagnosi dicono <strong>perché</strong> ricorre e
          <strong> come allenarlo</strong>. Sono la storia sopra i pattern.
        </p>
      </section>

      {diags.length === 0 ? (
        <div className="diagnoses-empty surface surface-padded">
          <p className="text-[color:var(--color-text-soft)]">
            Nessuna diagnosi al momento. Torna più tardi quando avrai accumulato altre partite.
          </p>
        </div>
      ) : (
        <div className="diagnoses-grid">
          {diags.map((d) => <DiagnosisCard key={d.key} diagnosis={d} />)}
        </div>
      )}
    </PageShell>
  );
}

function DiagnosisCard({ diagnosis }: { diagnosis: Diagnosis }) {
  return (
    <Link to={`/diagnoses/${encodeURIComponent(diagnosis.key)}`} className="diagnosis-card">
      <header className="diagnosis-card-head">
        <span className="diagnosis-card-icon" aria-hidden="true">
          <AlertCircle size={18} />
        </span>
        <span className="diagnosis-card-prio">
          priorità {prioBucket(diagnosis.priority)}
          <InfoHint text={`Quanto questa diagnosi pesa nelle tue partite. Calcolata dal numero di occorrenze e dalla loro gravità. Punteggio raw: ${diagnosis.priority}.`} />
        </span>
      </header>
      <h3 className="diagnosis-card-title">{diagnosis.title}</h3>
      <p className="diagnosis-card-evidence">{diagnosis.evidence}</p>
      <footer className="diagnosis-card-foot">
        <span>Approfondisci</span>
        <ChevronRight size={14} aria-hidden="true" />
      </footer>
    </Link>
  );
}
