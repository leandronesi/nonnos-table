/**
 * maiaEngine.ts — singleton wrapper around the Maia-3 ONNX web worker.
 *
 * Ported faithfully from:
 *   CSSLab/maia-platform-frontend/src/lib/engine/maia.ts (class Maia, branch main)
 *
 * Adaptations vs. CSSLab source:
 *   1. Singleton pattern via getMaiaEngine() — no React context dependency.
 *   2. Worker path uses import.meta.env.BASE_URL (GH Pages subpath-aware) instead
 *      of hardcoded '/maia-worker.js'.
 *   3. Model URL from VITE_MAIA_MODEL_URL env var with fallback to
 *      `${BASE_URL}maia3/maia3_simplified.onnx`.
 *   4. No MaiaStatus/setStatus/setProgress/setError React callbacks — instead
 *      a simple internal 'status' string and promise-based waitReady().
 *   5. evaluateMaia3 / batchEvaluateMaia3 / processOutputsMaia3 are ported verbatim.
 *   6. onnxruntime-web Tensor import kept (used only inside processOutputsMaia3
 *      to wrap raw Float32Arrays for the helper; actual ORT session runs in worker).
 */

import { Tensor } from 'onnxruntime-web'

import {
  mirrorMove,
  preprocessMaia3,
  allPossibleMovesMaia3Reversed,
} from './tensor'

// ── Types ─────────────────────────────────────────────────────────────────────

export type MaiaStatus =
  | 'idle'
  | 'loading'
  | 'no-cache'
  | 'downloading'
  | 'ready'
  | 'error'

export interface MaiaEvalResult {
  /** Move UCI → probability (softmax over legal moves), sorted desc. */
  policy: Record<string, number>
  /** Win probability for the side to move (0–1), from WDL head. */
  value: number
}

// ── Internal worker message types ────────────────────────────────────────────

interface PendingInference {
  resolve: (value: { logitsMove: Float32Array; logitsValue: Float32Array }) => void
  reject: (error: Error) => void
}

interface PendingReady {
  resolve: () => void
  reject: (error: Error) => void
}

// ── processOutputsMaia3 ───────────────────────────────────────────────────────
// Ported verbatim from CSSLab maia.ts (free function, not on the class).

/**
 * Post-processes raw maia3 ONNX outputs into a policy map and win probability.
 *
 * - WDL order: [0]=Loss, [1]=Draw, [2]=Win (side-to-move).
 * - Policy: softmax over legal-move logits only, then mirrorMove back if black.
 * - winProb is flipped for black (model always returns from white perspective
 *   of the mirrored position).
 */
function processOutputsMaia3(
  fen: string,
  logits_move: Tensor,
  logits_value: Tensor,
  legalMoves: Float32Array,
): MaiaEvalResult {
  const logits = logits_move.data as Float32Array
  const wdl = logits_value.data as Float32Array

  // Stable softmax over WDL
  const maxWdl = Math.max(wdl[0], wdl[1], wdl[2])
  const expL = Math.exp(wdl[0] - maxWdl)
  const expD = Math.exp(wdl[1] - maxWdl)
  const expW = Math.exp(wdl[2] - maxWdl)
  const sumExp = expL + expD + expW
  let winProb = (expW + 0.5 * expD) / sumExp

  let black_flag = false
  if (fen.split(' ')[1] === 'b') {
    black_flag = true
    winProb = 1 - winProb
  }

  winProb = Math.round(winProb * 10000) / 10000

  // Collect legal move indices
  const legalMoveIndices = legalMoves
    .map((value, index) => (value > 0 ? index : -1))
    .filter((index) => index !== -1)

  // Mirror moves back to original color if needed
  const legalMovesMirrored: string[] = []
  for (const moveIndex of legalMoveIndices) {
    let move = allPossibleMovesMaia3Reversed[moveIndex]
    if (black_flag) {
      move = mirrorMove(move)
    }
    legalMovesMirrored.push(move)
  }

  // Softmax over legal logits
  const legalLogits = legalMoveIndices.map((idx) => logits[idx])
  const maxLogit = Math.max(...legalLogits)
  const expLogits = legalLogits.map((logit) => Math.exp(logit - maxLogit))
  const sumExpMoves = expLogits.reduce((a, b) => a + b, 0)
  const probs = expLogits.map((expLogit) => expLogit / sumExpMoves)

  const moveProbs: Record<string, number> = {}
  for (let i = 0; i < legalMoveIndices.length; i++) {
    moveProbs[legalMovesMirrored[i]] = probs[i]
  }

  // Sort descending by probability
  const sortedMoveProbs = Object.keys(moveProbs)
    .sort((a, b) => moveProbs[b] - moveProbs[a])
    .reduce(
      (acc, key) => {
        acc[key] = moveProbs[key]
        return acc
      },
      {} as Record<string, number>,
    )

  return { policy: sortedMoveProbs, value: winProb }
}

