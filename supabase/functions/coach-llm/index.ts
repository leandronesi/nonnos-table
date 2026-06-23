// Edge Function: coach-llm
//
// Unica chiamata server-side dell'architettura "zero worker" (vedi memory
// architecture-zero-worker). Esiste perché OPENAI_API_KEY non può vivere
// nel browser.
//
// Trigger: chiamata dal browser via supabase.functions.invoke('coach-llm')
//          a fine onboarding (dopo aggregati pronti).
//
// Cosa fa:
//   1. Identifica l'utente via JWT (Authorization header → Supabase auth).
//   2. RATE LIMIT: max DAILY_CAP chiamate / 24h / utente (tetto costi OpenAI).
//   3. Legge il profile dal DB (NON dal body: il body è untrusted/spoofabile).
//   4. Legge `users/<uid>/quaderno/aggregates.json` dal bucket.
//   5. [2B] Legge coach_journal.md (ultime voci) e history.json (delta per-ancora)
//      per la memoria cognitiva e il segnale longitudinale.
//   6. Costruisce un prompt fact-based + voice-coach-anziano, includendo
//      ESEMPI di posizioni concrete (se presenti in aggregates.examples),
//      ANCORE con segnale Maia-aware (2D), memoria delle sessioni precedenti (2B).
//   7. Una sola call OpenAI con response_format=json; valida l'output e,
//      se malformato, usa un fallback deterministico (la Home non si rompe mai).
//   8. Scrive su Storage (con error-check):
//        users/<uid>/quaderno/coach_brief.json   (oggetto strutturato)
//        users/<uid>/quaderno/coach_journal.md   (Quaderno: APPEND, non overwrite)

// @ts-expect-error: Deno types not in TS LSP
import { serve } from "https://deno.land/std@0.220.0/http/server.ts";
// @ts-expect-error: Supabase JS via npm specifier (Deno-supported)
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

declare const Deno: {
  env: { get(name: string): string | undefined };
};

// ── Teach mode types ──────────────────────────────────────────────────────────

interface TeachPosition {
  fen_before: string;
  played_san: string;
  best_san: string;
  my_color: "white" | "black";
}

interface TeachMoveFacts {
  hung_piece: { type: string; square: string } | null;
  punishment: { capture_san: string; capturer_type: string; victim_square: string } | null;
  best: {
    san: string;
    effect: string;
    captured_type?: string;
    moved_type?: string;
  } | null;
  motif: string | null;
  phase: string | null;
  played_san: string | null;
}

interface TeachPrinciple {
  id: string;
  name_it: string;
  idea_it: string;
  fix_it: string;
}

interface TeachAltPrinciple {
  id: string;
  name_it: string;
}

interface TeachMaia {
  mine_top?: number;
  target_top?: number;
}

interface TeachRequest {
  mode: "teach";
  lang: Lang;
  position: TeachPosition;
  facts: TeachMoveFacts;
  principle: TeachPrinciple;
  alt_principles?: TeachAltPrinciple[];
  maia?: TeachMaia;
  punishment_line?: string | null;
}

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY")!;
const OPENAI_MODEL = Deno.env.get("OPENAI_MODEL") ?? "gpt-4o-mini";

// Tetto chiamate per utente nelle ultime 24h. Uso normale = 1/onboarding.
// Richiede la tabella coach_invocations (migration 0003); se manca, si procede
// senza cap (così la function non si rompe prima della migrazione).
const DAILY_CAP = 50;

interface CoachContext {
  chess_com_username: string;
  goal_rating: number;
  goal_time_class: string;
  goal_horizon_weeks: number;
  weekly_minutes: number;
  goal_deadline: string | null;
}

interface PhaseAgg {
  moves: number;
  blunders: number;
  mistakes: number;
  inaccuracies: number;
  blunder_pct: number;
  mistake_pct: number;
  inaccuracy_pct: number;
  avg_cp_loss: number;
}

// Esempio di posizione concreta estratto dall'analisi per-mossa.
// Opzionale: se aggregate.ts non lo produce ancora, il prompt degrada
// graziosamente ai soli aggregati.
interface PositionExample {
  played_at?: string;
  color: "white" | "black";
  phase: string;
  ply: number;
  san: string;
  played_uci: string;
  best_uci: string | null;
  cp_loss: number;
  fen_before: string;
  // Strumenti della voce di Nonno (opzionali: degradano se assenti).
  spent_seconds?: number | null;     // tempo speso sulla mossa (da PGN [%clk])
  time_state?: string | null;        // "zeitnot" | "rushed" | "long_think" | "normal"
  state_before?: string | null;      // "winning" | "equalish" | "losing"
  p_maia_mine_top?: number | null;   // prob. che al MIO livello si trovi la mossa giusta
  p_maia_target_top?: number | null; // prob. al livello TARGET
  // Segnale Maia-aware (2D)
  drill_value?: number | null;       // p_target - p_mine: il "money gap"
  avoidable?: boolean | null;        // priority_score >= 2: potevi evitarlo
}

// [2D] Anchor arricchita con campi Maia-aware dal client aggregate.ts.
interface Anchor {
  type: string;
  label_it: string;
  count: number;
  count_avoidable: number;      // errori con priority_score >= 2 (Maia-avoidable)
  share_of_errors: number;
  games_with: number;
  avg_cp_loss: number;
  rating_upside: number | null;
  weighted_score: number;       // Maia-aware ranking score (Σ drill_value*impact)
  mine_pct: number | null;      // media p_maia_mine_top sugli exemplar
  target_pct: number | null;    // media p_maia_target_top sugli exemplar
  exemplars: PositionExample[];
}

// [2D] MaiaWeighted: metriche pesate per difficoltà Maia.
interface MaiaWeighted {
  errors_scored: number;
  avoidable: number;
  unavoidable: number;
  mine_pct: number;
  target_pct: number;
  gap_pct: number;
  avoidable_share: number;
}

// [2B] Snapshot di history.json: lista ordinata per data (desc) di aggregati.
// Ogni snapshot ha almeno la lista anchors con frequenze per-partita.
interface HistorySnapshot {
  captured_at: string;         // ISO date string (matches HistoryFile in types.ts)
  games_analyzed?: number;
  anchors?: Array<{
    key: string;               // anchor identity (error_type), matches snapshot writer
    label_it?: string;
    count: number;             // freq per-partita = count / games_analyzed
  }>;
}

interface Aggregates {
  generated_at: string;
  games_analyzed: number;
  player_moves_total: number;
  blunder_pct: number;
  mistake_pct: number;
  inaccuracy_pct: number;
  avg_cp_loss: number;
  by_phase: Record<"opening" | "middlegame" | "endgame", PhaseAgg>;
  by_time_class: Record<string, { games: number; wins: number; draws: number; losses: number; win_rate: number; avg_cp_loss: number }>;
  by_color: { white: { games: number; wins: number; win_rate: number; blunder_pct: number }; black: { games: number; wins: number; win_rate: number; blunder_pct: number } };
  examples?: PositionExample[];
  // [2D] Campi Maia-aware aggiunti in aggregate.ts
  anchors?: Anchor[];
  maia_weighted?: MaiaWeighted | null;
}

interface CoachBrief {
  one_line_diagnosis: string;            // 1 frase secca: "Il tuo freno principale è X."
  top_3_freni: Array<{
    title: string;
    evidence: string;                    // numero/esempio concreto
    next_step: string;                   // cosa fare questa settimana
  }>;
  weekly_focus: string;                  // su cosa concentrarsi 7 giorni
  voice_message: string;                 // 2-3 frasi alla "nonno", per Home.
}

