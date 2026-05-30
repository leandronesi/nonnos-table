/**
 * eco.ts — ECO code to Italian family name.
 *
 * Maps ECO prefix (letter + first digit, e.g. "A0", "B2") to a family name in Italian.
 * Resolution order: exact 3-char code > letter+digit prefix > letter prefix.
 * Fallback: "Apertura ECO {code}".
 *
 * Coverage: A00-E99 (common families at 1000-1800 level).
 * Precision: family level, not per-variation — good enough for display.
 */

// ── 3-char exact overrides (most specific) ────────────────────────────────────

const EXACT: Record<string, string> = {
  B01: "Scandinava",
  B06: "Moderna",
  B07: "Difesa Pirc",
  B08: "Difesa Pirc",
  B09: "Difesa Pirc",
  C21: "Gambetto di Re",
  C22: "Gambetto di Re",
  C23: "Apertura Viennese",
  C24: "Apertura Viennese",
  C25: "Apertura Viennese",
  C26: "Apertura Viennese",
  C27: "Apertura Viennese",
  C28: "Apertura Viennese",
  C29: "Apertura Viennese",
  C30: "Gambetto di Re",
  C31: "Gambetto di Re",
  C32: "Gambetto di Re",
  C33: "Gambetto di Re",
  C34: "Gambetto di Re",
  C35: "Gambetto di Re",
  C36: "Gambetto di Re",
  C37: "Gambetto di Re",
  C38: "Gambetto di Re",
  C39: "Gambetto di Re",
  C40: "Apertura di Re",
  C41: "Difesa Philidor",
  C42: "Difesa Russa (Petrov)",
  C43: "Difesa Russa (Petrov)",
  C44: "Gambetto Scozzese",
  C45: "Partita Scozzese",
  C46: "Tre Cavalli",
  C47: "Quattro Cavalli",
  C48: "Quattro Cavalli",
  C49: "Quattro Cavalli",
  C50: "Partita Italiana",
  C51: "Gambetto Evans",
  C52: "Gambetto Evans",
  C53: "Partita Italiana",
  C54: "Partita Italiana",
  C55: "Due Cavalli",
  C56: "Due Cavalli",
  C57: "Due Cavalli",
  C58: "Due Cavalli",
  C59: "Due Cavalli",
  C60: "Apertura Spagnola (Ruy Lopez)",
  C61: "Apertura Spagnola (Ruy Lopez)",
  C62: "Apertura Spagnola (Ruy Lopez)",
  C63: "Apertura Spagnola (Ruy Lopez)",
  C64: "Apertura Spagnola (Ruy Lopez)",
  C65: "Apertura Spagnola (Ruy Lopez)",
  C66: "Apertura Spagnola (Ruy Lopez)",
  C67: "Apertura Spagnola (Ruy Lopez)",
  C68: "Apertura Spagnola (Ruy Lopez)",
  C69: "Apertura Spagnola (Ruy Lopez)",
  C70: "Apertura Spagnola (Ruy Lopez)",
  C71: "Apertura Spagnola (Ruy Lopez)",
  C72: "Apertura Spagnola (Ruy Lopez)",
  C73: "Apertura Spagnola (Ruy Lopez)",
  C74: "Apertura Spagnola (Ruy Lopez)",
  C75: "Apertura Spagnola (Ruy Lopez)",
  C76: "Apertura Spagnola (Ruy Lopez)",
  C77: "Apertura Spagnola (Ruy Lopez)",
  C78: "Apertura Spagnola (Ruy Lopez)",
  C79: "Apertura Spagnola (Ruy Lopez)",
  C80: "Apertura Spagnola (Ruy Lopez)",
  C81: "Apertura Spagnola (Ruy Lopez)",
  C82: "Apertura Spagnola (Ruy Lopez)",
  C83: "Apertura Spagnola (Ruy Lopez)",
  C84: "Apertura Spagnola (Ruy Lopez)",
  C85: "Apertura Spagnola (Ruy Lopez)",
  C86: "Apertura Spagnola (Ruy Lopez)",
  C87: "Apertura Spagnola (Ruy Lopez)",
  C88: "Apertura Spagnola (Ruy Lopez)",
  C89: "Apertura Spagnola (Ruy Lopez)",
  C90: "Apertura Spagnola (Ruy Lopez)",
  C91: "Apertura Spagnola (Ruy Lopez)",
  C92: "Apertura Spagnola (Ruy Lopez)",
  C93: "Apertura Spagnola (Ruy Lopez)",
  C94: "Apertura Spagnola (Ruy Lopez)",
  C95: "Apertura Spagnola (Ruy Lopez)",
  C96: "Apertura Spagnola (Ruy Lopez)",
  C97: "Apertura Spagnola (Ruy Lopez)",
  C98: "Apertura Spagnola (Ruy Lopez)",
  C99: "Apertura Spagnola (Ruy Lopez)",
  D00: "Apertura di Donna",
  D01: "Attacco Trompowsky / Difesa Richter-Veresov",
  D02: "Apertura di Donna",
  D03: "Torre Attack",
  D04: "Apertura di Donna",
  D05: "Colle System",
  D06: "Gambetto di Donna",
  D07: "Gambetto di Donna Declinato",
  D08: "Gambetto di Donna",
  D09: "Gambetto di Donna",
  D10: "Gambetto di Donna Slavo",
  D11: "Gambetto di Donna Slavo",
  D12: "Gambetto di Donna Slavo",
  D13: "Gambetto di Donna Slavo",
  D14: "Gambetto di Donna Slavo",
  D15: "Gambetto di Donna Slavo",
  D16: "Gambetto di Donna Slavo",
  D17: "Gambetto di Donna Slavo",
  D18: "Gambetto di Donna Slavo",
  D19: "Gambetto di Donna Slavo",
  E60: "Indiana di Re",
  E61: "Indiana di Re",
  E62: "Indiana di Re",
  E63: "Indiana di Re",
  E64: "Indiana di Re",
  E65: "Indiana di Re",
  E66: "Indiana di Re",
  E67: "Indiana di Re",
  E68: "Indiana di Re",
  E69: "Indiana di Re",
  E70: "Indiana del Re (variante)",
  E71: "Indiana del Re",
  E72: "Indiana del Re",
  E73: "Indiana del Re",
  E74: "Indiana del Re",
  E75: "Indiana del Re",
  E76: "Indiana del Re",
  E77: "Indiana del Re",
  E78: "Indiana del Re",
  E79: "Indiana del Re",
  E80: "Indiana del Re (samisch)",
  E81: "Indiana del Re (samisch)",
  E82: "Indiana del Re (samisch)",
  E83: "Indiana del Re (samisch)",
  E84: "Indiana del Re (samisch)",
  E85: "Indiana del Re (samisch)",
  E86: "Indiana del Re (samisch)",
  E87: "Indiana del Re (samisch)",
  E88: "Indiana del Re (samisch)",
  E89: "Indiana del Re (samisch)",
  E90: "Indiana del Re (classica)",
  E91: "Indiana del Re (classica)",
  E92: "Indiana del Re (classica)",
  E93: "Indiana del Re (classica)",
  E94: "Indiana del Re (classica)",
  E95: "Indiana del Re (classica)",
  E96: "Indiana del Re (classica)",
  E97: "Indiana del Re (classica)",
  E98: "Indiana del Re (classica)",
  E99: "Indiana del Re (classica)",
};

