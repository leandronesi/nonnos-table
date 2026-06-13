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
import { tr } from "../i18n/lang";

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
    const { label_it, count, games_with, rating_upside, category, type, exemplars } = topAnchor;
    // games_with = partite distinte con almeno un errore di questo tipo
    // (sempre <= partite giocate): numero per-partita, mai assurdo.
    // count = occorrenze per-mossa: usabile solo se diciamo "momenti".
    const inPartite = tr(`in ${games_with} delle tue partite`, `in ${games_with} of your games`);
    const upsidePart =
      rating_upside != null && rating_upside > 0
        ? tr(
            ` Il piu' facile da recuperare: vali gia' ~${rating_upside} punti in piu'.`,
            ` Close this and you add ~${rating_upside} points. Nothing else needs to change.`,
          )
        : "";

    // Framing comparativo Maia quando disponibile
    const maiaPart =
      maiaWeighted != null && maiaWeighted.mine_pct != null && maiaWeighted.target_pct != null
        ? tr(
            ` Sulle stesse posizioni, uno al tuo livello ci finisce ${Math.round(maiaWeighted.mine_pct)}% delle volte. Un ${target ?? "giocatore come vuoi diventare"} il ${Math.round(maiaWeighted.target_pct)}%.`,
            ` On the same positions, a player at your level gets it right ${Math.round(maiaWeighted.mine_pct)}% of the time. A ${target ?? "player at your goal level"} gets it right ${Math.round(maiaWeighted.target_pct)}%.`,
          )
        : "";

    // [2E] Time-causal: for zeitnot/rushed anchors, inject real seconds from an exemplar.
    // Only when a real exemplar with spent_seconds is available — never invented.
    const isTimingAnchor = category === "timing" || type === "zeitnot" || type === "rushed";
    const timingExemplar = isTimingAnchor && exemplars && exemplars.length > 0
      ? exemplars.find((ex) => ex.spent_seconds != null && ex.spent_seconds > 0) ?? null
      : null;

    let body: string;
    if (isTimingAnchor && timingExemplar != null && timingExemplar.spent_seconds != null) {
      // Build a time-causal sentence using real seconds from the exemplar.
      const secs = Math.round(timingExemplar.spent_seconds);
      const timeStateLabel =
        timingExemplar.time_state === "zeitnot"
          ? tr("con l'orologio in crisi", "with the clock in crisis")
          : timingExemplar.time_state === "rushed"
            ? tr("di fretta", "in a hurry")
            : tr("in poco tempo", "too quickly");
      const avoidablePart = games_with >= 3
        ? tr(
            ` In ${games_with} partite e' successo su posizioni che potevi risolvere.`,
            ` Across ${games_with} games it happened on positions you could have solved.`,
          )
        : "";
      body = pick(0, [
        tr(
          `Ho guardato le tue partite. ${label_it}: in ${secs} secondi, ${timeStateLabel}, su mosse che valevano la pena di uno stop.${avoidablePart}${upsidePart}`,
          `I looked at your games. ${label_it}: you played in ${secs} seconds, ${timeStateLabel}, on moves that were worth stopping for.${avoidablePart}${upsidePart}`,
        ),
        tr(
          `Ti dico una cosa sola. ${label_it}: hai mosso in ${secs} secondi, ${timeStateLabel}. Non era una posizione semplice.${avoidablePart}${upsidePart}`,
          `One thing. ${label_it}: you moved in ${secs} seconds, ${timeStateLabel}. It was not a simple position.${avoidablePart}${upsidePart}`,
        ),
        tr(
          `La cosa piu' netta che ho visto: ${count} momenti mossi ${timeStateLabel} (${secs}s in uno di quelli). Quelle posizioni chiedevano piu' tempo.${avoidablePart}${upsidePart}`,
          `The clearest thing I saw: ${count} moments played ${timeStateLabel} (${secs}s in one of them). Those positions asked for more time.${avoidablePart}${upsidePart}`,
        ),
      ]);
    } else {
      body = pick(0, [
        tr(
          `Ho guardato le tue partite. ${label_it}, ${inPartite}, su mosse che uno al tuo livello trovava.${maiaPart}${upsidePart}`,
          `I looked at your games. ${label_it}, ${inPartite}, on moves that a player at your level finds.${maiaPart}${upsidePart}`,
        ),
        tr(
          `Ti dico una cosa sola. ${label_it}: ti e' successo ${inPartite}. Non in posizioni impossibili, in quelle che potevi chiudere.${maiaPart}${upsidePart}`,
          `One thing. ${label_it}: it happened ${inPartite}. Not in impossible positions. In the ones you could have closed.${maiaPart}${upsidePart}`,
        ),
        tr(
          `La cosa piu' netta che ho visto: ${label_it}, ${count} momenti in cui la mossa giusta era li' davanti. Mosse che uno come te trova, non di quelle che non si possono trovare.${maiaPart}${upsidePart}`,
          `The clearest thing I saw: ${label_it}, ${count} moments where the right move was right there. Moves a player like you finds. Not the ones no one finds.${maiaPart}${upsidePart}`,
        ),
      ]);
    }

    const close = pick(1, [
      tr("Una settimana su questo e i punti arrivano.", "One week on this and the points come."),
      tr("Questo e' il tuo margine. Quello su cui vale la pena lavorare adesso.", "This is your margin. The one worth working on right now."),
      tr("Non e' fortuna: e' attenzione. Alleniamo quello.", "It is not luck. It is attention. Let's train that."),
    ]);

    return { body, close };
  }

  // ── (b) blow_rate > 0.30 ─────────────────────────────────────────────────
  if (decisions != null && decisions.blow_rate != null && decisions.blow_rate > 0.30) {
    const blowPct = Math.round(decisions.blow_rate * 100);
    const blew = decisions.blew_winning ?? null;
    // blew_winning = numero di PARTITE vinte e poi lasciate andare (per-partita).
    const blewPartite = blew != null && blew > 0
      ? tr(`${blew} partite`, `${blew} games`)
      : null;

    const body = pick(2, [
      tr(
        `Eri in vantaggio e l'hai lasciata andare nel ${blowPct}% delle partite in cui avevi il vantaggio. Non e' un problema di forza, e' di chiusura. Le partite vinte si portano a casa.`,
        `You had the advantage and let it go in ${blowPct}% of the games where you were winning. It is not a problem of strength. It is a problem of closing. Won games need to be brought home.`,
      ),
      tr(
        `Il numero che mi disturba di piu': ${blewPartite ?? `il ${blowPct}% delle partite`} in cui eri avanti, e poi le hai perse. Quello non e' sfortuna.`,
        `The number that concerns me most: ${blewPartite ?? `${blowPct}% of the games`} where you were ahead, and then you lost them. That is not bad luck.`,
      ),
      tr(
        `Sai cosa vedo spesso? Stai vincendo. Poi dai via la partita. ${blewPartite ?? `Il ${blowPct}% di quelle in cui eri avanti`}. Le partite vinte si chiudono, non si tengono aperte.`,
        `You know what I see often? You are winning. Then you give the game away. ${blewPartite ?? `${blowPct}% of the ones where you were ahead`}. Won games get closed, not kept open.`,
      ),
    ]);

    const close = pick(3, [
      tr("Quello e' il gap che chiudiamo prima.", "That is the gap we close first."),
      tr("Lavoraci e il rating sale da solo.", "Work on this and the rating takes care of itself."),
      tr("Ogni partita chiusa e' un passo verso il target.", "Every game closed is a step toward your goal."),
    ]);

    return { body, close };
  }

  // ── (c) Fase con blunder_pct piu' alta ───────────────────────────────────
  if (byPhase != null) {
    const phases: { label: string; pct: number }[] = [
      { label: tr("apertura", "opening"), pct: byPhase.opening },
      { label: tr("mediogioco", "middlegame"), pct: byPhase.middlegame },
      { label: tr("finale", "endgame"), pct: byPhase.endgame },
    ].filter((p) => p.pct > 0);

    if (phases.length > 0) {
      const worst = phases.reduce((a, b) => (b.pct > a.pct ? b : a));
      const pctStr = worst.pct.toFixed(1);

      const body = pick(4, [
        tr(
          `E' nel ${worst.label} che lasci piu' punti: ${pctStr}% delle mosse sono un errore grave. Piu' che nelle altre fasi.`,
          `It is in the ${worst.label} where you lose the most points: ${pctStr}% of moves are a serious error. More than in any other phase.`,
        ),
        tr(
          `Un numero su tutti: ${pctStr}% di errori gravi nel ${worst.label}. Quella e' la fase dove ti costa di piu'.`,
          `One number: ${pctStr}% of serious errors in the ${worst.label}. That is the phase where it costs you most.`,
        ),
        tr(
          `Il ${worst.label} e' dove il rating si perde. ${pctStr}% di errori gravi, la percentuale piu' alta che hai.`,
          `The ${worst.label} is where the rating gets lost. ${pctStr}% serious errors, your highest.`,
        ),
      ]);

      const close = pick(5, [
        tr("Partiamo da li'.", "We start there."),
        tr("E' da li' che si recupera.", "That is where we get it back."),
        tr("Quello e' il posto giusto su cui lavorare.", "That is the right place to work."),
      ]);

      return { body, close };
    }
  }

  // ── (d) Fallback — no dati Maia/ancore ───────────────────────────────────
  const body = pick(6, [
    tr(
      "Ho scelto le posizioni delle tue ultime partite. Appena finisci di riananalizzare ti dico esattamente dov'e' il tuo gap.",
      "I have picked positions from your last games. Once the analysis is done I will tell you exactly where your gap is.",
    ),
    tr(
      "Le tue partite ci sono. Manca ancora l'analisi a fondo: appena finisce, ti dico una cosa sola su cui concentrarti.",
      "Your games are here. The deep analysis is still running. Once it is done, I will give you one thing to focus on.",
    ),
    tr(
      "Ci siamo quasi. Analizza le partite e poi ti racconto cosa ho visto.",
      "Almost there. Once the games are analyzed I will tell you what I saw.",
    ),
  ]);

  const close = pick(7, [
    tr("Per adesso, sediamoci.", "For now, let's sit down."),
    tr("Nel frattempo, sediamoci.", "In the meantime, let's sit down."),
    tr("Sediamoci.", "Let's sit down."),
  ]);

  return { body, close };
}