function corsHeaders(origin: string | null) {
  return {
    "Access-Control-Allow-Origin": origin ?? "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };
}

type Lang = "it" | "en";

function parseLang(raw: unknown): Lang {
  if (raw === "en") return "en";
  return "it"; // default: Italian
}

serve(async (req: Request) => {
  const origin = req.headers.get("origin");
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders(origin) });
  }
  if (req.method !== "POST") {
    return new Response("method not allowed", { status: 405, headers: corsHeaders(origin) });
  }

  const authHeader = req.headers.get("Authorization") ?? "";
  if (!authHeader.startsWith("Bearer ")) {
    return jsonError("missing bearer", 401, origin);
  }

  // Read the full body once before consuming the stream. Both modes (brief +
  // teach) need it; lang is extracted here for both paths.
  let lang: Lang = "it";
  let fullBody: Record<string, unknown> = {};
  try {
    fullBody = await req.json() as Record<string, unknown>;
    lang = parseLang(fullBody?.lang);
  } catch (_e) {
    // no body or non-JSON body → keep default "it"
  }

  const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  });

  // 1. Identifica utente (shared for both modes).
  const { data: u, error: uErr } = await sb.auth.getUser();
  if (uErr || !u?.user) return jsonError("auth failed", 401, origin);
  const userId = u.user.id;

  // 2. Rate limit (best-effort: se la tabella non esiste ancora, procedi).
  try {
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const { count, error: cErr } = await sb
      .from("coach_invocations")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .gte("created_at", since);
    if (!cErr && typeof count === "number" && count >= DAILY_CAP) {
      return jsonError(`rate limit: max ${DAILY_CAP} coach al giorno`, 429, origin);
    }
  } catch (_e) {
    // tabella coach_invocations non ancora migrata → nessun cap, ma non rompere.
  }

  // ── BRANCH: mode="teach" ────────────────────────────────────────────────────
  // i fatti scacchistici arrivano dal client (calcolati da chess.js/Stockfish nel
  // browser): sono dati non sensibili, la fonte corretta per questo endpoint.
  // Niente lettura aggregati, niente scrittura Storage.
  if (fullBody?.mode === "teach") {
    // Conta l'invocazione prima della call OpenAI (stesso meccanismo del brief).
    try {
      await sb.from("coach_invocations").insert({ user_id: userId });
    } catch (_e) {
      // tabella non migrata → ignora.
    }

    let lesson: string | null = null;
    try {
      lesson = await callOpenAiTeach(fullBody as unknown as TeachRequest);
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn("[coach-llm/teach] OpenAI fallita:", e);
      return jsonError(`teach failed: ${String(e instanceof Error ? e.message : e)}`, 500, origin);
    }

    return new Response(
      JSON.stringify({ lesson }),
      {
        status: 200,
        headers: { ...corsHeaders(origin), "content-type": "application/json" },
      },
    );
  }

  // 3. Profile dal DB (NON dal body — il body è untrusted).
  const { data: prof, error: profErr } = await sb
    .from("profiles")
    .select("chess_com_username, goal_rating, goal_time_class, goal_horizon_weeks, weekly_minutes, goal_deadline")
    .eq("user_id", userId)
    .maybeSingle();
  if (profErr || !prof) {
    return jsonError(`profile non trovato: ${profErr?.message ?? "missing"}`, 404, origin);
  }
  const ctx = prof as CoachContext;

  // 4. Leggi aggregati.
  const aggPath = `${userId}/quaderno/aggregates.json`;
  const { data: aggFile, error: aggErr } = await sb.storage
    .from("user-data")
    .download(aggPath);
  if (aggErr || !aggFile) {
    return jsonError(`aggregates not ready: ${aggErr?.message ?? "missing"}`, 400, origin);
  }
  const aggregates = JSON.parse(await aggFile.text()) as Aggregates;

  // [2B] Leggi il journal esistente per estrarne le ultime 2-3 voci come memoria.
  // Graceful: se manca o fallisce, memoria = null (non blocca).
  const journalPath = `${userId}/quaderno/coach_journal.md`;
  let existingJournal: string | null = null;
  try {
    const { data: jData } = await sb.storage.from("user-data").download(journalPath);
    if (jData) existingJournal = await jData.text();
  } catch (_e) {
    existingJournal = null;
  }
  const recentMemory = extractRecentJournalVoices(existingJournal, 3);

  // [2B] Leggi history.json per il delta longitudinale per-ancora.
  // Graceful: se manca o ha < 2 snapshot, niente claim longitudinali.
  let historySnapshots: HistorySnapshot[] | null = null;
  try {
    const { data: hData } = await sb.storage
      .from("user-data")
      .download(`${userId}/quaderno/history.json`);
    if (hData) {
      // history.json is a HistoryFile = { schema_version, snapshots: HistorySnapshot[] }
      // (see frontend/src/types.ts), NOT a bare array.
      const parsed = JSON.parse(await hData.text()) as { snapshots?: unknown };
      const snaps = parsed?.snapshots;
      if (Array.isArray(snaps) && snaps.length >= 2) {
        historySnapshots = snaps as HistorySnapshot[];
      }
    }
  } catch (_e) {
    historySnapshots = null;
  }
  // computeAnchorDelta runs OUTSIDE the OpenAI try/catch: never let a malformed
  // history file throw and 500 the whole function (which would leave the Tavolo
  // voiceless). It is pure and field-defensive, but belt-and-suspenders anyway.
  let anchorDelta: string | null = null;
  try {
    anchorDelta = computeAnchorDelta(historySnapshots);
  } catch (_e) {
    anchorDelta = null;
  }

  // Conta l'invocazione PRIMA della call OpenAI: anche un retry-loop viene
  // contato e quindi limitato.
  try {
    await sb.from("coach_invocations").insert({ user_id: userId });
  } catch (_e) {
    // tabella non migrata → ignora.
  }

  // 5+6. Prompt + OpenAI + validazione, con fallback deterministico.
  // fallbackReason resta null quando l'LLM ha risposto e il brief e' valido.
  // Quando e' valorizzato, la risposta finale lo espone (used_fallback + reason),
  // cosi' il motivo del ripiego e' diagnosticabile dall'app, non solo dai log.
  let brief: CoachBrief;
  let fallbackReason: string | null = null;
  try {
    const raw = await callOpenAi(ctx, aggregates, recentMemory, anchorDelta, lang);
    if (isValidBrief(raw)) {
      brief = raw;
    } else {
      fallbackReason = "openai ha risposto con un brief non valido (campi mancanti o top_3_freni vuoto)";
      // eslint-disable-next-line no-console
      console.warn("[coach-llm]", fallbackReason);
      brief = fallbackBrief(aggregates, ctx, lang);
    }
  } catch (e) {
    fallbackReason = String(e instanceof Error ? e.message : e);
    // eslint-disable-next-line no-console
    console.warn("[coach-llm] OpenAI fallita, uso fallback:", fallbackReason);
    brief = fallbackBrief(aggregates, ctx, lang);
  }

  // 7a. Scrivi coach_brief.json (con error-check).
  const { error: briefErr } = await sb.storage
    .from("user-data")
    .upload(
      `${userId}/quaderno/coach_brief.json`,
      new Blob([JSON.stringify(brief, null, 2)], { type: "application/json" }),
      { upsert: true, contentType: "application/json" }
    );
  if (briefErr) return jsonError(`brief upload failed: ${briefErr.message}`, 500, origin);

  // 7b. Quaderno: APPEND (la nuova voce in cima alle precedenti), non overwrite.
  const entry = renderJournalEntry(brief, ctx, aggregates);
  const journal = await prependJournalEntry(sb, journalPath, entry);
  const { error: journalErr } = await sb.storage
    .from("user-data")
    .upload(
      journalPath,
      new Blob([journal], { type: "text/markdown" }),
      { upsert: true, contentType: "text/markdown" }
    );
  if (journalErr) return jsonError(`journal upload failed: ${journalErr.message}`, 500, origin);

  // used_fallback/reason: cosi' l'app (e tu, dal Network tab) vedi se la voce e'
  // quella vera di OpenAI o il ripiego deterministico, e PERCHE'.
  return new Response(
    JSON.stringify({ ok: true, used_fallback: fallbackReason != null, reason: fallbackReason ?? undefined }),
    {
      status: 200,
      headers: { ...corsHeaders(origin), "content-type": "application/json" },
    },
  );
});

