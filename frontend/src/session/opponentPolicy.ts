import { Chess } from "chess.js";

export type OpponentSource =
  | "maia_target_policy"
  | "stockfish_fallback"
  | "unavailable";

export type OpponentFallbackReason =
  | "maia_domain_unsupported"
  | "maia_model_unavailable"
  | "maia_timeout"
  | "maia_policy_invalid"
  | "maia_zero_legal_mass";

export type OpponentUnavailableReason =
  | "invalid_position"
  | "no_legal_moves"
  | "stockfish_unavailable"
  | "stockfish_invalid_move";

export type OpponentMaiaDomain =
  | "chesscom_rapid_cross_domain"
  | "chesscom_blitz_cross_platform";

export interface NormalizedPolicyMove {
  uci: string;
  mass: number;
}

export type LegalPolicyResult =
  | { moves: NormalizedPolicyMove[]; reason: null }
  | {
      moves: [];
      reason: "maia_policy_invalid" | "maia_zero_legal_mass";
    };

export interface OpponentMoveSelection {
  uci: string | null;
  opponent_source: OpponentSource;
  fallback_reason: OpponentFallbackReason | null;
  unavailable_reason: OpponentUnavailableReason | null;
  maia_domain: OpponentMaiaDomain | null;
  /** Massa rinormalizzata della mossa campionata; non frequenza umana. */
  sampled_policy_mass: number | null;
}

export interface TargetOpponentInput {
  fen: string;
  targetRating: number;
  timeClass: string;
  signal?: AbortSignal;
}

export interface TargetOpponentDependencies {
  maiaPolicy: (
    fen: string,
    targetRating: number,
  ) => Promise<{ policy: Record<string, number> }>;
  stockfishMove: (fen: string) => Promise<string | null>;
  rng?: () => number;
  maiaTimeoutMs?: number;
  stockfishTimeoutMs?: number;
}

export class OpponentSelectionAbortedError extends Error {
  constructor() {
    super("Opponent selection aborted");
    this.name = "OpponentSelectionAbortedError";
  }
}

class MaiaTimeoutError extends Error {
  constructor() {
    super("Maia opponent selection timed out");
    this.name = "MaiaTimeoutError";
  }
}

class StockfishTimeoutError extends Error {
  constructor() {
    super("Stockfish opponent fallback timed out");
    this.name = "StockfishTimeoutError";
  }
}

function normalizeUci(uci: string): string {
  return uci.trim().toLowerCase();
}

function legalUciSet(fen: string): Set<string> | null {
  try {
    const board = new Chess(fen);
    return new Set(
      board.moves({ verbose: true }).map((move) =>
        normalizeUci(`${move.from}${move.to}${move.promotion ?? ""}`),
      ),
    );
  } catch {
    return null;
  }
}

/**
 * Difesa client-side: rifiltra la policy Maia sulle mosse legali chess.js e
 * rinormalizza la massa rimasta. La policy del worker e' gia' masked, ma non
 * affidiamo mai una mossa alla scacchiera senza questa seconda verifica.
 */
export function normalizeLegalPolicy(
  fen: string,
  policy: Record<string, number>,
): LegalPolicyResult {
  const legal = legalUciSet(fen);
  if (!legal) return { moves: [], reason: "maia_policy_invalid" };

  const entries = Object.entries(policy ?? {});
  let sawInvalidMass = false;
  let sawPositiveFiniteMass = false;
  const legalMass = new Map<string, number>();

  for (const [rawUci, rawMass] of entries) {
    if (!Number.isFinite(rawMass) || rawMass < 0) {
      sawInvalidMass = true;
      continue;
    }
    if (rawMass === 0) continue;
    sawPositiveFiniteMass = true;
    const uci = normalizeUci(rawUci);
    if (!legal.has(uci)) continue;
    legalMass.set(uci, (legalMass.get(uci) ?? 0) + rawMass);
  }

  const total = [...legalMass.values()].reduce((sum, mass) => sum + mass, 0);
  if (!Number.isFinite(total) || total <= 0) {
    if (sawInvalidMass && !sawPositiveFiniteMass) {
      return { moves: [], reason: "maia_policy_invalid" };
    }
    return { moves: [], reason: "maia_zero_legal_mass" };
  }

  return {
    moves: [...legalMass.entries()]
      .map(([uci, mass]) => ({ uci, mass: mass / total }))
      .sort((a, b) => a.uci.localeCompare(b.uci)),
    reason: null,
  };
}