// ── Saluto builder ────────────────────────────────────────────────────────────

function buildSaluto(goal: Goal | null | undefined): string {
  if (!goal || goal.current_rating == null) {
    return pick(8, [
      tr("Eccoti. Siediti, che si comincia.", "There you are. Sit down. We have work to do."),
      tr("Ci sei. Bene.", "You're here. Good."),
      tr("Eccoti qui. Pronto?", "There you are. Ready?"),
    ]);
  }

  const { current_rating, target, on_track } = goal;

  if (on_track) {
    return pick(8, [
      tr(`Eccoti. ${current_rating} oggi, ${target} nel mirino. Sei in linea.`, `There you are. ${current_rating} today, ${target} in sight. You are on track.`),
      tr(`Ci sei. ${current_rating} adesso, ${target} l'obiettivo. Stai andando.`, `You're here. Good. ${current_rating} now, ${target} the goal. You are moving.`),
      tr(`Eccoti. ${current_rating} di rating, punta a ${target}. Sei in rotta.`, `There you are. ${current_rating} rating, aiming for ${target}. You are on course.`),
    ]);
  }

  return pick(8, [
    tr(`Eccoti. ${current_rating} oggi, ${target} nel mirino. Siamo un po' indietro, ma si recupera.`, `There you are. ${current_rating} today, ${target} in sight. We are a little behind, but we get it back.`),
    tr(`Ci sei. ${current_rating} adesso, ${target} l'obiettivo. C'e' del lavoro da fare, iniziamo.`, `You're here. Good. ${current_rating} now, ${target} the goal. There is work to do. Let's start.`),
    tr(`Eccoti. ${current_rating} di rating, ${target} nel mirino. Indietro, si'. Ma partita per partita si risale.`, `There you are. ${current_rating} rating, ${target} in sight. Behind, yes. But game by game we climb.`),
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
  /**
   * LLM-generated voice from coach_brief.json#voice_message.
   * When present and non-empty, replaces pickPunch (the template fallback).
   * The saluto (greeting line) is still rendered above the voice body.
   */
  voiceMessage?: string | null;
  /**
   * "Memoria visibile" — the continuity line ("L'altra volta abbiamo lavorato
   * su X. Riprendiamo da li'."). Rendered as a quiet first line INSIDE the card,
   * above the saluto: one voice, not two stacked boxes. Omitted when null.
   */
  memoria?: string | null;
  /**
   * When true, the component is rendered inside a NonnoLetter.
   * Removes the outer mb-8 wrapper margin (the letter provides its own padding).
   */
  inLetter?: boolean;
}

// ── Stagger delay slots (for CSS animation-delay) ─────────────────────────────
// Three stagger layers: saluto (100ms) | body (300ms) | CTA (500ms).
// CSS classes defined in index.css: .ng-stagger-1, .ng-stagger-2, .ng-stagger-3.

// ── Component ─────────────────────────────────────────────────────────────────

export function NonnoGreeting({
  goal,
  topAnchor,
  decisions,
  maiaWeighted,
  byPhase,
  onSediamoci,
  voiceMessage,
  memoria,
  inLetter = false,
}: NonnoGreetingProps) {
  const saluto = buildSaluto(goal);

  // Use LLM voice when available; fall back to deterministic pickPunch template.
  const useLlmVoice = voiceMessage != null && voiceMessage.trim().length > 0;
  const { body, close } = useLlmVoice
    ? { body: voiceMessage!.trim(), close: "" }
    : pickPunch(goal, topAnchor, decisions, maiaWeighted, byPhase);

  // Voice written on the wall — no box, no card. Content rests directly on the room.
  // When inside a letter, remove the outer margin (the letter padding takes over).
  return (
    <div className={inLetter ? undefined : "mb-8"}>
      {/* Memoria visibile — quiet line above the greeting, no box */}
      {memoria && memoria.trim().length > 0 && (
        <p
          style={{
            margin: 0,
            marginBottom: "0.75rem",
            fontSize: "0.78rem",
            lineHeight: 1.5,
            color: "var(--color-faint)",
            letterSpacing: "0.01em",
          }}
        >
          {memoria.trim()}
        </p>
      )}

      {/* Eyebrow */}
      <div
        className="tt-eyebrow"
        style={{ color: "var(--color-brand-soft)", marginBottom: "1rem" }}
      >
        Nonno
      </div>

      {/* Saluto — large serif voice on the wall, stagger layer 1 (100ms) */}
      <p
        className="ng-stagger-1"
        style={{
          margin: 0,
          marginBottom: "1.25rem",
          fontFamily: "var(--font-voice)",
          fontSize: "clamp(1.8rem, 5vw, 2.6rem)",
          fontWeight: 600,
          lineHeight: 1.2,
          color: "var(--color-text)",
        }}
      >
        {saluto}
      </p>

      {/* LA FRUSTATA — corpo (or LLM voice) — stagger layer 2 (300ms) */}
      <p
        className="ng-stagger-2"
        style={{
          margin: 0,
          marginBottom: useLlmVoice ? "1.75rem" : "0.75rem",
          fontSize: "1.125rem",
          lineHeight: 1.7,
          color: "var(--color-text-soft)",
          maxWidth: "36rem",
        }}
      >
        {body}
      </p>

      {/* Chiusura con speranza — Fraunces italic, wave B. Omitted when LLM voice is used. */}
      {close && (
        <p
          className="ng-stagger-2"
          style={{
            margin: 0,
            marginBottom: "1.75rem",
            fontFamily: "var(--font-voice)",
            fontStyle: "italic",
            fontSize: "1rem",
            lineHeight: 1.6,
            color: "var(--color-text)",
            fontWeight: 500,
            maxWidth: "36rem",
          }}
        >
          {close}
        </p>
      )}

      {/* CTA primaria — width auto: a button resting on the floor, not a full band */}
      <button
        onClick={onSediamoci}
        className="btn btn-primary btn-lg ng-stagger-3"
        style={{
          width: "auto",
          fontSize: "1rem",
          fontWeight: 700,
          padding: "0.875rem 2rem",
          letterSpacing: "0.01em",
          transition:
            "transform 160ms cubic-bezier(0.23,1,0.32,1), background 160ms cubic-bezier(0.23,1,0.32,1)",
        }}
      >
        {tr("Sediamoci al Tavolo", "Come to the Table.")}
      </button>

      {/* Fallback disclosure — shown only when using the template (no LLM brief) */}
      {!useLlmVoice && (
        <p
          style={{
            margin: 0,
            marginTop: "0.875rem",
            fontSize: "0.72rem",
            lineHeight: 1.4,
            color: "var(--color-faint)",
          }}
        >
          {tr("Non ho ancora letto le ultime partite.", "I have not read your latest games yet.")}
        </p>
      )}
    </div>
  );
}
