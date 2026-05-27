// Definizioni canoniche dei termini tecnici. Usate da <Help>, dal footer
// glossario e ovunque serva tradurre una valutazione in linguaggio da scacchiera.

export const GLOSS = {
  acpl:
    "ACPL - Average Centipawn Loss. La media di quanto vantaggio lasci per strada a ogni tua mossa, misurata in centesimi di pedone. " +
    "0 = mossa pulita, circa 50 = imprecisione, circa 100 = errore, 250+ = pezzo lasciato o posizione compromessa.",
  maia_agreement:
    "MAIA misura quanto la tua scelta somiglia a quella di un giocatore umano di una certa fascia Elo. Se MAIA target vede la mossa e tu no, quella posizione entra nel piano di training.",
  critical_position:
    "Posizione critica - una posizione ancora giocabile in cui una decisione cambia davvero l'esito della partita. Qui vale allenare il calcolo, non le mosse automatiche.",
  avoidable_error:
    "Errore evitabile - una mossa che alla tua forza si poteva vedere: pezzo in presa, difensore sparito, tattica semplice o finale da chiudere.",
  unavoidable_error:
    "Errore non prioritario - posizione difficile anche per il target. Resta tracciata, ma viene dopo i regali che puoi smettere subito.",
  conversion_rate:
    "Conversione - quando arrivi a vantaggio decisivo, quante volte porti a casa il punto. E' tecnica di chiusura: cambi, re attivo, nessun contropiede.",
  save_rate:
    "Tenuta - quando finisci peggio, quante volte salvi mezzo punto o ribalti. E' disciplina difensiva, non fortuna.",
  turning_point:
    "Bivio - una delle posizioni che hanno spostato davvero la partita. La rigiocata serve per cambiare abitudine, non solo per vedere la soluzione.",
  tilt:
    "Tilt - calo di qualita' dopo un colpo subito o un errore. Il rimedio e' sempre scacchistico: pausa, minacce, catture, pezzi indifesi.",
  performance_rating:
    "Performance Rating - stima della forza mostrata nelle ultime partite, pesata sugli avversari affrontati. Serve a capire se il rating ti sta seguendo o inseguendo.",
  blunder:
    "Blunder - errore grave: materiale lasciato, matto permesso o posizione vinta trasformata in persa.",
  mistake:
    "Errore - perdita concreta ma recuperabile: spesso un pedone, una casa forte o un finale reso piu' difficile.",
  inaccuracy:
    "Imprecisione - mossa giocabile ma poco precisa: non perde subito, pero' concede attivita' o semplifica male.",
  centipawn:
    "Centesimi di pedone (cp) - unita' di misura del vantaggio. 100 cp vale circa un pedone, 300 cp circa un pezzo minore, 900 cp circa una donna.",
  ply:
    "Ply - una singola semimossa. Bianco muove e nero risponde: due ply fanno una mossa intera.",
  eco:
    "ECO - codice internazionale dell'apertura, utile per capire da quale famiglia di posizioni nasce il problema.",
  motif_allowed_mate: "Hai permesso un matto: dopo la tua mossa l'avversario aveva un attacco forzato al re.",
  motif_material_loss: "Pezzo lasciato: dopo la mossa perdi materiale netto o lasci un pezzo senza difesa.",
  motif_winning_to_lost:
    "Da vinta a persa: eri in vantaggio chiaro e una decisione ha ribaltato la partita.",
  motif_winning_advantage_thrown:
    "Vantaggio buttato: avevi posizione superiore, ma hai concesso controgioco o semplificato nel modo sbagliato.",
  motif_positional_blunder:
    "Errore posizionale: non e' solo materiale; hai concesso case, attivita', struttura o finale peggiore.",
  phase_opening: "Apertura: sviluppo, centro, re al sicuro e primi piani di pezzi.",
  phase_middlegame:
    "Mediogioco: pezzi attivi, minacce, tattica e decisioni sul piano.",
  phase_endgame:
    "Finale: pochi pezzi, re attivo, pedoni passati e tecnica.",
  goal_target:
    "Target Elo - il livello MAIA da raggiungere con posizioni scelte dai tuoi errori reali.",
};

// Helper per convertire centipawn in linguaggio umano: "-2.50 circa un cavallo".
export function cpToHuman(cp: number): string {
  const abs = Math.abs(cp);
  if (abs >= 900) return "una donna";
  if (abs >= 500) return "una torre";
  if (abs >= 300) return "un pezzo minore";
  if (abs >= 250) return "circa un cavallo";
  if (abs >= 100) return "circa un pedone";
  if (abs >= 50) return "mezzo pedone";
  return "lieve";
}

export function cpToPawns(cp: number): string {
  const v = cp / 100;
  if (v === 0) return "0";
  return (v >= 0 ? "+" : "") + v.toFixed(2);
}
