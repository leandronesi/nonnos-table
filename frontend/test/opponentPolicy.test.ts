import { describe, expect, it, vi } from "vitest";

import {
  chooseTargetOpponentMove,
  createSeededRng,
  normalizeLegalPolicy,
  opponentSourceCopy,
  OpponentSelectionAbortedError,
  sampleNormalizedPolicy,
} from "../src/session/opponentPolicy";

const START_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

describe("target Maia opponent policy", () => {
  it("filters illegal moves and renormalizes the remaining raw policy mass", () => {
    const result = normalizeLegalPolicy(START_FEN, {
      e2e4: 2,
      d2d4: 1,
      a1a8: 100,
    });

    expect(result.reason).toBeNull();
    if (result.reason) throw new Error("expected legal normalized policy");
    const moves = result.moves as Array<{ uci: string; mass: number }>;
    expect(moves.map((move) => move.uci)).toEqual(["d2d4", "e2e4"]);
    expect(moves[0].mass).toBeCloseTo(1 / 3);
    expect(moves[1].mass).toBeCloseTo(2 / 3);
    expect(moves.reduce((sum, move) => sum + move.mass, 0)).toBeCloseTo(1);
  });

  it("samples deterministically with the same injected seed", () => {
    const moves = [
      { uci: "d2d4", mass: 0.25 },
      { uci: "e2e4", mass: 0.75 },
    ];
    const firstRng = createSeededRng(20260711);
    const secondRng = createSeededRng(20260711);
    const first = Array.from({ length: 8 }, () =>
      sampleNormalizedPolicy(moves, firstRng)?.uci,
    );
    const second = Array.from({ length: 8 }, () =>
      sampleNormalizedPolicy(moves, secondRng)?.uci,
    );

    expect(first).toEqual(second);
    expect(sampleNormalizedPolicy(moves, () => 0)?.uci).toBe("d2d4");
    expect(sampleNormalizedPolicy(moves, () => 0.99)?.uci).toBe("e2e4");
  });

  it("falls back to Stockfish for zero or invalid policy mass", async () => {
    const stockfishMove = vi.fn(async () => "e2e4");
    const zero = await chooseTargetOpponentMove(
      { fen: START_FEN, targetRating: 1500, timeClass: "rapid" },
      {
        maiaPolicy: async () => ({ policy: { e2e4: 0, d2d4: 0 } }),
        stockfishMove,
      },
    );
    const invalid = await chooseTargetOpponentMove(
      { fen: START_FEN, targetRating: 1500, timeClass: "rapid" },
      {
        maiaPolicy: async () => ({ policy: { e2e4: Number.NaN, d2d4: -1 } }),
        stockfishMove,
      },
    );

    expect(zero).toMatchObject({
      uci: "e2e4",
      opponent_source: "stockfish_fallback",
      fallback_reason: "maia_zero_legal_mass",
    });
    expect(invalid).toMatchObject({
      uci: "e2e4",
      opponent_source: "stockfish_fallback",
      fallback_reason: "maia_policy_invalid",
    });
  });

  it("uses and reports Stockfish when the Maia model is unavailable", async () => {
    const result = await chooseTargetOpponentMove(
      { fen: START_FEN, targetRating: 1500, timeClass: "rapid" },
      {
        maiaPolicy: async () => {
          throw new Error("model unavailable");
        },
        stockfishMove: async () => "g1f3",
      },
    );

    expect(result).toMatchObject({
      uci: "g1f3",
      opponent_source: "stockfish_fallback",
      fallback_reason: "maia_model_unavailable",
      unavailable_reason: null,
    });
  });

  it("times Maia out without blocking the Stockfish fallback", async () => {
    const result = await chooseTargetOpponentMove(
      { fen: START_FEN, targetRating: 1500, timeClass: "rapid" },
      {
        maiaPolicy: () => new Promise(() => undefined),
        stockfishMove: async () => "c2c4",
        maiaTimeoutMs: 5,
      },
    );

    expect(result).toMatchObject({
      uci: "c2c4",
      opponent_source: "stockfish_fallback",
      fallback_reason: "maia_timeout",
    });
  });

  it("returns an unavailable state instead of hanging when Stockfish fallback times out", async () => {
    const result = await chooseTargetOpponentMove(
      { fen: START_FEN, targetRating: 1500, timeClass: "rapid" },
      {
        maiaPolicy: async () => {
          throw new Error("model unavailable");
        },
        stockfishMove: () => new Promise(() => undefined),
        stockfishTimeoutMs: 5,
      },
    );

    expect(result).toMatchObject({
      uci: null,
      opponent_source: "unavailable",
      fallback_reason: "maia_model_unavailable",
      unavailable_reason: "stockfish_unavailable",
    });
  });

  it("does not start Maia outside the supported target/time-control domain", async () => {
    const maiaPolicy = vi.fn(async () => ({ policy: { e2e4: 1 } }));
    const result = await chooseTargetOpponentMove(
      { fen: START_FEN, targetRating: 1500, timeClass: "classical" },
      { maiaPolicy, stockfishMove: async () => "e2e4" },
    );

    expect(maiaPolicy).not.toHaveBeenCalled();
    expect(result.opponent_source).toBe("stockfish_fallback");
    expect(result.fallback_reason).toBe("maia_domain_unsupported");
  });

  it("does not invent a hard rating gate for continuous Maia conditioning", async () => {
    const result = await chooseTargetOpponentMove(
      { fen: START_FEN, targetRating: 2800, timeClass: "rapid" },
      {
        maiaPolicy: async () => ({ policy: { e2e4: 1 } }),
        stockfishMove: async () => "d2d4",
        rng: () => 0,
      },
    );

    expect(result.opponent_source).toBe("maia_target_policy");
    expect(result.uci).toBe("e2e4");
  });

  it("preserves the selected blitz time class in Maia domain metadata", async () => {
    const result = await chooseTargetOpponentMove(
      { fen: START_FEN, targetRating: 1500, timeClass: "blitz" },
      {
        maiaPolicy: async () => ({ policy: { e2e4: 1 } }),
        stockfishMove: async () => "d2d4",
        rng: () => 0,
      },
    );

    expect(result.opponent_source).toBe("maia_target_policy");
    expect(result.maia_domain).toBe("chesscom_blitz_cross_platform");
  });

  it("aborts stale requests instead of returning a late fallback", async () => {
    const controller = new AbortController();
    controller.abort();

    await expect(
      chooseTargetOpponentMove(
        {
          fen: START_FEN,
          targetRating: 1500,
          timeClass: "rapid",
          signal: controller.signal,
        },
        {
          maiaPolicy: async () => ({ policy: { e2e4: 1 } }),
          stockfishMove: async () => "e2e4",
        },
      ),
    ).rejects.toBeInstanceOf(OpponentSelectionAbortedError);
  });

  it("shows the source actually used and never calls raw policy a human frequency", () => {
    const maiaCopy = opponentSourceCopy(
      {
        uci: "e2e4",
        opponent_source: "maia_target_policy",
        fallback_reason: null,
        unavailable_reason: null,
        maia_domain: "chesscom_rapid_cross_domain",
        sampled_policy_mass: 0.4,
      },
      1500,
      "it",
    );
    const fallbackCopy = opponentSourceCopy(
      {
        uci: "e2e4",
        opponent_source: "stockfish_fallback",
        fallback_reason: "maia_timeout",
        unavailable_reason: null,
        maia_domain: "chesscom_rapid_cross_domain",
        sampled_policy_mass: null,
      },
      1500,
      "it",
    );

    expect(maiaCopy.label).toBe("Maia · conditioning obiettivo 1500");
    expect(maiaCopy.detail).toContain("non significa che Maia abbia forza o rating 1500");
    expect(maiaCopy.detail).toContain("massa policy grezza");
    expect(maiaCopy.detail).toContain("partite blitz Lichess");
    expect(maiaCopy.detail).toContain("rapid Chess.com");
    expect(fallbackCopy.label).toBe("Stockfish di riserva");
    expect(fallbackCopy.detail).toContain("troppo tempo");
  });

  it("explains the concrete Lichess-to-Chess.com domain shift for blitz", () => {
    const copy = opponentSourceCopy(
      {
        uci: "e2e4",
        opponent_source: "maia_target_policy",
        fallback_reason: null,
        unavailable_reason: null,
        maia_domain: "chesscom_blitz_cross_platform",
        sampled_policy_mass: 1,
      },
      1500,
      "it",
      "blitz",
    );

    expect(copy.detail).toContain("partite blitz Lichess");
    expect(copy.detail).toContain("blitz Chess.com");
    expect(copy.detail).not.toContain("cross-domain");
    expect(copy.detail).not.toContain("cross-platform");
  });

  it("shows Stockfish from the start when the selected time class is unsupported", () => {
    const initialCopy = opponentSourceCopy(null, 1500, "it", "classical");

    expect(initialCopy.label).toBe("Stockfish da allenamento");
    expect(initialCopy.detail).toContain("fuori dal dominio");
    expect(initialCopy.detail).not.toContain("campionate dalla massa policy");
  });
});