// ── MaiaEngine class ──────────────────────────────────────────────────────────

class MaiaEngine {
  private worker: Worker | null = null
  private status: MaiaStatus = 'idle'
  private pendingInferences: Map<number, PendingInference> = new Map()
  private pendingReady: PendingReady | null = null
  private readyPromise: Promise<void> | null = null
  private nextRequestId = 0

  constructor() {
    this.init()
  }

  private init() {
    if (typeof window === 'undefined' || typeof Worker === 'undefined') {
      return
    }

    const base = import.meta.env.BASE_URL ?? '/'
    // Encode base as a query param so the plain-JS worker can read it from
    // self.location.href (no import.meta.env in classic workers).
    const workerUrl = `${base}maia-worker.js?base=${encodeURIComponent(base)}`
    // Default: Supabase Storage (bucket pubblico 'models'). Override via env.
    // Cross-origin OK: lo Storage pubblico manda CORS *, e su GH Pages non
    // settiamo COEP quindi nessun vincolo CORP. Cache in IndexedDB nel worker.
    const modelUrl =
      import.meta.env.VITE_MAIA_MODEL_URL ||
      'https://zydvfgxqryzcxzdeztnu.supabase.co/storage/v1/object/public/models/maia3_simplified.onnx'
    const modelVersion = 'maia3-simplified-v1'

    this.worker = new Worker(workerUrl)

    this.worker.onmessage = (e) => {
      const msg = e.data

      switch (msg.type) {
        case 'status':
          this.status = msg.status as MaiaStatus
          if (msg.status === 'ready') {
            this.pendingReady?.resolve()
            this.pendingReady = null
          } else if (msg.status === 'no-cache') {
            // Auto-trigger download after cache miss
            this.worker!.postMessage({ type: 'download' })
          }
          break

        case 'error': {
          if (msg.id !== undefined) {
            const pending = this.pendingInferences.get(msg.id)
            if (pending) {
              pending.reject(new Error(msg.message))
              this.pendingInferences.delete(msg.id)
            }
          } else {
            this.status = 'error'
            this.pendingReady?.reject(new Error(msg.message))
            this.pendingReady = null
          }
          break
        }

        case 'inference-result': {
          const pending = this.pendingInferences.get(msg.id)
          if (pending) {
            pending.resolve({
              logitsMove: new Float32Array(msg.logitsMove),
              logitsValue: new Float32Array(msg.logitsValue),
            })
            this.pendingInferences.delete(msg.id)
          }
          break
        }
      }
    }

    this.worker.onerror = (err) => {
      console.error('[MaiaEngine] Worker error:', err)
      this.status = 'error'
      this.pendingReady?.reject(new Error(err.message || 'Worker crashed'))
      this.pendingReady = null
    }

    this.worker.postMessage({ type: 'init', modelUrl, modelVersion })
  }

  /**
   * Resolves when the model is loaded and the session is ready.
   * Safe to call multiple times — returns the same promise.
   */
  public waitReady(): Promise<void> {
    if (this.status === 'ready') return Promise.resolve()
    if (this.readyPromise) return this.readyPromise

    this.readyPromise = new Promise<void>((resolve, reject) => {
      this.pendingReady = { resolve, reject }
    })
    // Clean up reference once settled
    this.readyPromise.finally(() => {
      this.readyPromise = null
    })
    return this.readyPromise
  }

  public getStatus(): MaiaStatus {
    return this.status
  }

  // ── Raw worker inference ────────────────────────────────────────────────────

