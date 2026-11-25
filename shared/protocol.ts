export type PlayerColor = 'w' | 'b'

export type PieceType = 'p' | 'n' | 'b' | 'r' | 'q' | 'k'

export type PromotionPiece = 'q' | 'r' | 'b' | 'n'

export type DifficultyLevel = 'casual' | 'club' | 'tactical'

export const DIFFICULTY_DEPTH: Record<DifficultyLevel, number> = {
  casual: 1,
  club: 2,
  tactical: 3,
}

export type RoomStatus = 'waiting' | 'playing' | 'finished'

export interface MoveInput {
  from: string
  to: string
  promotion?: PromotionPiece
}

export interface SerializedMove {
  from: string
  to: string
  san: string
  color: PlayerColor
  piece: PieceType
  captured?: PieceType
  promotion?: PromotionPiece
  flags: string
}

export type OutcomeReason =
  | 'checkmate'
  | 'stalemate'
  | 'draw'
  | 'threefold'
  | 'insufficient'
  | 'resign'
  | 'disconnect'

export interface GameOutcome {
  reason: OutcomeReason
  winner: PlayerColor | null
  message: string
}

export interface RoomSnapshot {
  code: string
  fen: string
  turn: PlayerColor
  status: RoomStatus
  players: {
    w: boolean
    b: boolean
  }
  history: SerializedMove[]
  pgn: string
  lastMove: { from: string; to: string } | null
  inCheck: boolean
  outcome: GameOutcome | null
  rematchRequestedBy: PlayerColor | null
}

export type ClientMessage =
  | { type: 'create_room' }
  | { type: 'join_room'; code: string }
  | { type: 'make_move'; move: MoveInput }
  | { type: 'resign' }
  | { type: 'request_rematch' }
  | { type: 'leave_room' }
  | { type: 'ping' }

export type ServerMessage =
  | {
      type: 'room_created'
      code: string
      color: PlayerColor
      snapshot: RoomSnapshot
    }
  | {
      type: 'room_joined'
      code: string
      color: PlayerColor
      snapshot: RoomSnapshot
    }
  | {
      type: 'state_update'
      snapshot: RoomSnapshot
    }
  | {
      type: 'rematch_started'
      color: PlayerColor
      snapshot: RoomSnapshot
    }
  | {
      type: 'opponent_disconnected'
      snapshot: RoomSnapshot
      message: string
    }
  | {
      type: 'error'
      code: string
      message: string
    }
  | {
      type: 'pong'
    }

export function normalizeRoomCode(raw: string): string {
  return raw
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, 6)
}

export function oppositeColor(color: PlayerColor): PlayerColor {
  return color === 'w' ? 'b' : 'w'
}
