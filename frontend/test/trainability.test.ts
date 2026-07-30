/**
 * trainability.test.ts — di cosa parla Nonno.
 *
 * La skill `prodotto` dichiara: "ogni metrica si pesa per difficulty; una
 * metrica non pesata e' rumore travestito da segnale". Gli esempi che arrivano
 * alla voce erano ordinati per cp_loss grezzo, cioe' per rumore.
 *
 * Il test che conta e' "preferisce l'allenabile al fragoroso": e' la decisione
 * di prodotto scritta come assertion.
 */

import { describe, it, expect } from "vitest";
import { trainabilityScore } from "../src/pipeline/aggregate";

describe("trainabilityScore", () => {
  it("senza pesi vale il solo cp_loss", () => {
    expect(trainabilityScore({ cp_loss: 300 })).toBe(300);
  });

  it("blame_weight scala l'impatto", () => {
    expect(trainabilityScore({ cp_loss: 300, blame_weight: 0.5 })).toBe(150);
  });

  it("training_priority_weight scala l'impatto gia' pesato", () => {
    expect(
      trainabilityScore({
        cp_loss: 300,
        blame_weight: 0.5,
        training_priority_weight: 2,
      }),
    ).toBe(300);
  });

  it("le posizioni senza dato Maia partecipano comunque, non vanno a zero", () => {
    // training_priority_weight null non deve azzerare: sparirebbero dalla
    // selezione tutte le posizioni non valutate da Maia.
    const noMaia = trainabilityScore({
      cp_loss: 200,
      blame_weight: 1,
      training_priority_weight: null,
    });
    expect(noMaia).toBe(200);
    expect(noMaia).toBeGreaterThan(0);
  });

  it("preferisce l'errore allenabile a quello solo fragoroso", () => {
    // Cannonata in posizione gia' persa: cp_loss enorme, colpa poca,
    // niente da allenare.
    const fragoroso = trainabilityScore({
      cp_loss: 900,
      blame_weight: 0.2,
      training_priority_weight: 0.3,
    });
    // Errore piu' piccolo ma tutto tuo e allenabile verso il target.
    const allenabile = trainabilityScore({
      cp_loss: 250,
      blame_weight: 1.0,
      training_priority_weight: 2.0,
    });
    expect(allenabile).toBeGreaterThan(fragoroso);
  });

  it("ordina una lista mettendo davanti l'allenabile", () => {
    const positions = [
      { name: "cannonata", cp_loss: 900, blame_weight: 0.2, training_priority_weight: 0.3 },
      { name: "allenabile", cp_loss: 250, blame_weight: 1.0, training_priority_weight: 2.0 },
      { name: "medio", cp_loss: 400, blame_weight: 0.8, training_priority_weight: 1.0 },
    ];
    const ordered = [...positions]
      .sort((a, b) => trainabilityScore(b) - trainabilityScore(a))
      .map((p) => p.name);
    expect(ordered[0]).toBe("allenabile");
    // Per cp_loss puro la cannonata sarebbe stata prima; ora e' ultima.
    expect(ordered[ordered.length - 1]).toBe("cannonata");
  });
});