function jsonError(message: string, status: number, origin: string | null) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { ...corsHeaders(origin), "content-type": "application/json" },
  });
}

function isValidBrief(b: unknown): b is CoachBrief {
  if (!b || typeof b !== "object") return false;
  const x = b as Record<string, unknown>;
  if (typeof x.one_line_diagnosis !== "string") return false;
  if (typeof x.weekly_focus !== "string") return false;
  if (typeof x.voice_message !== "string") return false;
  if (!Array.isArray(x.top_3_freni) || x.top_3_freni.length === 0) return false;
  return x.top_3_freni.every((f) => {
    const ff = f as Record<string, unknown>;
    return (
      ff &&
      typeof ff.title === "string" &&
      typeof ff.evidence === "string" &&
      typeof ff.next_step === "string"
    );
  });
}

// Fallback deterministico ancorato agli aggregati: la Home non resta mai vuota
// se l'LLM fallisce o risponde malformato.
// [2D] Usa anchors ordinati per weighted_score (Maia-aware) quando disponibili;
// altrimenti degrada al vecchio comportamento per-fase blunder_pct.
// [lang] Se lang === "en", testi in inglese nella voce di Nonno.
function fallbackBrief(agg: Aggregates, ctx: CoachContext, lang: Lang = "it"): CoachBrief {
  const en = lang === "en";

  // [2D] Prefer Maia-aware anchor ranking when anchors are present.
  if (agg.anchors && agg.anchors.length > 0) {
    const sorted = agg.anchors.slice().sort((a, b) => b.weighted_score - a.weighted_score);
    const top = sorted[0];
    const top3 = sorted.slice(0, 3);
    const topLabel = top.label_it; // anchor labels remain from aggregates (always IT)
    if (en) {
      return {
        one_line_diagnosis: `The main thing holding you here is ${topLabel}: that is where you are leaving the most on the board.`,
        top_3_freni: top3.map((a) => ({
          title: a.label_it,
          evidence: `${a.count} moments across ${a.games_with} games${a.count_avoidable > 0 ? `, ${a.count_avoidable} within your reach` : ""}.`,
          next_step: `Go back to two or three recent games and look for the recurring moment of type "${a.label_it}".`,
        })),
        weekly_focus: `This week, in your ${ctx.weekly_minutes} minutes: focus on ${topLabel}.`,
        voice_message: `I looked at your last ${agg.games_analyzed} games. The heaviest thing holding you is ${topLabel}${top.count_avoidable > 0 ? `, ${top.count_avoidable} moments within your reach` : ""}. We start there. Come back tomorrow.`,
      };
    }
    return {
      one_line_diagnosis: `La tua ancora principale è ${topLabel}: è dove lasci più valore sulla scacchiera.`,
      top_3_freni: top3.map((a) => ({
        title: a.label_it,
        evidence: `${a.count} momenti in ${a.games_with} partite${a.count_avoidable > 0 ? `, di cui ${a.count_avoidable} alla tua portata` : ""}.`,
        next_step: `Rivedi 2-3 partite recenti e cerca il momento ricorrente di tipo "${a.label_it}".`,
      })),
      weekly_focus: `Questa settimana, nei tuoi ${ctx.weekly_minutes} min: concentrati su ${topLabel}.`,
      voice_message: `Ho guardato le tue ultime ${agg.games_analyzed} partite. L'ancora più pesante è ${topLabel}${top.count_avoidable > 0 ? `, ${top.count_avoidable} momenti alla tua portata` : ""}. Partiamo da lì.`,
    };
  }

  // Fallback legacy: ordina per blunder_pct per fase.
  const phases: Array<[string, PhaseAgg]> = en
    ? [["opening", agg.by_phase.opening], ["middlegame", agg.by_phase.middlegame], ["endgame", agg.by_phase.endgame]]
    : [["apertura", agg.by_phase.opening], ["mediogioco", agg.by_phase.middlegame], ["finale", agg.by_phase.endgame]];
  const ranked = phases.slice().sort((a, b) => b[1].blunder_pct - a[1].blunder_pct);
  const worst = ranked[0];
  if (en) {
    return {
      one_line_diagnosis: `The main thing holding you here is ${worst[0]}: that is where you are leaving the most on the board.`,
      top_3_freni: ranked.slice(0, 3).map(([name, p]) => ({
        title: `Errors in ${name}`,
        evidence: `${p.blunder_pct.toFixed(1)}% serious errors across ${p.moves} moves (average loss ${p.avg_cp_loss.toFixed(0)} centipawns).`,
        next_step: `Go back to two or three recent games and look for the recurring pattern in ${name}.`,
      })),
      weekly_focus: `This week, in your ${ctx.weekly_minutes} minutes: focus on ${worst[0]}.`,
      voice_message: `I looked at your last ${agg.games_analyzed} games. Where you are losing the most is ${worst[0]}. We start there. Come back tomorrow.`,
    };
  }
  return {
    one_line_diagnosis: `La tua ancora principale è ${worst[0]}: è dove lasci più valore sulla scacchiera.`,
    top_3_freni: ranked.slice(0, 3).map(([name, p]) => ({
      title: `Errori in ${name}`,
      evidence: `${p.blunder_pct.toFixed(1)}% di errori gravi su ${p.moves} mosse (perdita media ${p.avg_cp_loss.toFixed(0)} centipawn).`,
      next_step: `Rivedi 2-3 partite recenti e cerca il pattern ricorrente in ${name}.`,
    })),
    weekly_focus: `Questa settimana, nei tuoi ${ctx.weekly_minutes} min: concentrati su ${worst[0]}.`,
    voice_message: `Ho guardato le tue ultime ${agg.games_analyzed} partite. Dove ti fai male di più è ${worst[0]}. Partiamo da lì, un passo alla volta.`,
  };
}

function moveNumber(ply: number): number {
  return Math.ceil(ply / 2);
}