/** Campiona dalla massa rinormalizzata. L'RNG e' iniettabile per i test. */
export function sampleNormalizedPolicy(
  moves: NormalizedPolicyMove[],
  rng: () => number = Math.random,
): NormalizedPolicyMove | null {
  if (moves.length === 0) return null;
  const random = rng();
  if (!Number.isFinite(random)) return null;
  const roll = Math.min(1 - Number.EPSILON, Math.max(0, random));
  let cumulative = 0;
  for (const move of moves) {
    cumulative += move.mass;
    if (roll < cumulative) return move;
  }
  // Compensa solo eventuali errori floating point dell'ultima somma.
  return moves[moves.length - 1];
}

/** Mulberry32: piccolo PRNG deterministico, utile per replay e test. */
export function createSeededRng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw new OpponentSelectionAbortedError();
}

function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  signal: AbortSignal | undefined,
  timeoutError: Error,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const finish = (cb: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      cb();
    };
    const onAbort = () => finish(() => reject(new OpponentSelectionAbortedError()));
    const timer = setTimeout(
      () => finish(() => reject(timeoutError)),
      Math.max(1, timeoutMs),
    );
    signal?.addEventListener("abort", onAbort, { once: true });
    promise.then(
      (value) => finish(() => resolve(value)),
      (error) => finish(() => reject(error)),
    );
  });
}

export function opponentMaiaDomain(
  targetRating: number,
  timeClass: string,
): { supported: true; domain: OpponentMaiaDomain } | { supported: false; domain: null } {
  // Maia-3 usa rating continui e non abbiamo una fonte primaria che giustifichi
  // un hard gate 1100-1900. Rifiutiamo solo un conditioning non numerico/non positivo.
  if (!Number.isFinite(targetRating) || targetRating <= 0) {
    return { supported: false, domain: null };
  }
  const normalizedTimeClass = timeClass.trim().toLowerCase();
  if (normalizedTimeClass === "rapid") {
    return { supported: true, domain: "chesscom_rapid_cross_domain" };
  }
  if (normalizedTimeClass === "blitz") {
    return { supported: true, domain: "chesscom_blitz_cross_platform" };
  }
  return { supported: false, domain: null };
}

async function stockfishFallback(
  input: TargetOpponentInput,
  dependencies: TargetOpponentDependencies,
  fallbackReason: OpponentFallbackReason,
  maiaDomain: OpponentMaiaDomain | null,
): Promise<OpponentMoveSelection> {
  throwIfAborted(input.signal);
  let uci: string | null;
  try {
    uci = await withTimeout(
      dependencies.stockfishMove(input.fen),
      dependencies.stockfishTimeoutMs ?? 5000,
      input.signal,
      new StockfishTimeoutError(),
    );
  } catch {
    uci = null;
  }
  throwIfAborted(input.signal);

  if (!uci) {
    return {
      uci: null,
      opponent_source: "unavailable",
      fallback_reason: fallbackReason,
      unavailable_reason: "stockfish_unavailable",
      maia_domain: maiaDomain,
      sampled_policy_mass: null,
    };
  }

  const legal = legalUciSet(input.fen);
  if (!legal?.has(normalizeUci(uci))) {
    return {
      uci: null,
      opponent_source: "unavailable",
      fallback_reason: fallbackReason,
      unavailable_reason: legal ? "stockfish_invalid_move" : "invalid_position",
      maia_domain: maiaDomain,
      sampled_policy_mass: null,
    };
  }

  return {
    uci: normalizeUci(uci),
    opponent_source: "stockfish_fallback",
    fallback_reason: fallbackReason,
    unavailable_reason: null,
    maia_domain: maiaDomain,
    sampled_policy_mass: null,
  };
}

