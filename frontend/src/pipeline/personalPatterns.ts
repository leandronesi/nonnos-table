import type { GameAnalysis } from "./analyze";
import { assessDecisionTiming, type DecisionTiming } from "./decisionTiming";
import type { MaiaPolicyMetrics } from "./maia/policySemantics";
import type { PatternObservation } from "./patternLearning";

export const PATTERN_VERSION = 2;
export type PatternKind = "fork" | "back_rank" | "hanging_piece" | "narrow_choice" | "time_reserve" | "time_pressure" | "keep_advantage";

export const PATTERN_CATALOG: Record<PatternKind, { title: string; titleEn: string; action: string; actionEn: string }> = {
  fork: { title: "Riconoscere i doppi attacchi", titleEn: "Recognize double attacks", action: "Prima di scegliere, cerca un pezzo che possa attaccare due bersagli insieme.", actionEn: "Before choosing, look for a piece that can attack two targets at once." },
  back_rank: { title: "Proteggere l'ultima traversa", titleEn: "Watch the back rank", action: "Controlla le vie di fuga del re e le linee aperte per torri e donna.", actionEn: "Check the king's escape squares and open lines for rooks and queens." },
  hanging_piece: { title: "Controllare i pezzi in presa", titleEn: "Check exposed pieces", action: "Dopo la mossa avversaria, ricontrolla quali pezzi sono attaccati e chi li difende.", actionEn: "After the opponent's move, check which pieces are attacked and who defends them." },
  narrow_choice: { title: "Fermarsi nelle scelte delicate", titleEn: "Pause at consequential choices", action: "Metti a confronto almeno due candidate e la migliore risposta dell'avversario.", actionEn: "Compare at least two candidates and the opponent's strongest reply." },
  time_reserve: { title: "Usare il tempo che hai", titleEn: "Use the time you have", action: "Con tempo disponibile, riconosci quando la posizione richiede un controllo prima di muovere.", actionEn: "With time available, recognize when the position needs a check before moving." },
  time_pressure: { title: "Decidere con poco tempo", titleEn: "Decide with little time", action: "Con poco tempo, individua prima le minacce immediate e una risposta praticabile.", actionEn: "With little time, first identify immediate threats and a practical reply." },
  keep_advantage: { title: "Mantenere il vantaggio", titleEn: "Preserve your advantage", action: "Prima di cercare altro, controlla quale controgioco stai concedendo.", actionEn: "Before seeking more, check what counterplay you allow." },
};

export interface PatternSourceGame {
  analysis: GameAnalysis;
  baseSeconds: number | null;
  incrementSeconds: number | null;
  opponentRating: number | null;
}

export interface PatternOpportunity {
  startedAt?: string | null;
  id: string;
  gameId: string;
  playedAt: string;
  kinds: PatternKind[];
  scope: string;
  timeClass: string;
  baseSeconds: number | null;
  incrementSeconds: number | null;
  opponentRating: number | null;
  phase: string;
  ply: number;
  fen: string;
  color: "white" | "black";
  playedUci: string;
  playedSan: string;
  lastOpponentSan?: string | null;
  previousMoves?: string[];
  bestUci: string | null;
  acceptableUcis: string[];
  cpLoss: number;
  scoreBeforeCp: number;
  clockRemaining: number | null;
  timing: DecisionTiming;
}

export function maiaEligible(opportunity: PatternOpportunity): boolean {
  return opportunity.acceptableUcis.length > 0
    && (opportunity.clockRemaining === null || opportunity.clockRemaining >= 30);
}

