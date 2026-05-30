/**
 * NonnoGreeting — il pugno dominante in cima al Tavolo.
 *
 * Struttura:
 *   1. Saluto + traiettoria (dove sei → dove vuoi arrivare)
 *   2. LA FRUSTATA (una cosa sola, la piu' netta, dai dati veri)
 *   3. Chiusura con speranza
 *   4. CTA primaria "Sediamoci al Tavolo" — DENTRO questo componente
 *
 * pickPunch — logica di selezione (in ordine di forza):
 *   a) anchors[0] se count >= 3: cite label + count + rating_upside
 *   b) blow_rate > 0.30: partite vinte lasciate andare
 *   c) fase con blunder_pct piu' alta: fase critica
 *   d) fallback (no dati Maia/ancore): saluto + traiettoria + "ci rivedremo presto"
 *
 * Tre varianti random-stabili per non essere meccanico (indice basato su data).
 * Graceful degradation: mai crash su dati assenti.
 */

import type { Anchor, MaiaWeighted } from "../pipeline/aggregate";
import type { Goal } from "../types";

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Pseudo-random variant index stable within the same calendar day. */
function dailyVariant(slot: number, n: number): number {
  const day = Math.floor(Date.now() / 86400000);
  return (day * 7 + slot * 13) % n;
}

function pick<T>(slot: number, items: T[]): T {
  return items[dailyVariant(slot, items.length)];
}

// ── Punch lines ───────────────────────────────────────────────────────────────

type PunchResult = {
  body: string;
  close: string;
};

/**
 * Selects the single most compelling truth from the available data.
 * Returns { body, close } for the "frustata" section.
 */
function pickPunch(
  goal: Goal | null | undefined,
  topAnchor: Anchor | null | undefined,
  decisions: DecisionsSlim | null | undefined,
  maiaWeighted: MaiaWeighted | null | undefined,
  byPhase: ByPhaseSlim | null | undefined,
): PunchResult {
  const target = goal?.target ?? null;

  // ── (a) Ancora #1 con count >= 3 ──────────────────────────────────────────
  if (topAnchor != null && topAnchor.count >= 3) {
    const { label_it, count, rating_upside } = topAnchor;
    const upsidePart =
      rating_upside != null && rating_upside > 0
        ? ` Il piu' facile da recuperare: vali gia' ~${rating_upside} punti in piu'.`
        : "";

    // Framing comparativo Maia quando disponibile
    const maiaPart =
      maiaWeighted != null && maiaWeighted.mine_pct != null && maiaWeighted.target_pct != null
        ? ` Sulle stesse posizioni, uno al tuo livello ci finisce ${Math.round(maiaWeighted.mine_pct)}% delle volte. Un ${target ?? "giocatore come vuoi diventare"} il ${Math.round(maiaWeighted.target_pct)}%.`
        : "";

    const body = pick(0, [
      `Ho guardato le tue partite. ${label_it}: ${count} volte, su mosse che uno al tuo livello trovava.${maiaPart}${upsidePart}`,
      `Ti dico una cosa sola. ${label_it} e' tornato ${count} volte. Non in posizioni impossibili: in quelle che potevi chiudere.${maiaPart}${upsidePart}`,
      `La cosa piu' netta che ho visto: ${label_it}, ${count} volte di fila. Mosse che uno come te trova, non che non si possono trovare.${maiaPart}${upsidePart}`,
    ]);

    const close = pick(1, [
      "Una settimana su questo e i punti arrivano.",
      "Questo e' il tuo margine. Quello su cui vale la pena lavorare adesso.",
      "Non e' fortuna: e' attenzione. Alleniamo quello.",
    ]);

    return { body, close };
  }

  // ── (b) blow_rate > 0.30 ─────────────────────────────────────────────────
  if (decisions != null && decisions.blow_rate != null && decisions.blow_rate > 0.30) {
    const blowPct = Math.round(decisions.blow_rate * 100);
    const blew = decisions.blew_winning ?? null;
    const blewStr = blew != null && blew > 0 ? `${blew} volte` : `il ${blowPct}% delle volte`;

    const body = pick(2, [
      `Eri in vantaggio e l'hai lasciata andare ${blewStr} (${blowPct}%). Non e' un problema di forza: e' di chiusura. Le partite vinte si portano a casa.`,
      `Il numero che mi disturba di piu': eri avanti, e hai perso ${blewStr}. ${blowPct}% delle partite in cui avevi il vantaggio. Quello non e' sfortuna.`,
      `Sai cosa vedo spesso? Stai vincendo. Poi dai via la partita. ${blew != null ? `${blew} volte` : `${blowPct}% delle partite`}. Le partite vinte si chiudono, non si tengono aperte.`,
    ]);

    const close = pick(3, [
      "Quello e' il gap che chiudiamo prima.",
      "Lavoraci e il rating sale da solo.",
      "Ogni partita chiusa e' un passo verso il target.",
    ]);

    return { body, close };
  }

  // ── (c) Fase con blunder_pct piu' alta ───────────────────────────────────
  if (byPhase != null) {
    const phases: { label: string; pct: number }[] = [
      { label: "apertura", pct: byPhase.opening },
      { label: "mediogioco", pct: byPhase.middlegame },
      { label: "finale", pct: byPhase.endgame },
    ].filter((p) => p.pct > 0);

    if (phases.length > 0) {
      const worst = phases.reduce((a, b) => (b.pct > a.pct ? b : a));
      const pctStr = worst.pct.toFixed(1);

      const body = pick(4, [
        `E' nel ${worst.label} che lasci piu' punti: ${pctStr}% delle mosse sono un errore grave. Piu' che nelle altre fasi.`,
        `Un numero su tutti: ${pctStr}% di errori gravi nel ${worst.label}. Quella e' la fase dove ti costa di piu'.`,
        `Il ${worst.label} e' dove il rating si perde. ${pctStr}% di errori gravi, la percentuale piu' alta che hai.`,
      ]);

      const close = pick(5, [
        "Partiamo da li'.",
        "E' da li' che si recupera.",
        "Quello e' il posto giusto su cui lavorare.",
      ]);

      return { body, close };
    }
  }

  // ── (d) Fallback — no dati Maia/ancore ───────────────────────────────────
  const body = pick(6, [
    "Ho scelto le posizioni delle tue ultime partite. Appena finisci di riananalizzare ti dico esattamente dov'e' il tuo gap.",
    "Le tue partite ci sono. Manca ancora l'analisi a fondo: appena finisce, ti dico una cosa sola su cui concentrarti.",
    "Ci siamo quasi. Analizza le partite e poi ti racconto cosa ho visto.",
  ]);

  const close = pick(7, [
    "Per adesso, sediamoci.",
    "Nel frattempo, sediamoci.",
    "Sediamoci.",
  ]);

  return { body, close };
}

