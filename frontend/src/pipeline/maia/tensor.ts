/**
 * tensor.ts — Maia-3 board encoding helpers.
 *
 * Ported faithfully from:
 *   CSSLab/maia-platform-frontend/src/lib/engine/tensor.ts (branch main)
 *
 * Adaptation: chess.ts → chess.js
 *   - `new Chess(fen)` unchanged (chess.js accepts same API)
 *   - `board.moves({ verbose: true })` → returns objects with { from, to, promotion? }
 *   - `board.fen()` unchanged
 *
 * Only the maia3 path is kept:
 *   boardToMaia3Tokens, preprocessMaia3, mirrorFEN, mirrorMove,
 *   mirrorSquare, swapColorsInRank, swapCastlingRights.
 *
 * The legacy 18-plane path (boardToTensor / preprocess / mapToCategory /
 * all_moves 1880-entry / eloDict) is intentionally omitted.
 */

import { Chess } from 'chess.js'

import allPossibleMovesMaia3Dict from './all_moves_maia3.json'
import allPossibleMovesMaia3ReversedDict from './all_moves_maia3_reversed.json'

const allPossibleMovesMaia3 = allPossibleMovesMaia3Dict as Record<string, number>
export const allPossibleMovesMaia3Reversed =
  allPossibleMovesMaia3ReversedDict as Record<number, string>

// ── mirror helpers ────────────────────────────────────────────────────────────

/**
 * Mirrors a chess move in UCI notation (vertical flip, top-to-bottom).
 * Ported verbatim from CSSLab tensor.ts.
 */
export function mirrorMove(moveUci: string): string {
  const isPromotion: boolean = moveUci.length > 4

  const startSquare: string = moveUci.substring(0, 2)
  const endSquare: string = moveUci.substring(2, 4)
  const promotionPiece: string = isPromotion ? moveUci.substring(4) : ''

  const mirroredStart: string = mirrorSquare(startSquare)
  const mirroredEnd: string = mirrorSquare(endSquare)

  return mirroredStart + mirroredEnd + promotionPiece
}

/**
 * Mirrors a square vertically. File stays, rank is flipped (1↔8, 2↔7, …).
 * Ported verbatim from CSSLab tensor.ts.
 */
export function mirrorSquare(square: string): string {
  const file: string = square.charAt(0)
  const rank: string = (9 - parseInt(square.charAt(1))).toString()
  return file + rank
}

/**
 * Swaps uppercase↔lowercase letters in a FEN rank string.
 * Ported verbatim from CSSLab tensor.ts.
 */
export function swapColorsInRank(rank: string): string {
  let swappedRank = ''
  for (const char of rank) {
    if (/[A-Z]/.test(char)) {
      swappedRank += char.toLowerCase()
    } else if (/[a-z]/.test(char)) {
      swappedRank += char.toUpperCase()
    } else {
      swappedRank += char
    }
  }
  return swappedRank
}

/**
 * Swaps white and black castling rights (K↔k, Q↔q).
 * Ported verbatim from CSSLab tensor.ts.
 */
export function swapCastlingRights(castling: string): string {
  if (castling === '-') return '-'

  const rights = new Set(castling.split(''))
  const swapped = new Set<string>()

  if (rights.has('K')) swapped.add('k')
  if (rights.has('Q')) swapped.add('q')
  if (rights.has('k')) swapped.add('K')
  if (rights.has('q')) swapped.add('Q')

  let output = ''
  if (swapped.has('K')) output += 'K'
  if (swapped.has('Q')) output += 'Q'
  if (swapped.has('k')) output += 'k'
  if (swapped.has('q')) output += 'q'

  return output === '' ? '-' : output
}

/**
 * Mirrors a FEN string vertically while swapping piece colors.
 * Used to normalise black-to-move positions to white-perspective.
 * Ported verbatim from CSSLab tensor.ts.
 */
export function mirrorFEN(fen: string): string {
  const [position, activeColor, castling, enPassant, halfmove, fullmove] =
    fen.split(' ')

  const ranks = position.split('/')
  const mirroredRanks = ranks
    .slice()
    .reverse()
    .map((rank) => swapColorsInRank(rank))
  const mirroredPosition = mirroredRanks.join('/')

  const mirroredActiveColor = activeColor === 'w' ? 'b' : 'w'
  const mirroredCastling = swapCastlingRights(castling)
  const mirroredEnPassant = enPassant !== '-' ? mirrorSquare(enPassant) : '-'

  return `${mirroredPosition} ${mirroredActiveColor} ${mirroredCastling} ${mirroredEnPassant} ${halfmove} ${fullmove}`
}

// ── maia3 encoding ────────────────────────────────────────────────────────────

/**
 * Tokenises a board position into maia3 format: Float32Array of shape (64×12).
 * Layout: tensor[square * 12 + pieceIdx] = 1.0
 *   square = (7 - rank) * 8 + file  (a1 = square 0)
 *   pieceIdx: P=0 N=1 B=2 R=3 Q=4 K=5  p=6 n=7 b=8 r=9 q=10 k=11
 *
 * The board MUST already be in white-perspective (mirror before calling if black to move).
 * Ported verbatim from CSSLab tensor.ts (boardToMaia3Tokens).
 */
export function boardToMaia3Tokens(fen: string): Float32Array {
  const tokens = fen.split(' ')
  const piecePlacement = tokens[0]

  const pieceTypes = [
    'P', 'N', 'B', 'R', 'Q', 'K',
    'p', 'n', 'b', 'r', 'q', 'k',
  ]
  const tensor = new Float32Array(64 * 12)

  const rows = piecePlacement.split('/')

  for (let rank = 0; rank < 8; rank++) {
    const row = 7 - rank
    let file = 0
    for (const char of rows[rank]) {
      if (isNaN(parseInt(char))) {
        const pieceIdx = pieceTypes.indexOf(char)
        if (pieceIdx >= 0) {
          const square = row * 8 + file
          tensor[square * 12 + pieceIdx] = 1.0
        }
        file += 1
      } else {
        file += parseInt(char)
      }
    }
  }

  return tensor
}

/**
 * Preprocesses a FEN for maia3 inference.
 * - Mirrors the position if black to move (model always sees white perspective).
 * - Returns (64×12) board tokens and a 4352-length legal moves mask.
 * - ELO is passed as a raw float (maia3 uses continuous interpolation, not categories).
 *
 * Adaptation from CSSLab: chess.ts Move type → chess.js move objects
 * (both expose { from, to, promotion }; the field names are identical).
 * Ported logic verbatim from CSSLab tensor.ts (preprocessMaia3).
 */
export function preprocessMaia3(fen: string): {
  boardTokens: Float32Array
  legalMoves: Float32Array
} {
  let board = new Chess(fen)
  if (fen.split(' ')[1] === 'b') {
    board = new Chess(mirrorFEN(board.fen()))
  } else if (fen.split(' ')[1] !== 'w') {
    throw new Error(`Invalid FEN: ${fen}`)
  }

  const boardTokens = boardToMaia3Tokens(board.fen())

  const legalMoves = new Float32Array(
    Object.keys(allPossibleMovesMaia3).length,
  )

  // chess.js verbose moves return { from, to, promotion? } — same fields as chess.ts
  for (const move of board.moves({ verbose: true })) {
    const promotion = move.promotion ? move.promotion : ''
    const moveIndex =
      allPossibleMovesMaia3[(move.from as string) + (move.to as string) + promotion]
    if (moveIndex !== undefined) {
      legalMoves[moveIndex] = 1.0
    }
  }

  return { boardTokens, legalMoves }
}