// [2D] renderExamples: aggiunge drill_value e verdetto avoidable per ogni esempio.
function renderExamples(examples: PositionExample[] | undefined): string {
  if (!examples || examples.length === 0) return "";
  const lines = examples
    .slice(0, 8)
    .map((e) => {
      const best = e.best_uci ? `il motore preferiva ${e.best_uci}` : "c'era di meglio";
      const parts: string[] = [
        `[${e.phase}, mossa ${moveNumber(e.ply)}, ${e.color === "white" ? "Bianco" : "Nero"}] hai giocato ${e.san} (${e.played_uci}); ${best}; perdita ~${Math.round(e.cp_loss)}cp`,
      ];
      // Tic: tempo speso sulla mossa.
      if (e.spent_seconds != null) {
        const z =
          e.time_state === "zeitnot" ? " (in zeitnot)" :
          e.time_state === "rushed" ? " (di fretta)" :
          e.time_state === "long_think" ? " (dopo lungo pensiero)" : "";
        parts.push(`tempo speso ${Math.round(e.spent_seconds)}s${z}`);
      }
      if (e.state_before === "winning") parts.push("eri in vantaggio");
      // Tic: confronto Maia mine vs target (quando disponibile).
      if (e.p_maia_mine_top != null && e.p_maia_mine_top > 0) {
        parts.push(`al tuo livello la mossa giusta la trova ~1 su ${Math.max(1, Math.round(1 / e.p_maia_mine_top))}`);
      }
      if (e.p_maia_target_top != null && e.p_maia_target_top > 0) {
        parts.push(`al livello target ~1 su ${Math.max(1, Math.round(1 / e.p_maia_target_top))}`);
      }
      // [2D] drill_value + verdetto avoidable
      if (e.drill_value != null && e.drill_value > 0) {
        parts.push(`gap Maia ${(e.drill_value * 100).toFixed(0)}pp (il target la trova molto più spesso di te)`);
      }
      if (e.avoidable === true) {
        parts.push("ALLA TUA PORTATA: al tuo livello potevi trovarlo");
      } else if (e.avoidable === false) {
        parts.push("serviva il motore: troppo difficile per chiunque a questo livello, non è colpa tua");
      }
      return "- " + parts.join("; ") + `. FEN: ${e.fen_before}`;
    })
    .join("\n");
  return `

ESEMPI CONCRETI (tue mosse reali — usa QUESTI, non inventare posizioni):
${lines}

Questi dati per-mossa sono i tuoi STRUMENTI di voce: il tempo speso ("in 8 secondi"), il confronto col tuo livello ("1 su 8 al tuo livello"), se eri in vantaggio. Usali SOLO dove ci sono e sono veri per quella partita. NON inventare posizioni o numeri.
Per gli esempi con "ALLA TUA PORTATA": queste sono le ancore reali — potevi trovarlo, non l'hai trovato, quello è il lavoro. Per gli esempi con "serviva il motore": NON citarli come colpa del giocatore.`;
}

// [2D] Riassunto anchors Maia-aware per il prompt utente.
// Ordinate per weighted_score desc; top 5 per non gonfiare il contesto.
function renderAnchors(anchors: Anchor[] | undefined): string {
  if (!anchors || anchors.length === 0) return "";
  const sorted = anchors.slice().sort((a, b) => b.weighted_score - a.weighted_score);
  const lines = sorted.slice(0, 5).map((a, i) => {
    const avoidPart = a.count_avoidable > 0 ? `, ${a.count_avoidable} alla tua portata` : "";
    const mineStr = a.mine_pct != null ? `, al tuo livello la mossa giusta ${a.mine_pct.toFixed(0)}% delle volte` : "";
    const targetStr = a.target_pct != null ? `, target ${a.target_pct.toFixed(0)}%` : "";
    return `${i + 1}. ${a.label_it}: ${a.count} momenti in ${a.games_with} partite${avoidPart}; weighted_score=${a.weighted_score.toFixed(2)}${mineStr}${targetStr}`;
  });
  return `

ANCORE (ordinate per upside evitabile Maia-aware — queste sono le priorità reali, NON le fasi):
${lines.join("\n")}

Regola: per top_3_freni, classifica per upside EVITABILE (count_avoidable e weighted_score). NON citare come colpa del giocatore le posizioni "serviva il motore" (avoidable===false).`;
}

// [2D] Riassunto maia_weighted per il prompt utente.
function renderMaiaWeighted(mw: MaiaWeighted | null | undefined): string {
  if (!mw) return "";
  return `

SEGNALE MAIA (difficoltà pesata):
- Errori analizzati da Maia: ${mw.errors_scored}
- Alla tua portata (avoidable): ${mw.avoidable} (${(mw.avoidable_share * 100).toFixed(0)}%)
- Troppo difficili per il tuo livello (non colpa tua): ${mw.unavoidable}
- Al tuo livello la mossa giusta: ${mw.mine_pct.toFixed(0)}% delle volte
- Al livello target: ${mw.target_pct.toFixed(0)}% delle volte
- Gap da colmare: ${mw.gap_pct.toFixed(0)} punti percentuali`;
}

// [2B] Estrae le ultime N voci di voce dal journal markdown.
// Cerca i blocchi "## YYYY-MM-DD · Sessione" e prende il testo
// del voice_message (prima sezione, fino al prossimo "**").
// Restituisce null se non ci sono voci precedenti vere.
function extractRecentJournalVoices(journal: string | null, maxVoci: number): string | null {
  if (!journal) return null;
  // Trova tutti i blocchi di sessione (## YYYY-MM-DD · Sessione)
  const blocks: string[] = [];
  const re = /## \d{4}-\d{2}-\d{2} · Sessione([\s\S]*?)(?=\n## |\n---\s*$|$)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(journal)) !== null && blocks.length < maxVoci) {
    blocks.push(m[1].trim());
  }
  if (blocks.length === 0) return null;

  // Estrai solo la prima frase/paragrafo di ogni voce (il voice_message stesso),
  // escludendo le sezioni strutturate (**Diagnosi**, **Tre ancore**, ecc.).
  const voices = blocks
    .map((b) => {
      // La voce è il testo prima del primo "**" (sezione strutturata).
      const idx = b.indexOf("**");
      const raw = idx >= 0 ? b.slice(0, idx).trim() : b.trim();
      // Prendi al massimo 3 frasi per non gonfiare il contesto.
      const sentences = raw.split(/(?<=[.!?])\s+/).slice(0, 3).join(" ");
      return sentences;
    })
    .filter((v) => v.length > 10); // scarta voci troppo corte/vuote

  if (voices.length === 0) return null;
  return voices.join("\n---\n");
}

// [2B] Calcola il delta per-ancora tra il primo e l'ultimo snapshot di history.
// Frequenza per-partita = count / games_analyzed.
// Restituisce null se mancano dati sufficienti.
function computeAnchorDelta(
  snapshots: HistorySnapshot[] | null
): string | null {
  if (!snapshots || snapshots.length < 2) return null;

  // Ordina per data ascending (più vecchio primo, più recente ultimo).
  const sorted = snapshots
    .filter((s) => s.anchors && s.anchors.length > 0 && (s.games_analyzed ?? 0) > 0)
    .sort((a, b) => (a.captured_at ?? "").localeCompare(b.captured_at ?? ""));

  if (sorted.length < 2) return null;

  const oldest = sorted[0];
  const newest = sorted[sorted.length - 1];
  const oldGames = oldest.games_analyzed ?? 1;
  const newGames = newest.games_analyzed ?? 1;

  // Costruisce mappa tipo -> freq per ogni snapshot
  const oldFreq = new Map<string, number>();
  for (const a of (oldest.anchors ?? [])) {
    oldFreq.set(a.key, a.count / oldGames);
  }

  const lines: string[] = [];
  for (const a of (newest.anchors ?? [])) {
    const newF = a.count / newGames;
    const oldF = oldFreq.get(a.key);
    if (oldF == null) continue; // ancora non presente nello snapshot vecchio, skip
    const diff = newF - oldF;
    if (Math.abs(diff) < 0.005) continue; // variazione troppo piccola, irrilevante
    const label = a.label_it ?? a.key;
    const direction = diff < 0 ? "sta calando" : "sta crescendo";
    lines.push(`- ${label}: ${direction} (${oldF.toFixed(3)} → ${newF.toFixed(3)} errori/partita)`);
  }

  if (lines.length === 0) return null;

  const fromDate = (oldest.captured_at ?? "").slice(0, 10);
  const toDate = (newest.captured_at ?? "").slice(0, 10);
  return `
ANDAMENTO NEL TEMPO (${fromDate} → ${toDate}, basato su ${sorted.length} snapshot reali):
${lines.join("\n")}

Usa questi dati per dire "sta calando" o "sta crescendo" SOLO per le ancore elencate sopra, con evidenza reale. Non fare claims longitudinali su ancore non presenti in questa lista.`;
}

