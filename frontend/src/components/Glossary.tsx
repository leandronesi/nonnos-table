import { useState } from "react";
import { GLOSS } from "../glossary";

// Glossary collassabile in fondo alla pagina. La metto a portata di mano ma
// senza occupare spazio di default — l'utente la apre se non ricorda un termine.

const ENTRIES: { term: string; key: keyof typeof GLOSS }[] = [
  { term: "ACPL", key: "acpl" },
  { term: "Performance rating", key: "performance_rating" },
  { term: "Blunder", key: "blunder" },
  { term: "Errore (mistake)", key: "mistake" },
  { term: "Imprecisione", key: "inaccuracy" },
  { term: "Centesimi di pedone (cp)", key: "centipawn" },
  { term: "Ply", key: "ply" },
  { term: "ECO", key: "eco" },
  { term: "Apertura", key: "phase_opening" },
  { term: "Mediogioco", key: "phase_middlegame" },
  { term: "Finale", key: "phase_endgame" },
  { term: "Motivo · Matto subìto", key: "motif_allowed_mate" },
  { term: "Motivo · Pezzo lasciato", key: "motif_material_loss" },
  { term: "Motivo · Da vincente a perso", key: "motif_winning_to_lost" },
  { term: "Motivo · Vantaggio buttato", key: "motif_winning_advantage_thrown" },
  { term: "Motivo · Errore posizionale", key: "motif_positional_blunder" },
];

export function Glossary() {
  const [open, setOpen] = useState(false);

  return (
    <div className="card mt-5">
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full text-left flex items-center justify-between gap-2 group"
      >
        <div>
          <div className="card-title">Glossario</div>
          <p className="text-slate-400 text-sm mt-1">
            Tutti i termini tecnici della dashboard, in italiano.
          </p>
        </div>
        <span
          className="text-slate-400 group-hover:text-slate-200 transition text-xl select-none"
          aria-label={open ? "Chiudi" : "Apri"}
        >
          {open ? "−" : "+"}
        </span>
      </button>

      {open && (
        <dl className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-5">
          {ENTRIES.map(({ term, key }) => (
            <div key={key} className="border border-[color:var(--color-line)] rounded-lg p-3">
              <dt className="text-sm font-semibold text-slate-100">{term}</dt>
              <dd className="text-xs text-slate-400 leading-relaxed mt-1">
                {GLOSS[key]}
              </dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  );
}
