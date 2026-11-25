import { Chess, type Move, type PieceSymbol } from 'chess.js'
import {
  DIFFICULTY_DEPTH,
  type DifficultyLevel,
  type PromotionPiece,
} from '../../shared/protocol.js'

export interface AIMoveResult {
  from: string
  to: string
  promotion?: PromotionPiece
  san: string
  uci: string
  score: number
  depth: number
  nodesEvaluated: number
  durationMs: number
}

export interface SearchOptions {
  /** Soft search time budget in milliseconds. */
  timeBudgetMs?: number
  /** Disable slight variety jitter on Casual mode (useful for deterministic tests). */
  deterministic?: boolean
}

const MATE_SCORE = 100_000
const INF = 1_000_000

// Piece type encodings (positive = White, negative = Black)
const EMPTY = 0
const PAWN = 1
const KNIGHT = 2
const BISHOP = 3
const ROOK = 4
const QUEEN = 5
const KING = 6

const CASTLE_WK = 1
const CASTLE_WQ = 2
const CASTLE_BK = 4
const CASTLE_BQ = 8

const SYMBOL_TO_CODE: Record<PieceSymbol, number> = {
  p: PAWN,
  n: KNIGHT,
  b: BISHOP,
  r: ROOK,
  q: QUEEN,
  k: KING,
}

export const PIECE_VALUES: Record<PieceSymbol, number> = {
  p: 100,
  n: 320,
  b: 330,
  r: 500,
  q: 900,
  k: 20_000,
}

const CODE_VALUES = [0, 100, 320, 330, 500, 900, 20_000]

// Flat 64-entry Piece-Square Tables (White perspective: index 0 = a8, 63 = h1)
// Based on Tomasz Michniewski's Simplified Evaluation Function.
const PAWN_PST = new Int16Array([
  0, 0, 0, 0, 0, 0, 0, 0,
  50, 50, 50, 50, 50, 50, 50, 50,
  10, 10, 20, 30, 30, 20, 10, 10,
  5, 5, 10, 25, 25, 10, 5, 5,
  0, 0, 0, 22, 22, 0, 0, 0,
  5, -5, -10, 0, 0, -10, -5, 5,
  5, 10, 10, -20, -20, 10, 10, 5,
  0, 0, 0, 0, 0, 0, 0, 0,
])

const KNIGHT_PST = new Int16Array([
  -50, -40, -30, -30, -30, -30, -40, -50,
  -40, -20, 0, 0, 0, 0, -20, -40,
  -30, 0, 10, 15, 15, 10, 0, -30,
  -30, 5, 15, 20, 20, 15, 5, -30,
  -30, 0, 15, 20, 20, 15, 0, -30,
  -30, 5, 10, 15, 15, 10, 5, -30,
  -40, -20, 0, 5, 5, 0, -20, -40,
  -50, -40, -30, -30, -30, -30, -40, -50,
])

const BISHOP_PST = new Int16Array([
  -20, -10, -10, -10, -10, -10, -10, -20,
  -10, 0, 0, 0, 0, 0, 0, -10,
  -10, 0, 5, 10, 10, 5, 0, -10,
  -10, 5, 5, 10, 10, 5, 5, -10,
  -10, 0, 10, 10, 10, 10, 0, -10,
  -10, 10, 10, 10, 10, 10, 10, -10,
  -10, 5, 0, 0, 0, 0, 5, -10,
  -20, -10, -10, -10, -10, -10, -10, -20,
])

const ROOK_PST = new Int16Array([
  0, 0, 0, 0, 0, 0, 0, 0,
  5, 10, 10, 10, 10, 10, 10, 5,
  -5, 0, 0, 0, 0, 0, 0, -5,
  -5, 0, 0, 0, 0, 0, 0, -5,
  -5, 0, 0, 0, 0, 0, 0, -5,
  -5, 0, 0, 0, 0, 0, 0, -5,
  -5, 0, 0, 0, 0, 0, 0, -5,
  0, 0, 0, 5, 5, 0, 0, 0,
])

