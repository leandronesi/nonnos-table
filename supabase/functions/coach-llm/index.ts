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
//   5. Costruisce un prompt fact-based + voice-coach-anziano, includendo
//      ESEMPI di posizioni concrete (se presenti in aggregates.examples).
//   6. Una sola call OpenAI con response_format=json; valida l'output e,
//      se malformato, usa un fallback deterministico (la Home non si rompe mai).
//   7. Scrive su Storage (con error-check):
//        users/<uid>/quaderno/coach_brief.json   (oggetto strutturato)
//        users/<uid>/quaderno/coach_journal.md   (Quaderno: APPEND, non overwrite)

// @ts-expect-error: Deno types not in TS LSP
import { serve } from "https://deno.land/std@0.220.0/http/server.ts";
// @ts-expect-error: Supabase JS via npm specifier (Deno-supported)
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

declare const Deno: {
  env: { get(name: string): string | undefined };
};

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

// Esempio di posizione concreta estratto dall'analisi per-mossa (P1).
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

  const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  });

  // 1. Identifica utente.
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

  // Conta l'invocazione PRIMA della call OpenAI: anche un retry-loop viene
  // contato e quindi limitato.
  try {
    await sb.from("coach_invocations").insert({ user_id: userId });
  } catch (_e) {
    // tabella non migrata → ignora.
  }

  // 5+6. Prompt + OpenAI + validazione, con fallback deterministico.
  let brief: CoachBrief;
  try {
    const raw = await callOpenAi(ctx, aggregates);
    brief = isValidBrief(raw) ? raw : fallbackBrief(aggregates, ctx);
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn("[coach-llm] OpenAI fallita, uso fallback:", String(e));
    brief = fallbackBrief(aggregates, ctx);
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
  const journalPath = `${userId}/quaderno/coach_journal.md`;
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

  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { ...corsHeaders(origin), "content-type": "application/json" },
  });
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
function fallbackBrief(agg: Aggregates, ctx: CoachContext): CoachBrief {
  const phases: Array<[string, PhaseAgg]> = [
    ["apertura", agg.by_phase.opening],
    ["mediogioco", agg.by_phase.middlegame],
    ["finale", agg.by_phase.endgame],
  ];
  const ranked = phases.slice().sort((a, b) => b[1].blunder_pct - a[1].blunder_pct);
  const worst = ranked[0];
  return {
    one_line_diagnosis: `Il tuo freno principale è ${worst[0]}: è dove lasci più valore sulla scacchiera.`,
    top_3_freni: ranked.slice(0, 3).map(([name, p]) => ({
      title: `Errori in ${name}`,
      evidence: `${p.blunder_pct.toFixed(1)}% di blunder su ${p.moves} mosse (cp loss medio ${p.avg_cp_loss.toFixed(0)}).`,
      next_step: `Rivedi 2-3 partite recenti e cerca il pattern ricorrente in ${name}.`,
    })),
    weekly_focus: `Questa settimana, nei tuoi ${ctx.weekly_minutes} min: concentrati su ${worst[0]}.`,
    voice_message: `Ho guardato le tue ultime ${agg.games_analyzed} partite. Dove ti fai male di più è ${worst[0]}. Partiamo da lì, un passo alla volta.`,
  };
}

function moveNumber(ply: number): number {
  return Math.ceil(ply / 2);
}

function renderExamples(examples: PositionExample[] | undefined): string {
  if (!examples || examples.length === 0) return "";
  const lines = examples
    .slice(0, 8)
    .map((e) => {
      const best = e.best_uci ? `il motore preferiva ${e.best_uci}` : "c'era di meglio";
      return `- [${e.phase}, mossa ${moveNumber(e.ply)}, ${e.color === "white" ? "Bianco" : "Nero"}] hai giocato ${e.san} (${e.played_uci}); ${best}; perdita ~${Math.round(e.cp_loss)}cp. FEN: ${e.fen_before}`;
    })
    .join("\n");
  return `

ESEMPI CONCRETI (tue mosse dove hai perso più valore — usa QUESTI, non inventare posizioni):
${lines}

Quando descrivi un freno, ancoralo a uno di questi esempi (la fase e cosa è successo). NON inventare posizioni o motivi diversi da questi.`;
}