// ── Saluto builder ────────────────────────────────────────────────────────────

function buildSaluto(goal: Goal | null | undefined): string {
  if (!goal || goal.current_rating == null) {
    return pick(8, [
      "Oooh, eccoti. Siediti, che si comincia.",
      "Oooh, ci sei. Bene.",
      "Eccoti qui. Pronto?",
    ]);
  }

  const { current_rating, target, on_track } = goal;

  if (on_track) {
    return pick(8, [
      `Oooh, eccoti. ${current_rating} oggi, ${target} nel mirino. Sei in linea.`,
      `Oooh, ci sei. ${current_rating} adesso, ${target} l'obiettivo. Stai andando.`,
      `Eccoti. ${current_rating} di rating, punta a ${target}. Sei in rotta.`,
    ]);
  }

  return pick(8, [
    `Oooh, eccoti. ${current_rating} oggi, ${target} nel mirino. Siamo un po' indietro, ma si recupera.`,
    `Oooh, ci sei. ${current_rating} adesso, ${target} l'obiettivo. C'e' del lavoro da fare, iniziamo.`,
    `Eccoti. ${current_rating} di rating, ${target} nel mirino. Indietro, si'. Ma partita per partita si risale.`,
  ]);
}

// ── Slim types (only what we need from the data) ─────────────────────────────

interface DecisionsSlim {
  blow_rate: number | null;
  blew_winning: number;
}

interface ByPhaseSlim {
  opening: number;
  middlegame: number;
  endgame: number;
}

// ── Props ─────────────────────────────────────────────────────────────────────

export interface NonnoGreetingProps {
  goal: Goal | null | undefined;
  topAnchor: Anchor | null | undefined;
  decisions: DecisionsSlim | null | undefined;
  maiaWeighted: MaiaWeighted | null | undefined;
  byPhase: ByPhaseSlim | null | undefined;
  onSediamoci: () => void;
}

// ── Component ─────────────────────────────────────────────────────────────────

export function NonnoGreeting({
  goal,
  topAnchor,
  decisions,
  maiaWeighted,
  byPhase,
  onSediamoci,
}: NonnoGreetingProps) {
  const saluto = buildSaluto(goal);
  const { body, close } = pickPunch(goal, topAnchor, decisions, maiaWeighted, byPhase);

  return (
    <div
      className="mb-8"
      style={{
        background: "var(--color-surface)",
        border: "1px solid var(--color-line)",
        borderRadius: "14px",
        padding: "clamp(20px, 4vw, 28px)",
      }}
    >
      {/* Eyebrow */}
      <div
        className="tt-eyebrow"
        style={{ color: "var(--color-brand-soft)", marginBottom: "1.25rem" }}
      >
        Nonno
      </div>

      {/* Saluto + traiettoria */}
      <p
        style={{
          margin: 0,
          marginBottom: "1rem",
          fontFamily: "var(--font-display, 'Inter Tight', Inter, system-ui, sans-serif)",
          fontSize: "clamp(1.35rem, 3.5vw, 1.75rem)",
          fontWeight: 700,
          lineHeight: 1.25,
          letterSpacing: "-0.01em",
          color: "var(--color-text)",
        }}
      >
        {saluto}
      </p>

      {/* LA FRUSTATA — corpo */}
      <p
        style={{
          margin: 0,
          marginBottom: "0.75rem",
          fontSize: "1.05rem",
          lineHeight: 1.65,
          color: "var(--color-text-soft)",
        }}
      >
        {body}
      </p>

      {/* Chiusura con speranza */}
      <p
        style={{
          margin: 0,
          marginBottom: "1.75rem",
          fontSize: "1rem",
          lineHeight: 1.6,
          color: "var(--color-text)",
          fontWeight: 500,
        }}
      >
        {close}
      </p>

      {/* CTA primaria — vive qui, non in fondo alla pagina */}
      <button
        onClick={onSediamoci}
        className="btn btn-primary btn-lg"
        style={{
          width: "100%",
          fontSize: "1rem",
          fontWeight: 700,
          padding: "0.875rem 1.5rem",
          letterSpacing: "0.01em",
          transition:
            "transform 160ms cubic-bezier(0.23,1,0.32,1), background 160ms cubic-bezier(0.23,1,0.32,1)",
        }}
      >
        Sediamoci al Tavolo
      </button>
    </div>
  );
}