const QUEEN_PST = new Int16Array([
  -20, -10, -10, -5, -5, -10, -10, -20,
  -10, 0, 0, 0, 0, 0, 0, -10,
  -10, 0, 5, 5, 5, 5, 0, -10,
  -5, 0, 5, 5, 5, 5, 0, -5,
  0, 0, 5, 5, 5, 5, 0, -5,
  -10, 5, 5, 5, 5, 5, 0, -10,
  -10, 0, 5, 0, 0, 0, 0, -10,
  -20, -10, -10, -5, -5, -10, -10, -20,
])

const KING_MID_PST = new Int16Array([
  -30, -40, -40, -50, -50, -40, -40, -30,
  -30, -40, -40, -50, -50, -40, -40, -30,
  -30, -40, -40, -50, -50, -40, -40, -30,
  -30, -40, -40, -50, -50, -40, -40, -30,
  -20, -30, -30, -40, -40, -30, -30, -20,
  -10, -20, -20, -20, -20, -20, -20, -10,
  20, 20, 0, 0, 0, 0, 20, 20,
  20, 30, 10, 0, 0, 10, 30, 20,
])

const KING_END_PST = new Int16Array([
  -50, -40, -30, -20, -20, -30, -40, -50,
  -30, -20, -10, 0, 0, -10, -20, -30,
  -30, -10, 20, 30, 30, 20, -10, -30,
  -30, -10, 30, 40, 40, 30, -10, -30,
  -30, -10, 30, 40, 40, 30, -10, -30,
  -30, -10, 20, 30, 30, 20, -10, -30,
  -30, -30, 0, 0, 0, 0, -30, -30,
  -50, -30, -30, -30, -30, -30, -30, -50,
])

const PST_BY_CODE: readonly (Int16Array | null)[] = [
  null,
  PAWN_PST,
  KNIGHT_PST,
  BISHOP_PST,
  ROOK_PST,
  QUEEN_PST,
  null,
]

const KNIGHT_DELTAS: readonly [number, number][] = [
  [-2, -1], [-2, 1], [-1, -2], [-1, 2],
  [1, -2], [1, 2], [2, -1], [2, 1],
]

const KING_DELTAS: readonly [number, number][] = [
  [-1, -1], [-1, 0], [-1, 1],
  [0, -1],           [0, 1],
  [1, -1],  [1, 0],  [1, 1],
]

const BISHOP_DIRS: readonly [number, number][] = [
  [-1, -1], [-1, 1], [1, -1], [1, 1],
]

const ROOK_DIRS: readonly [number, number][] = [
  [-1, 0], [1, 0], [0, -1], [0, 1],
]

interface FastBoard {
  sq: Int8Array
  turn: 1 | -1
  castling: number
  epSquare: number
  whiteKingSq: number
  blackKingSq: number
}

interface FastMove {
  from: number
  to: number
  promo: number // 0 or QUEEN/ROOK/BISHOP/KNIGHT
  isEp: boolean
  isCastle: boolean
  orderScore: number
}

interface UndoState {
  captured: number
  epCapturedSq: number
  castling: number
  epSquare: number
  whiteKingSq: number
  blackKingSq: number
}

interface SearchContext {
  nodes: number
  deadlineMs: number
  aborted: boolean
  useQuiescence: boolean
  maxQuiescenceDepth: number
}

function algebraicToSq(square: string): number {
  const col = square.charCodeAt(0) - 97
  const row = 8 - (square.charCodeAt(1) - 48)
  return (row << 3) | col
}