  private runInference(
    tokens: Float32Array,
    eloSelfs: Float32Array,
    eloOppos: Float32Array,
    batchSize: number,
  ): Promise<{ logitsMove: Float32Array; logitsValue: Float32Array }> {
    if (!this.worker) {
      return Promise.reject(new Error('Worker not initialized'))
    }

    const id = this.nextRequestId++

    return new Promise((resolve, reject) => {
      this.pendingInferences.set(id, { resolve, reject })

      // Transfer ArrayBuffers for zero-copy send (same as CSSLab)
      this.worker!.postMessage(
        {
          type: 'inference',
          id,
          tokens: tokens.buffer,
          eloSelfs: eloSelfs.buffer,
          eloOppos: eloOppos.buffer,
          batchSize,
        },
        [tokens.buffer, eloSelfs.buffer, eloOppos.buffer],
      )
    })
  }

  // ── Public evaluation API ───────────────────────────────────────────────────

  /**
   * Evaluates a single chess position.
   *
   * @param fen     FEN string of the position.
   * @param eloSelf ELO of the side to move (raw float, not a bucket).
   * @param eloOppo ELO of the opponent (raw float).
   */
  public async evaluate(
    fen: string,
    eloSelf: number,
    eloOppo: number,
  ): Promise<MaiaEvalResult> {
    const { boardTokens, legalMoves } = preprocessMaia3(fen)

    const { logitsMove, logitsValue } = await this.runInference(
      boardTokens,
      Float32Array.from([eloSelf]),
      Float32Array.from([eloOppo]),
      1,
    )

    const policyTensor = new Tensor('float32', logitsMove, [logitsMove.length])
    const valueTensor = new Tensor('float32', logitsValue, [logitsValue.length])

    return processOutputsMaia3(fen, policyTensor, valueTensor, legalMoves)
  }

  /**
   * Evaluates a batch of chess positions in a single ONNX session.run() call.
   * Much more efficient than calling evaluate() N times.
   *
   * @param fens      Array of FEN strings.
   * @param eloSelfs  ELO of the side to move for each position (raw floats).
   * @param eloOppos  ELO of the opponent for each position (raw floats).
   */
  public async batchEvaluate(
    fens: string[],
    eloSelfs: number[],
    eloOppos: number[],
  ): Promise<MaiaEvalResult[]> {
    const batchSize = fens.length
    const boardInputs: Float32Array[] = []
    const legalMovesArr: Float32Array[] = []

    for (let i = 0; i < batchSize; i++) {
      const { boardTokens, legalMoves } = preprocessMaia3(fens[i])
      boardInputs.push(boardTokens)
      legalMovesArr.push(legalMoves)
    }

    const combinedTokens = new Float32Array(batchSize * 64 * 12)
    for (let i = 0; i < batchSize; i++) {
      combinedTokens.set(boardInputs[i], i * 64 * 12)
    }

    const { logitsMove, logitsValue } = await this.runInference(
      combinedTokens,
      Float32Array.from(eloSelfs),
      Float32Array.from(eloOppos),
      batchSize,
    )

    const results: MaiaEvalResult[] = []
    const moveLogitsPerItem = 4352
    const valueLogitsPerItem = 3

    for (let i = 0; i < batchSize; i++) {
      const moveStart = i * moveLogitsPerItem
      const policyLogits = logitsMove.slice(moveStart, moveStart + moveLogitsPerItem)
      const policyTensor = new Tensor('float32', policyLogits, [moveLogitsPerItem])

      const valueStart = i * valueLogitsPerItem
      const valueLogitsSlice = logitsValue.slice(valueStart, valueStart + valueLogitsPerItem)
      const valueTensor = new Tensor('float32', valueLogitsSlice, [valueLogitsPerItem])

      results.push(
        processOutputsMaia3(fens[i], policyTensor, valueTensor, legalMovesArr[i]),
      )
    }

    return results
  }
}

// ── Singleton ─────────────────────────────────────────────────────────────────

let _instance: MaiaEngine | null = null

/**
 * Returns the singleton MaiaEngine instance, creating it on first call.
 * Safe to call from any module — the worker is created once per page load.
 */
export function getMaiaEngine(): MaiaEngine {
  if (!_instance) {
    _instance = new MaiaEngine()
  }
  return _instance
}

export type { MaiaEngine }
