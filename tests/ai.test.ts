import { Chess } from 'chess.js'
import { describe, expect, it } from 'vitest'
import { DIFFICULTY_DEPTH, type DifficultyLevel } from '../shared/protocol.js'
import { evaluatePosition, findBestMove } from '../src/engine/ai.js'

describe('Minimax + Alpha-Beta AI Chess Engine', () => {
  it('evaluates symmetric starting position at 0 and detects clear material imbalance', () => {
    const start = new Chess()
    expect(evaluatePosition(start)).toBe(0)

    const whiteUpQueen = new Chess('4k3/8/8/8/3Q4/8/8/4K3 w - - 0 1')
    expect(evaluatePosition(whiteUpQueen)).toBeGreaterThan(800)

    const blackUpRook = new Chess('4k3/8/8/3r4/8/8/8/4K3 w - - 0 1')
    expect(evaluatePosition(blackUpRook)).toBeLessThan(-450)
  })

  it.each<DifficultyLevel>(['casual', 'club', 'tactical'])(
    'finds forced mate-in-1 for White on %s difficulty',
    (level) => {
      // Back-rank mate: Rd8#
      const backRankFen = '6k1/5ppp/8/8/8/8/5PPP/3R2K1 w - - 0 1'
      const result = findBestMove(backRankFen, level, { deterministic: true })

      expect(result).not.toBeNull()
      expect(result!.san).toBe('Rd8#')
      expect(result!.uci).toBe('d1d8')
      expect(result!.depth).toBe(DIFFICULTY_DEPTH[level])

      const verify = new Chess(backRankFen)
      verify.move({ from: result!.from, to: result!.to, promotion: result!.promotion })
      expect(verify.isCheckmate()).toBe(true)
    },
  )

  it('finds forced mate-in-1 for Black (Fool’s Mate pattern)', () => {
    const foolsMateFen = 'rnbqkbnr/pppp1ppp/8/4p3/6P1/5P2/PPPPP2P/RNBQKBNR b KQkq - 0 2'
    const result = findBestMove(foolsMateFen, 'club')

    expect(result).not.toBeNull()
    expect(result!.san).toBe('Qh4#')
    expect(result!.uci).toBe('d8h4')
  })

  it('avoids hanging its Queen when attacked by a defended pawn (Club & Tactical)', () => {
    // White Queen on d4 is attacked by Black pawn on e5 (defended by d6, which is defended by c7).
    // Staying on d4 or capturing on e5/d6 loses the Queen.
    const trappedQueenFen = '4k3/2p5/3p4/4p3/3Q4/8/8/4K3 w - - 0 1'

    for (const level of ['club', 'tactical'] as const) {
      const result = findBestMove(trappedQueenFen, level)
      expect(result).not.toBeNull()

      const afterMove = new Chess(trappedQueenFen)
      afterMove.move({ from: result!.from, to: result!.to, promotion: result!.promotion })

      // Verify Black has no legal capture of White's Queen on the very next ply
      const blackCapturesQueen = afterMove
        .moves({ verbose: true })
        .some((m) => m.captured === 'q')
      expect(blackCapturesQueen).toBe(false)
    }
  })

  it('captures a free undefended Queen rather than ignoring material', () => {
    const freeQueenFen = '4k3/8/8/4q3/8/8/4R3/4K3 w - - 0 1'
    const result = findBestMove(freeQueenFen, 'club')

    expect(result).not.toBeNull()
    expect(result!.uci).toBe('e2e5')
    expect(result!.san).toBe('Rxe5+')
  })

  it('respects all 3 difficulty depths, always returns valid UCI/SAN moves, and stays fast', () => {
    const positions = [
      'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
      'r1bqk2r/pp1pppbp/2n2np1/2p5/4P3/2NP1N2/PPP2PPP/R1BQKB1R w KQkq - 2 5',
      '4k3/P7/8/8/8/8/8/4K3 w - - 0 1', // Pawn promotion position
    ]

    const levels: DifficultyLevel[] = ['casual', 'club', 'tactical']

    for (const fen of positions) {
      for (const level of levels) {
        const result = findBestMove(fen, level)
        expect(result).not.toBeNull()
        expect(result!.depth).toBe(DIFFICULTY_DEPTH[level])
        expect(result!.uci).toMatch(/^[a-h][1-8][a-h][1-8][qrbn]?$/)
        expect(result!.durationMs).toBeLessThan(150)

        const validator = new Chess(fen)
        const applied = validator.move({
          from: result!.from,
          to: result!.to,
          promotion: result!.promotion,
        })
        expect(applied).not.toBeNull()
        expect(applied.san).toBe(result!.san)
      }
    }
  })

  it('returns null cleanly on terminal checkmate and stalemate positions', () => {
    const checkmateFen = 'rnb1kbnr/pppp1ppp/8/4p3/6Pq/5P2/PPPPP2P/RNBQKBNR w KQkq - 1 3'
    const stalemateFen = '7k/5Q2/6K1/8/8/8/8/8 b - - 0 1'

    expect(findBestMove(checkmateFen, 'tactical')).toBeNull()
    expect(findBestMove(stalemateFen, 'tactical')).toBeNull()
  })
})