function createFastBoardFromChess(chess: Chess): FastBoard {
  const sq = new Int8Array(64)
  const grid = chess.board()
  let whiteKingSq = 60
  let blackKingSq = 4

  for (let row = 0; row < 8; row++) {
    for (let col = 0; col < 8; col++) {
      const piece = grid[row][col]
      if (!piece) continue
      const code = SYMBOL_TO_CODE[piece.type]
      const idx = (row << 3) | col
      if (piece.color === 'w') {
        sq[idx] = code
        if (code === KING) whiteKingSq = idx
      } else {
        sq[idx] = -code
        if (code === KING) blackKingSq = idx
      }
    }
  }

  const fenParts = chess.fen().split(' ')
  const turn: 1 | -1 = fenParts[1] === 'w' ? 1 : -1
  const castleStr = fenParts[2] ?? '-'
  let castling = 0
  if (castleStr.includes('K')) castling |= CASTLE_WK
  if (castleStr.includes('Q')) castling |= CASTLE_WQ
  if (castleStr.includes('k')) castling |= CASTLE_BK
  if (castleStr.includes('q')) castling |= CASTLE_BQ

  const epStr = fenParts[3] ?? '-'
  const epSquare = epStr !== '-' && epStr.length === 2 ? algebraicToSq(epStr) : -1

  return { sq, turn, castling, epSquare, whiteKingSq, blackKingSq }
}

function evaluateFastBoardWhitePerspective(board: FastBoard): number {
  const sq = board.sq
  let whiteNonPawn = 0
  let blackNonPawn = 0
  let score = 0

  for (let idx = 0; idx < 64; idx++) {
    const piece = sq[idx]
    if (piece === EMPTY) continue

    const absType = piece > 0 ? piece : -piece
    if (absType === KING) continue

    const val = CODE_VALUES[absType]
    const pst = PST_BY_CODE[absType]!

    if (piece > 0) {
      if (absType !== PAWN) whiteNonPawn += val
      score += val + pst[idx]
    } else {
      if (absType !== PAWN) blackNonPawn += val
      const mirrorIdx = ((7 - (idx >> 3)) << 3) | (idx & 7)
      score -= val + pst[mirrorIdx]
    }
  }

  const isEndgame = whiteNonPawn <= 1300 && blackNonPawn <= 1300
  const kingPst = isEndgame ? KING_END_PST : KING_MID_PST

  score += kingPst[board.whiteKingSq]
  const bkMirror = ((7 - (board.blackKingSq >> 3)) << 3) | (board.blackKingSq & 7)
  score -= kingPst[bkMirror]

  return score
}

/**
 * Static board evaluation in centipawns from White's perspective
 * (positive favors White, negative favors Black).
 */
export function evaluatePosition(chess: Chess): number {
  return evaluateFastBoardWhitePerspective(createFastBoardFromChess(chess))
}

function isSquareAttacked(sq: Int8Array, targetSq: number, bySide: 1 | -1): boolean {
  const row = targetSq >> 3
  const col = targetSq & 7

  // Pawn attacks: White pawns sit on row + 1; Black pawns sit on row - 1
  const pawnRow = row + bySide
  if (pawnRow >= 0 && pawnRow < 8) {
    const attackerPawn = bySide * PAWN
    if (col > 0 && sq[(pawnRow << 3) | (col - 1)] === attackerPawn) return true
    if (col < 7 && sq[(pawnRow << 3) | (col + 1)] === attackerPawn) return true
  }

  // Knight attacks
  const attackerKnight = bySide * KNIGHT
  for (let i = 0; i < 8; i++) {
    const nr = row + KNIGHT_DELTAS[i][0]
    const nc = col + KNIGHT_DELTAS[i][1]
    if (nr >= 0 && nr < 8 && nc >= 0 && nc < 8 && sq[(nr << 3) | nc] === attackerKnight) {
      return true
    }
  }

  // King attacks
  const attackerKing = bySide * KING
  for (let i = 0; i < 8; i++) {
    const kr = row + KING_DELTAS[i][0]
    const kc = col + KING_DELTAS[i][1]
    if (kr >= 0 && kr < 8 && kc >= 0 && kc < 8 && sq[(kr << 3) | kc] === attackerKing) {
      return true
    }
  }

  // Diagonal rays (Bishop / Queen)
  const attackerBishop = bySide * BISHOP
  const attackerQueen = bySide * QUEEN
  for (let d = 0; d < 4; d++) {
    const dr = BISHOP_DIRS[d][0]
    const dc = BISHOP_DIRS[d][1]
    let r = row + dr
    let c = col + dc
    while (r >= 0 && r < 8 && c >= 0 && c < 8) {
      const p = sq[(r << 3) | c]
      if (p !== EMPTY) {
        if (p === attackerBishop || p === attackerQueen) return true
        break
      }
      r += dr
      c += dc
    }
  }

  // Orthogonal rays (Rook / Queen)
  const attackerRook = bySide * ROOK
  for (let d = 0; d < 4; d++) {
    const dr = ROOK_DIRS[d][0]
    const dc = ROOK_DIRS[d][1]
    let r = row + dr
    let c = col + dc
    while (r >= 0 && r < 8 && c >= 0 && c < 8) {
      const p = sq[(r << 3) | c]
      if (p !== EMPTY) {
        if (p === attackerRook || p === attackerQueen) return true
        break
      }
      r += dr
      c += dc
    }
  }

  return false
}