/**
 * Sceglie la mossa dell'avversario: Maia condizionata sul rating obiettivo, con
 * sampling dalla policy raw legale. Il parametro non implica equivalenza di
 * forza. Ogni failure Maia passa a Stockfish con reason code
 * esplicito. Abort interrompe il risultato logico (l'inferenza worker puo'
 * terminare in background, ma non puo' piu' mutare stato/UI).
 */
export async function chooseTargetOpponentMove(
  input: TargetOpponentInput,
  dependencies: TargetOpponentDependencies,
): Promise<OpponentMoveSelection> {
  throwIfAborted(input.signal);
  const legal = legalUciSet(input.fen);
  if (!legal) {
    return {
      uci: null,
      opponent_source: "unavailable",
      fallback_reason: null,
      unavailable_reason: "invalid_position",
      maia_domain: null,
      sampled_policy_mass: null,
    };
  }
  if (legal.size === 0) {
    return {
      uci: null,
      opponent_source: "unavailable",
      fallback_reason: null,
      unavailable_reason: "no_legal_moves",
      maia_domain: null,
      sampled_policy_mass: null,
    };
  }

  const domain = opponentMaiaDomain(input.targetRating, input.timeClass);
  if (!domain.supported) {
    return stockfishFallback(
      input,
      dependencies,
      "maia_domain_unsupported",
      null,
    );
  }

  let policy: Record<string, number>;
  try {
    const result = await withTimeout(
      dependencies.maiaPolicy(input.fen, input.targetRating),
      dependencies.maiaTimeoutMs ?? 4500,
      input.signal,
      new MaiaTimeoutError(),
    );
    policy = result.policy;
  } catch (error) {
    if (error instanceof OpponentSelectionAbortedError) throw error;
    return stockfishFallback(
      input,
      dependencies,
      error instanceof MaiaTimeoutError ? "maia_timeout" : "maia_model_unavailable",
      domain.domain,
    );
  }

  throwIfAborted(input.signal);
  const normalized = normalizeLegalPolicy(input.fen, policy);
  if (normalized.reason) {
    return stockfishFallback(input, dependencies, normalized.reason, domain.domain);
  }
  const sampled = sampleNormalizedPolicy(normalized.moves, dependencies.rng ?? Math.random);
  if (!sampled) {
    return stockfishFallback(
      input,
      dependencies,
      "maia_policy_invalid",
      domain.domain,
    );
  }

  return {
    uci: sampled.uci,
    opponent_source: "maia_target_policy",
    fallback_reason: null,
    unavailable_reason: null,
    maia_domain: domain.domain,
    sampled_policy_mass: sampled.mass,
  };
}

function fallbackReasonText(
  reason: OpponentFallbackReason | null,
  lang: "it" | "en",
): string {
  if (lang === "en") {
    switch (reason) {
      case "maia_domain_unsupported": return "the target or time control is outside the supported Maia practice domain";
      case "maia_timeout": return "Maia took too long to answer";
      case "maia_policy_invalid": return "Maia returned unusable policy mass";
      case "maia_zero_legal_mass": return "Maia assigned no usable mass to legal moves";
      default: return "the Maia model was unavailable";
    }
  }
  switch (reason) {
    case "maia_domain_unsupported": return "target o cadenza sono fuori dal dominio pratica supportato da Maia";
    case "maia_timeout": return "Maia ha impiegato troppo tempo a rispondere";
    case "maia_policy_invalid": return "Maia ha restituito una massa policy non utilizzabile";
    case "maia_zero_legal_mass": return "Maia non ha lasciato massa utilizzabile sulle mosse legali";
    default: return "il modello Maia non era disponibile";
  }
}