/** Each eligible position enters once; it may supply evidence for several patterns. */
export function collectPatternOpportunities(sources: PatternSourceGame[]): PatternOpportunity[] {
  const seen = new Set<string>();
  const opportunities: PatternOpportunity[] = [];
  for (const { analysis: game, baseSeconds, incrementSeconds, opponentRating } of sources) {
    for (const [index, move] of game.moves.entries()) {
      const id = `${game.chess_com_uuid}:${move.ply}`;
      if (seen.has(id)) continue;
      seen.add(id);
      if (move.ply <= 16 || !Number.isFinite(move.scoreBeforeCp) || !Number.isFinite(move.cpLoss)
        || Math.abs(move.scoreBeforeCp) > 600 || move.legalMoveCount === 1) continue;
      const timing = assessDecisionTiming({ ...move, baseSeconds, incrementSeconds });
      const kinds: PatternKind[] = [];
      // Older analyses store occurrences in exactly the same order as analyzed moves.
      const motif = move.opportunityMotif ?? game.motif_occurrences?.[index]?.motif;
      if (motif === "fork" || motif === "back_rank" || motif === "hanging_piece") kinds.push(motif);
      if ((move.stockfishChoiceGap ?? move.moveDifficulty ?? 0) >= 0.5) kinds.push("narrow_choice");
      if (move.scoreBeforeCp >= 150) kinds.push("keep_advantage");
      if (timing.eligible && timing.reserve === "ample") kinds.push("time_reserve");
      if (timing.eligible && timing.reserve === "pressure") kinds.push("time_pressure");
      if (!kinds.length) continue;
      opportunities.push({
        id, gameId: game.chess_com_uuid, playedAt: game.played_at, startedAt: game.started_at ?? null, kinds,
        scope: `${game.time_class}:${baseSeconds ?? "unknown"}:${incrementSeconds ?? "unknown"}:${move.phase}`,
        timeClass: game.time_class, baseSeconds, incrementSeconds, opponentRating,
        phase: move.phase, ply: move.ply, fen: move.fenBefore, color: game.color,
        playedUci: move.uci, playedSan: move.san, bestUci: move.bestMoveUci,
        lastOpponentSan: move.last_opp_san ?? null, previousMoves: move.prevMoves ?? [],
        acceptableUcis: move.acceptableObservedMoveUcis ?? (move.bestMoveUci ? [move.bestMoveUci] : []),
        cpLoss: move.cpLoss, scoreBeforeCp: move.scoreBeforeCp,
        clockRemaining: move.clockRemaining, timing,
      });
    }
  }
  return opportunities;
}

function hash(value: string): number {
  let result = 2166136261;
  for (let i = 0; i < value.length; i++) result = Math.imul(result ^ value.charCodeAt(i), 16777619);
  return result >>> 0;
}

/**
 * A reproducible, outcome-independent sample, balanced across patterns and games.
 * No loss/played-move filter: good decisions and errors have the same eligibility.
 * Not a random-population estimate: publish scored/eligible counts per pattern.
 */
export function selectPatternSample(opportunities: PatternOpportunity[], cap: number): PatternOpportunity[] {
  const buckets = new Map<string, Map<string, PatternOpportunity[]>>();
  for (const opportunity of opportunities) {
    if (!maiaEligible(opportunity)) continue;
    for (const kind of opportunity.kinds) {
      const key = `${kind}:${opportunity.scope}`;
      const byGame = buckets.get(key) ?? new Map<string, PatternOpportunity[]>();
      const positions = byGame.get(opportunity.gameId) ?? [];
      positions.push(opportunity);
      byGame.set(opportunity.gameId, positions);
      buckets.set(key, byGame);
    }
  }
  const queues = [...buckets.entries()].sort(([a], [b]) => hash(a) - hash(b)).map(([, byGame]) => {
    const games = [...byGame.entries()].sort(([a], [b]) => hash(a) - hash(b))
      .map(([, rows]) => rows.sort((a, b) => hash(a.id) - hash(b.id)));
    const queue: PatternOpportunity[] = [];
    for (let round = 0; games.some((g) => g.length > round); round++) {
      games.forEach((g) => { if (g[round]) queue.push(g[round]); });
    }
    return queue;
  });
  const chosen = new Map<string, PatternOpportunity>();
  const limit = Number.isFinite(cap) ? Math.max(0, Math.floor(cap)) : 0;
  for (let round = 0; chosen.size < limit && queues.some((q) => q.length > round); round++) {
    for (const queue of queues) {
      const item = queue[round];
      if (item) chosen.set(item.id, item);
      if (chosen.size >= limit) break;
    }
  }
  return [...chosen.values()];
}

export interface PatternPolicy {
  status: "scored" | "unavailable" | "skipped";
  metrics?: MaiaPolicyMetrics;
}

export interface PersonalPattern {
  id: string;
  kind: PatternKind;
  scope: string;
  opportunities: number;
  games: number;
  errors: number;
  errorGames: number;
  handled: number;
  fastDecisions: number;
  evidence: "insufficient" | "observed" | "recurring";
  priority: number;
  examples: PatternOpportunity[];
  successfulExamples: PatternOpportunity[];
  maia: {
    eligible: number;
    selected: number;
    scored: number;
    currentSupport: number | null;
    targetSupport: number | null;
  };
}

