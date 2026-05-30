/**
 * Config della pipeline browser-side.
 *
 * FREE_GAME_CAP — quante partite (le più recenti) ingeriamo + analizziamo nel
 * tier free. Alzato a 100 (2026-05-29) ora che l'analisi è parallela (pool di
 * worker Stockfish + MultiPV 2): dataset più ricco, statistiche più solide,
 * e la curva-rating combacia quasi con le partite analizzate. Resta sotto il
 * "scarica tutto" (un utente attivo ha ~1500 partite in 6 mesi). Il tier paid
 * (storico completo / refresh ricorrente) alzerà ancora questo cap.
 */
export const FREE_GAME_CAP = 100;

/** Prima fetta di analisi: le N partite più recenti → aggregate+coach parziale rapido. */
export const FIRST_BATCH_SIZE = 20;

/** Quante posizioni-esempio (mosse peggiori) passiamo al coach LLM. */
export const MAX_COACH_EXAMPLES = 8;

/** Dopo quanti giorni la Home propone a Nonno di riguardare le partite nuove. */
export const REFRESH_AFTER_DAYS = 7;

/** Quante posizioni mostrare nella galleria Cadute. */
export const CADUTE_LIMIT = 40;

/**
 * Cap di posizioni-errore da passare a Maia (le peggiori per cp_loss).
 * Alzato a 400 (2026-05-29) per un campione piu' rappresentativo degli errori
 * nelle metriche pesate per difficolta'. Il motore ONNX single-thread regge
 * grazie ai chunk da 24; la latenza aggiuntiva e' accettabile lato browser.
 */
export const CADUTE_MAIA_CAP = 400;
