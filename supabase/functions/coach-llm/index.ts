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
//   2. Consuma quota atomica per modalita' (brief/teach), fail-closed.
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
  current_acceptable_observed_policy?: number;
  target_acceptable_observed_policy?: number;
  policy_semantics: "raw_policy_mass_not_calibrated_frequency";
  status: "scored";
  reason_code?: string;
  domain_status?: "cross_domain" | "out_of_training_domain";
  domain_reason?: string;
  avoidable_at_current?: boolean | null;
  target_relevant?: boolean | null;
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
const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY") ?? "";
const OPENAI_MODEL = Deno.env.get("OPENAI_MODEL") ?? "gpt-4o-mini";

// Limiti definiti nell'RPC consume_coach_quota (migration 0007).
const MAX_REQUEST_BYTES = 24 * 1024;
const MAX_AGGREGATES_BYTES = 2 * 1024 * 1024;
const MAX_JOURNAL_BYTES = 96 * 1024;
const MAX_HISTORY_BYTES = 512 * 1024;
const ALLOWED_ORIGINS = new Set([
  "http://localhost:5173",
  "http://127.0.0.1:5173",
  "http://127.0.0.1:3000",
  ...(Deno.env.get("APP_ALLOWED_ORIGINS") ?? "")
    .split(",")
    .map((value) => value.trim().replace(/\/$/, ""))
    .filter(Boolean),
]);

interface CoachContext {
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
  maia_status?: "scored" | "not_requested" | "not_scored" | "skipped" | "unavailable" | null;
  maia_reason_code?: string | null;
  maia_policy_semantics?: "raw_policy_mass_not_calibrated_frequency";
  maia_domain_status?: "cross_domain" | "out_of_training_domain" | null;
  maia_domain_reason?: string | null;
  maia_mine_acceptable_observed_policy?: number | null;
  maia_target_acceptable_observed_policy?: number | null;
  acceptable_observed_uci?: string[] | null;
  acceptable_moves_complete?: boolean | null;
  avoidable_at_current?: boolean | null;
  target_relevant?: boolean | null;
  trainable?: boolean | null;
}

// [2D] Anchor arricchita con campi Maia-aware dal client aggregate.ts.
interface Anchor {
  type: string;
  label_it: string;
  count: number;
  share_of_errors: number;
  relative_priority?: number;
  games_with: number;
  avg_cp_loss: number;
  weighted_score: number;
  mine_acceptable_observed_policy_pct?: number | null;
  target_acceptable_observed_policy_pct?: number | null;
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
  avoidable_at_current_known_positions?: number;
  target_relevant?: number;
  trainable?: number;
  mine_acceptable_observed_policy_pct?: number;
  target_acceptable_observed_policy_pct?: number;
  policy_semantics?: "raw_policy_mass_not_calibrated_frequency";
}

interface MaiaCoverage {
  status: "disabled" | "no_data" | "unavailable" | "partial" | "complete";
  eligible_positions: number;
  selected_positions: number;
  scored_positions: number;
  coverage_ratio: number;
  current_avoidable_eligible_positions: number;
  current_avoidable_domain_coverage_ratio: number;
  reason_counts: Record<string, number>;
  domain_reason_counts: Record<string, number>;
  policy_semantics: "raw_policy_mass_not_calibrated_frequency";
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
  maia_coverage?: MaiaCoverage;
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
    ...(origin && ALLOWED_ORIGINS.has(origin) ? { "Access-Control-Allow-Origin": origin } : {}),
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Cache-Control": "no-store",
    "Vary": "Origin",
  };
}

function isAllowedOrigin(origin: string | null): boolean {
  return !!origin && ALLOWED_ORIGINS.has(origin.replace(/\/$/, ""));
}

type Lang = "it" | "en";

function parseLang(raw: unknown): Lang {
  if (raw === "en") return "en";
  return "it"; // default: Italian
}

function asObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function boundedText(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const clean = value.replace(/[\u0000-\u001f\u007f]/g, " ").trim();
  if (!clean || clean.length > max) return null;
  return clean;
}

function nullableBoundedText(value: unknown, max: number): string | null {
  if (value == null) return null;
  return boundedText(value, max);
}

function probability(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1
    ? value
    : undefined;
}

function finiteNumber(value: unknown, min = 0, max = 10_000_000): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= min && value <= max;
}

function isPhaseAgg(value: unknown): value is PhaseAgg {
  const row = asObject(value);
  return !!row &&
    finiteNumber(row.moves) && finiteNumber(row.blunders) &&
    finiteNumber(row.mistakes) && finiteNumber(row.inaccuracies) &&
    finiteNumber(row.blunder_pct, 0, 100) && finiteNumber(row.mistake_pct, 0, 100) &&
    finiteNumber(row.inaccuracy_pct, 0, 100) && finiteNumber(row.avg_cp_loss);
}

function isPositionExample(value: unknown): value is PositionExample {
  const row = asObject(value);
  if (!row || (row.color !== "white" && row.color !== "black")) return false;
  if (!boundedText(row.phase, 40) || !boundedText(row.san, 24) || !boundedText(row.played_uci, 8)) return false;
  if (!finiteNumber(row.ply, 1, 1000) || !finiteNumber(row.cp_loss, 0, 100_000)) return false;
  if (row.best_uci != null && !boundedText(row.best_uci, 8)) return false;
  if (!boundedText(row.fen_before, 120)) return false;
  for (const field of ["maia_mine_acceptable_observed_policy", "maia_target_acceptable_observed_policy"] as const) {
    if (row[field] != null && probability(row[field]) == null) return false;
  }
  if (row.acceptable_observed_uci != null && (
    !Array.isArray(row.acceptable_observed_uci) || row.acceptable_observed_uci.length > 64 ||
    row.acceptable_observed_uci.some((move) => !boundedText(move, 8))
  )) return false;
  return true;
}

function isAnchor(value: unknown): value is Anchor {
  const row = asObject(value);
  return !!row && !!boundedText(row.type, 80) && !!boundedText(row.label_it, 160) &&
    finiteNumber(row.count, 0, 100_000) && finiteNumber(row.games_with, 0, 10_000) &&
    finiteNumber(row.share_of_errors, 0, 1) && finiteNumber(row.avg_cp_loss) &&
    finiteNumber(row.weighted_score) && Array.isArray(row.exemplars) &&
    row.exemplars.length <= 12 && row.exemplars.every(isPositionExample);
}

function isMaiaWeighted(value: unknown): value is MaiaWeighted {
  const row = asObject(value);
  return !!row && row.policy_semantics === "raw_policy_mass_not_calibrated_frequency" &&
    finiteNumber(row.errors_scored, 0, 100_000) &&
    finiteNumber(row.target_relevant, 0, 100_000) && finiteNumber(row.trainable, 0, 100_000) &&
    finiteNumber(row.mine_acceptable_observed_policy_pct, 0, 100) &&
    finiteNumber(row.target_acceptable_observed_policy_pct, 0, 100);
}

function isMaiaCoverage(value: unknown): value is MaiaCoverage {
  const row = asObject(value);
  const statuses = new Set(["disabled", "no_data", "unavailable", "partial", "complete"]);
  return !!row && statuses.has(String(row.status)) &&
    row.policy_semantics === "raw_policy_mass_not_calibrated_frequency" &&
    finiteNumber(row.eligible_positions, 0, 100_000) &&
    finiteNumber(row.selected_positions, 0, 100_000) &&
    finiteNumber(row.scored_positions, 0, 100_000) &&
    finiteNumber(row.coverage_ratio, 0, 1) && !!asObject(row.reason_counts) &&
    !!asObject(row.domain_reason_counts);
}

