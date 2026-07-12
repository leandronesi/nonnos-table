/**
 * NonnoGreeting — il pugno dominante in cima al Tavolo.
 *
 * Struttura:
 *   1. Saluto + traiettoria (dove sei → dove vuoi arrivare)
 *   2. CTA primaria della sessione, sempre prima della voce variabile
 *   3. LA FRUSTATA (una cosa sola, la piu' netta, dai dati veri)
 *   4. Chiusura con speranza
 *
 * pickPunch — logica di selezione (in ordine di forza):
 *   a) anchors[0] se count >= 3: cite label + count + quota osservata
 *   b) blow_rate > 0.30: partite vinte lasciate andare
 *   c) fase con blunder_pct piu' alta: fase critica
 *   d) fallback (no dati Maia/ancore): saluto + traiettoria + "ci rivedremo presto"
 *
 * Tre varianti random-stabili per non essere meccanico (indice basato su data).
 * Graceful degradation: mai crash su dati assenti.
 */

import type { Anchor } from "../pipeline/aggregate";
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
  byPhase: ByPhaseSlim | null | undefined,
): PunchResult {
  const target = goal?.target ?? null;

  // ── (a) Ancora #1 con count >= 3 ──────────────────────────────────────────
  if (topAnchor != null && topAnchor.count >= 3) {
    const { label_it, count, games_with, share_of_errors, category, type, exemplars } = topAnchor;
    // games_with = partite distinte con almeno un errore di questo tipo
    // (sempre <= partite giocate): numero per-partita, mai assurdo.
    // count = occorrenze per-mossa: usabile solo se diciamo "momenti".
    const inPartite = tr(`in ${games_with} delle tue partite`, `in ${games_with} of your games`);
    const sharePct = Math.round(Math.max(0, share_of_errors ?? 0) * 100);
    const priorityPart =
      sharePct > 0
        ? tr(
            ` Rappresenta il ${sharePct}% degli errori osservati.`,
            ` It represents ${sharePct}% of the observed errors.`,
          )
        : "";

    // Anchor-specific Maia context. Never attribute the global average to one pattern.
    const anchorMine = topAnchor.mine_acceptable_observed_policy_pct ?? topAnchor.mine_pct;
    const anchorTarget = topAnchor.target_acceptable_observed_policy_pct ?? topAnchor.target_pct;
    const maiaPart = anchorMine != null && anchorTarget != null
      ? tr(
          ` Su questo gruppo, gli indici Maia sulle mosse accettabili osservate sono ${Math.round(anchorMine)} al livello attuale e ${Math.round(anchorTarget)} al target${target != null ? ` ${target}` : ""}: masse di policy relative, non frequenze umane.`,
          ` For this group, Maia indices on the observed acceptable moves are ${Math.round(anchorMine)} at the current level and ${Math.round(anchorTarget)} at the${target != null ? ` ${target}` : ""} target: relative policy masses, not human frequencies.`,
        )
      : "";

    // Timing context: cite observed seconds without turning association into cause.
    // Only when a real exemplar with spent_seconds is available — never invented.
    const isTimingAnchor = category === "timing" || type === "zeitnot" || type === "rushed";
    const timingExemplar = isTimingAnchor && exemplars && exemplars.length > 0
      ? exemplars.find((ex) => ex.spent_seconds != null && ex.spent_seconds > 0) ?? null
      : null;

    let body: string;
    if (isTimingAnchor && timingExemplar != null && timingExemplar.spent_seconds != null) {
      // Build an observational sentence using real seconds from the exemplar.
      const secs = Math.round(timingExemplar.spent_seconds);
      const timeStateLabel =
        timingExemplar.time_state === "zeitnot"
          ? tr("nella fascia con poco tempo rimasto", "in the low-time-remaining band")
          : timingExemplar.time_state === "rushed"
            ? tr("nella fascia di mosse rapide", "in the fast-move band")
            : tr("nella fascia di tempo breve", "in the short-time band");
      const avoidablePart = games_with >= 3
        ? tr(
            ` Il pattern compare in ${games_with} partite.`,
            ` The pattern appears across ${games_with} games.`,
          )
        : "";
      body = pick(0, [
        tr(
          `Ho guardato le tue partite. ${label_it}: in un episodio hai mosso in ${secs} secondi, ${timeStateLabel}.${avoidablePart} Il tempo è un segnale, non una causa provata.${priorityPart}`,
          `I looked at your games. ${label_it}: in one episode you moved in ${secs} seconds, ${timeStateLabel}.${avoidablePart} Time is a signal, not a proven cause.${priorityPart}`,
        ),
        tr(
          `Ti dico una cosa sola. ${label_it}: in un episodio hai mosso in ${secs} secondi, ${timeStateLabel}.${avoidablePart} Rivediamo insieme posizione e orologio.${priorityPart}`,
          `One thing. ${label_it}: in one episode you moved in ${secs} seconds, ${timeStateLabel}.${avoidablePart} We will review the position and clock together.${priorityPart}`,
        ),
        tr(
          `La cosa più netta che ho visto: ${count} momenti ${timeStateLabel}; in uno hai speso ${secs}s.${avoidablePart} Rivediamo insieme quegli episodi.${priorityPart}`,
          `The clearest thing I saw: ${count} moments ${timeStateLabel}; in one you spent ${secs}s.${avoidablePart} Let us review those episodes together.${priorityPart}`,
        ),
      ]);
    } else {
      body = pick(0, [
        tr(
          `Ho guardato le tue partite. ${label_it}: il gruppo compare ${inPartite}.${maiaPart}${priorityPart}`,
          `I looked at your games. ${label_it}: this group appears ${inPartite}.${maiaPart}${priorityPart}`,
        ),
        tr(
          `Ti dico una cosa sola. ${label_it}: compare ${inPartite} ed è il gruppo con priorità relativa più alta fra quelli osservati disponibili.${maiaPart}${priorityPart}`,
          `One thing. ${label_it}: it appears ${inPartite} and has the highest relative priority among the observed groups available.${maiaPart}${priorityPart}`,
        ),
        tr(
          `La cosa più netta che ho visto: ${label_it}, ${count} momenti osservati nelle tue partite. Partiamo da quelli.${maiaPart}${priorityPart}`,
          `The clearest thing I saw: ${label_it}, ${count} moments observed in your games. We start there.${maiaPart}${priorityPart}`,
        ),
      ]);
    }

    const close = pick(1, [
      tr("Una settimana su questo e vediamo se il pattern ricompare meno.", "One week on this, then we check whether the pattern appears less often."),
      tr("Questo è il gruppo osservato su cui vale la pena lavorare adesso.", "This is the observed group worth working on now."),
      tr("Il pattern ricorre nelle partite osservate. Alleniamo la risposta sulla scacchiera.", "The pattern recurs in the observed games. Let us train the response on the board."),
    ]);

    return { body, close };
  }

  // ── (b) blow_rate > 0.30 ─────────────────────────────────────────────────
  if (decisions != null && decisions.blow_rate != null && decisions.blow_rate > 0.30 && decisions.reached_winning > 0) {
    const blowPct = Math.round(decisions.blow_rate * 100);
    const blew = decisions.blew_winning;
    const reached = decisions.reached_winning;
    const conversionSample = tr(
      `${blew} delle ${reached} partite in cui hai raggiunto un vantaggio decisivo`,
      `${blew} of the ${reached} games in which you reached a decisive advantage`,
    );

    const body = pick(2, [
      tr(
        `Nelle partite osservate, ${conversionSample} non sono diventate una vittoria (${blowPct}%). Rivediamo la conversione.`,
        `In the observed games, ${conversionSample} did not become a win (${blowPct}%). Let us review conversion.`,
      ),
      tr(
        `Un dato osservato: ${conversionSample} sono partite non vinte (${blowPct}%). Rivediamo quelle posizioni di vantaggio.`,
        `One observed figure: ${conversionSample} were not won (${blowPct}%). Let us review those advantageous positions.`,
      ),
      tr(
        `Quando eri arrivato a un vantaggio decisivo, ${blew} partite su ${reached} non sono diventate una vittoria (${blowPct}%). Guardiamo le decisioni osservate.`,
        `After reaching a decisive advantage, ${blew} games out of ${reached} did not become a win (${blowPct}%). Let us inspect the observed decisions.`,
      ),
    ]);

    const close = pick(3, [
      tr("Partiamo dalla tecnica di conversione.", "We start with conversion technique."),
      tr("Lavoriamo sulle decisioni osservate quando eri avanti.", "We work on the observed decisions when you were ahead."),
      tr("Rivediamo come hai gestito il vantaggio sulla scacchiera.", "Let us review how you handled the advantage on the board."),
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
          `Nelle partite osservate, il ${worst.label} ha la quota più alta di errori gravi: ${pctStr}% delle mosse in quella fase.`,
          `In the observed games, the ${worst.label} has the highest serious-error share: ${pctStr}% of moves in that phase.`,
        ),
        tr(
          `Un numero osservato: ${pctStr}% di errori gravi nel ${worst.label}, la quota più alta fra le fasi.`,
          `One observed number: ${pctStr}% serious errors in the ${worst.label}, the highest share across phases.`,
        ),
        tr(
          `Nel ${worst.label}, il ${pctStr}% delle mosse osservate è un errore grave: è la percentuale più alta fra le fasi.`,
          `In the ${worst.label}, ${pctStr}% of observed moves are serious errors: the highest percentage across phases.`,
        ),
      ]);

      const close = pick(5, [
        tr("Partiamo da li'.", "We start there."),
        tr("Alleniamo quella fase per prima.", "We train that phase first."),
        tr("Quella fase merita la prima revisione.", "That phase deserves the first review."),
      ]);

      return { body, close };
    }
  }

  // ── (d) Fallback — riepilogo neutro sui dati disponibili ─────────────────
  const body = pick(6, [
    tr(
      "Con i dati disponibili ho scelto un momento concreto delle tue partite da rivedere.",
      "From the data available, I selected one concrete moment from your games to review.",
    ),
    tr(
      "Partiamo da una posizione osservata nelle partite disponibili, senza aggiungere conclusioni che il campione non sostiene.",
      "We start from a position observed in the available games, without adding conclusions the sample does not support.",
    ),
    tr(
      "Oggi lavoriamo su un episodio concreto fra quelli disponibili.",
      "Today we work on one concrete episode among those available.",
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

  const { current_rating, target } = goal;
  return pick(8, [
    tr(`Eccoti. Rating attuale ${current_rating}, obiettivo scelto ${target}. Oggi guardiamo una cosa concreta.`, `There you are. Current rating ${current_rating}, chosen goal ${target}. Today we look at one concrete thing.`),
    tr(`Ci sei. ${current_rating} adesso, ${target} come obiettivo. Iniziamo dalle partite osservate.`, `You're here. ${current_rating} now, ${target} as your goal. We start from the observed games.`),
    tr(`Eccoti. ${current_rating} di rating, target ${target}. Vediamo il pattern scelto per oggi.`, `There you are. ${current_rating} rating, ${target} target. Let us see today's selected pattern.`),
  ]);
}

// ── Slim types (only what we need from the data) ─────────────────────────────

interface DecisionsSlim {
  blow_rate: number | null;
  blew_winning: number;
  reached_winning: number;
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
  byPhase: ByPhaseSlim | null | undefined;
  onSediamoci: () => void;
  sessionStatus?: "new" | "in_progress" | "completed";
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
}

// ── Stagger delay slots (for CSS animation-delay) ─────────────────────────────
// Three stagger layers: saluto (100ms) | CTA (300ms) | voce (500ms).
// CSS classes defined in index.css: .ng-stagger-1, .ng-stagger-2, .ng-stagger-3.

// ── Component ─────────────────────────────────────────────────────────────────

export function NonnoGreeting({
  goal,
  topAnchor,
  decisions,
  byPhase,
  onSediamoci,
  sessionStatus = "new",
  voiceMessage,
  memoria,
}: NonnoGreetingProps) {
  const saluto = buildSaluto(goal);

  // Use LLM voice when available; fall back to deterministic pickPunch template.
  const useLlmVoice = voiceMessage != null && voiceMessage.trim().length > 0;
  const { body, close } = useLlmVoice
    ? { body: voiceMessage!.trim(), close: "" }
    : pickPunch(goal, topAnchor, decisions, byPhase);

  // Voice written on the wall — no box, no card. Content rests directly on the room.
  return (
    <div className="ng-root mb-8">
      {/* Memoria visibile — quiet line above the greeting, no box */}
      {memoria && memoria.trim().length > 0 && (
        <p
          className="ng-memory"
          style={{
            color: "var(--color-faint)",
            letterSpacing: "0.01em",
          }}
        >
          {memoria.trim()}
        </p>
      )}

      {/* Eyebrow */}
      <div
        className="tt-eyebrow ng-eyebrow"
        style={{ color: "var(--color-brand-soft)" }}
      >
        Nonno
      </div>

      {/* Saluto — large serif voice on the wall, stagger layer 1 (100ms) */}
      <p
        className="ng-stagger-1 ng-saluto"
        style={{
          fontFamily: "var(--font-voice)",
          fontWeight: 600,
          color: "var(--color-text)",
        }}
      >
        {saluto}
      </p>

      {/* The primary decision comes before any variable-length voice copy. */}
      <div className="ng-primary-action ng-stagger-2">
        <button
          type="button"
          onClick={onSediamoci}
          className="btn btn-primary btn-lg w-full sm:w-auto"
          data-session-trigger="true"
          style={{
            fontSize: "1rem",
            fontWeight: 700,
            padding: "0.875rem 2rem",
            letterSpacing: "0.01em",
            transition:
              "transform 160ms cubic-bezier(0.23,1,0.32,1), background 160ms cubic-bezier(0.23,1,0.32,1)",
          }}
        >
          {sessionStatus === "in_progress"
            ? tr("Riprendi la sessione di oggi", "Resume today's session")
            : sessionStatus === "completed"
              ? tr("Rivedi la sessione di oggi", "Review today's session")
              : tr("Inizia la sessione di oggi", "Start today's session")}
        </button>
        <p className="ng-primary-microcopy">
          {sessionStatus === "in_progress"
            ? tr(
                "Riparte dalla fase salvata; non perdi i passaggi già completati.",
                "Resumes from the saved phase; completed steps are preserved.",
              )
            : sessionStatus === "completed"
              ? tr(
                  "Riapre il riepilogo salvato. Se avevi scelto Rivedi, torna direttamente a quella fase.",
                  "Reopens the saved recap. If you chose Review, it returns directly to that phase.",
                )
              : tr(
                  "Guardi una posizione, provi con aiuto, poi da solo e infine giochi.",
                  "Review a position, try with help, then on your own, and finally play.",
                )}
        </p>
      </div>

      {/* LA FRUSTATA — corpo (or LLM voice), after the primary decision. */}
      <p
        className="ng-stagger-3"
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
          className="ng-stagger-3"
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
          {tr(
            "Questa lettura usa i dati già disponibili sul Tavolo.",
            "This reading uses the data already available on the Table.",
          )}
        </p>
      )}
    </div>
  );
}
