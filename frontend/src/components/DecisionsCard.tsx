import type { Decisions } from "../types";

/**
 * Tre decisioni chiave, IMPILATE in righe pulite (niente card-dentro-card,
 * niente 3 colonne strette che troncano). Ogni riga: a sinistra cosa significa,
 * a destra il numero grosso (mono, colore di tono) + il dettaglio.
 *
 * Vive dentro una tessera `surface surface-padded` del Tavolo (con eyebrow
 * "Decisioni" sopra), quindi qui NON c'e' surface: solo il contenuto.
 */
export function DecisionsCard({ decisions }: { decisions: Decisions }) {
  const conv = decisions.conversion_rate;
  const save = decisions.save_rate;
  const blow = decisions.blow_rate;

  return (
    <div className="flex flex-col">
      <DecisionRow
        tone={conv != null && conv >= 0.7 ? "good" : conv != null && conv < 0.55 ? "bad" : "mute"}
        label="Conversione"
        meaning="Chiudi quando arrivi in vantaggio"
        value={conv != null ? `${Math.round(conv * 100)}%` : "-"}
        detail={`${decisions.converted_winning} su ${decisions.reached_winning}`}
      />
      <DecisionRow
        tone={blow != null && blow > 0.3 ? "bad" : blow != null && blow < 0.15 ? "good" : "mute"}
        label="Vittorie buttate"
        meaning="Eri in vantaggio e l'hai persa"
        value={blow != null ? `${Math.round(blow * 100)}%` : "-"}
        detail={`${decisions.blew_winning} partite`}
      />
      <DecisionRow
        tone={save != null && save >= 0.35 ? "good" : "mute"}
        label="Salvataggi"
        meaning="Ti salvi da posizione persa"
        value={save != null ? `${Math.round(save * 100)}%` : "-"}
        detail={`${decisions.saved_losing} su ${decisions.reached_losing}`}
      />
    </div>
  );
}

function DecisionRow({
  tone,
  label,
  meaning,
  value,
  detail,
}: {
  tone: "good" | "bad" | "mute";
  label: string;
  meaning: string;
  value: string;
  detail: string;
}) {
  const accentColor =
    tone === "good"
      ? "var(--color-ok)"
      : tone === "bad"
      ? "var(--color-danger)"
      : "var(--color-text)";

  return (
    <div
      className="flex items-center justify-between gap-4 py-3"
      style={{ borderTop: "1px solid var(--color-line)" }}
    >
      <div className="min-w-0">
        <div className="text-sm font-semibold" style={{ color: "var(--color-text)" }}>
          {label}
        </div>
        <div className="text-xs mt-0.5" style={{ color: "var(--color-muted)" }}>
          {meaning}
        </div>
      </div>
      <div className="text-right shrink-0">
        <div
          className="font-mono font-bold tabular-nums"
          style={{ fontSize: "1.6rem", lineHeight: 1, color: accentColor }}
        >
          {value}
        </div>
        <div
          className="text-xs font-mono mt-1"
          style={{ color: "var(--color-muted)" }}
        >
          {detail}
        </div>
      </div>
    </div>
  );
}