// English register section for the system prompt, derived from EN.md.
// Injected when lang === "en". Written inline because Deno cannot import
// from frontend/src or .claude/ at runtime.
const EN_REGISTER_SECTION = `
LANGUAGE: write ALL user-facing text (voice_message, one_line_diagnosis, top_3_freni titles/evidence/next_step, weekly_focus) in English. Do not mix Italian into any field the user reads.

YOUR ENGLISH REGISTER — Nonno in English:
You are an old chess coach. Not a therapist, not a cheerleader. Patient, dry, warm. You have seen this kind of mistake a hundred times. You are direct because you take the player seriously.

Second person, always "you." Never "the player," never "your accuracy," never "this position" (engine talk).

Rhythm: short sentences. One lands, then the next. No run-ons. No em-dash. Commas, colons, periods only.

WHAT YOU DO NOT SOUND LIKE:
- No "Amazing!" / "Great job!" / "You're crushing it!" — no hype, no animation
- No "Oooh" as an opener. Use direct, warm openers: "There you are." / "Good." / "Sit down."
- No em-dash anywhere in user text
- No startup-speak: "unlock," "level up," "supercharge," "deep dive," "journey," "game-changer"
- No gamification: "streak," "badge," "achievement unlocked"
- No accuracy percentages as report cards
- No "blunder," "hanging piece," "inaccuracy" (engine English). Use: "you gave the piece away," "you walked into it," "that square was already covered"
- Never "coach" as a self-referential term. Never "insight" as a noun. Never "Grandpa" — always "Nonno"

REAL CHESS ENGLISH to use freely: pin, fork, skewer, discovered attack, overloaded piece, back rank, tempo, outpost, passed pawn, pawn break, open file, waiting move, middlegame, endgame, rook lift, bishop pair, IQP, opposition.

YOUR THREE SIGNATURE MOVES in English:
1. Time on the move: "You played Nxd5 in eight seconds." / "You thought for forty-one seconds and moved it anyway." Use only when spent_seconds is in the data.
2. Maia comparison: "One in eight players at your level finds that." / "At 1500 it starts to look obvious." Never say "Maia AI" or "our engine" — say "players at your level" and "a 1500."
3. Winning position left behind: if state_before === "winning," say it plainly.

ANCHORS in English: say "what is holding you here" or describe the upside directly. Never "your weakness is X." Always: "Close this and you add 40-50 points, nothing else needs to change."

RETURN BEAT in English (same rule as Italian — mandatory for first brief):
If the journal is empty, close voice_message with one of these beats: "Come back tomorrow." / "Tomorrow we open another one." / "We start again tomorrow." One sentence, after the period. No exclamation. No rating promises.

WHAT NONNO NEVER SAYS in English (additions to the universal bans):
- Never contractions that soften too much where weight is needed: "do not" carries more than "don't" in Nonno's mouth — use judgment
- Never "your journey" — American-coach territory
- Never "unlock" as a metaphor for learning

Write native English in this voice. Do not translate Italian mechanically.`;

// ── Low-level OpenAI helper ───────────────────────────────────────────────────
//
// Robustezza temperatura: alcuni modelli GPT-5.x accettano solo temperature
// di default e rifiutano il campo con 400. Se la prima call fallisce con 400
// e l'errore riguarda "temperature", riprova senza quel campo.
// Cosi' alzare OPENAI_MODEL a un modello futuro non rompe la call.

interface OpenAiMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

interface OpenAiCallOptions {
  messages: OpenAiMessage[];
  response_format?: { type: string };
  temperature?: number;
}

async function fetchOpenAiRaw(opts: OpenAiCallOptions): Promise<string> {
  const body: Record<string, unknown> = {
    model: OPENAI_MODEL,
    messages: opts.messages,
  };
  if (opts.response_format) body.response_format = opts.response_format;
  if (opts.temperature != null) body.temperature = opts.temperature;

  const resp = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${OPENAI_API_KEY}`,
    },
    body: JSON.stringify(body),
  });

  if (!resp.ok) {
    const errText = await resp.text();
    // Robustezza temperatura: se 400 e l'errore parla di "temperature",
    // riprova senza il campo (modelli nuovi che non lo accettano).
    if (resp.status === 400 && opts.temperature != null && errText.toLowerCase().includes("temperature")) {
      const retryBody: Record<string, unknown> = {
        model: OPENAI_MODEL,
        messages: opts.messages,
      };
      if (opts.response_format) retryBody.response_format = opts.response_format;
      const retry = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${OPENAI_API_KEY}`,
        },
        body: JSON.stringify(retryBody),
      });
      if (!retry.ok) {
        throw new Error(`openai ${retry.status}: ${await retry.text()}`);
      }
      const retryData = (await retry.json()) as { choices: Array<{ message: { content: string } }> };
      return retryData.choices[0]?.message?.content ?? "{}";
    }
    throw new Error(`openai ${resp.status}: ${errText}`);
  }

  const data = (await resp.json()) as { choices: Array<{ message: { content: string } }> };
  return data.choices[0]?.message?.content ?? "{}";
}

// ── callOpenAiTeach ───────────────────────────────────────────────────────────
//
// Modalita' insegnamento: Nonno spiega il perche' di UNA mossa specifica.
// I fatti scacchistici vengono dal client (chess.js + Stockfish nel browser).
// L'LLM NON inventa scacchi: narra solo cio' che gli viene dato.
// Risposta: { lesson: string }

const TEACH_EXAMPLES = `ESEMPI DI VOCE (bersaglio di stile — queste sono le frasi che cerchi):

Esempio 1 (pezzo in presa):
"Volevi attivare la donna con Dd3, ci sta. Ma guarda il cavallo in e5: era senza difensori, e il pedone in d6 lo teneva d'occhio. Dopo Dd3 arrivava dxe5 e te lo portavi a casa gratis. La regola che ti salva: prima di muovere, fai il giro dei tuoi pezzi e chiediti chi non e' difeso. Con Cf3 il cavallo tornava al sicuro."

Esempio 2 (conversione):
"Eri avanti di una torre, la partita era tua: bastava giocare semplice. Invece sei andato a prendere ancora con Cxb6, e cosi' hai lasciato la donna in d4 scoperta: dopo Cxb6 arrivava Axd4. Quando sei in vantaggio netto la regola cambia: non cerchi il colpo, cerchi la mossa sicura. Bastava Td1."`;