async function callOpenAi(ctx: CoachContext, agg: Aggregates): Promise<unknown> {
  const systemPrompt = `Sei Nonno, il coach di scacchi del giocatore. Hai una voce calma, asciutta, con un'esperienza vissuta. NON usi metafore zuccherose. Parli al "tu", in italiano. Sei FATTUALE: ogni cosa che dici deve essere ancorata ai numeri e agli esempi che ti do. Non inventi pattern di cui non hai evidenza.

Il tuo obiettivo qui: leggere gli aggregati di un giocatore e produrre un Coach Brief strutturato in JSON.

Regole hard:
- Le percentuali nel JSON le scrivi così come sono nei dati, non le interpreti.
- Per "top_3_freni" identifichi i 3 ambiti in cui il giocatore perde più valore rispetto al suo target. Ogni freno ha un evidence (numero specifico O un esempio concreto dalle posizioni) e un next_step (azione concreta per la settimana).
- Se hai ESEMPI CONCRETI, citane almeno uno dentro gli evidence: "in una partita col Nero, in finale, hai giocato X invece di Y".
- "voice_message" è 2-3 frasi tue, in italiano, voce di Nonno. NO emoji. NO "Allora vediamo!" o frasi da animatore. Asciutto.
- "one_line_diagnosis" è UNA frase che riassume il freno principale. Diretta. Es: "Ti fai male in finale, soprattutto quando hai i pezzi minori."
- "weekly_focus" è cosa allenare questa settimana dati i ${ctx.weekly_minutes} minuti disponibili.

Output: SOLO il JSON.`;

  const userPrompt = `Giocatore: ${ctx.chess_com_username}
Target: ${ctx.goal_rating} ${ctx.goal_time_class}, in ${ctx.goal_horizon_weeks} settimane${ctx.goal_deadline ? `\nDeadline obiettivo: ${ctx.goal_deadline}` : ""}
Tempo allenamento: ${ctx.weekly_minutes} min/settimana

AGGREGATI (${agg.games_analyzed} partite analizzate, ${agg.player_moves_total} mosse tue):

Errori globali:
- blunder: ${agg.blunder_pct.toFixed(1)}% delle mosse
- mistake: ${agg.mistake_pct.toFixed(1)}%
- inaccuracy: ${agg.inaccuracy_pct.toFixed(1)}%
- avg cp loss: ${agg.avg_cp_loss.toFixed(0)}

Per fase:
- Opening:    ${agg.by_phase.opening.moves} mosse · ${agg.by_phase.opening.blunder_pct.toFixed(1)}% blunder · cpl ${agg.by_phase.opening.avg_cp_loss.toFixed(0)}
- Middlegame: ${agg.by_phase.middlegame.moves} mosse · ${agg.by_phase.middlegame.blunder_pct.toFixed(1)}% blunder · cpl ${agg.by_phase.middlegame.avg_cp_loss.toFixed(0)}
- Endgame:    ${agg.by_phase.endgame.moves} mosse · ${agg.by_phase.endgame.blunder_pct.toFixed(1)}% blunder · cpl ${agg.by_phase.endgame.avg_cp_loss.toFixed(0)}

Per colore:
- Bianco: ${agg.by_color.white.games} partite, win-rate ${(agg.by_color.white.win_rate * 100).toFixed(0)}%, blunder ${agg.by_color.white.blunder_pct.toFixed(1)}%
- Nero:   ${agg.by_color.black.games} partite, win-rate ${(agg.by_color.black.win_rate * 100).toFixed(0)}%, blunder ${agg.by_color.black.blunder_pct.toFixed(1)}%

Per categoria di tempo: ${JSON.stringify(agg.by_time_class)}${renderExamples(agg.examples)}

Produci il Coach Brief JSON.`;

  const resp = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      response_format: { type: "json_object" },
      temperature: 0.4,
    }),
  });

  if (!resp.ok) {
    throw new Error(`openai ${resp.status}: ${await resp.text()}`);
  }

  const data = (await resp.json()) as {
    choices: Array<{ message: { content: string } }>;
  };
  const text = data.choices[0]?.message?.content ?? "{}";
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
    return `${existing.slice(0, idx)}\n${entry}${existing.slice(idx)}`;
  }
  return `${existing}\n${entry}`;
}

function renderJournalEntry(
  brief: CoachBrief,
  ctx: CoachContext,
  agg: Aggregates
): string {
  const today = new Date().toISOString().slice(0, 10);
  return `
## ${today} — Sessione

${brief.voice_message}

**Diagnosi in una frase:**
${brief.one_line_diagnosis}

**Tre freni che ho visto** (su ${agg.games_analyzed} partite, ${ctx.goal_time_class}):

${brief.top_3_freni
  .map(
    (f, i) =>
      `${i + 1}. **${f.title}** — ${f.evidence}\n   _Prossimo passo:_ ${f.next_step}`
  )
  .join("\n\n")}

**Questa settimana:**
${brief.weekly_focus}

---
_— Nonno_
`;
}
