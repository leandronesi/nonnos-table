/**
 * anchors.ts — language-aware resolver for anchor (weakness) labels.
 *
 * Design:
 *  - Keyed by errorType string (canonical keys from analyze.ts error-tree).
 *  - Works on the KEY, not on stored label_it — so it works for aggregates.json
 *    written before this file existed, with no re-analysis needed.
 *  - Fallback: unknown key returns Italian text if it exists on the Anchor
 *    object, otherwise a placeholder.
 *  - Italian is the canonical source; English is transcreated following EN.md
 *    (Nonno's voice, second person, direct, no hype, no engine-speak).
 */

import type { Lang } from "./lang";

interface AnchorCopy {
  label: string;
  meaning: string;
  action: string;
}

type AnchorMeta = Record<string, { it: AnchorCopy; en: AnchorCopy }>;

/**
 * Canonical copy for all 8 errorType keys.
 *
 * Italian: source from WEAKNESS_META in aggregate.ts.
 * English: transcreated to Nonno's EN voice (EN.md).
 *   - Second person, "you".
 *   - Direct, warm, no hype.
 *   - Chess language (not "hung piece" engine-speak, but "you gave the piece away").
 *   - Label = noun phrase (the anchor name).
 *   - Meaning = one sentence with the upside framing.
 *   - Action = one sentence, plain directive.
 */