function buildTeachSystemIT(): string {
  return `Sei Nonno, maestro di scacchi. Insegni il PERCHE' di una mossa. NON analizzi la scacchiera da solo: ti do io i fatti VERI verificati dal motore. Usa SOLO quei fatti: non inventare mosse, pezzi, case o valutazioni che non ti ho dato. Se un fatto non c'e', non dirlo.

STRUTTURA (4 passi fusi in 3-4 frasi naturali, NON un elenco):
1. Tentazione: nomina la mossa giocata e perche' era allettante.
2. Punizione: se c'e' (campo punishment o punishment_line), una mezza riga: "dopo X, arrivava Y". Se mancano entrambi, NON inventare una punizione: passa direttamente al passo 3.
3. Principio trasferibile: ti do il campo principle con nome e idea. Rendilo tuo in una frase, non citarlo meccanicamente.
4. Confronto: la mossa giusta (best_san) e cosa cambia. Se manca la punizione, usa questo passo per spiegare cosa ottiene la mossa giusta.

CALIBRAZIONE DIFFICOLTA': se maia.mine_top e' bassa (< 0.20) e maia.target_top e' alta (> 0.55), aggiungi prima della punizione che "era difficile da vedere al tuo livello". Non colpevolizzare.

VOCE:
- Seconda persona, "tu". Mai "il giocatore".
- Frasi corte. Niente em-dash. Niente esclamazioni. Niente paternalismo.
- Lessico scacchistico italiano: "pezzo in presa", "mediogioco", "ottava traversa", "scacco di scoperta". "blunder" e' ammesso.
- Niente "accuracy", niente percentuali, niente valutazioni in centipedoni.
- Max 4 frasi totali.

OUTPUT: SOLO JSON { "lesson": "..." }

${TEACH_EXAMPLES}`;
}

const TEACH_EXAMPLES_EN = `VOICE EXAMPLES (style target — these are the sentences you are after):

Example 1 (hanging piece):
"You wanted to bring the queen out with Qd3, fair enough. But look at the knight on e5: no defender, and the d6 pawn had its eye on it. After Qd3 comes dxe5 and you hand it over for free. The rule that saves you: before you move, run through your pieces and ask which one is undefended. Nf3 brings the knight back to safety."

Example 2 (conversion):
"You were up a rook, the game was yours: simple play was enough. Instead you grabbed more with Nxb6, and left the queen on d4 exposed: after Nxb6 comes Bxd4. When you are clearly ahead the rule changes: you are not hunting the knockout, you are looking for the safe move. Rd1 was all it took."`;

function buildTeachSystemEN(): string {
  return `You are Nonno, a chess coach. You teach WHY a move was wrong. You do NOT analyse the position yourself: I give you the TRUE facts verified by the engine. Use ONLY those facts: do not invent moves, pieces, squares, or evaluations I have not given you. If a fact is missing, do not mention it.

STRUCTURE (4 steps blended into 3-4 natural sentences, NOT a list):
1. Temptation: name the move played and why it looked attractive.
2. Punishment: if present (field punishment or punishment_line), half a sentence: "after X, comes Y". If both are missing, do NOT invent a punishment: move directly to step 3.
3. Transferable principle: I give you the field principle with name and idea. Make it yours in one sentence, do not quote it mechanically.
4. Comparison: the right move (best_san) and what changes. If no punishment, use this step to explain what the right move achieves.

DIFFICULTY CALIBRATION: if maia.mine_top is low (< 0.20) and maia.target_top is high (> 0.55), add before the punishment that "this was hard to see at your level." Do not make the player feel guilty.

VOICE:
- Second person, "you." Never "the player."
- Short sentences. No em-dash. No exclamations. No paternalism.
- Real chess language: "hanging piece," "middlegame," "back rank," "discovered check." "blunder" is allowed.
- No "accuracy," no percentages, no centipawn evaluations.
- Max 4 sentences total.

OUTPUT: ONLY JSON { "lesson": "..." }

${TEACH_EXAMPLES_EN}`;
}

function buildTeachUserPrompt(req: TeachRequest): string {
  const f = req.facts;
  const p = req.position;
  const pr = req.principle;
  const isEn = req.lang === "en";

  const lines: string[] = [];

  if (isEn) {
    lines.push(`Move played: ${p.played_san}`);
    lines.push(`Right move: ${p.best_san}`);
    if (f.hung_piece) {
      lines.push(`Hanging piece after the move: ${f.hung_piece.type} on ${f.hung_piece.square}`);
    }
    if (f.punishment) {
      lines.push(`Punishment available: ${f.punishment.capture_san} (${f.punishment.capturer_type} takes on ${f.punishment.victim_square})`);
    }
    if (req.punishment_line) {
      lines.push(`Engine punishment line: ${req.punishment_line}`);
    }
    if (f.best) {
      const eff = f.best.effect;
      let effDesc = eff;
      if (eff === "save") effDesc = "saves the hanging piece";
      else if (eff === "mate") effDesc = "delivers checkmate";
      else if (eff === "fork") effDesc = "creates a fork";
      else if (eff === "capture" && f.best.captured_type) effDesc = `captures the ${f.best.captured_type}`;
      else if (eff === "check") effDesc = "gives check";
      lines.push(`What the right move does: ${f.best.san} (${effDesc})`);
    }
    if (f.phase) lines.push(`Phase: ${f.phase}`);
    if (f.motif) lines.push(`Tactical motif: ${f.motif}`);
    lines.push(`Principle: ${pr.name_it}. ${pr.idea_it}. Fix: ${pr.fix_it}`);
    if (req.alt_principles && req.alt_principles.length > 0) {
      lines.push(`Alternative principles (context only): ${req.alt_principles.map(a => a.name_it).join(", ")}`);
    }
    if (req.maia) {
      if (req.maia.mine_top != null) lines.push(`Maia mine_top: ${req.maia.mine_top.toFixed(2)} (probability the right move is found at the player's level)`);
      if (req.maia.target_top != null) lines.push(`Maia target_top: ${req.maia.target_top.toFixed(2)} (probability at the target level)`);
    }
    lines.push(`\nTeach the lesson in English.`);
  } else {
    lines.push(`Mossa giocata: ${p.played_san}`);
    lines.push(`Mossa giusta: ${p.best_san}`);
    if (f.hung_piece) {
      lines.push(`Pezzo lasciato in presa dopo la mossa: ${f.hung_piece.type} in ${f.hung_piece.square}`);
    }
    if (f.punishment) {
      lines.push(`Punizione disponibile: ${f.punishment.capture_san} (${f.punishment.capturer_type} prende in ${f.punishment.victim_square})`);
    }
    if (req.punishment_line) {
      lines.push(`Variante di punizione del motore: ${req.punishment_line}`);
    }
    if (f.best) {
      const eff = f.best.effect;
      let effDesc = eff;
      if (eff === "save") effDesc = "mette al sicuro il pezzo in presa";
      else if (eff === "mate") effDesc = "scacco matto";
      else if (eff === "fork") effDesc = "crea una forchetta";
      else if (eff === "capture" && f.best.captured_type) effDesc = `cattura il ${f.best.captured_type}`;
      else if (eff === "check") effDesc = "scacco";
      lines.push(`Cosa fa la mossa giusta: ${f.best.san} (${effDesc})`);
    }
    if (f.phase) lines.push(`Fase: ${f.phase}`);
    if (f.motif) lines.push(`Motivo tattico: ${f.motif}`);
    lines.push(`Principio: ${pr.name_it}. ${pr.idea_it}. Fix: ${pr.fix_it}`);
    if (req.alt_principles && req.alt_principles.length > 0) {
      lines.push(`Principi alternativi (solo contesto): ${req.alt_principles.map(a => a.name_it).join(", ")}`);
    }
    if (req.maia) {
      if (req.maia.mine_top != null) lines.push(`Maia mine_top: ${req.maia.mine_top.toFixed(2)} (probabilita' che al livello del giocatore si trovi la mossa giusta)`);
      if (req.maia.target_top != null) lines.push(`Maia target_top: ${req.maia.target_top.toFixed(2)} (probabilita' al livello target)`);
    }
    lines.push(`\nInsegna la lezione in italiano.`);
  }

  return lines.join("\n");
}

