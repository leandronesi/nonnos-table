import { X } from "lucide-react";

interface Props {
  date: string;    // formatted date string, e.g. "20 maggio"
  onClose: () => void;
}

/**
 * Modal placeholder per il recap di una partita reale.
 * Il backend recap-after-real-game non esiste ancora — mostra un
 * messaggio di attesa coerente con la voce di Nonno O.
 */
export function RealGameRecap({ date, onClose }: Props) {
  return (
    <div className="real-game-recap-overlay" role="dialog" aria-modal="true" aria-label="Recap partita reale">
      <div className="real-game-recap-panel fade-in">
        <div className="real-game-recap-header">
          <div className="real-game-recap-chips">
            <span className="coach-note-chip">Nonno O.</span>
          </div>
          <button
            type="button"
            className="real-game-recap-close"
            onClick={onClose}
            aria-label="Chiudi"
          >
            <X size={18} />
          </button>
        </div>

        <h3 className="real-game-recap-title">Quella partita del {date}</h3>

        <p className="real-game-recap-body">
          Nonno la sta ancora guardando. Tornerà nelle prossime sessioni con
          un'analisi mossa-per-mossa.
        </p>

        <p className="real-game-recap-sub">
          (funzionalità in arrivo: recap automatico delle partite Chess.com)
        </p>

        <button type="button" className="btn btn-ghost btn-sm real-game-recap-cta" onClick={onClose}>
          Chiudi
        </button>
      </div>
    </div>
  );
}