// ── Letter+digit prefix map ───────────────────────────────────────────────────

const PREFIX2: Record<string, string> = {
  // A — Flank / Irregular
  A0: "Apertura Irregolare",
  A1: "Apertura Inglese",
  A2: "Apertura Inglese",
  A3: "Apertura Inglese",
  A4: "Apertura di Donna Varia",
  A5: "Apertura di Donna Varia",
  A6: "Difesa Benoni",
  A7: "Difesa Benoni",
  A8: "Difesa Olandese",
  A9: "Difesa Olandese",

  // B — Semi-aperte (1.e4 non 1...e5)
  B0: "Apertura di Re (difesa irregolare)",
  B1: "Caro-Kann",
  B2: "Siciliana",
  B3: "Siciliana",
  B4: "Siciliana",
  B5: "Siciliana",
  B6: "Siciliana",
  B7: "Pirc / Moderna",
  B8: "Siciliana (Scheveningen)",
  B9: "Siciliana (Najdorf)",

  // C — Aperte (1.e4 e5)
  C0: "Difesa Francese",
  C1: "Difesa Francese",
  C2: "Apertura di Re / Viennese",
  C3: "Gambetto di Re",
  C4: "Apertura di Re (varianti pedone)",
  C5: "Partita Italiana",
  C6: "Apertura Spagnola",
  C7: "Apertura Spagnola",
  C8: "Apertura Spagnola",
  C9: "Apertura Spagnola",

  // D — Chiuse / semi-chiuse (1.d4 d5)
  D2: "Gambetto di Donna",
  D3: "Gambetto di Donna",
  D4: "Gambetto di Donna / Semi-slavo",
  D5: "Gambetto di Donna Accettato / Tarrasch",
  D6: "Gambetto di Donna (varianti ortodosse)",

  // E — Indiane (1.d4 Cf6)
  E0: "Indiana della Donna / Catalan",
  E1: "Indiana della Donna",
  E2: "Indiana della Donna / Nimzo",
  E3: "Nimzo-Indiana",
  E4: "Nimzo-Indiana",
  E5: "Indiana della Donna (varianti)",
  E6: "Indiana del Re",
  E7: "Indiana del Re",
  E8: "Indiana del Re",
  E9: "Indiana del Re",
};

// ── Letter-only fallback ──────────────────────────────────────────────────────

const PREFIX1: Record<string, string> = {
  A: "Apertura di Fianco",
  B: "Apertura Semi-Aperta",
  C: "Apertura Aperta",
  D: "Apertura di Donna",
  E: "Indiana",
};

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Returns an Italian family name for the given ECO code.
 *
 * Resolution:
 *   1. Exact 3-char match (e.g. "B01" → "Scandinava")
 *   2. Letter + first digit prefix (e.g. "B0" → "Apertura di Re...")
 *   3. Letter prefix (e.g. "B" → "Apertura Semi-Aperta")
 *   4. Fallback: "Apertura ECO {code}"
 *
 * Returns null if eco is null or empty.
 */
export function ecoName(eco: string | null | undefined): string | null {
  if (!eco) return null;
  const code = eco.trim().toUpperCase();
  if (!code) return null;

  // 1. Exact (3+ chars, take first 3)
  const exact3 = code.slice(0, 3);
  if (EXACT[exact3]) return EXACT[exact3];

  // 2. Letter + digit prefix
  const prefix2 = code.slice(0, 2);
  if (PREFIX2[prefix2]) return PREFIX2[prefix2];

  // 3. Letter prefix
  const prefix1 = code.slice(0, 1);
  if (PREFIX1[prefix1]) return PREFIX1[prefix1];

  // 4. Fallback
  return `Apertura ECO ${code}`;
}