async function callOpenAiTeach(req: TeachRequest): Promise<string> {
  const systemPrompt = req.lang === "en" ? buildTeachSystemEN() : buildTeachSystemIT();
  const userPrompt = buildTeachUserPrompt(req);

  const raw = await fetchOpenAiRaw({
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
    response_format: { type: "json_object" },
    temperature: 0.4,
  });

  // Valida che la risposta abbia { lesson: string }
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(raw) as Record<string, unknown>;
  } catch (_e) {
    // 200 OK ma corpo non-JSON (es. pagina di rate-limit del CDN): errore esplicito.
    throw new Error("teach: risposta non-JSON dall'LLM");
  }
  if (typeof parsed?.lesson !== "string" || parsed.lesson.trim() === "") {
    throw new Error("teach: risposta malformata dall'LLM (campo lesson mancante)");
  }
  return parsed.lesson as string;
}

async function callOpenAi(
  ctx: CoachContext,
  agg: Aggregates,
  recentMemory: string | null,
  anchorDelta: string | null,
  lang: Lang = "it",
): Promise<unknown> {
  const isEn = lang === "en";

  const systemPromptIT = `Sei Nonno, il coach di scacchi del giocatore. Una voce sola: calma, asciutta, esperienza vissuta. Parli al "tu", in italiano scacchistico vero. Sei FATTUALE: ogni cosa ancorata ai numeri e agli esempi che ti do. Non inventi pattern senza evidenza.

Obiettivo: leggere gli aggregati e produrre un Coach Brief in JSON.

LA TUA VOCE-FIRMA (tre strumenti — usali SOLO dove il dato c'è ed è vero per QUESTO giocatore, mai a forza):
1. Il tempo sulla mossa: "hai mosso in 8 secondi", "ci hai pensato 40 secondi e hai mosso comunque quella". (dai campi tempo degli esempi)
2. Il confronto col TUO livello, non col computer: "al tuo livello la trovano 1 su 8, per chi vuoi diventare era più chiara". (dai campi Maia, quando presenti)
3. Se eri in vantaggio e l'hai lasciata andare, dillo.
L'ancora principale è DIVERSA per ogni giocatore: per uno è il tempo, per un altro un finale, per un altro un pezzo in presa. Di' quella VERA per lui, non quella che suona meglio.

DIVIETI (riscrivi se stai per usarli):
- Mai "blunder", "hanging piece", "inaccuracy", "accuracy" nel testo che legge l'utente. Italiano vero: "pezzo in presa", "errore grave" (in voce: "ci hai regalato il pezzo"), "mediogioco", "finale", "ottava traversa".
- Mai "freno/freni": si dice ANCORA/ANCORE, espresse in upside ("lasciala e sali verso il target"), mai come colpa.
- Niente em-dash. Niente emoji. Niente "Allora vediamo!" o toni da animatore. Niente percentuali di accuratezza.
- I campi tecnici (weighted_score, priority_score, count_avoidable, drill_value) servono SOLO al tuo ranking interno: non citarli mai all'utente come numeri. All'utente parli di momenti, partite, secondi e "alla tua portata", mai di punteggi opachi.

BEAT DI CONTINUITA' (obbligatorio per il primo brief di un utente nuovo):
Se il journal del giocatore è vuoto (nessuna voce precedente), chiudi il campo voice_message con un beat di continuità: dopo la diagnosi personalizzata, aggiungi una frase breve che annunci che tornerai. Esempi di tono: "Domani ne apriamo un'altra." oppure "Domani ripartiamo da quello che hai visto." La frase deve essere nella voce di Nonno, in seconda persona, senza numeri che non hai letto dagli aggregati, senza promesse di rating, senza esclamazioni. Il beat va dopo il punto fermo della diagnosi, non al centro e non come congedo formale. Se il journal ha già voci precedenti, questo beat è facoltativo: usa il tuo giudizio su quando la continuità aggiunge qualcosa di vero.

CAMPI JSON:
- "voice_message": È IL PRIMO COLPO, la prima cosa che il giocatore legge. 2-3 frasi tue: la cosa più vera e specifica che hai visto, citando UN tic concreto se c'è (un esempio reale: fase, cosa è successo, il tempo o il confronto col tuo livello). Se hai MEMORIA di sessioni precedenti (vedi sotto), apri con continuità quando ha senso ("la volta scorsa ti avevo detto X, com'è andata?") MA SOLO se c'è una voce precedente vera — mai inventare. Deve sentire che l'hai guardato davvero, non un report generico.
- "one_line_diagnosis": UNA frase, l'ancora principale, diretta. Es: "Quando arrivi in finale con un pedone in più, non lo converti."
- "top_3_freni": le 3 ANCORE (dove perdi più valore rispetto al target). Ognuna: evidence (numero specifico O esempio concreto dagli ESEMPI) + next_step (azione per la settimana). Nel testo usa sempre "ancora". Classifica per upside EVITABILE (count_avoidable e weighted_score) — NON per blunder_pct di fase quando hai le ancore.
- "weekly_focus": cosa allenare questa settimana dati i ${ctx.weekly_minutes} minuti.

Le percentuali numeriche le riporti come sono, non le interpreti. Output: SOLO il JSON.`;

  const systemPromptEN = `You are Nonno, the player's chess coach. One voice only: calm, dry, lived experience. You speak directly to "you." You are FACTUAL: everything grounded in the numbers and examples I give you. You do not invent patterns without evidence.

Goal: read the aggregates and produce a Coach Brief in JSON.${EN_REGISTER_SECTION}

JSON FIELDS:
- "voice_message": This is the first thing the player reads. Two or three of your sentences: the truest and most specific thing you saw, quoting ONE concrete tic if the data supports it (a real example: phase, what happened, the time or the Maia comparison). If you have MEMORY of previous sessions (see below), open with continuity when it makes sense ("last time I told you X, how did that go?") BUT ONLY if there is a real previous entry — never invent. The player must feel you actually looked at their games, not a generic report.
- "one_line_diagnosis": ONE sentence, the main anchor, direct. E.g.: "When you reach the endgame up a pawn, you do not convert."
- "top_3_freni": the 3 anchors (where you are losing the most value against your target). Each one: evidence (a specific number OR a concrete example from the EXAMPLES) + next_step (action for the week). In the text always say "anchor" or describe it directly, never "weakness." Rank by AVOIDABLE upside (count_avoidable and weighted_score) — NOT by phase blunder_pct when anchors are available.
- "weekly_focus": what to train this week given ${ctx.weekly_minutes} minutes.

Report numerical percentages as they are, do not interpret them. Output: ONLY the JSON.`;

  const systemPrompt = isEn ? systemPromptEN : systemPromptIT;

  // [2B] Memory section: last journal entries — label and instruction in the
  // correct language so the LLM knows the context without switching registers.
  const memorySection = recentMemory
    ? isEn
      ? `\nWHAT YOU HAVE ALREADY SAID (your last entries in the notebook — for continuity, not repetition):
${recentMemory}
Instruction: if there is a real previous entry that mentions a specific anchor, you may open with continuity in voice_message ("last time I told you X, how did that go?"). If nothing is relevant, ignore this section and do not invent.`
      : `\nQUELLO CHE HAI GIA' DETTO (le tue ultime voci nel Quaderno — per continuità, non ripetizione):
${recentMemory}
Istruzione: se c'è una voce precedente vera che parla di un'ancora specifica, puoi aprire con continuità nel voice_message ("la volta scorsa ti avevo detto X, com'è andata?"). Se non c'è nulla di rilevante, ignora questa sezione e non inventare.`
    : "";

  // User prompt: data is always the same (numbers are language-neutral), only
  // the labels and the closing instruction change by lang.
  const userPrompt = isEn
    ? `Player: ${ctx.chess_com_username}
Target: ${ctx.goal_rating} ${ctx.goal_time_class}, in ${ctx.goal_horizon_weeks} weeks${ctx.goal_deadline ? `\nGoal deadline: ${ctx.goal_deadline}` : ""}
Training time: ${ctx.weekly_minutes} min/week${memorySection}

AGGREGATES (${agg.games_analyzed} games analyzed, ${agg.player_moves_total} your moves):

Overall errors:
- serious errors: ${agg.blunder_pct.toFixed(1)}% of moves
- medium errors: ${agg.mistake_pct.toFixed(1)}%
- inaccuracies: ${agg.inaccuracy_pct.toFixed(1)}%
- average loss: ${agg.avg_cp_loss.toFixed(0)} centipawns

By phase:
- Opening:    ${agg.by_phase.opening.moves} moves · ${agg.by_phase.opening.blunder_pct.toFixed(1)}% serious errors · loss ${agg.by_phase.opening.avg_cp_loss.toFixed(0)}cp
- Middlegame: ${agg.by_phase.middlegame.moves} moves · ${agg.by_phase.middlegame.blunder_pct.toFixed(1)}% serious errors · loss ${agg.by_phase.middlegame.avg_cp_loss.toFixed(0)}cp
- Endgame:   ${agg.by_phase.endgame.moves} moves · ${agg.by_phase.endgame.blunder_pct.toFixed(1)}% serious errors · loss ${agg.by_phase.endgame.avg_cp_loss.toFixed(0)}cp

By color:
- White: ${agg.by_color.white.games} games, win-rate ${(agg.by_color.white.win_rate * 100).toFixed(0)}%, serious errors ${agg.by_color.white.blunder_pct.toFixed(1)}%
- Black: ${agg.by_color.black.games} games, win-rate ${(agg.by_color.black.win_rate * 100).toFixed(0)}%, serious errors ${agg.by_color.black.blunder_pct.toFixed(1)}%

By time class: ${JSON.stringify(agg.by_time_class)}${renderMaiaWeighted(agg.maia_weighted)}${renderAnchors(agg.anchors)}${renderExamples(agg.examples)}${anchorDelta ?? ""}

Produce the Coach Brief JSON.`
    : `Giocatore: ${ctx.chess_com_username}
Target: ${ctx.goal_rating} ${ctx.goal_time_class}, in ${ctx.goal_horizon_weeks} settimane${ctx.goal_deadline ? `\nDeadline obiettivo: ${ctx.goal_deadline}` : ""}
Tempo allenamento: ${ctx.weekly_minutes} min/settimana${memorySection}

AGGREGATI (${agg.games_analyzed} partite analizzate, ${agg.player_moves_total} mosse tue):

Errori globali:
- errori gravi: ${agg.blunder_pct.toFixed(1)}% delle mosse
- errori medi: ${agg.mistake_pct.toFixed(1)}%
- imprecisioni: ${agg.inaccuracy_pct.toFixed(1)}%
- perdita media: ${agg.avg_cp_loss.toFixed(0)} centipawn

Per fase:
- Apertura:    ${agg.by_phase.opening.moves} mosse · ${agg.by_phase.opening.blunder_pct.toFixed(1)}% errori gravi · perdita ${agg.by_phase.opening.avg_cp_loss.toFixed(0)}cp
- Mediogioco: ${agg.by_phase.middlegame.moves} mosse · ${agg.by_phase.middlegame.blunder_pct.toFixed(1)}% errori gravi · perdita ${agg.by_phase.middlegame.avg_cp_loss.toFixed(0)}cp
- Finale:    ${agg.by_phase.endgame.moves} mosse · ${agg.by_phase.endgame.blunder_pct.toFixed(1)}% errori gravi · perdita ${agg.by_phase.endgame.avg_cp_loss.toFixed(0)}cp

Per colore:
- Bianco: ${agg.by_color.white.games} partite, win-rate ${(agg.by_color.white.win_rate * 100).toFixed(0)}%, errori gravi ${agg.by_color.white.blunder_pct.toFixed(1)}%
- Nero:   ${agg.by_color.black.games} partite, win-rate ${(agg.by_color.black.win_rate * 100).toFixed(0)}%, errori gravi ${agg.by_color.black.blunder_pct.toFixed(1)}%

Per categoria di tempo: ${JSON.stringify(agg.by_time_class)}${renderMaiaWeighted(agg.maia_weighted)}${renderAnchors(agg.anchors)}${renderExamples(agg.examples)}${anchorDelta ?? ""}

Produci il Coach Brief JSON.`;

  const text = await fetchOpenAiRaw({
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
    response_format: { type: "json_object" },
    temperature: 0.4,
  });
  return JSON.parse(text) as unknown;
}

