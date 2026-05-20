// Definizioni canoniche dei termini tecnici. Usate da <Help>, dal Glossary footer,
// e ovunque serva spiegare un'acronimo.

export const GLOSS = {
  acpl:
    "ACPL · Average Centipawn Loss. La media di quanto perdi a ogni tua mossa secondo Stockfish, in centesimi di pedone. " +
    "0 = mossa perfetta, ~50 = imprecisione, ~100 = errore (≈ un pedone), ~250+ = blunder (≈ un cavallo).",
  performance_rating:
    "Performance Rating. Quanto avresti dovuto essere valutato date le ultime 20 partite, indipendentemente dal rating ufficiale. " +
    "Calcolato come (rating medio avversari) + 400·log10(p/(1−p)) dove p è la tua percentuale di punti. " +
    "Se è più alto del rating ufficiale stai giocando come uno più forte: il rating ti sta inseguendo.",
  blunder:
    "Blunder. Una mossa con perdita ≥ 250 centesimi di pedone — l'equivalente di regalare un cavallo o peggio. Errore grave.",
  mistake:
    "Errore (mistake). Una mossa con perdita tra 100 e 250 centesimi di pedone — più o meno un pedone perso.",
  inaccuracy:
    "Imprecisione. Una mossa con perdita tra 50 e 100 centesimi di pedone. Non perde materiale ma cede del vantaggio.",
  centipawn:
    "Centesimi di pedone (cp). L'unità con cui Stockfish misura il vantaggio. 100 cp = 1 pedone. 300 cp = ≈ un pezzo minore. 900 cp ≈ una donna.",
  ply:
    "Ply. Una singola mossa di un giocatore. Due ply = una mossa intera (bianco + nero). 'Mossa 12' nel PGN corrisponde a ply 23 o 24.",
  eco:
    "ECO. Encyclopaedia of Chess Openings: un codice di 3 caratteri (es. B07, C00) che identifica un'apertura specifica. Standard internazionale.",
  motif_allowed_mate: "Hai permesso un matto: dopo la tua mossa l'avversario aveva matto forzato in N.",
  motif_material_loss: "Pezzo lasciato: la mossa fa perdere materiale netto (≥ 2-3 punti).",
  motif_winning_to_lost:
    "Da vincente a perso: prima della mossa eri in vantaggio (+2 pedoni o più), dopo sei in netto svantaggio (−1 pedone o peggio).",
  motif_winning_advantage_thrown:
    "Vantaggio buttato: prima eri chiaramente in vantaggio (+2 o più), dopo la posizione è circa pari.",
  motif_positional_blunder:
    "Errore posizionale: blunder che non rientra nelle categorie sopra (es. mossa che dà compenso, posizionale, struttura).",
  phase_opening: "Apertura: prime 12 mosse della partita.",
  phase_middlegame:
    "Mediogioco: dopo le prime 12 mosse, finché restano abbastanza pezzi pesanti. Definito da un punteggio materiale > 24.",
  phase_endgame:
    "Finale: quando il materiale totale (cavalli=3, alfieri=3, torri=5, donne=9, no pedoni) scende sotto 24 punti.",
  goal_target:
    "Target 1600 blitz entro il 31/12/2026. Da qui calcolo: punti mancanti, giorni rimasti, ritmo richiesto vs ritmo attuale, proiezione.",
};

// Helper per convertire centipawn in linguaggio umano: "−2.50 ≈ un cavallo".
export function cpToHuman(cp: number): string {
  const abs = Math.abs(cp);
  if (abs >= 900) return "una donna";
  if (abs >= 500) return "una torre";
  if (abs >= 300) return "un pezzo minore";
  if (abs >= 250) return "≈ un cavallo";
  if (abs >= 100) return "≈ un pedone";
  if (abs >= 50) return "mezzo pedone";
  return "lieve";
}

export function cpToPawns(cp: number): string {
  const v = cp / 100;
  if (v === 0) return "0";
  return (v >= 0 ? "+" : "") + v.toFixed(2);
}
