import { useId } from "react";
import { HelpCircle } from "lucide-react";

/**
 * Piccolo "(?)" cliccabile che mostra un tooltip su hover/focus.
 * Usato per spiegare jargon scacchistico (pedoni, cp_loss, priorità, ECO…)
 * dove il principiante si potrebbe perdere.
 *
 * a11y: il bottone ha aria-describedby; il tooltip è un <span role="tooltip">.
 * Tooltip mostrato via CSS hover/focus-within — niente JS state.
 */
interface Props {
  text: string;
  /** Posizione del tooltip rispetto al trigger. */
  side?: "top" | "right" | "bottom" | "left";
}

export function InfoHint({ text, side = "top" }: Props) {
  const id = useId();
  return (
    <span className={`info-hint info-hint-${side}`}>
      <button
        type="button"
        className="info-hint-trigger"
        aria-describedby={id}
        aria-label="Cosa significa"
        tabIndex={0}
      >
        <HelpCircle size={12} aria-hidden="true" />
      </button>
      <span id={id} role="tooltip" className="info-hint-tooltip">
        {text}
      </span>
    </span>
  );
}