function makeFastMove(board: FastBoard, move: FastMove): UndoState {
  const sq = board.sq
  const moving = sq[move.from]
  const absMoving = moving > 0 ? moving : -moving
  const undo: UndoState = {
    captured: sq[move.to],
    epCapturedSq: -1,
    castling: board.castling,
    epSquare: board.epSquare,
    whiteKingSq: board.whiteKingSq,
    blackKingSq: board.blackKingSq,
  }

  board.epSquare = -1
  sq[move.from] = EMPTY

  if (move.isEp) {
    const capSq = (move.from & 56) | (move.to & 7)
    undo.epCapturedSq = capSq
    undo.captured = sq[capSq]
    sq[capSq] = EMPTY
  }

  sq[move.to] = move.promo ? board.turn * move.promo : moving

  if (absMoving === PAWN && Math.abs(move.from - move.to) === 16) {
    board.epSquare = (move.from + move.to) >> 1
  }

  if (absMoving === KING) {
    if (board.turn === 1) {
      board.whiteKingSq = move.to
      board.castling &= ~(CASTLE_WK | CASTLE_WQ)
    } else {
      board.blackKingSq = move.to
      board.castling &= ~(CASTLE_BK | CASTLE_BQ)
    }

    if (move.isCastle) {
      if (move.to === 62) { sq[63] = EMPTY; sq[61] = ROOK }
      else if (move.to === 58) { sq[56] = EMPTY; sq[59] = ROOK }
      else if (move.to === 6) { sq[7] = EMPTY; sq[5] = -ROOK }
      else if (move.to === 2) { sq[0] = EMPTY; sq[3] = -ROOK }
    }
  }

  // Revoke castling rights when rooks move from or are captured on home corners
  if (move.from === 63 || move.to === 63) board.castling &= ~CASTLE_WK
  if (move.from === 56 || move.to === 56) board.castling &= ~CASTLE_WQ
  if (move.from === 7 || move.to === 7) board.castling &= ~CASTLE_BK
  if (move.from === 0 || move.to === 0) board.castling &= ~CASTLE_BQ

  board.turn = (board.turn === 1 ? -1 : 1) as 1 | -1
  return undo
}

function unmakeFastMove(board: FastBoard, move: FastMove, undo: UndoState): void {
  board.turn = (board.turn === 1 ? -1 : 1) as 1 | -1
  const sq = board.sq
  const movedPiece = move.promo ? board.turn * PAWN : sq[move.to]

  sq[move.from] = movedPiece
  if (move.isEp && undo.epCapturedSq !== -1) {
    sq[move.to] = EMPTY
    sq[undo.epCapturedSq] = undo.captured
  } else {
    sq[move.to] = undo.captured
  }

  if (move.isCastle) {
    if (move.to === 62) { sq[61] = EMPTY; sq[63] = ROOK }
    else if (move.to === 58) { sq[59] = EMPTY; sq[56] = ROOK }
    else if (move.to === 6) { sq[5] = EMPTY; sq[7] = -ROOK }
    else if (move.to === 2) { sq[3] = EMPTY; sq[0] = -ROOK }
  }

  board.castling = undo.castling
  board.epSquare = undo.epSquare
  board.whiteKingSq = undo.whiteKingSq
  board.blackKingSq = undo.blackKingSq
}

