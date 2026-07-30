/**
 * levelCompare.test.ts — la firma #2 deve essere DICIBILE e VERA.
 *
 * Due famiglie di test:
 *  1. quando tace (il silenzio e' il default: nessun divario netto, niente dato)
 *  2. cosa non puo' mai dire (le forme vietate dal §0.6 e dal referee coach-llm)
 *
 * La seconda famiglia e' la piu' importante: e' la dottrina scritta come
 * assertion invece che come commento. Se qualcuno un giorno riscrive il copy in
 * «questa la trova chi gioca a 1600», il test cade.
 */

import { describe, it, expect } from "vitest";
import { buildLevelCompare } from "../src/session/levelCompare";

// I nove pattern del referee in supabase/functions/coach-llm/index.ts:761-771.
// Duplicati qui di proposito: se il referee cambia, questo test deve essere
// riletto a mano, non seguire in automatico.
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

const SPEAKING = {
  pMineAcceptable: 0.18,
  pTargetAcceptable: 0.52,
  targetRating: 1600,
  maiaStatus: "scored",
};

describe("buildLevelCompare — quando tace", () => {
  it("tace se Maia non ha valutato la posizione", () => {
    expect(buildLevelCompare({ ...SPEAKING, maiaStatus: "unavailable" })).toBeNull();
    expect(buildLevelCompare({ ...SPEAKING, maiaStatus: "skipped" })).toBeNull();
  });

  it("tace se manca uno dei due indici", () => {
    expect(buildLevelCompare({ ...SPEAKING, pMineAcceptable: null })).toBeNull();
    expect(buildLevelCompare({ ...SPEAKING, pTargetAcceptable: undefined })).toBeNull();
  });

  it("tace sui valori non finiti", () => {
    expect(buildLevelCompare({ ...SPEAKING, pTargetAcceptable: NaN })).toBeNull();
    expect(buildLevelCompare({ ...SPEAKING, pMineAcceptable: Infinity })).toBeNull();
  });

  it("tace quando non c'e' divario netto (§0.6: e' una delle forme, qui e' silenzio)", () => {
    expect(buildLevelCompare({ ...SPEAKING, pTargetAcceptable: 0.2 })).toBeNull();
    // Divario esattamente sotto soglia.
    expect(
      buildLevelCompare({ ...SPEAKING, pMineAcceptable: 0.3, pTargetAcceptable: 0.39 }),
    ).toBeNull();
  });

  it("tace se il target e' piu' basso dell'attuale", () => {
    expect(
      buildLevelCompare({ ...SPEAKING, pMineAcceptable: 0.6, pTargetAcceptable: 0.2 }),
    ).toBeNull();
  });
});

describe("buildLevelCompare — quando parla", () => {
  it("nomina il rating obiettivo quando lo conosce", () => {
    const line = buildLevelCompare(SPEAKING);
    expect(line).toBeTruthy();
    expect(line).toContain("1600");
  });

  it("resta generico quando il rating non c'e'", () => {
    const line = buildLevelCompare({ ...SPEAKING, targetRating: null });
    expect(line).toBeTruthy();
    expect(line).not.toMatch(/\d{3,4}/);
  });

  it("parla anche senza maiaStatus (analisi vecchie senza il campo)", () => {
    const { maiaStatus: _omitted, ...noStatus } = SPEAKING;
    expect(buildLevelCompare(noStatus)).toBeTruthy();
  });
});

describe("buildLevelCompare — cosa non puo' mai dire", () => {
  const variants = [
    buildLevelCompare(SPEAKING),
    buildLevelCompare({ ...SPEAKING, targetRating: null }),
    buildLevelCompare({ ...SPEAKING, targetRating: 2000 }),
  ].filter((line): line is string => line != null);

  it("produce almeno una frase da esaminare", () => {
    expect(variants.length).toBeGreaterThan(0);
  });

  it("passa tutti e nove i pattern vietati del referee coach-llm", () => {
    for (const line of variants) {
      for (const pattern of FORBIDDEN_COACH_CLAIMS) {
        expect(line, `"${line}" viola ${pattern}`).not.toMatch(pattern);
      }
    }
  });

  it("non afferma nulla sui GIOCATORI: parla della mossa (§0.6 righe 91-93)", () => {
    // "la trova chi gioca a 1600", "N su M", "il 67%" sono affermazioni sulle
    // persone. La policy Maia non le autorizza, per quanto suonino naturali.
    for (const line of variants) {
      expect(line).not.toMatch(/\b(?:giocator|persone|players|people)/i);
      expect(line).not.toMatch(/\bchi\s+gioca\b/i);
      expect(line).not.toMatch(/\b(?:la|lo|le)\s+trova(?:no)?\b/i);
      expect(line).not.toMatch(/%/);
    }
  });

  it("rispetta la voce: niente em-dash, niente emoji, niente esclamazioni", () => {
    for (const line of variants) {
      expect(line).not.toContain("—");
      expect(line).not.toContain("!");
      // eslint-disable-next-line no-control-regex
      expect(line).not.toMatch(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u);
    }
  });
});
