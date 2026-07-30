/**
 * waitingMove.test.ts — la mossa d'attesa deve scattare quando SAPPIAMO che la
 * mossa giusta era fuori portata, non quando non sappiamo niente.
 *
 * Il caso che conta e' il quarto test: prima il gate era
 * `target_relevant === true && avoidable_at_current !== true`, e `!== true`
 * include null. Bastava che Maia non avesse valutato la posizione perche' Nonno
 * dicesse "questa non la vedevi" a qualcuno che magari la vedeva.
 */

import { describe, it, expect } from "vitest";
import {
  shouldOfferWaitingMove,
  orderWaitingCandidates,
  WAITING_MAX_MINE_TOP,
  type CandidateMove,
} from "../src/session/waitingMove";

describe("shouldOfferWaitingMove", () => {
  it("propone quando la mossa giusta e' sotto soglia al livello attuale", () => {
    expect(
      shouldOfferWaitingMove({ pMaiaMineTop: 0.08, maiaStatus: "scored" }),
    ).toBe(true);
  });

  it("non propone quando la mossa giusta era alla portata", () => {
    expect(
      shouldOfferWaitingMove({ pMaiaMineTop: 0.45, maiaStatus: "scored" }),
    ).toBe(false);
  });

  it("rispetta esattamente la soglia canonica documentata", () => {
    expect(WAITING_MAX_MINE_TOP).toBe(0.2);
    // Sulla soglia esatta non si propone: la condizione e' "< 0.20".
    expect(
      shouldOfferWaitingMove({ pMaiaMineTop: 0.2, maiaStatus: "scored" }),
    ).toBe(false);
    expect(
      shouldOfferWaitingMove({ pMaiaMineTop: 0.199, maiaStatus: "scored" }),
    ).toBe(true);
  });

  it("NON propone quando il dato manca (la regressione che contava)", () => {
    expect(shouldOfferWaitingMove({ pMaiaMineTop: null })).toBe(false);
    expect(shouldOfferWaitingMove({ pMaiaMineTop: undefined })).toBe(false);
    expect(shouldOfferWaitingMove({})).toBe(false);
    expect(shouldOfferWaitingMove({ pMaiaMineTop: NaN, maiaStatus: "scored" })).toBe(
      false,
    );
  });

  it("non propone se Maia non ha valutato la posizione", () => {
    expect(
      shouldOfferWaitingMove({ pMaiaMineTop: 0.05, maiaStatus: "unavailable" }),
    ).toBe(false);
    expect(
      shouldOfferWaitingMove({ pMaiaMineTop: 0.05, maiaStatus: "skipped" }),
    ).toBe(false);
  });
});

describe("orderWaitingCandidates", () => {
  const mv = (san: string, piece: string, flags: string): CandidateMove => ({
    san,
    piece,
    flags,
  });

  it("mette davanti le mosse normalizzanti, non l'ordine di scacchiera", () => {
    const moves = [
      mv("Qxd5", "q", "c"), // cattura
      mv("Nf3", "n", "n"), // pezzo tranquillo
      mv("h3", "p", "n"), // spinta tranquilla
      mv("Kh1", "k", "n"), // mossa di re
      mv("O-O", "k", "k"), // arrocco
    ];
    const ordered = orderWaitingCandidates(moves).map((m) => m.san);
    expect(ordered).toEqual(["O-O", "Kh1", "h3", "Nf3", "Qxd5"]);
  });

  it("manda in fondo catture, en passant e promozioni", () => {
    const moves = [
      mv("e8=Q", "p", "p"),
      mv("exd6", "p", "e"),
      mv("Rxa7", "r", "c"),
      mv("Be2", "b", "n"),
    ];
    const ordered = orderWaitingCandidates(moves).map((m) => m.san);
    expect(ordered[0]).toBe("Be2");
    expect(ordered.slice(1)).toHaveLength(3);
  });

  it("non muta l'array in ingresso", () => {
    const moves = [mv("Nf3", "n", "n"), mv("O-O", "k", "k")];
    const before = moves.map((m) => m.san);
    orderWaitingCandidates(moves);
    expect(moves.map((m) => m.san)).toEqual(before);
  });

  it("regge l'array vuoto", () => {
    expect(orderWaitingCandidates([])).toEqual([]);
  });
});