/** Validate the user-owned Storage document before it can shape a prompt. */
function parseAggregates(value: unknown): Aggregates | null {
  const row = asObject(value);
  const phases = asObject(row?.by_phase);
  const colors = asObject(row?.by_color);
  const white = asObject(colors?.white);
  const black = asObject(colors?.black);
  const timeClasses = asObject(row?.by_time_class);
  if (!row || !phases || !colors || !white || !black || !timeClasses) return null;
  if (!boundedText(row.generated_at, 80) ||
      !finiteNumber(row.games_analyzed, 1, 10_000) ||
      !finiteNumber(row.player_moves_total, 1, 10_000_000) ||
      !finiteNumber(row.blunder_pct, 0, 100) || !finiteNumber(row.mistake_pct, 0, 100) ||
      !finiteNumber(row.inaccuracy_pct, 0, 100) || !finiteNumber(row.avg_cp_loss) ||
      !isPhaseAgg(phases.opening) || !isPhaseAgg(phases.middlegame) || !isPhaseAgg(phases.endgame)) return null;

  const validColor = (color: Record<string, unknown>) =>
    finiteNumber(color.games, 0, 10_000) && finiteNumber(color.wins, 0, 10_000) &&
    finiteNumber(color.win_rate, 0, 1) && finiteNumber(color.blunder_pct, 0, 100);
  if (!validColor(white) || !validColor(black)) return null;

  const cleanTimeClasses: Aggregates["by_time_class"] = {};
  for (const [key, value] of Object.entries(timeClasses).slice(0, 20)) {
    const stats = asObject(value);
    if (!boundedText(key, 40) || !stats ||
        !finiteNumber(stats.games, 0, 10_000) || !finiteNumber(stats.wins, 0, 10_000) ||
        !finiteNumber(stats.draws, 0, 10_000) || !finiteNumber(stats.losses, 0, 10_000) ||
        !finiteNumber(stats.win_rate, 0, 1) || !finiteNumber(stats.avg_cp_loss)) continue;
    cleanTimeClasses[key] = stats as unknown as Aggregates["by_time_class"][string];
  }

  const examples = Array.isArray(row.examples)
    ? row.examples.slice(0, 24).filter(isPositionExample)
    : undefined;
  const anchors = Array.isArray(row.anchors)
    ? row.anchors.slice(0, 24).filter(isAnchor)
    : undefined;
  return {
    ...(row as unknown as Aggregates),
    by_time_class: cleanTimeClasses,
    examples,
    anchors,
    maia_weighted: row.maia_weighted != null && isMaiaWeighted(row.maia_weighted)
      ? row.maia_weighted
      : null,
    maia_coverage: isMaiaCoverage(row.maia_coverage) ? row.maia_coverage : undefined,
  };
}

async function readJsonBody(req: Request): Promise<Record<string, unknown>> {
  const declared = Number(req.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > MAX_REQUEST_BYTES) throw new Error("body_too_large");
  if (!req.body) return {};
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_REQUEST_BYTES) {
      await reader.cancel();
      throw new Error("body_too_large");
    }
    chunks.push(value);
  }
  if (total === 0) return {};
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  const parsed = JSON.parse(new TextDecoder().decode(merged)) as unknown;
  const object = asObject(parsed);
  if (!object) throw new Error("invalid_json");
  return object;
}

function parseTeachRequest(value: Record<string, unknown>, lang: Lang): TeachRequest | null {
  const position = asObject(value.position);
  const facts = asObject(value.facts);
  const principle = asObject(value.principle);
  if (!position || !facts || !principle) return null;

  const fen = boundedText(position.fen_before, 120);
  const playedSan = boundedText(position.played_san, 24);
  const bestSan = boundedText(position.best_san, 24);
  const myColor = position.my_color;
  if (!fen || fen.split(" ").length < 4 || !playedSan || !bestSan || (myColor !== "white" && myColor !== "black")) {
    return null;
  }

  const principleId = boundedText(principle.id, 80);
  const principleName = boundedText(principle.name_it, 120);
  const principleIdea = boundedText(principle.idea_it, 320);
  const principleFix = boundedText(principle.fix_it, 320);
  if (!principleId || !principleName || !principleIdea || !principleFix) return null;

  const hung = asObject(facts.hung_piece);
  const punishment = asObject(facts.punishment);
  const best = asObject(facts.best);
  const parsedFacts: TeachMoveFacts = {
    hung_piece: hung ? {
      type: boundedText(hung.type, 32) ?? "piece",
      square: boundedText(hung.square, 4) ?? "?",
    } : null,
    punishment: punishment ? {
      capture_san: boundedText(punishment.capture_san, 24) ?? "capture",
      capturer_type: boundedText(punishment.capturer_type, 32) ?? "piece",
      victim_square: boundedText(punishment.victim_square, 4) ?? "?",
    } : null,
    best: best ? {
      san: boundedText(best.san, 24) ?? bestSan,
      effect: boundedText(best.effect, 40) ?? "improves the position",
      captured_type: nullableBoundedText(best.captured_type, 32) ?? undefined,
      moved_type: nullableBoundedText(best.moved_type, 32) ?? undefined,
    } : null,
    motif: nullableBoundedText(facts.motif, 80),
    phase: nullableBoundedText(facts.phase, 40),
    played_san: nullableBoundedText(facts.played_san, 24),
  };

  const altPrinciples = Array.isArray(value.alt_principles)
    ? value.alt_principles.slice(0, 3).flatMap((item) => {
        const alt = asObject(item);
        const id = boundedText(alt?.id, 80);
        const name = boundedText(alt?.name_it, 120);
        return id && name ? [{ id, name_it: name }] : [];
      })
    : undefined;
  const rawMaia = asObject(value.maia);
  const maiaStatus = rawMaia?.status === "scored" ? "scored" : null;
  const policySemantics = rawMaia?.policy_semantics === "raw_policy_mass_not_calibrated_frequency"
    ? "raw_policy_mass_not_calibrated_frequency" as const
    : null;
  const currentObserved = probability(rawMaia?.current_acceptable_observed_policy);
  const targetObserved = probability(rawMaia?.target_acceptable_observed_policy);
  const domainStatus = rawMaia?.domain_status === "cross_domain" || rawMaia?.domain_status === "out_of_training_domain"
    ? rawMaia.domain_status
    : undefined;
  const avoidableAtCurrent = domainStatus === "out_of_training_domain"
    ? null
    : typeof rawMaia?.avoidable_at_current === "boolean"
      ? rawMaia.avoidable_at_current
      : null;
  const targetRelevant = typeof rawMaia?.target_relevant === "boolean"
    ? rawMaia.target_relevant
    : null;
  const parsedMaia: TeachMaia | undefined = maiaStatus && policySemantics &&
      (currentObserved != null || targetObserved != null)
    ? {
        status: maiaStatus,
        policy_semantics: policySemantics,
        current_acceptable_observed_policy: currentObserved,
        target_acceptable_observed_policy: targetObserved,
        reason_code: nullableBoundedText(rawMaia?.reason_code, 80) ?? undefined,
        domain_status: domainStatus,
        domain_reason: nullableBoundedText(rawMaia?.domain_reason, 80) ?? undefined,
        avoidable_at_current: avoidableAtCurrent,
        target_relevant: targetRelevant,
      }
    : undefined;

  return {
    mode: "teach",
    lang,
    position: { fen_before: fen, played_san: playedSan, best_san: bestSan, my_color: myColor },
    facts: parsedFacts,
    principle: { id: principleId, name_it: principleName, idea_it: principleIdea, fix_it: principleFix },
    alt_principles: altPrinciples,
    // Omit Maia entirely when it was not scored or came from a fallback.
    maia: parsedMaia,
    punishment_line: nullableBoundedText(value.punishment_line, 360),
  };
}

