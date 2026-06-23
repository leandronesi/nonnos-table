/**
 * teachClient.ts — client per la modalita' "insegna" di coach-llm.
 *
 * Contratto: riceve position + facts + ctx, chiama coach-llm con mode:"teach",
 * ritorna la lezione del maestro (stringa) o null se offline/rate-limit/errore.
 * Mai lancia: il chiamante fa fallback al floor deterministico.
 *
 * Cache localStorage: chiave = hash di (fen_before|played_san|best_san|lang).
 * Se la lezione e' gia' in cache, non chiama l'Edge Function.
 */

import { supabase } from "../auth/supabaseClient";
import { getLang } from "../i18n/lang";
import { selectPrinciples } from "./selectPrinciple";
import type { MoveFacts, MoveReasonInput } from "../session/moveReason";
import type { SelectContext } from "./selectPrinciple";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface TeachArgs {
  /** Input per extractMoveFacts (fen, colore, mosse, fase, motif). */
  position: {
    fen_before: string;
    played_san: string;
    best_san: string;
    my_color: "white" | "black";
  };
  /** Fatti deterministici gia' estratti da extractMoveFacts. */
  facts: MoveFacts;
  /** Contesto per selectPrinciples (fase, Maia, errorType, stateBefore). */
  ctx: SelectContext;
  /** Variante di punizione del motore (pv_san_sf dalla pipeline). Opzionale. */
  punishment_line?: string | null;
  /** Dati Maia dalla pipeline (opzionali). */
  maia?: { mine_top?: number | null; target_top?: number | null } | null;
}

// ── Cache helpers ─────────────────────────────────────────────────────────────

const CACHE_PREFIX = "nonno_lesson_v1_";
const CACHE_MAX_ENTRIES = 200; // evita di gonfiare il localStorage

/** Hash semplice e veloce: non crittografica, serve solo come chiave cache. */
function hashKey(s: string): string {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  }
  return (h >>> 0).toString(36);
}

function cacheKey(fenBefore: string, playedSan: string, bestSan: string, lang: string): string {
  return CACHE_PREFIX + hashKey(`${fenBefore}|${playedSan}|${bestSan}|${lang}`);
}

function cacheGet(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function cacheSet(key: string, value: string): void {
  try {
    // Pulizia FIFO se si supera il limite: rimuove le voci piu' vecchie
    const keys = Object.keys(localStorage).filter(k => k.startsWith(CACHE_PREFIX));
    if (keys.length >= CACHE_MAX_ENTRIES) {
      // Rimuove le prime N per mantenere il limite
      keys.slice(0, keys.length - CACHE_MAX_ENTRIES + 1).forEach(k => {
        try { localStorage.removeItem(k); } catch { /* ignore */ }
      });
    }
    localStorage.setItem(key, value);
  } catch {
    // localStorage pieno o non disponibile: ignora silenziosamente
  }
}

// ── fetchLesson ───────────────────────────────────────────────────────────────

/**
 * Chiama coach-llm in modalita' "teach" e ritorna la lezione del maestro.
 * Ritorna null su qualsiasi errore (offline, rate-limit, risposta malformata).
 * Mai lancia eccezioni.
 */
export async function fetchLesson(args: TeachArgs): Promise<string | null> {
  const lang = getLang();
  const { position, facts, ctx, punishment_line, maia } = args;

  // ── 0. Invariante difensiva: senza le due mosse non c'e' lezione sensata ──
  // (extractMoveFacts non-null implica playedSan risolvibile, ma non fidarsi)
  if (!position.played_san || !position.best_san) return null;

  // ── 1. Cache hit ─────────────────────────────────────────────────────────
  const key = cacheKey(position.fen_before, position.played_san, position.best_san, lang);
  const cached = cacheGet(key);
  if (cached) return cached;

  // ── 2. Seleziona principi (top-3: top1 = principle, top2/3 = alt_principles) ─
  const selections = selectPrinciples(facts, ctx, 3);
  if (selections.length === 0) {
    // Nessun principio trovato: non possiamo costruire una lezione significativa.
    return null;
  }

  const [top1, ...rest] = selections;
  const principle = {
    id: top1.principle.id,
    name_it: top1.principle.name_it,
    idea_it: top1.principle.idea_it,
    fix_it: top1.principle.fix_it,
  };
  const alt_principles = rest.map(r => ({
    id: r.principle.id,
    name_it: r.principle.name_it,
  }));

  // ── 3. Prepara il body del contratto ─────────────────────────────────────
  const body = {
    mode: "teach" as const,
    lang,
    position: {
      fen_before: position.fen_before,
      played_san: position.played_san,
      best_san: position.best_san,
      my_color: position.my_color,
    },
    facts,
    principle,
    alt_principles: alt_principles.length > 0 ? alt_principles : undefined,
    maia: maia
      ? {
          mine_top: maia.mine_top ?? undefined,
          target_top: maia.target_top ?? undefined,
        }
      : undefined,
    punishment_line: punishment_line ?? null,
  };

  // ── 4. Chiama la Edge Function ────────────────────────────────────────────
  try {
    const { data, error } = await supabase.functions.invoke("coach-llm", { body });

    if (error) {
      // eslint-disable-next-line no-console
      console.warn("[teachClient] coach-llm error:", error.message);
      return null;
    }

    const lesson = (data as Record<string, unknown>)?.lesson;
    if (typeof lesson !== "string" || lesson.trim() === "") {
      // eslint-disable-next-line no-console
      console.warn("[teachClient] risposta malformata:", data);
      return null;
    }

    // ── 5. Salva in cache e ritorna ─────────────────────────────────────────
    cacheSet(key, lesson);
    return lesson;
  } catch (e) {
    // Offline o errore di rete: fail silente, il chiamante usa il floor.
    // eslint-disable-next-line no-console
    console.warn("[teachClient] fetch fallita:", e);
    return null;
  }
}

// ── buildTeachArgs ────────────────────────────────────────────────────────────

/**
 * Helper: costruisce TeachArgs a partire da una MoveReasonInput + campi
 * aggiuntivi disponibili nella PositionRow. Centralizza l'assemblaggio per
 * non duplicarlo in ogni chiamante.
 */
export function buildTeachArgs(
  input: MoveReasonInput & {
    p_maia_mine_top?: number | null;
    p_maia_target_top?: number | null;
    pv_san_sf?: string | null;
    state_before?: string | null;
    error_type?: string | null;
  },
  facts: MoveFacts,
): TeachArgs {
  const ctx: SelectContext = {
    phase: input.phase ?? null,
    maiaMineTop: input.p_maia_mine_top ?? null,
    maiaTargetTop: input.p_maia_target_top ?? null,
    stateBefore: input.state_before ?? null,
    errorType: input.error_type ?? null,
  };

  return {
    position: {
      fen_before: input.fenBefore,
      // Pesca le SAN gia' RISOLTE dai facts (extractMoveFacts le ricava sempre,
      // da SAN o da UCI). Cosi' un chiamante che passa solo UCI (es. CaduteTrainer
      // PhaseGuarda) non manda SAN vuote che farebbero scattare il guard di fetchLesson.
      played_san: facts.played_san ?? input.playedSan ?? "",
      best_san: facts.best?.san ?? input.bestSan ?? "",
      my_color: input.myColor,
    },
    facts,
    ctx,
    punishment_line: input.pv_san_sf ?? null,
    maia:
      input.p_maia_mine_top != null || input.p_maia_target_top != null
        ? { mine_top: input.p_maia_mine_top, target_top: input.p_maia_target_top }
        : null,
  };
}