export interface OpponentSourceCopy {
  label: string;
  detail: string;
}

function maiaDomainFact(
  domain: OpponentMaiaDomain,
  lang: "it" | "en",
): string {
  if (domain === "chesscom_rapid_cross_domain") {
    return lang === "en"
      ? " Maia was trained on Lichess blitz games; here it is being used for Chess.com rapid."
      : " Maia e' stata addestrata su partite blitz Lichess; qui la stiamo usando sul rapid Chess.com.";
  }
  return lang === "en"
    ? " Maia was trained on Lichess blitz games; here it is being used for Chess.com blitz."
    : " Maia e' stata addestrata su partite blitz Lichess; qui la stiamo usando sul blitz Chess.com.";
}

/** Copy UI derivato esclusivamente dalla fonte realmente usata nell'ultimo turno. */
export function opponentSourceCopy(
  selection: OpponentMoveSelection | null,
  targetRating: number,
  lang: "it" | "en",
  timeClass = "rapid",
): OpponentSourceCopy {
  if (!selection) {
    const domain = opponentMaiaDomain(targetRating, timeClass);
    if (!domain.supported) {
      return lang === "en"
        ? {
            label: "Stockfish practice opponent",
            detail: "Maia is outside the supported practice time-control domain here, so this game uses Stockfish from the start.",
          }
        : {
            label: "Stockfish da allenamento",
            detail: "Qui Maia e' fuori dal dominio di cadenza supportato per la pratica: la partita usa Stockfish fin dall'inizio.",
          };
    }
    const domainFact = maiaDomainFact(domain.domain, lang);
    return lang === "en"
      ? {
          label: `Maia · target conditioning ${targetRating}`,
          detail: `The number conditions Maia's policy; it does not mean Maia has ${targetRating} playing strength or rating. Opponent moves are sampled from raw policy mass, not a calibrated human frequency. Stockfish remains available as fallback.${domainFact}`,
        }
      : {
          label: `Maia · conditioning obiettivo ${targetRating}`,
          detail: `Il numero condiziona la policy di Maia: non significa che Maia abbia forza o rating ${targetRating}. Le mosse avversarie sono campionate dalla massa policy grezza, non da una frequenza umana calibrata. Stockfish resta disponibile come riserva.${domainFact}`,
        };
  }
  if (selection.opponent_source === "maia_target_policy") {
    const domainFact = selection.maia_domain
      ? maiaDomainFact(selection.maia_domain, lang)
      : "";
    return lang === "en"
      ? {
          label: `Maia · target conditioning ${targetRating}`,
          detail: `The number conditions Maia's policy; it does not mean Maia has ${targetRating} playing strength or rating. The last opponent move was sampled from normalized raw policy mass, not a calibrated human frequency.${domainFact}`,
        }
      : {
          label: `Maia · conditioning obiettivo ${targetRating}`,
          detail: `Il numero condiziona la policy di Maia: non significa che Maia abbia forza o rating ${targetRating}. L'ultima mossa avversaria e' stata campionata dalla massa policy grezza rinormalizzata, non da una frequenza umana calibrata.${domainFact}`,
        };
  }
  if (selection.opponent_source === "stockfish_fallback") {
    const reason = fallbackReasonText(selection.fallback_reason, lang);
    return lang === "en"
      ? {
          label: "Stockfish fallback",
          detail: `Stockfish selected the last opponent move because ${reason}.`,
        }
      : {
          label: "Stockfish di riserva",
          detail: `L'ultima mossa avversaria e' stata scelta da Stockfish perche' ${reason}.`,
        };
  }
  return lang === "en"
    ? {
        label: "Opponent unavailable",
        detail: "Neither Maia nor the Stockfish fallback produced a usable legal move.",
      }
    : {
        label: "Avversario non disponibile",
        detail: "Ne' Maia ne' la riserva Stockfish hanno prodotto una mossa legale utilizzabile.",
      };
}