async function consumeCoachQuota(
  sb: ReturnType<typeof createClient>,
  mode: "brief" | "teach",
): Promise<"accepted" | "exhausted" | "unavailable"> {
  try {
    const { data, error } = await sb.rpc("consume_coach_quota", { p_mode: mode });
    if (error) return "unavailable";
    return data === "accepted" ? "accepted" : "exhausted";
  } catch (_error) {
    return "unavailable";
  }
}

serve(async (req: Request) => {
  const origin = req.headers.get("origin")?.replace(/\/$/, "") ?? null;
  if (!isAllowedOrigin(origin)) return jsonError("origin_not_allowed", 403, origin);
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders(origin) });
  }
  if (req.method !== "POST") {
    return new Response("method not allowed", { status: 405, headers: corsHeaders(origin) });
  }
  if (!(req.headers.get("content-type") ?? "").toLowerCase().includes("application/json")) {
    return jsonError("content_type_required", 415, origin);
  }

  const authHeader = req.headers.get("Authorization") ?? "";
  if (!authHeader.startsWith("Bearer ")) {
    return jsonError("missing bearer", 401, origin);
  }

  // Read the full body once before consuming the stream. Both modes (brief +
  // teach) need it; lang is extracted here for both paths.
  let fullBody: Record<string, unknown>;
  try {
    fullBody = await readJsonBody(req);
  } catch (error) {
    const code = error instanceof Error && error.message === "body_too_large" ? "body_too_large" : "invalid_json";
    return jsonError(code, code === "body_too_large" ? 413 : 400, origin);
    // no body or non-JSON body → keep default "it"
  }

  const lang = parseLang(fullBody.lang);
  const requestMode = fullBody.mode === "teach"
    ? "teach"
    : fullBody.mode == null || fullBody.mode === "brief"
      ? "brief"
      : null;
  if (!requestMode) return jsonError("invalid_mode", 400, origin);
  const teachRequest = requestMode === "teach" ? parseTeachRequest(fullBody, lang) : null;
  if (requestMode === "teach" && !teachRequest) return jsonError("invalid_teach_payload", 400, origin);

  const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  });

  // 1. Identifica utente (shared for both modes).
  const { data: u, error: uErr } = await sb.auth.getUser();
  if (uErr || !u?.user) return jsonError("auth failed", 401, origin);
  const userId = u.user.id;

  // ── BRANCH: mode="teach" ────────────────────────────────────────────────────
  // i fatti scacchistici arrivano dal client (calcolati da chess.js/Stockfish nel
  // browser): sono dati non sensibili, la fonte corretta per questo endpoint.
  // Niente lettura aggregati, niente scrittura Storage.
  if (requestMode === "teach") {
    const request = teachRequest;
    if (!request) return jsonError("invalid_teach_payload", 400, origin);
    if (!OPENAI_API_KEY) return jsonError("teach_unavailable", 503, origin);
    // Consume only after the full payload is valid, immediately before the
    // paid call. Missing/unavailable quota is fail-closed.
    const teachQuota = await consumeCoachQuota(sb, "teach");
    if (teachQuota === "unavailable") return jsonError("quota_unavailable", 503, origin);
    if (teachQuota !== "accepted") return jsonError("coach_quota_exhausted", 429, origin);

    let lesson: string | null = null;
    try {
      lesson = await callOpenAiTeach(request);
    } catch (_e) {
      return jsonError("teach_unavailable", 502, origin);
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
    .select("goal_rating, goal_time_class, goal_horizon_weeks, weekly_minutes, goal_deadline")
    .eq("user_id", userId)
    .maybeSingle();
  if (profErr || !prof) {
    return jsonError("profile_not_ready", 404, origin);
  }
  const ctx = prof as CoachContext;

  // 4. Leggi aggregati.
  const aggPath = `${userId}/quaderno/aggregates.json`;
  const { data: aggFile, error: aggErr } = await sb.storage
    .from("user-data")
    .download(aggPath);
  if (aggErr || !aggFile) {
    return jsonError("aggregates_not_ready", 400, origin);
  }
  if (aggFile.size > MAX_AGGREGATES_BYTES) return jsonError("aggregates_too_large", 413, origin);
  let aggregates: Aggregates;
  try {
    const parsed = JSON.parse(await aggFile.text()) as unknown;
    const validated = parseAggregates(parsed);
    if (!validated) return jsonError("aggregates_invalid", 400, origin);
    aggregates = validated;
  } catch (_e) {
    return jsonError("aggregates_invalid", 400, origin);
  }

  // [2B] Leggi il journal esistente per estrarne le ultime 2-3 voci come memoria.
  // Graceful: se manca o fallisce, memoria = null (non blocca).
  const journalPath = `${userId}/quaderno/coach_journal.md`;
  let existingJournal: string | null = null;
  try {
    const { data: jData } = await sb.storage.from("user-data").download(journalPath);
    if (jData && jData.size <= MAX_JOURNAL_BYTES) existingJournal = await jData.text();
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
    if (hData && hData.size <= MAX_HISTORY_BYTES) {
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
    anchorDelta = computeAnchorDelta(historySnapshots, lang);
  } catch (_e) {
    anchorDelta = null;
  }

  // 5+6. Prompt + OpenAI + validazione, con fallback deterministico.
  // fallbackReason resta null quando l'LLM ha risposto e il brief e' valido.
  // Quando e' valorizzato, la risposta finale lo espone (used_fallback + reason),
  // cosi' il motivo del ripiego e' diagnosticabile dall'app, non solo dai log.
  let brief: CoachBrief;
  let fallbackReason: string | null = null;
  if (!OPENAI_API_KEY) {
    // A deterministic response without an attempted paid call consumes no quota.
    fallbackReason = "openai_not_configured";
    brief = fallbackBrief(aggregates, ctx, lang);
  } else {
    const briefQuota = await consumeCoachQuota(sb, "brief");
    if (briefQuota === "unavailable") return jsonError("quota_unavailable", 503, origin);
    if (briefQuota !== "accepted") return jsonError("coach_quota_exhausted", 429, origin);
    try {
      const raw = await callOpenAi(ctx, aggregates, recentMemory, anchorDelta, lang);
      if (isValidBrief(raw)) {
        brief = raw;
      } else {
        fallbackReason = "invalid_model_response";
        brief = fallbackBrief(aggregates, ctx, lang);
      }
    } catch (_e) {
      fallbackReason = "openai_unavailable";
      brief = fallbackBrief(aggregates, ctx, lang);
    }
  }

  // 7a. Scrivi coach_brief.json (con error-check).
  const { error: briefErr } = await sb.storage
    .from("user-data")
    .upload(
      `${userId}/quaderno/coach_brief.json`,
      new Blob([JSON.stringify(brief, null, 2)], { type: "application/json" }),
      { upsert: true, contentType: "application/json" }
    );
  if (briefErr) return jsonError("brief_upload_failed", 500, origin);

  // 7b. Quaderno: APPEND (la nuova voce in cima alle precedenti), non overwrite.
  const entry = renderJournalEntry(brief, ctx, aggregates, lang);
  const journal = await prependJournalEntry(sb, journalPath, entry, lang);
  const { error: journalErr } = await sb.storage
    .from("user-data")
    .upload(
      journalPath,
      new Blob([journal], { type: "text/markdown" }),
      { upsert: true, contentType: "text/markdown" }
    );
  if (journalErr) return jsonError("journal_upload_failed", 500, origin);

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

const FORBIDDEN_COACH_CLAIMS = [
  /\b(?:1|one)\s+(?:su|in)\s+\d+/i,
  /\b\d+(?:[.,]\d+)?\s*%\s+(?:(?:dei|delle|di)\s+)?(?:giocatori|persone|players|people)\b/i,
  /\bmaia\b.{0,50}\b\d+(?:[.,]\d+)?\s*%/i,
  /\+\s*\d+\s*(?:punti\s+)?(?:elo|rating)\b/i,
  /\brating\s+(?:sale|aumenta|cresce|rises|grows)\b/i,
  /\b(?:potevi|avresti potuto)\s+evitar|\byou could have avoided\b/i,
  /\b(?:probabilit[aà]\s+(?:maia|umana|al tuo livello)|maia\s+probability)\b/i,
  /\b(?:difficile|facile)\s+(?:da vedere\s+)?al tuo livello|\b(?:hard|easy)\s+to\s+(?:see|find)\s+at your level/i,
  /\b(?:al tuo livello|at your (?:level|rating))\b/i,
];

function hasForbiddenCoachClaim(value: string): boolean {
  return FORBIDDEN_COACH_CLAIMS.some((pattern) => pattern.test(value));
}

function isNonEmptyBoundedString(value: unknown, max: number): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.length <= max;
}

function isValidBrief(b: unknown): b is CoachBrief {
  if (!b || typeof b !== "object") return false;
  const x = b as Record<string, unknown>;
  if (!isNonEmptyBoundedString(x.one_line_diagnosis, 600)) return false;
  if (!isNonEmptyBoundedString(x.weekly_focus, 1200)) return false;
  if (!isNonEmptyBoundedString(x.voice_message, 1600)) return false;
  if (!Array.isArray(x.top_3_freni) || x.top_3_freni.length === 0 || x.top_3_freni.length > 3) return false;
  const itemsValid = x.top_3_freni.every((f) => {
    const ff = f as Record<string, unknown>;
    return (
      ff &&
      isNonEmptyBoundedString(ff.title, 240) &&
      isNonEmptyBoundedString(ff.evidence, 800) &&
      isNonEmptyBoundedString(ff.next_step, 800)
    );
  });
  if (!itemsValid) return false;
  const userText = [
    x.one_line_diagnosis,
    x.weekly_focus,
    x.voice_message,
    ...x.top_3_freni.flatMap((f) => {
      const item = f as Record<string, unknown>;
      return [item.title, item.evidence, item.next_step];
    }),
  ].join(" ");
  return !hasForbiddenCoachClaim(userText);
}

const ANCHOR_LABEL_EN: Record<string, string> = {
  left_winning_band: "Advantage slipping away",
  clock_pressure: "Errors with little time left",
  fast_decision: "Quick decisions",
  narrow_choice_after_long_think: "Narrow choices after a long think",
  unclassified_error: "Positions to review",
  careless: "Positions to review",
  hung_piece: "Pieces left en prise",
  rushed: "Quick decisions",
  conversion: "Converting an advantage",
  zeitnot: "Errors with little time left",
  missed_tactic: "Tactical opportunities",
  hard_calc: "Calculation after a long think",
};

function anchorLabel(anchor: Pick<Anchor, "type" | "label_it">, lang: Lang): string {
  if (lang === "it") return anchor.label_it;
  return ANCHOR_LABEL_EN[anchor.type] ?? "Recurring pattern";
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
    const topLabel = anchorLabel(top, lang);
    if (en) {
      return {
        one_line_diagnosis: `The main thing holding you here is ${topLabel}: that is where you are leaving the most on the board.`,
        top_3_freni: top3.map((a) => ({
          title: anchorLabel(a, lang),
          evidence: `${a.count} observed moments across ${a.games_with} games.`,
          next_step: `Go back to two or three recent games and look for this recurring moment: ${anchorLabel(a, lang).toLowerCase()}.`,
        })),
        weekly_focus: `This week, in your ${ctx.weekly_minutes} minutes: focus on ${topLabel}.`,
        voice_message: `I looked at your last ${agg.games_analyzed} games. The most recurrent training priority is ${topLabel}. We start there. Come back tomorrow.`,
      };
    }
    return {
      one_line_diagnosis: `La tua priorità principale è ${topLabel}: è il pattern da rivedere per primo.`,
      top_3_freni: top3.map((a) => ({
        title: anchorLabel(a, lang),
        evidence: `${a.count} momenti osservati in ${a.games_with} partite.`,
        next_step: `Rivedi 2-3 partite recenti e cerca questo momento ricorrente: ${anchorLabel(a, lang).toLowerCase()}.`,
      })),
      weekly_focus: `Questa settimana, nei tuoi ${ctx.weekly_minutes} min: concentrati su ${topLabel}.`,
      voice_message: `Ho guardato le tue ultime ${agg.games_analyzed} partite. La priorità di allenamento più ricorrente è ${topLabel}. Partiamo da lì.`,
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
      one_line_diagnosis: `The phase with the highest observed serious-error rate is ${worst[0]}.`,
      top_3_freni: ranked.slice(0, 3).map(([name, p]) => ({
        title: `Errors in ${name}`,
        evidence: `${p.blunder_pct.toFixed(1)}% serious errors across ${p.moves} observed moves.`,
        next_step: `Go back to two or three recent games and look for the recurring pattern in ${name}.`,
      })),
      weekly_focus: `This week, in your ${ctx.weekly_minutes} minutes: focus on ${worst[0]}.`,
      voice_message: `I looked at your last ${agg.games_analyzed} games. ${worst[0]} has the highest observed serious-error rate. We start there. Come back tomorrow.`,
    };
  }
  return {
    one_line_diagnosis: `La fase con il tasso osservato di errori gravi più alto è ${worst[0]}.`,
    top_3_freni: ranked.slice(0, 3).map(([name, p]) => ({
      title: `Errori in ${name}`,
      evidence: `${p.blunder_pct.toFixed(1)}% di errori gravi su ${p.moves} mosse osservate.`,
      next_step: `Rivedi 2-3 partite recenti e cerca il pattern ricorrente in ${name}.`,
    })),
    weekly_focus: `Questa settimana, nei tuoi ${ctx.weekly_minutes} min: concentrati su ${worst[0]}.`,
    voice_message: `Ho guardato le tue ultime ${agg.games_analyzed} partite. In ${worst[0]} il tasso osservato di errori gravi è il più alto. Partiamo da lì.`,
  };
}

function moveNumber(ply: number): number {
  return Math.ceil(ply / 2);
}

// Rende esempi osservati senza trasformare la policy in frequenza umana.
function renderExamples(examples: PositionExample[] | undefined, lang: Lang): string {
  if (!examples || examples.length === 0) return "";
  const en = lang === "en";
  const lines = examples
    .slice(0, 8)
    .map((e) => {
      const best = en
        ? e.best_uci ? `reference move ${e.best_uci}` : "a stronger reference move was available"
        : e.best_uci ? `mossa di riferimento ${e.best_uci}` : "era disponibile una mossa di riferimento migliore";
      const parts: string[] = [
        en
          ? `[${e.phase}, move ${moveNumber(e.ply)}, ${e.color === "white" ? "White" : "Black"}] played ${e.san} (${e.played_uci}); ${best}; engine loss about ${Math.round(e.cp_loss)}cp`
          : `[${e.phase}, mossa ${moveNumber(e.ply)}, ${e.color === "white" ? "Bianco" : "Nero"}] hai giocato ${e.san} (${e.played_uci}); ${best}; perdita motore ~${Math.round(e.cp_loss)}cp`,
      ];
      // Tic: tempo speso sulla mossa.
      if (e.spent_seconds != null) {
        const z = en
          ? e.time_state === "zeitnot" ? " (under severe time pressure)" :
            e.time_state === "rushed" ? " (decision within 3 seconds)" :
            e.time_state === "long_think" ? " (after a long think)" : ""
          : e.time_state === "zeitnot" ? " (in zeitnot)" :
            e.time_state === "rushed" ? " (decisione entro 3 secondi)" :
            e.time_state === "long_think" ? " (dopo lungo pensiero)" : "";
        parts.push(en
          ? `time used ${Math.round(e.spent_seconds)}s${z}`
          : `tempo speso ${Math.round(e.spent_seconds)}s${z}`);
      }
      if (e.state_before === "winning") parts.push(en ? "you were ahead" : "eri in vantaggio");
      // Include Maia only for a real scored policy result. Values are raw
      // normalized model masses over the observed acceptable move set.
      if (
        e.maia_status === "scored" &&
        e.maia_policy_semantics === "raw_policy_mass_not_calibrated_frequency"
      ) {
        const mine = e.maia_mine_acceptable_observed_policy;
        const target = e.maia_target_acceptable_observed_policy;
        if (mine != null || target != null) {
          parts.push(
            en
              ? `raw policy mass over the observed acceptable set: current=${mine?.toFixed(3) ?? "n/a"}, target=${target?.toFixed(3) ?? "n/a"}; these are not human frequencies`
              : `masse policy raw sull'insieme accettabile osservato: current=${mine?.toFixed(3) ?? "n/d"}, target=${target?.toFixed(3) ?? "n/d"}; non sono frequenze umane`,
          );
        }
        if (e.maia_domain_reason === "chesscom_rapid_cross_domain") {
          parts.push(en
            ? "cross-domain comparison: Chess.com rapid game, model trained on Lichess blitz"
            : "confronto cross-domain: partita Chess.com rapid, modello addestrato su Lichess blitz");
        } else if (e.maia_domain_reason === "chesscom_blitz_cross_platform") {
          parts.push(en
            ? "cross-platform comparison: Chess.com game, model trained on Lichess"
            : "confronto cross-platform: partita Chess.com, modello addestrato su Lichess");
        } else if (e.maia_domain_reason === "low_clock_out_of_training_domain") {
          parts.push(en
            ? "fewer than 30 seconds remained: outside Maia's training domain; no current-level claim"
            : "meno di 30 secondi rimasti: fuori dominio Maia; nessun claim sul livello corrente");
        }
        if (e.maia_domain_status !== "out_of_training_domain" && e.avoidable_at_current === true) {
          parts.push(en
            ? "the current-policy support threshold is met (ranking heuristic only)"
            : "la soglia euristica di supporto della policy corrente è superata (solo ranking)");
        }
        if (e.target_relevant === true) {
          parts.push(en
            ? "the target-relevance threshold is met (ranking heuristic only)"
            : "la soglia euristica di rilevanza per il target è superata (solo ranking)");
        }
      }
      return "- " + parts.join("; ") + `. FEN: ${e.fen_before}`;
    })
    .join("\n");
  if (en) {
    return `

CONCRETE EXAMPLES FROM THE PLAYER'S GAMES (use only these; do not invent positions):
${lines}

Per-move data may support the voice through time used, game state, and verified chess facts. Maia policy, when present, is raw mass over an observed acceptable set: it is NOT a frequency of people and does NOT support one-in-N statements, personal probabilities, or rating-based difficulty claims. If the data is outside the training domain, make no current-level claim. Do not expose FEN, UCI, centipawns, policy values, or other internal notation in user-facing text.`;
  }
  return `

ESEMPI CONCRETI (tue mosse reali — usa QUESTI, non inventare posizioni):
${lines}

Questi dati per-mossa sono strumenti di voce: tempo speso, stato della partita e fatti scacchistici verificati. La policy Maia, quando presente, è massa raw sull'insieme accettabile osservato: NON è una frequenza di persone e NON autorizza rapporti fra persone o giudizi di difficoltà umana basati sul rating. Se il dato è fuori dominio, non fare claim sul livello corrente. Non mostrare FEN, UCI, centipawn, valori policy o altra notazione interna nel testo utente. Usa SOLO dati presenti e non inventare posizioni o numeri.`;
}

// [2D] Riassunto anchors Maia-aware per il prompt utente.
// Ordinate per weighted_score desc; top 5 per non gonfiare il contesto.
function renderAnchors(anchors: Anchor[] | undefined, lang: Lang): string {
  if (!anchors || anchors.length === 0) return "";
  const en = lang === "en";
  const sorted = anchors.slice().sort((a, b) => b.weighted_score - a.weighted_score);
  const lines = sorted.slice(0, 5).map((a, i) => {
    const mine = a.mine_acceptable_observed_policy_pct;
    const target = a.target_acceptable_observed_policy_pct;
    const policy = mine != null || target != null
      ? en
        ? `; mean raw policy mass over the observed acceptable set current=${mine != null ? (mine / 100).toFixed(3) : "n/a"}, target=${target != null ? (target / 100).toFixed(3) : "n/a"}`
        : `; media massa policy raw sull'insieme accettabile osservato current=${mine != null ? (mine / 100).toFixed(3) : "n/d"}, target=${target != null ? (target / 100).toFixed(3) : "n/d"}`
      : "";
    return en
      ? `${i + 1}. ${anchorLabel(a, lang)}: ${a.count} observed moments across ${a.games_with} games${policy}`
      : `${i + 1}. ${anchorLabel(a, lang)}: ${a.count} momenti osservati in ${a.games_with} partite${policy}`;
  });
  if (en) {
    return `

ANCHORS (ordered by observed training priority; this order is not an Elo estimate):
${lines.join("\n")}

Rule: use this order to choose the focus without exposing opaque scores. Maia masses are raw model outputs over the observed acceptable set, not human frequencies.`;
  }
  return `

ANCORE (ordinate per priorità di training osservata; l'ordine non è una stima Elo):
${lines.join("\n")}

Regola: usa l'ordine per scegliere il focus, senza citare score opachi. Le masse Maia sono output raw del modello sull'insieme accettabile osservato, non frequenze umane.`;
}

// [2D] Riassunto maia_weighted per il prompt utente.
function renderMaiaWeighted(mw: MaiaWeighted | null | undefined, lang: Lang): string {
  if (!mw || mw.policy_semantics !== "raw_policy_mass_not_calibrated_frequency") return "";
  const mine = mw.mine_acceptable_observed_policy_pct;
  const target = mw.target_acceptable_observed_policy_pct;
  if (lang === "en") {
    return `

MAIA SIGNAL (raw policy only, not calibrated human frequencies):
- Errors with a scored Maia result: ${mw.errors_scored}
- Positions meeting the target-relevance ranking threshold: ${mw.target_relevant ?? 0}
- Positions selected by the training-ranking heuristic: ${mw.trainable ?? 0}
- Mean raw policy mass over the observed acceptable set: current=${mine != null ? (mine / 100).toFixed(3) : "n/a"}, target=${target != null ? (target / 100).toFixed(3) : "n/a"}
Do not translate these values into people-out-of-N statements, personal probability, human difficulty, or Elo points.`;
  }
  return `

SEGNALE MAIA (solo policy raw, non frequenze umane calibrate):
- Errori con score Maia reale: ${mw.errors_scored}
- Posizioni rilevanti per il target: ${mw.target_relevant ?? 0}
- Posizioni selezionate come allenabili: ${mw.trainable ?? 0}
- Media massa policy sull'insieme accettabile osservato: current=${mine != null ? (mine / 100).toFixed(3) : "n/d"}, target=${target != null ? (target / 100).toFixed(3) : "n/d"}
Non tradurre questi valori in "persone su N", probabilità di una persona, difficoltà umana o punti Elo.`;
}

function renderMaiaCoverage(coverage: MaiaCoverage | undefined, lang: Lang): string {
  if (
    !coverage ||
    coverage.policy_semantics !== "raw_policy_mass_not_calibrated_frequency" ||
    (coverage.status !== "partial" && coverage.status !== "complete")
  ) return "";
  const reasons = JSON.stringify(coverage.reason_counts ?? {}).slice(0, 2000);
  const domains = JSON.stringify(coverage.domain_reason_counts ?? {}).slice(0, 1000);
  if (lang === "en") {
    return `

MAIA COVERAGE:
- status=${coverage.status}; eligible=${coverage.eligible_positions}; selected=${coverage.selected_positions}; scored=${coverage.scored_positions}
- not-scored reasons=${reasons}
- domains=${domains}
Chess.com is cross-platform relative to the Lichess training data; rapid is also cross-time-control. With fewer than 30 seconds left, the position is outside the training domain and supports no current-level claim.`;
  }
  return `

COPERTURA MAIA:
- stato=${coverage.status}; eleggibili=${coverage.eligible_positions}; selezionate=${coverage.selected_positions}; scored=${coverage.scored_positions}
- motivi non-score=${reasons}
- domini=${domains}
Chess.com è sempre cross-platform rispetto al training Lichess; rapid è anche cross-time-control. Sotto 30 secondi la posizione è fuori dominio e non autorizza claim sul livello corrente.`;
}

// [2B] Estrae le ultime N voci di voce dal journal markdown.
// Cerca i blocchi "## YYYY-MM-DD · Sessione" e prende il testo
// del voice_message (prima sezione, fino al prossimo "**").
// Restituisce null se non ci sono voci precedenti vere.
function extractRecentJournalVoices(journal: string | null, maxVoci: number): string | null {
  if (!journal) return null;
  // Trova tutti i blocchi di sessione in italiano o inglese.
  const blocks: string[] = [];
  const re = /## \d{4}-\d{2}-\d{2} · (?:Sessione|Session)([\s\S]*?)(?=\n## |\n---\s*$|$)/g;
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
  return voices.join("\n---\n").slice(0, 6000);
}

// [2B] Calcola il delta per-ancora tra il primo e l'ultimo snapshot di history.
// Frequenza per-partita = count / games_analyzed.
// Restituisce null se mancano dati sufficienti.
function computeAnchorDelta(
  snapshots: HistorySnapshot[] | null,
  lang: Lang,
): string | null {
  if (!snapshots || snapshots.length < 2) return null;

  // Ordina per data ascending (più vecchio primo, più recente ultimo).
  const sorted = snapshots
    .filter((s) =>
      !!boundedText(s.captured_at, 80) &&
      Array.isArray(s.anchors) &&
      s.anchors.length > 0 &&
      finiteNumber(s.games_analyzed, 20, 10_000)
    )
    .sort((a, b) => (a.captured_at ?? "").localeCompare(b.captured_at ?? ""));

  if (sorted.length < 2) return null;

  const oldest = sorted[0];
  const newest = sorted[sorted.length - 1];
  const oldGames = oldest.games_analyzed ?? 1;
  const newGames = newest.games_analyzed ?? 1;
  const fromDate = oldest.captured_at.slice(0, 10);
  const toDate = newest.captured_at.slice(0, 10);
  // Multiple refreshes on the same day are not evidence of longitudinal change.
  if (!fromDate || !toDate || fromDate === toDate) return null;

  // Costruisce mappa tipo -> freq per ogni snapshot
  const oldFreq = new Map<string, { count: number; frequency: number }>();
  for (const a of (oldest.anchors ?? [])) {
    const key = boundedText(a.key, 80);
    if (!key || !finiteNumber(a.count, 3, 100_000)) continue;
    oldFreq.set(key, { count: a.count, frequency: a.count / oldGames });
  }

  const lines: string[] = [];
  for (const a of (newest.anchors ?? [])) {
    if (lines.length >= 10) break;
    const key = boundedText(a.key, 80);
    if (!key || !finiteNumber(a.count, 3, 100_000)) continue;
    const newF = a.count / newGames;
    const previous = oldFreq.get(key);
    if (!previous) continue;
    const diff = newF - previous.frequency;
    if (Math.abs(diff) < 0.02) continue;
    const label = lang === "en"
      ? ANCHOR_LABEL_EN[key] ?? "Recurring pattern"
      : boundedText(a.label_it, 120) ?? "Pattern ricorrente";
    lines.push(lang === "en"
      ? `- ${label}: ${previous.frequency.toFixed(3)} observed errors/game in the earlier sample; ${newF.toFixed(3)} in the later sample.`
      : `- ${label}: ${previous.frequency.toFixed(3)} errori osservati/partita nel campione precedente; ${newF.toFixed(3)} nel campione successivo.`);
  }

  if (lines.length === 0) return null;

  if (lang === "en") {
    return `
SAMPLE COMPARISON (${fromDate} and ${toDate}; each sample contains at least 20 games):
${lines.join("\n")}

These are two observed samples, not proof of a trend or of improvement. You may report the two values only. Do not say that a pattern is rising, falling, improving, or worsening.`;
  }
  return `
CONFRONTO TRA CAMPIONI (${fromDate} e ${toDate}; almeno 20 partite per campione):
${lines.join("\n")}

Sono due campioni osservati, non la prova di un andamento o di un miglioramento. Puoi riportare solo i due valori. Non dire che un pattern sta salendo, scendendo, migliorando o peggiorando.`;
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
2. Maia policy context: use it only to order training priorities. It is raw model policy mass on an observed acceptable move set, not a calibrated frequency of players. Never translate it into "one in N," human probability, or difficulty at a rating.
3. Winning position left behind: if state_before === "winning," say it plainly.

ANCHORS in English: say "what is holding you here" or describe the observed recurring pattern directly. Never "your weakness is X," and never promise rating points.

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
  max_tokens?: number;
}

async function fetchOpenAiRaw(opts: OpenAiCallOptions): Promise<string> {
  const body: Record<string, unknown> = {
    model: OPENAI_MODEL,
    messages: opts.messages,
    max_tokens: opts.max_tokens ?? 700,
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
    signal: AbortSignal.timeout(20_000),
  });

  if (!resp.ok) {
    const errText = await resp.text();
    // Robustezza temperatura: se 400 e l'errore parla di "temperature",
    // riprova senza il campo (modelli nuovi che non lo accettano).
    if (resp.status === 400 && opts.temperature != null && errText.toLowerCase().includes("temperature")) {
      const retryBody: Record<string, unknown> = {
        model: OPENAI_MODEL,
        messages: opts.messages,
        max_tokens: opts.max_tokens ?? 700,
      };
      if (opts.response_format) retryBody.response_format = opts.response_format;
      const retry = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${OPENAI_API_KEY}`,
        },
        body: JSON.stringify(retryBody),
        signal: AbortSignal.timeout(20_000),
      });
      if (!retry.ok) {
        throw new Error("openai_request_failed");
      }
      const retryData = (await retry.json()) as { choices: Array<{ message: { content: string } }> };
      return retryData.choices[0]?.message?.content ?? "{}";
    }
    throw new Error("openai_request_failed");
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

const TEACH_EXAMPLES = `ESEMPI DI VOCE (bersaglio di stile — massimo quattro frasi, senza attribuire intenzioni non fornite):

Esempio 1 (pezzo in presa):
"Hai giocato Dd3. Il cavallo in e5 era senza difensori e, dopo Dd3, dxe5 lo prendeva senza ricattura immediata. Prima di muovere, passa in rassegna i tuoi pezzi e controlla quali non sono difesi. Cf3 rimetteva il cavallo al sicuro."

Esempio 2 (conversione):
"Eri avanti di una torre e hai giocato Cxb6. Dopo Cxb6, Axd4 prendeva la donna in d4. Quando sei in vantaggio netto, controlla prima le risposte forzanti dell'avversario. Td1 teneva la posizione sotto controllo."`;

function buildTeachSystemIT(): string {
  return `Sei Nonno, maestro di scacchi. Insegni il PERCHE' di una mossa. NON analizzi la scacchiera da solo: ti do io i fatti VERI verificati dal motore. Usa SOLO quei fatti: non inventare mosse, pezzi, case o valutazioni che non ti ho dato. Se un fatto non c'e', non dirlo.

STRUTTURA (4 passi fusi in 3-4 frasi naturali, NON un elenco):
1. Osservazione: nomina la mossa giocata. Non attribuire al giocatore un'intenzione o un motivo che non compare nei fatti forniti.
2. Punizione: se c'e' (campo punishment o punishment_line), una mezza riga: "dopo X, arrivava Y". Se mancano entrambi, NON inventare una punizione: passa direttamente al passo 3.
3. Principio trasferibile: ti do il campo principle con nome e idea. Rendilo tuo in una frase, non citarlo meccanicamente.
4. Confronto: la mossa giusta (best_san) e cosa cambia. Se manca la punizione, usa questo passo per spiegare cosa ottiene la mossa giusta.

MAIA: se presente, contiene solo masse policy raw sull'insieme di mosse accettabili osservato. NON trasformarle in frequenze umane, probabilità personali o frasi sulla difficoltà al livello del giocatore. Se domain_status è out_of_training_domain, non fare alcun claim sul livello corrente.

VOCE:
- Seconda persona, "tu". Mai "il giocatore".
- Frasi corte. Niente em-dash. Niente esclamazioni. Niente paternalismo.
- Lessico scacchistico italiano: "pezzo in presa", "mediogioco", "ottava traversa", "scacco di scoperta". Mai "blunder", "hanging piece", "inaccuracy" o "accuracy".
- Niente "accuracy", niente percentuali, niente valutazioni in centipedoni.
- Max 4 frasi totali.

OUTPUT: SOLO JSON { "lesson": "..." }

${TEACH_EXAMPLES}`;
}

const TEACH_EXAMPLES_EN = `VOICE EXAMPLES (style target — no more than four sentences, with no invented intention):

Example 1 (piece left en prise):
"You played Qd3. The knight on e5 had no defender and, after Qd3, dxe5 took it without an immediate recapture. Before you move, run through your pieces and check which ones are undefended. Nf3 brought the knight back to safety."

Example 2 (conversion):
"You were up a rook and played Nxb6. After Nxb6, Bxd4 took the queen on d4. When you are clearly ahead, check the opponent's forcing replies first. Rd1 kept the position under control."`;

function buildTeachSystemEN(): string {
  return `You are Nonno, a chess coach. You teach WHY a move was wrong. You do NOT analyse the position yourself: I give you the TRUE facts verified by the engine. Use ONLY those facts: do not invent moves, pieces, squares, or evaluations I have not given you. If a fact is missing, do not mention it.

STRUCTURE (4 steps blended into 3-4 natural sentences, NOT a list):
1. Observation: name the move played. Do not attribute an intention or motive to the player unless it appears in the supplied facts.
2. Punishment: if present (field punishment or punishment_line), half a sentence: "after X, comes Y". If both are missing, do NOT invent a punishment: move directly to step 3.
3. Transferable principle: I give you the field principle with name and idea. Make it yours in one sentence, do not quote it mechanically.
4. Comparison: the right move (best_san) and what changes. If no punishment, use this step to explain what the right move achieves.

MAIA: when present, it contains only raw policy mass over the observed acceptable move set. Do NOT turn it into human frequency, personal probability, or a claim about difficulty at the player's rating. If domain_status is out_of_training_domain, make no current-level claim.

VOICE:
- Second person, "you." Never "the player."
- Short sentences. No em-dash. No exclamations. No paternalism.
- Real chess language: "piece left en prise," "undefended piece," "middlegame," "back rank," "discovered check." Never "blunder," "hanging piece," "inaccuracy," or "accuracy."
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
      lines.push(`Piece left en prise after the move: ${f.hung_piece.type} on ${f.hung_piece.square}`);
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
      if (eff === "save") effDesc = "keeps the piece safe";
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
      lines.push("Maia semantics: raw model policy mass on the observed acceptable move set; not calibrated human frequency.");
      if (req.maia.current_acceptable_observed_policy != null) lines.push(`Current raw acceptable-set policy mass: ${req.maia.current_acceptable_observed_policy.toFixed(3)}`);
      if (req.maia.target_acceptable_observed_policy != null) lines.push(`Target raw acceptable-set policy mass: ${req.maia.target_acceptable_observed_policy.toFixed(3)}`);
      if (req.maia.domain_reason) lines.push(`Maia domain note: ${req.maia.domain_reason}`);
      if (req.maia.domain_status !== "out_of_training_domain" && req.maia.avoidable_at_current === true) lines.push("Current-policy support threshold: met (ranking heuristic only).");
      if (req.maia.target_relevant === true) lines.push("Target-policy relevance threshold: met (ranking heuristic only).");
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
      lines.push("Semantica Maia: massa policy raw del modello sull'insieme di mosse accettabili osservato; non è una frequenza umana calibrata.");
      if (req.maia.current_acceptable_observed_policy != null) lines.push(`Massa policy raw current sull'insieme accettabile: ${req.maia.current_acceptable_observed_policy.toFixed(3)}`);
      if (req.maia.target_acceptable_observed_policy != null) lines.push(`Massa policy raw target sull'insieme accettabile: ${req.maia.target_acceptable_observed_policy.toFixed(3)}`);
      if (req.maia.domain_reason) lines.push(`Nota dominio Maia: ${req.maia.domain_reason}`);
      if (req.maia.domain_status !== "out_of_training_domain" && req.maia.avoidable_at_current === true) lines.push("Soglia euristica di supporto current: superata (solo ranking).");
      if (req.maia.target_relevant === true) lines.push("Soglia euristica di rilevanza target: superata (solo ranking).");
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
    max_tokens: 320,
  });

  // Valida che la risposta abbia { lesson: string }
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(raw) as Record<string, unknown>;
  } catch (_e) {
    // 200 OK ma corpo non-JSON (es. pagina di rate-limit del CDN): errore esplicito.
    throw new Error("teach: risposta non-JSON dall'LLM");
  }
  if (
    typeof parsed?.lesson !== "string" ||
    parsed.lesson.trim() === "" ||
    parsed.lesson.length > 2000 ||
    hasForbiddenCoachClaim(parsed.lesson)
  ) {
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
2. Il contesto Maia, quando presente: usalo soltanto per scegliere l'ordine del training. È massa policy raw su un insieme accettabile osservato, non una frequenza umana. Non trasformarlo mai in rapporti fra persone, probabilità personale o difficoltà umana al rating.
3. Se eri in vantaggio e l'hai lasciata andare, dillo.
L'ancora principale è DIVERSA per ogni giocatore: per uno è il tempo, per un altro un finale, per un altro un pezzo in presa. Di' quella VERA per lui, non quella che suona meglio.

DIVIETI (riscrivi se stai per usarli):
- Mai "blunder", "hanging piece", "inaccuracy", "accuracy" nel testo che legge l'utente. Italiano vero: "pezzo in presa", "errore grave" (in voce: "ci hai regalato il pezzo"), "mediogioco", "finale", "ottava traversa".
- Mai "freno/freni": si dice ANCORA/ANCORE, presentate come priorità di lavoro osservate, mai come colpa o promessa di rating.
- Niente em-dash. Niente emoji. Niente "Allora vediamo!" o toni da animatore. Niente percentuali di accuratezza.
- I campi tecnici servono SOLO al ranking interno: non citarli mai all'utente come numeri e non promettere punti Elo. Parla di momenti, partite, secondi e pattern osservati.

BEAT DI CONTINUITA' (obbligatorio per il primo brief di un utente nuovo):
Se il journal del giocatore è vuoto (nessuna voce precedente), chiudi il campo voice_message con un beat di continuità: dopo la diagnosi personalizzata, aggiungi una frase breve che annunci che tornerai. Esempi di tono: "Domani ne apriamo un'altra." oppure "Domani ripartiamo da quello che hai visto." La frase deve essere nella voce di Nonno, in seconda persona, senza numeri che non hai letto dagli aggregati, senza promesse di rating, senza esclamazioni. Il beat va dopo il punto fermo della diagnosi, non al centro e non come congedo formale. Se il journal ha già voci precedenti, questo beat è facoltativo: usa il tuo giudizio su quando la continuità aggiunge qualcosa di vero.

CAMPI JSON:
- "voice_message": È IL PRIMO COLPO, la prima cosa che il giocatore legge. 2-3 frasi tue: la cosa più vera e specifica che hai visto, citando UN tic concreto se c'è (un esempio reale: fase, cosa è successo o tempo usato). Se hai MEMORIA di sessioni precedenti (vedi sotto), apri con continuità quando ha senso ("la volta scorsa ti avevo detto X, com'è andata?") MA SOLO se c'è una voce precedente vera — mai inventare. Deve sentire che l'hai guardato davvero, non un report generico. Per collegare il focus all'obiettivo puoi dire "per il tuo obiettivo, questa viene prima nel lavoro"; non fare affermazioni su ciò che una persona del suo livello vedrebbe.
- "one_line_diagnosis": UNA frase, l'ancora principale, diretta. Es: "Quando arrivi in finale con un pedone in più, non lo converti."
- "top_3_freni": le 3 ANCORE prioritarie nell'ordine già fornito. Ognuna: evidence (numero specifico O esempio concreto dagli ESEMPI) + next_step (azione per la settimana). Nel testo usa sempre "ancora". Non trasformare l'ordine in una promessa Elo o in un giudizio di colpa.
- "weekly_focus": cosa allenare questa settimana dati i ${ctx.weekly_minutes} minuti.

Le percentuali di errori osservati le riporti come sono. I valori Maia sono masse policy raw: non presentarli come percentuali di persone e, nel dubbio, omettili dal testo utente. Output: SOLO il JSON.`;

  const systemPromptEN = `You are Nonno, the player's chess coach. One voice only: calm, dry, lived experience. You speak directly to "you." You are FACTUAL: everything grounded in the numbers and examples I give you. You do not invent patterns without evidence.

Goal: read the aggregates and produce a Coach Brief in JSON.${EN_REGISTER_SECTION}

JSON FIELDS:
- "voice_message": This is the first thing the player reads. Two or three of your sentences: the truest and most specific thing you saw, quoting ONE concrete tic if the data supports it (a real example: phase, what happened, or time used). If you have MEMORY of previous sessions (see below), open with continuity when it makes sense ("last time I told you X, how did that go?") BUT ONLY if there is a real previous entry — never invent. The player must feel you actually looked at their games, not a generic report.
- "one_line_diagnosis": ONE sentence, the main anchor, direct. E.g.: "When you reach the endgame up a pawn, you do not convert."
- "top_3_freni": the 3 priority anchors in the order already provided. Each one: evidence (a specific number OR a concrete example from the EXAMPLES) + next_step (action for the week). Say "anchor" or describe it directly, never "weakness." Do not turn the ranking into an Elo promise or a judgment of blame.
- "weekly_focus": what to train this week given ${ctx.weekly_minutes} minutes.

Report observed error percentages as they are. Maia values are raw policy masses: never present them as percentages of people and omit them from user-facing text when in doubt. Output: ONLY the JSON.`;

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
    ? `Player: authenticated learner
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

By time class: ${JSON.stringify(agg.by_time_class)}${renderMaiaCoverage(agg.maia_coverage, lang)}${renderMaiaWeighted(agg.maia_weighted, lang)}${renderAnchors(agg.anchors, lang)}${renderExamples(agg.examples, lang)}${anchorDelta ?? ""}

Produce the Coach Brief JSON.`
    : `Giocatore: utente autenticato
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

Per categoria di tempo: ${JSON.stringify(agg.by_time_class)}${renderMaiaCoverage(agg.maia_coverage, lang)}${renderMaiaWeighted(agg.maia_weighted, lang)}${renderAnchors(agg.anchors, lang)}${renderExamples(agg.examples, lang)}${anchorDelta ?? ""}

Produci il Coach Brief JSON.`;

  if (userPrompt.length > 60_000) throw new Error("coach_context_too_large");

  const text = await fetchOpenAiRaw({
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
    response_format: { type: "json_object" },
    temperature: 0.4,
    max_tokens: 700,
  });
  return JSON.parse(text) as unknown;
}

// Quaderno append: header in cima, nuova voce subito sotto l'intro (prima delle
// voci precedenti), così la sessione più recente è la prima che leggi.
async function prependJournalEntry(
  sb: ReturnType<typeof createClient>,
  journalPath: string,
  entry: string,
  lang: Lang,
): Promise<string> {
  const HEADER = lang === "en" ? `# Notebook

> Nonno's persistent memory. Every entry is dated and signed.

---
` : `# Quaderno

> Memoria persistente di Nonno. Ogni voce è datata e firmata.

---
`;
  let existing: string | null = null;
  try {
    const { data } = await sb.storage.from("user-data").download(journalPath);
    if (data && data.size <= MAX_JOURNAL_BYTES) existing = await data.text();
  } catch (_e) {
    existing = null;
  }

  if (!existing) {
    return `${HEADER}\n${entry}`;
  }
  // Keep the newest prefix bounded; old entries are context, not an unbounded log.
  if (existing.length > 80_000) existing = existing.slice(0, 80_000);
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
  agg: Aggregates,
  lang: Lang,
): string {
  const today = new Date().toISOString().slice(0, 10);
  if (lang === "en") {
    return `
## ${today} · Session

${brief.voice_message}

**Diagnosis in one sentence:**
${brief.one_line_diagnosis}

**Three anchors I saw** (across ${agg.games_analyzed} games, ${ctx.goal_time_class}):

${brief.top_3_freni
  .map(
    (f, i) =>
      `${i + 1}. **${f.title}**: ${f.evidence}\n   _Next step:_ ${f.next_step}`
  )
  .join("\n\n")}

**This week:**
${brief.weekly_focus}

---
_Nonno_
`;
  }
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
