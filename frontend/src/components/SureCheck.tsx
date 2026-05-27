import { Brain } from "lucide-react";
import { COACH_NAME } from "../coaching";

/**
 * Overlay anti-blunder: si attiva quando la mossa candidata lascia materiale
 * in presa. Deve fermare il gesto, non fare spettacolo.
 */
export function SureCheck({
  phrase,
  onCancel,
  onConfirm,
}: {
  phrase: string;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div className="sure-check-overlay" role="alertdialog" aria-live="assertive">
      <div className="sure-check-card">
        <div className="sure-check-head">
          <div className="sure-check-chip">
            <Brain size={13} aria-hidden="true" />
            <span>{COACH_NAME}</span>
          </div>
        </div>
        <p>{phrase}</p>
        <div className="sure-check-actions">
          <button onClick={onCancel} className="btn btn-primary justify-center">
            Riprovo
          </button>
          <button onClick={onConfirm} className="btn btn-ghost justify-center">
            Lo so, vado avanti
          </button>
        </div>
      </div>
    </div>
  );
}
