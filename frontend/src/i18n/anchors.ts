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
  careless: {
    it: {
      label: "Disattenzione",
      meaning:
        "Errori in posizioni non difficili dove avevi tempo e la mossa non era complicata. Se molli questa ancora guadagni punti sulle partite facili.",
      action: "Prima di muovere, un controllo veloce: cosa minaccia l'avversario.",
    },
    en: {
      label: "Inattention",
      meaning:
        "Errors in positions that were not hard — you had the time and the move was not complicated. Close this and you pick up points in the easy games.",
      action: "Before you move, one quick check: what is your opponent threatening.",
    },
  },
  hung_piece: {
    it: {
      label: "Pezzi in presa",
      meaning:
        "Lasci pezzi catturabili gratis. Se smetti di regalare materiale sali di rating direttamente.",
      action: "Controlla sempre le catture dell'avversario prima di muovere.",
    },
    en: {
      label: "Pieces given away",
      meaning:
        "You leave pieces that can be taken for free. Stop giving material away and the rating comes on its own.",
      action: "Before you move, check what your opponent can capture.",
    },
  },
  rushed: {
    it: {
      label: "Mosse impulsive",
      meaning:
        "Muovi troppo in fretta in momenti che chiedono calcolo. Rallentare nei critici vale punti concreti.",
      action: "Datti qualche secondo in piu' sui momenti critici.",
    },
    en: {
      label: "Rushed moves",
      meaning:
        "You move too fast in positions that ask for calculation. Slowing down at the critical moment is worth real points.",
      action: "Give yourself a few more seconds on the positions that matter.",
    },
  },
  conversion: {
    it: {
      label: "Vittorie buttate",
      meaning:
        "Eri in vantaggio e hai lasciato sfuggire la partita. Imparare a chiudere e' il salto di qualita' piu' diretto.",
      action: "Quando sei avanti semplifica e gioca solido.",
    },
    en: {
      label: "Games thrown away",
      meaning:
        "You were winning and let the game slip. Learning to close is the most direct step up you can take.",
      action: "When you are ahead, simplify. Play solid.",
    },
  },
  zeitnot: {
    it: {
      label: "Crolli in zeitnot",
      meaning:
        "Sbagli quando il tempo sta per finire. Gestire meglio l'orologio ti porta a convertire queste partite.",
      action: "Gestisci meglio l'orologio nelle fasi iniziali.",
    },
    en: {
      label: "Time trouble collapses",
      meaning:
        "You go wrong when the clock is running out. Better clock management earlier means you convert these games.",
      action: "Manage the clock in the opening and middlegame, not just at the end.",
    },
  },
  missed_tactic: {
    it: {
      label: "Tattiche mancate",
      meaning:
        "Posizioni acute con una mossa precisa che hai mancato. Riconoscere i pattern tattici e' il tuo prossimo gradino.",
      action: "Allena i pattern tattici ricorrenti.",
    },
    en: {
      label: "Missed tactics",
      meaning:
        "Sharp positions with one precise move that you did not find. Recognising the recurring patterns is your next step.",
      action: "Train the tactical patterns that keep coming up.",
    },
  },
  hard_calc: {
    it: {
      label: "Calcolo al limite",
      meaning:
        "Posizioni difficili dove ci hai pensato ma non l'hai trovata: e' il tuo prossimo gradino di crescita.",
      action: "Esercizi di calcolo piu' profondo.",
    },
    en: {
      label: "Deep calculation",
      meaning:
        "Hard positions where you thought it through but did not find it. This is your next level of growth.",
      action: "Work on calculation exercises that go a few moves deeper.",
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
