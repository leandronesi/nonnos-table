// Definizioni canoniche dei termini tecnici. Usate da <Help>, dal Glossary footer,
// e ovunque serva spiegare un'acronimo.

export const GLOSS = {
  acpl:
    "ACPL · Average Centipawn Loss. La media di quanto perdi a ogni tua mossa secondo Stockfish, in centesimi di pedone. " +
    "0 = mossa perfetta, ~50 = imprecisione, ~100 = errore (≈ un pedone), ~250+ = blunder (≈ un cavallo).",
  maia_agreement:
    "Maia è un engine che imita il gioco UMANO per fascia rating. 'Agreement Maia 1200' = % di posizioni critiche in cui hai giocato la mossa più probabile per un giocatore della tua forza. " +
    "Confrontandolo con 'agreement Maia target' (es. 1600) capisci se giochi già da quel livello.",
  critical_position:
    "Posizione critica · una posizione dove la valutazione era in equilibrio (entro ±150 cp), non in apertura standard (ply > 16), non già decisa. Sono le posizioni dove le tue decisioni cambiano davvero l'esito. Tutto il coaching v2 si concentra QUI.",
  avoidable_error:
    "Errore evitabile alla tua forza · un errore (cp_loss ≥ 100) in posizione critica dove Maia@tuo_livello trovava la mossa giusta — quindi NON era una mossa da computer, dovevi vederla. Questi sono i drill veri.",
  unavoidable_error:
    "Errore non evitabile · errore dove neanche Maia@target trovava facilmente la mossa giusta. Non te lo blamare: succedono anche ai giocatori del tuo target.",
  conversion_rate:
    "Conversion rate · su quante partite sei arrivato a +2 di vantaggio decisivo, quante hai effettivamente vinto. Misura la 'tecnica' di chiusura.",
  save_rate:
    "Save rate · su quante partite sei finito a -2 di svantaggio, quante hai salvato (vinta o patta). Misura la 'resilienza'.",
  turning_point:
    "Turning point · una delle top-3 posizioni della partita per swing di valutazione. Sono i bivi che hanno deciso davvero il risultato — più importanti delle 40 mosse medie.",
  tilt:
    "Tilt · qualità delle mosse subito dopo aver subito un colpo o aver fatto un blunder. Se ACPL crolla, è tilt: lavora su 'pausa di 10s' e 'non rincorrere'.",
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