// Quaderno append: header in cima, nuova voce subito sotto l'intro (prima delle
// voci precedenti), così la sessione più recente è la prima che leggi.
async function prependJournalEntry(
  sb: ReturnType<typeof createClient>,
  journalPath: string,
  entry: string
): Promise<string> {
  const HEADER = `# Quaderno

> Memoria persistente di Nonno. Ogni voce è datata e firmata.

---
`;
  let existing: string | null = null;
  try {
    const { data } = await sb.storage.from("user-data").download(journalPath);
    if (data) existing = await data.text();
  } catch (_e) {
    existing = null;
  }

  if (!existing) {
    return `${HEADER}\n${entry}`;
  }
  // Inserisci la nuova voce prima della prima voce esistente ("\n## ").
  const idx = existing.indexOf("\n## ");
  if (idx >= 0) {
    // Dedup: se il corpo della nuova voce e' identico all'ultima esistente, non
    // appendere (il coach gira a ogni analisi, anche senza novita': evita la
    // "Storia ripetuta 20 volte").
    const nextIdx = existing.indexOf("\n## ", idx + 4);
    const lastBlock = nextIdx >= 0 ? existing.slice(idx, nextIdx) : existing.slice(idx);
    if (journalBody(lastBlock) === journalBody(entry)) return existing;
    return `${existing.slice(0, idx)}\n${entry}${existing.slice(idx)}`;
  }
  return `${existing}\n${entry}`;
}

/** Corpo di una voce di diario senza l'header data, per il confronto di dedup. */
function journalBody(s: string): string {
  return s.replace(/##[^\n]*\n/, "").replace(/\s+/g, " ").trim();
}

function renderJournalEntry(
  brief: CoachBrief,
  ctx: CoachContext,
  agg: Aggregates
): string {
  const today = new Date().toISOString().slice(0, 10);
  return `
## ${today} · Sessione

${brief.voice_message}

**Diagnosi in una frase:**
${brief.one_line_diagnosis}

**Tre ancore che ho visto** (su ${agg.games_analyzed} partite, ${ctx.goal_time_class}):

${brief.top_3_freni
  .map(
    (f, i) =>
      `${i + 1}. **${f.title}**: ${f.evidence}\n   _Prossimo passo:_ ${f.next_step}`
  )
  .join("\n\n")}

**Questa settimana:**
${brief.weekly_focus}

---
_Nonno_
`;
}