function generatePseudoLegalMoves(board: FastBoard, capturesOnly: boolean): FastMove[] {
  const moves: FastMove[] = []
  const sq = board.sq
  const turn = board.turn
  const enemy = (turn === 1 ? -1 : 1) as 1 | -1

  for (let from = 0; from < 64; from++) {
    const piece = sq[from]
    if (piece === EMPTY || piece * turn <= 0) continue

    const absType = piece > 0 ? piece : -piece
    const row = from >> 3
    const col = from & 7

    if (absType === PAWN) {
      const dir = -turn // White moves up (-1 row), Black moves down (+1 row)
      const startRow = turn === 1 ? 6 : 1
      const promoRow = turn === 1 ? 0 : 7
      const nextRow = row + dir

      // Forward pushes (quiet or promotion)
      if (nextRow >= 0 && nextRow < 8) {
        const oneStep = (nextRow << 3) | col
        if (sq[oneStep] === EMPTY) {
          if (nextRow === promoRow) {
            moves.push({ from, to: oneStep, promo: QUEEN, isEp: false, isCastle: false, orderScore: 1700 })
            moves.push({ from, to: oneStep, promo: KNIGHT, isEp: false, isCastle: false, orderScore: 1120 })
          } else if (!capturesOnly) {
            moves.push({ from, to: oneStep, promo: 0, isEp: false, isCastle: false, orderScore: 5 })
            if (row === startRow) {
              const twoStep = ((row + dir * 2) << 3) | col
              if (sq[twoStep] === EMPTY) {
                moves.push({ from, to: twoStep, promo: 0, isEp: false, isCastle: false, orderScore: 10 })
              }
            }
          }
        }

        // Diagonal captures & en passant
        for (const dc of [-1, 1]) {
          const nc = col + dc
          if (nc < 0 || nc > 7) continue
          const targetSq = (nextRow << 3) | nc
          const target = sq[targetSq]

          if (target !== EMPTY && target * turn < 0) {
            const victimVal = CODE_VALUES[target > 0 ? target : -target]
            const mvvLva = 300 + victimVal * 10 - 100
            if (nextRow === promoRow) {
              moves.push({ from, to: targetSq, promo: QUEEN, isEp: false, isCastle: false, orderScore: mvvLva + 1500 })
            } else {
              moves.push({ from, to: targetSq, promo: 0, isEp: false, isCastle: false, orderScore: mvvLva })
            }
          } else if (targetSq === board.epSquare) {
            moves.push({ from, to: targetSq, promo: 0, isEp: true, isCastle: false, orderScore: 1200 })
          }
        }
      }
      continue
    }

    if (absType === KNIGHT) {
      for (let i = 0; i < 8; i++) {
        const nr = row + KNIGHT_DELTAS[i][0]
        const nc = col + KNIGHT_DELTAS[i][1]
        if (nr < 0 || nr > 7 || nc < 0 || nc > 7) continue
        const to = (nr << 3) | nc
        const target = sq[to]
        if (target !== EMPTY && target * turn > 0) continue
        if (target !== EMPTY) {
          const victimVal = CODE_VALUES[target > 0 ? target : -target]
          moves.push({ from, to, promo: 0, isEp: false, isCastle: false, orderScore: 300 + victimVal * 10 - 320 })
        } else if (!capturesOnly) {
          moves.push({ from, to, promo: 0, isEp: false, isCastle: false, orderScore: 15 })
        }
      }
      continue
    }

    if (absType === KING) {
      for (let i = 0; i < 8; i++) {
        const nr = row + KING_DELTAS[i][0]
        const nc = col + KING_DELTAS[i][1]
        if (nr < 0 || nr > 7 || nc < 0 || nc > 7) continue
        const to = (nr << 3) | nc
        const target = sq[to]
        if (target !== EMPTY && target * turn > 0) continue
        if (target !== EMPTY) {
          const victimVal = CODE_VALUES[target > 0 ? target : -target]
          moves.push({ from, to, promo: 0, isEp: false, isCastle: false, orderScore: 250 + victimVal * 10 - 500 })
        } else if (!capturesOnly) {
          moves.push({ from, to, promo: 0, isEp: false, isCastle: false, orderScore: 0 })
        }
      }

      // Castling
      if (!capturesOnly) {
        if (turn === 1 && from === 60 && !isSquareAttacked(sq, 60, enemy)) {
          if (
            (board.castling & CASTLE_WK) !== 0 &&
            sq[61] === EMPTY &&
            sq[62] === EMPTY &&
            sq[63] === ROOK &&
            !isSquareAttacked(sq, 61, enemy) &&
            !isSquareAttacked(sq, 62, enemy)
          ) {
            moves.push({ from: 60, to: 62, promo: 0, isEp: false, isCastle: true, orderScore: 60 })
          }
          if (
            (board.castling & CASTLE_WQ) !== 0 &&
            sq[59] === EMPTY &&
            sq[58] === EMPTY &&
            sq[57] === EMPTY &&
            sq[56] === ROOK &&
            !isSquareAttacked(sq, 59, enemy) &&
            !isSquareAttacked(sq, 58, enemy)
          ) {
            moves.push({ from: 60, to: 58, promo: 0, isEp: false, isCastle: true, orderScore: 55 })
          }
        } else if (turn === -1 && from === 4 && !isSquareAttacked(sq, 4, enemy)) {
          if (
            (board.castling & CASTLE_BK) !== 0 &&
            sq[5] === EMPTY &&
            sq[6] === EMPTY &&
            sq[7] === -ROOK &&
            !isSquareAttacked(sq, 5, enemy) &&
            !isSquareAttacked(sq, 6, enemy)
          ) {
            moves.push({ from: 4, to: 6, promo: 0, isEp: false, isCastle: true, orderScore: 60 })
          }
          if (
            (board.castling & CASTLE_BQ) !== 0 &&
            sq[3] === EMPTY &&
            sq[2] === EMPTY &&
            sq[1] === EMPTY &&
            sq[0] === -ROOK &&
            !isSquareAttacked(sq, 3, enemy) &&
            !isSquareAttacked(sq, 2, enemy)
          ) {
            moves.push({ from: 4, to: 2, promo: 0, isEp: false, isCastle: true, orderScore: 55 })
          }
        }
      }
      continue
    }

    // Sliding pieces (Bishop, Rook, Queen)
    const dirs =
      absType === BISHOP
        ? BISHOP_DIRS
        : absType === ROOK
          ? ROOK_DIRS
          : [...BISHOP_DIRS, ...ROOK_DIRS]
    const attackerVal = CODE_VALUES[absType]

    for (let d = 0; d < dirs.length; d++) {
      const dr = dirs[d][0]
      const dc = dirs[d][1]
      let r = row + dr
      let c = col + dc
      while (r >= 0 && r < 8 && c >= 0 && c < 8) {
        const to = (r << 3) | c
        const target = sq[to]
        if (target === EMPTY) {
          if (!capturesOnly) {
            moves.push({ from, to, promo: 0, isEp: false, isCastle: false, orderScore: 10 })
          }
        } else {
          if (target * turn < 0) {
            const victimVal = CODE_VALUES[target > 0 ? target : -target]
            moves.push({
              from,
              to,
              promo: 0,
              isEp: false,
              isCastle: false,
              orderScore: 300 + victimVal * 10 - attackerVal,
            })
          }
          break
        }
        r += dr
        c += dc
      }
    }
  }

  return moves
}

