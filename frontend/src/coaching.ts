import type { PlayerModel, PositionRow } from "./types";

export const PRODUCT_NAME = "Nonno's Table";
export const COACH_NAME = "Nonno";

const MAIA_LEVELS = [1100, 1200, 1300, 1400, 1500, 1600, 1700, 1800, 1900];

export function maiaLevelForGoal(pm: PlayerModel): number {
  const target = pm.identity.goal.target || 1600;
  return MAIA_LEVELS.reduce((best, level) => (
    Math.abs(level - target) < Math.abs(best - target) ? level : best
  ), 1600);
}

export function stockfishSkillForMaiaLevel(level: number): number {
  if (level <= 1100) return 3;
  if (level <= 1200) return 4;
  if (level <= 1300) return 5;
  if (level <= 1400) return 6;
  if (level <= 1500) return 7;
  if (level <= 1600) return 8;
  if (level <= 1700) return 10;
  if (level <= 1800) return 12;
  return 14;
}

/**
 * Label semantica dell'avversario calibrato sul target dichiarato dell'utente.
 * Internamente usiamo MAIA (rete neurale addestrata su partite umane per rating)
 * o Stockfish con skill capato, ma all'utente parliamo del SUO target.
 */
export function maiaLabel(level: number): string {
  return `avversario ${level}`;
}

/** Variante lunga per copy di benvenuto / contesto sessione. */
export function targetOpponentLabel(level: number, timeClass: string = "rapid"): string {
  return `avversario calibrato sul tuo obiettivo: ${level} ${timeClass}`;
}

/** Time class label umanizzato (dal goal). */
export function timeClassLabel(tc: string | undefined | null): string {
  if (!tc) return "rapid";
  const k = tc.toLowerCase();
  if (k.includes("rapid")) return "rapid";
  if (k.includes("blitz")) return "blitz";
  if (k.includes("bullet")) return "bullet";
  if (k.includes("classical")) return "classical";
  if (k.includes("daily")) return "daily";
  return tc;
}

export function colorLabel(color?: "white" | "black" | null): string {
  return color === "black" ? "Nero" : "Bianco";
}

export function phaseLabel(phase?: PositionRow["phase"] | null): string {
  if (phase === "opening") return "apertura";
  if (phase === "middlegame") return "mediogioco";
  if (phase === "endgame") return "finale";
  return "posizione";
}

export function positionCoachLine(position: PositionRow, maiaLevel = 1600): string {
  const side = colorLabel(position.my_color);
  const phase = phaseLabel(position.phase);
  const lastMove = position.last_opp_san ? ` dopo ${position.last_opp_san}` : "";

  return `${side} muove${lastMove} contro ${maiaLabel(maiaLevel)}. In ${phase} niente tema regalato: prima minacce avversarie, poi pezzi non difesi, poi candidate forzanti.`;
}

export function sessionFallbackLine(key: string, maiaLevel = 1600): string {
  const lines: Record<string, string> = {
    open_tavolo: "Oooh, eccolo. Oggi rivediamo i tuoi momenti chiave dalle ultime partite. Poi giochiamo contro un giocatore al tuo target. Sediamoci.",
    open_warmup: "Oooh, eccolo. Allora oggi guardiamo il pezzo non difeso. Cinque posizioni, prima conti i difensori.",
    between_warmup_bivio: "Bene. Adesso bivi veri, di tue partite. Pensa alla minaccia avversaria prima di scegliere.",
    open_bivio: "Ecco la posizione. Prima attaccanti, poi difensori. Poi muovi.",
    between_bivio_play: `Adesso la partita, contro ${maiaLabel(maiaLevel)}. Senza muovere di mano.`,
    open_play: `Contro ${maiaLabel(maiaLevel)} non serve fare il fenomeno. Difensori, scambi puliti, semplifica quando sei avanti.`,
    recap_win: "Bravo. Oooh, hai chiuso pulito.",
    recap_draw: "Mh. Hai tenuto il punto. La prossima cerchi lo scambio giusto.",
    recap_loss: "Oh. C'era un pezzo non difeso che è rimasto. Domani lo guardiamo.",
    close: "Riposati. Domani stesso tavolo: difensori, minacce, mossa.",
  };
  return lines[key] || "";
}
