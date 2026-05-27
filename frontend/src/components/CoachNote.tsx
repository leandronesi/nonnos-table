import { Brain } from "lucide-react";
import { COACH_NAME } from "../coaching";

/**
 * Nota coach: una guida breve sul calcolo, secondaria rispetto alla scacchiera.
 */
export function CoachNote({
  text,
  tone = "default",
}: {
  text: string | null | undefined;
  tone?: "default" | "warm" | "win" | "loss";
}) {
  if (!text || !text.trim()) return null;
  return (
    <div className={`coach-note coach-note-${tone}`}>
      <span className="coach-note-marker" aria-hidden="true" />
      <div className="coach-note-body">
        <div className="coach-note-chip">
          <Brain size={13} aria-hidden="true" />
          <span>{COACH_NAME}</span>
        </div>
        <p>{text.trim()}</p>
      </div>
    </div>
  );
}