function quiescence(
  board: FastBoard,
  alpha: number,
  beta: number,
  qPly: number,
  ctx: SearchContext,
): number {
  ctx.nodes += 1
  if ((ctx.nodes & 2047) === 0 && performance.now() >= ctx.deadlineMs) {
    ctx.aborted = true
    return board.turn * evaluateFastBoardWhitePerspective(board)
  }

  const standPat = board.turn * evaluateFastBoardWhitePerspective(board)
  if (standPat >= beta) return beta
  if (standPat > alpha) alpha = standPat
  if (qPly >= ctx.maxQuiescenceDepth) return alpha

  const captures = generatePseudoLegalMoves(board, true)
  if (captures.length === 0) return alpha

  captures.sort((a, b) => b.orderScore - a.orderScore)

  const movingSide = board.turn
  for (let i = 0; i < captures.length; i++) {
    const move = captures[i]
    const undo = makeFastMove(board, move)
    const ownKingSq = movingSide === 1 ? board.whiteKingSq : board.blackKingSq
    const illegal = isSquareAttacked(board.sq, ownKingSq, board.turn)
    if (illegal) {
      unmakeFastMove(board, move, undo)
      continue
    }

    const score = -quiescence(board, -beta, -alpha, qPly + 1, ctx)
    unmakeFastMove(board, move, undo)

    if (ctx.aborted) return alpha
    if (score >= beta) return beta
    if (score > alpha) alpha = score
  }

  return alpha
}