export interface PersonalPatternReport {
  /** Compact complete opportunity ledger, used to compare later games with training. */
  observations?: PatternObservation[];
  version: typeof PATTERN_VERSION;
  currentRating: number | null;
  targetRating: number;
  opportunities: number;
  sampled: number;
  sampling: "pattern_game_balanced_outcome_independent";
  patterns: PersonalPattern[];
}

function distinctGameExamples(rows: PatternOpportunity[]): PatternOpportunity[] {
  const seen = new Set<string>();
  return rows.filter((r) => {
    if (seen.has(r.gameId)) return false;
    seen.add(r.gameId);
    return true;
  }).slice(0, 6);
}

export function buildPersonalPatternReport(
  opportunities: PatternOpportunity[], policies: Map<string, PatternPolicy>,
  currentRating: number | null, targetRating: number,
): PersonalPatternReport {
  const groups = new Map<string, PatternOpportunity[]>();
  for (const item of opportunities) for (const kind of item.kinds) {
    const key = `${kind}:${item.scope}`;
    const rows = groups.get(key) ?? [];
    rows.push(item);
    groups.set(key, rows);
  }
  const patterns: PersonalPattern[] = [];
  for (const [id, rows] of groups) {
    const kind = id.split(":")[0] as PatternKind;
    const errors = rows.filter((r) => r.cpLoss >= 100 && (kind !== "time_reserve" || r.timing.pace === "fast"));
    const errorGames = new Set(errors.map((r) => r.gameId)).size;
    const games = new Set(rows.map((r) => r.gameId)).size;
    const scored = rows.filter((r) => policies.get(r.id)?.status === "scored" && policies.get(r.id)?.metrics);
    const enoughComparison = scored.length >= 8 && new Set(scored.map((r) => r.gameId)).size >= 3;
    const currentSupport = enoughComparison ? scored.reduce((sum, r) => sum + policies.get(r.id)!.metrics!.maia_mine_acceptable_observed_policy, 0) / scored.length : null;
    const targetSupport = enoughComparison ? scored.reduce((sum, r) => sum + policies.get(r.id)!.metrics!.maia_target_acceptable_observed_policy, 0) / scored.length : null;
    // Game recurrence limits dominance by a single long game; engine losses are capped.
    const impact = errors.length ? errors.reduce((sum, r) => sum + Math.min(300, r.cpLoss), 0) / errors.length : 0;
    const evidence = games >= 3 && rows.length >= 8 ? (errorGames >= 3 ? "recurring" : "observed") : "insufficient";
    patterns.push({
      id, kind, scope: rows[0].scope, opportunities: rows.length, games,
      errors: errors.length, errorGames,
      handled: rows.filter((r) => r.cpLoss < 50).length,
      fastDecisions: rows.filter((r) => r.timing.pace === "fast").length,
      evidence,
      priority: evidence === "recurring" ? errorGames * impact * (1 + Math.max(0, (targetSupport ?? 0) - (currentSupport ?? 0))) : 0,
      examples: distinctGameExamples([...errors].sort((a, b) => b.cpLoss - a.cpLoss)),
      successfulExamples: distinctGameExamples(rows.filter((r) => r.cpLoss < 50)),
      maia: {
        eligible: rows.filter(maiaEligible).length,
        selected: rows.filter((r) => policies.has(r.id)).length,
        scored: scored.length, currentSupport, targetSupport,
      },
    });
  }
  patterns.sort((a, b) => b.priority - a.priority || b.games - a.games || a.id.localeCompare(b.id));
  return {
    version: PATTERN_VERSION, currentRating, targetRating,
    observations: opportunities.map((o) => ({
      id: o.id, gameId: o.gameId, playedAt: o.playedAt, startedAt: o.startedAt ?? null,
      patternIds: o.kinds.map((kind) => `${kind}:${o.scope}`), cpLoss: o.cpLoss,
      fast: o.timing.status === "available" ? o.timing.pace === "fast" : null,
    })),
    opportunities: opportunities.length, sampled: policies.size,
    sampling: "pattern_game_balanced_outcome_independent", patterns,
  };
}
