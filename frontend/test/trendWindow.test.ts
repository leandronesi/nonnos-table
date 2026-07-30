/**
 * trendWindow.test.ts — le finestre del trend si contano a PARTITE, non a giorni.
 *
 * Il test che conta e' "il giocatore irregolare": a calendario, chi gioca 40
 * partite in un mese e 3 nel mese prima si vedeva confrontare 40 contro 3, e
 * chi si fermava un mese non aveva nessun trend. Sono i due casi in cui la
 * memoria di Nonno smetteva di funzionare proprio per le persone che tornano
 * dopo una pausa.
 *
 * Qui si prova la sola logica di finestratura, che e' la parte che sbagliava.
 */

import { describe, it, expect } from "vitest";
import { TREND_WINDOW_GAMES } from "../src/pipeline/config";

/** Stessa finestratura di aggregate.ts: piu' recenti prima, poi due fette. */
function windows(games: { key: string; playedAt: number }[]) {
  const ranked = [...games].sort((a, b) => b.playedAt - a.playedAt);
  return {
    recent: new Set(ranked.slice(0, TREND_WINDOW_GAMES).map((g) => g.key)),
    prior: new Set(
      ranked.slice(TREND_WINDOW_GAMES, TREND_WINDOW_GAMES * 2).map((g) => g.key),
    ),
  };
}

const DAY = 86_400_000;
/** n partite, una al giorno all'indietro a partire da `startDaysAgo`. */
function games(n: number, startDaysAgo = 0, prefix = "g") {
  return Array.from({ length: n }, (_, i) => ({
    key: `${prefix}${i}`,
    playedAt: Date.parse("2026-07-30T12:00:00Z") - (startDaysAgo + i) * DAY,
  }));
}

describe("finestre del trend", () => {
  it("prende le ultime N e le N precedenti", () => {
    const { recent, prior } = windows(games(TREND_WINDOW_GAMES * 2));
    expect(recent.size).toBe(TREND_WINDOW_GAMES);
    expect(prior.size).toBe(TREND_WINDOW_GAMES);
    // g0 e' la piu' recente, quindi sta in recent; la N-esima apre prior.
    expect(recent.has("g0")).toBe(true);
    expect(prior.has(`g${TREND_WINDOW_GAMES}`)).toBe(true);
  });

  it("le due finestre non si sovrappongono mai", () => {
    const { recent, prior } = windows(games(TREND_WINDOW_GAMES * 3));
    for (const k of recent) expect(prior.has(k)).toBe(false);
  });

  it("il giocatore irregolare: 40 partite in un mese, 3 nel mese prima", () => {
    // A calendario: recent = 40 partite, prior = 3. Campioni incomparabili.
    // A partite: N contro N, sempre.
    const burst = games(40, 0, "burst");
    const sparse = games(3, 40, "sparse");
    const { recent, prior } = windows([...burst, ...sparse]);
    expect(recent.size).toBe(TREND_WINDOW_GAMES);
    expect(prior.size).toBe(TREND_WINDOW_GAMES);
    // Entrambe le finestre cadono dentro il periodo intenso: e' corretto,
    // "ultimamente" vuol dire le ultime partite giocate, non l'ultimo mese.
    for (const k of prior) expect(k.startsWith("burst")).toBe(true);
  });

  it("chi si ferma un mese ha comunque il suo trend", () => {
    // Nessuna partita negli ultimi 60 giorni: a calendario il trend spariva.
    const dormant = games(TREND_WINDOW_GAMES * 2, 60, "old");
    const { recent, prior } = windows(dormant);
    expect(recent.size).toBe(TREND_WINDOW_GAMES);
    expect(prior.size).toBe(TREND_WINDOW_GAMES);
  });

  it("all'inizio la finestra precedente e' parziale, e si vede", () => {
    // 12 partite: recent piena, prior con 2. La confidence a valle deve poterlo
    // leggere, quindi prior.size NON va gonfiato.
    const { recent, prior } = windows(games(TREND_WINDOW_GAMES + 2));
    expect(recent.size).toBe(TREND_WINDOW_GAMES);
    expect(prior.size).toBe(2);
  });

  it("sotto una finestra intera, prior e' vuota e non si inventa un confronto", () => {
    const { recent, prior } = windows(games(4));
    expect(recent.size).toBe(4);
    expect(prior.size).toBe(0);
  });

  it("regge l'assenza di partite", () => {
    const { recent, prior } = windows([]);
    expect(recent.size).toBe(0);
    expect(prior.size).toBe(0);
  });
});
