/**
 * Maia-3 in-browser engine — public API.
 *
 * Usage:
 *   import { getMaiaEngine } from 'src/pipeline/maia'
 *
 *   const engine = getMaiaEngine()
 *   await engine.waitReady()
 *   const { policy, value } = await engine.evaluate(fen, eloSelf, eloOppo)
 */
export { getMaiaEngine } from './maiaEngine'
export type { MaiaEngine, MaiaEvalResult, MaiaStatus } from './maiaEngine'
export { mirrorMove, mirrorFEN, preprocessMaia3, boardToMaia3Tokens } from './tensor'