const ANCHOR_META: AnchorMeta = {
  left_winning_band: {
    it: {
      label: "Uscita dalla fascia winning",
      meaning: "La valutazione era sopra la soglia winning ed e' scesa sotto quella soglia; puo' restare positiva.",
      action: "Rivedi quali semplificazioni o controlli mantenevano il vantaggio.",
    },
    en: {
      label: "Left the winning band",
      meaning: "The evaluation was above the winning threshold and fell below it; it may still remain positive.",
      action: "Review which simplification or safety check preserved the advantage.",
    },
  },
  clock_pressure: {
    it: {
      label: "Errore con poco tempo",
      meaning: "L'errore e' avvenuto sotto la soglia del clock; questo descrive il contesto, non la causa.",
      action: "Ricostruisci dove hai usato il tempo prima di questa posizione.",
    },
    en: {
      label: "Error under clock pressure",
      meaning: "The error happened below the clock threshold; that describes context, not cause.",
      action: "Trace where you used your time before reaching this position.",
    },
  },
  fast_decision: {
    it: {
      label: "Decisione rapida",
      meaning: "La mossa-errore e' stata giocata in tre secondi o meno; il clock da solo non ne prova la causa.",
      action: "Ripeti la posizione senza fretta e confronta il processo.",
    },
    en: {
      label: "Fast decision",
      meaning: "The error move was played in three seconds or less; the clock alone does not prove why.",
      action: "Replay the position without time pressure and compare your process.",
    },
  },
  narrow_choice_after_long_think: {
    it: {
      label: "Scelta stretta dopo riflessione",
      meaning: "Hai pensato a lungo e le linee MultiPV osservate avevano un divario netto; non prova una tattica mancata.",
      action: "Ricostruisci le candidate e le varianti che avevi considerato.",
    },
    en: {
      label: "Narrow choice after a long think",
      meaning: "You thought for a while and the observed MultiPV lines had a clear gap; this does not prove a missed tactic.",
      action: "Rebuild the candidate moves and lines you considered.",
    },
  },
  unclassified_error: {
    it: {
      label: "Errore da classificare",
      meaning: "La perdita e' reale, ma i segnali disponibili non sostengono una spiegazione piu' specifica.",
      action: "Rivedi la posizione e annota cosa avevi calcolato.",
    },
    en: {
      label: "Unclassified error",
      meaning: "The loss is real, but the available signals do not support a more specific explanation.",
      action: "Review the position and write down what you had calculated.",
    },
  },
  careless: {
    it: {
      label: "Errore non classificato (storico)",
      meaning: "Categoria legacy usata quando mancava una spiegazione supportata; non prova una disattenzione.",
      action: "Rianalizza la posizione con la nuova tassonomia fattuale.",
    },
    en: {
      label: "Unclassified error (legacy)",
      meaning: "A legacy fallback used when no supported explanation was available; it does not prove inattention.",
      action: "Reanalyse the position with the factual taxonomy.",
    },
  },
  hung_piece: {
    it: {
      label: "Pezzi in presa",
      meaning: "Dopo la mossa il rilevatore geometrico trova un pezzo catturabile senza ricattura immediata.",
      action: "Controlla sempre le catture dell'avversario prima di muovere.",
    },
    en: {
      label: "Pieces given away",
      meaning: "After the move, the geometric detector finds a piece that can be captured without an immediate recapture.",
      action: "Before you move, check what your opponent can capture.",
    },
  },
  rushed: {
    it: {
      label: "Decisione rapida (storico)",
      meaning: "Categoria legacy basata sul tempo speso; la velocita' da sola non dimostra la causa dell'errore.",
      action: "Confronta la stessa posizione con e senza limite di tempo.",
    },
    en: {
      label: "Fast decision (legacy)",
      meaning: "A legacy category based on time spent; speed alone does not establish the cause of an error.",
      action: "Compare the same position with and without a time limit.",
    },
  },
  conversion: {
    it: {
      label: "Vantaggio prima dell'errore (storico)",
      meaning: "Categoria legacy: indicava solo una valutazione sopra soglia prima della mossa, non la perdita della partita.",
      action: "Verifica se la valutazione e' davvero uscita dalla fascia winning.",
    },
    en: {
      label: "Advantage before the error (legacy)",
      meaning: "A legacy category that only meant the pre-move evaluation was above a threshold, not that the game was thrown away.",
      action: "Check whether the evaluation actually left the winning band.",
    },
  },
  zeitnot: {
    it: {
      label: "Errore con poco tempo (storico)",
      meaning: "Categoria legacy per errori sotto la soglia clock; descrive il contesto, non una causa.",
      action: "Ricostruisci dove hai speso il tempo nella partita.",
    },
    en: {
      label: "Error with little time (legacy)",
      meaning: "A legacy category for errors below the clock threshold; it describes context, not cause.",
      action: "Trace where you spent your time earlier in the game.",
    },
  },
  missed_tactic: {
    it: {
      label: "Divario MultiPV (storico)",
      meaning: "Categoria legacy inferita dal divario tra linee; quel dato da solo non prova una tattica mancata.",
      action: "Cerca un motivo tattico verificabile prima di assegnare un tema.",
    },
    en: {
      label: "MultiPV gap (legacy)",
      meaning: "A legacy category inferred from the gap between lines; that alone does not prove a missed tactic.",
      action: "Look for a verifiable tactical motif before assigning a theme.",
    },
  },
  hard_calc: {
    it: {
      label: "Scelta stretta dopo riflessione (storico)",
      meaning: "Categoria legacy basata su tempo lungo e divario MultiPV; non identifica da sola la causa.",
      action: "Annota candidate e linee realmente calcolate.",
    },
    en: {
      label: "Narrow choice after a long think (legacy)",
      meaning: "A legacy category based on a long think and a MultiPV gap; it does not identify the cause by itself.",
      action: "Write down the candidate moves and lines you actually calculated.",
    },
  },
  // Note: in_lost_position is excluded from anchors (filtered in aggregate.ts),
  // but we define it here for completeness — it will not appear in UI.
  in_lost_position: {
    it: {
      label: "Posizione persa",
      meaning:
        "Errori commessi quando eri gia' in svantaggio.",
      action: "Concentrati su come evitare di entrare in queste posizioni.",
    },
    en: {
      label: "Already losing",
      meaning:
        "Errors made when you were already behind.",
      action: "Focus on staying out of these positions in the first place.",
    },
  },
};

/**
 * Returns label, meaning, and action for an anchor key in the requested language.
 *
 * @param key        errorType string (e.g. "careless", "hung_piece")
 * @param lang       "it" | "en" — current UI language
 * @param fallbackIt Italian strings from the Anchor object in aggregates.json.
 *                   Used when `key` is not in ANCHOR_META (forward-compat guard).
 */
export function getAnchorMeta(
  key: string,
  lang: Lang,
  fallbackIt?: { label_it?: string; meaning_it?: string; action_it?: string }
): AnchorCopy {
  const entry = ANCHOR_META[key];
  if (entry) {
    return lang === "en" ? entry.en : entry.it;
  }
  // Unknown key: fall back to Italian data from the Anchor object.
  return {
    label: fallbackIt?.label_it ?? key,
    meaning: fallbackIt?.meaning_it ?? "",
    action: fallbackIt?.action_it ?? "",
  };
}

/**
 * Convenience: returns only the label for an anchor key.
 */
export function getAnchorLabel(
  key: string,
  lang: Lang,
  fallbackLabel?: string
): string {
  const entry = ANCHOR_META[key];
  if (entry) return lang === "en" ? entry.en.label : entry.it.label;
  return fallbackLabel ?? key;
}