function negamax(
  board: FastBoard,
  depth: number,
  alpha: number,
  beta: number,
  ply: number,
  ctx: SearchContext,
): number {
  ctx.nodes += 1
  if ((ctx.nodes & 2047) === 0 && performance.now() >= ctx.deadlineMs) {
    ctx.aborted = true
    return board.turn * evaluateFastBoardWhitePerspective(board)
  }

  if (depth <= 0) {
    if (ctx.useQuiescence) {
      return quiescence(board, alpha, beta, 0, ctx)
    }
    return board.turn * evaluateFastBoardWhitePerspective(board)
  }

  const moves = generatePseudoLegalMoves(board, false)
  moves.sort((a, b) => b.orderScore - a.orderScore)

  const movingSide = board.turn
  let legalCount = 0
  let bestScore = -INF

  for (let i = 0; i < moves.length; i++) {
    const move = moves[i]
    const undo = makeFastMove(board, move)
    const ownKingSq = movingSide === 1 ? board.whiteKingSq : board.blackKingSq
    const illegal = isSquareAttacked(board.sq, ownKingSq, board.turn)
    if (illegal) {
      unmakeFastMove(board, move, undo)
      continue
    }

    legalCount += 1
    const score = -negamax(board, depth - 1, -beta, -alpha, ply + 1, ctx)
    unmakeFastMove(board, move, undo)

    if (ctx.aborted) {
      return bestScore === -INF ? board.turn * evaluateFastBoardWhitePerspective(board) : bestScore
    }
    if (score > bestScore) bestScore = score
    if (score > alpha) alpha = score
    if (alpha >= beta) break
  }

  if (legalCount === 0) {
    const kingSq = movingSide === 1 ? board.whiteKingSq : board.blackKingSq
    const enemy = (movingSide === 1 ? -1 : 1) as 1 | -1
    return isSquareAttacked(board.sq, kingSq, enemy) ? -MATE_SCORE + ply : 0
  }

  return bestScore
}

function chessMoveToFastMove(move: Move): FastMove {
  const from = algebraicToSq(move.from)
  const to = algebraicToSq(move.to)
  const promo = move.promotion ? SYMBOL_TO_CODE[move.promotion] : 0
  const isEp = move.flags.includes('e')
  const isCastle = move.flags.includes('k') || move.flags.includes('q')

  let orderScore = 0
  if (move.san.endsWith('#')) orderScore = 100_000
  else {
    if (move.promotion) orderScore += 1500 + CODE_VALUES[promo]
    if (move.captured) {
      orderScore += 300 + PIECE_VALUES[move.captured] * 10 - PIECE_VALUES[move.piece]
    }
    if (move.san.endsWith('+')) orderScore += 70
    if (isCastle) orderScore += 60
  }

  return { from, to, promo, isEp, isCastle, orderScore }
}

/**
 * Computes the best legal move for the side to move using Negamax + Alpha-Beta
 * pruning + MVV-LVA move ordering + Quiescence search + Piece-Square Tables.
 * Root candidates always originate from chess.js for 100% FIDE legality.
 */
