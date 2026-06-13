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

/** Prima fetta di analisi: le N partite più recenti → aggregate+coach parziale rapido.
 * Set to 10 (was 20) so the user enters the Tavolo after fewer games analyzed upfront;
 * the remaining 90 continue in the background while they are already inside. */
export const FIRST_BATCH_SIZE = 10;

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

/**
 * Time classes included in error analysis, anchor computation and drill scoring.
 *
 * Rationale: the product targets rapid/blitz players. Daily games have no
 * usable clock data; bullet games are reflex-driven and produce noisy cp_loss
 * data that pollutes the weakness profile. Both are excluded.
 *
 * If a game's time_class field is missing/undefined it is NOT excluded
 * (conservative: we keep the data rather than silently drop it).
 *
 * Change this array to add/remove time classes from the analysis scope.
 */
export const ANALYZED_TIME_CLASSES: string[] = ["rapid", "blitz"];