export function findBestMove(
  fenOrChess: string | Chess,
  difficulty: DifficultyLevel = 'club',
  options: SearchOptions = {},
): AIMoveResult | null {
  const startMs = performance.now()
  const chess = typeof fenOrChess === 'string' ? new Chess(fenOrChess) : new Chess(fenOrChess.fen())
  const targetDepth = DIFFICULTY_DEPTH[difficulty]

  const rootMoves = chess.moves({ verbose: true })
  if (rootMoves.length === 0) {
    return null
  }

  // Fast-path: deliver an immediate forced mate-in-1 without unnecessary search
  const mateInOne = rootMoves.find((m) => m.san.endsWith('#'))
  if (mateInOne) {
    const durationMs = Math.max(0.1, performance.now() - startMs)
    return {
      from: mateInOne.from,
      to: mateInOne.to,
      promotion: mateInOne.promotion as PromotionPiece | undefined,
      san: mateInOne.san,
      uci: `${mateInOne.from}${mateInOne.to}${mateInOne.promotion ?? ''}`,
      score: MATE_SCORE - 1,
      depth: targetDepth,
      nodesEvaluated: 1,
      durationMs,
    }
  }

  const board = createFastBoardFromChess(chess)
  const rootPairs = rootMoves
    .map((cm) => ({ cm, fm: chessMoveToFastMove(cm) }))
    .sort((a, b) => b.fm.orderScore - a.fm.orderScore)

  const timeBudgetMs = options.timeBudgetMs ?? (targetDepth >= 3 ? 115 : 85)
  const ctx: SearchContext = {
    nodes: 0,
    deadlineMs: startMs + timeBudgetMs,
    aborted: false,
    useQuiescence: targetDepth >= 2,
    maxQuiescenceDepth: targetDepth >= 3 ? 4 : 2,
  }

  let bestMove = rootPairs[0].cm
  let bestScore = -INF
  let scoredMoves: Array<{ move: Move; score: number }> = []

  // Iterative deepening ensures optimal PV move ordering at Depth 3
  for (let currentDepth = 1; currentDepth <= targetDepth; currentDepth++) {
    if (currentDepth > 1) {
      const idx = rootPairs.findIndex((p) => p.cm === bestMove)
      if (idx > 0) {
        const [pv] = rootPairs.splice(idx, 1)
        rootPairs.unshift(pv)
      }
    }

    let iterBestMove = rootPairs[0].cm
    let iterBestScore = -INF
    let alpha = -INF
    const beta = INF
    const iterScored: Array<{ move: Move; score: number }> = []

    for (let i = 0; i < rootPairs.length; i++) {
      const { cm, fm } = rootPairs[i]
      const undo = makeFastMove(board, fm)
      const score = -negamax(board, currentDepth - 1, -beta, -alpha, 1, ctx)
      unmakeFastMove(board, fm, undo)

      if (ctx.aborted) break

      iterScored.push({ move: cm, score })
      if (score > iterBestScore) {
        iterBestScore = score
        iterBestMove = cm
      }
      if (score > alpha) {
        alpha = score
      }
    }

    if (!ctx.aborted) {
      bestMove = iterBestMove
      bestScore = iterBestScore
      scoredMoves = iterScored
    }

    if (ctx.aborted || Math.abs(bestScore) >= MATE_SCORE - 50) {
      break
    }
  }

  // Casual mode mixes among near-equal moves (within 15cp) for natural variety
  // while never missing forced mates or major tactical captures.
  if (
    difficulty === 'casual' &&
    !options.deterministic &&
    Math.abs(bestScore) < MATE_SCORE - 500 &&
    scoredMoves.length > 1
  ) {
    const nearBest = scoredMoves.filter((entry) => bestScore - entry.score <= 15)
    if (nearBest.length > 1) {
      const picked = nearBest[Math.floor(Math.random() * nearBest.length)]
      bestMove = picked.move
      bestScore = picked.score
    }
  }

  const durationMs = Math.max(0.1, performance.now() - startMs)
  return {
    from: bestMove.from,
    to: bestMove.to,
    promotion: bestMove.promotion as PromotionPiece | undefined,
    san: bestMove.san,
    uci: `${bestMove.from}${bestMove.to}${bestMove.promotion ?? ''}`,
    score: bestScore,
    depth: targetDepth,
    nodesEvaluated: Math.max(1, ctx.nodes),
    durationMs,
  }
}
