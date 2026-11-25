import { randomBytes } from 'node:crypto'
import http from 'node:http'
import type { AddressInfo } from 'node:net'
import { Chess } from 'chess.js'
import { WebSocket, WebSocketServer } from 'ws'
import {
  normalizeRoomCode,
  oppositeColor,
  type ClientMessage,
  type GameOutcome,
  type MoveInput,
  type PieceType,
  type PlayerColor,
  type PromotionPiece,
  type RoomSnapshot,
  type RoomStatus,
  type SerializedMove,
  type ServerMessage,
} from '../shared/protocol.js'

const ROOM_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
const ROOM_CODE_LENGTH = 6
const SQUARE_RE = /^[a-h][1-8]$/
const PROMOTION_PIECES = new Set<PromotionPiece>(['q', 'r', 'b', 'n'])

interface ChessRoom {
  code: string
  chess: Chess
  players: Record<PlayerColor, WebSocket | null>
  status: RoomStatus
  lastMove: { from: string; to: string } | null
  outcome: GameOutcome | null
  rematchRequestedBy: PlayerColor | null
  createdAt: number
  updatedAt: number
}

interface SocketSession {
  roomCode: string | null
  color: PlayerColor | null
}

export interface ChessServerOptions {
  port?: number
  host?: string
}

export interface StartedChessServer {
  port: number
  host: string
  httpUrl: string
  wsUrl: string
}

export interface ChessRoomServer {
  start(): Promise<StartedChessServer>
  close(): Promise<void>
  getActiveRoomCount(): number
  getRoomSnapshot(code: string): RoomSnapshot | null
}

function generateRoomCode(existing: Set<string>): string {
  for (let attempt = 0; attempt < 100; attempt++) {
    const bytes = randomBytes(ROOM_CODE_LENGTH)
    let code = ''
    for (let i = 0; i < ROOM_CODE_LENGTH; i++) {
      code += ROOM_ALPHABET[bytes[i] % ROOM_ALPHABET.length]
    }
    if (!existing.has(code)) {
      return code
    }
  }
  throw new Error('Failed to allocate a unique room code')
}

function serializeHistory(chess: Chess): SerializedMove[] {
  return chess.history({ verbose: true }).map((m) => ({
    from: m.from,
    to: m.to,
    san: m.san,
    color: m.color,
    piece: m.piece as PieceType,
    captured: m.captured as PieceType | undefined,
    promotion: m.promotion as PromotionPiece | undefined,
    flags: m.flags,
  }))
}

function detectTerminalOutcome(chess: Chess, lastMover: PlayerColor): GameOutcome | null {
  if (chess.isCheckmate()) {
    const winnerName = lastMover === 'w' ? 'White' : 'Black'
    return {
      reason: 'checkmate',
      winner: lastMover,
      message: `Checkmate — ${winnerName} wins!`,
    }
  }
  if (chess.isStalemate()) {
    return {
      reason: 'stalemate',
      winner: null,
      message: 'Draw by stalemate.',
    }
  }
  if (chess.isThreefoldRepetition()) {
    return {
      reason: 'threefold',
      winner: null,
      message: 'Draw by threefold repetition.',
    }
  }
  if (chess.isInsufficientMaterial()) {
    return {
      reason: 'insufficient',
      winner: null,
      message: 'Draw by insufficient material.',
    }
  }
  if (chess.isDraw()) {
    return {
      reason: 'draw',
      winner: null,
      message: 'Game drawn by 50-move rule.',
    }
  }
  return null
}

function buildSnapshot(room: ChessRoom): RoomSnapshot {
  return {
    code: room.code,
    fen: room.chess.fen(),
    turn: room.chess.turn(),
    status: room.status,
    players: {
      w: room.players.w !== null && room.players.w.readyState === WebSocket.OPEN,
      b: room.players.b !== null && room.players.b.readyState === WebSocket.OPEN,
    },
    history: serializeHistory(room.chess),
    pgn: room.chess.pgn(),
    lastMove: room.lastMove,
    inCheck: room.chess.inCheck(),
    outcome: room.outcome,
    rematchRequestedBy: room.rematchRequestedBy,
  }
}

function sendJson(socket: WebSocket | null, payload: ServerMessage): void {
  if (!socket || socket.readyState !== WebSocket.OPEN) {
    return
  }
  socket.send(JSON.stringify(payload))
}

function isValidMoveInput(raw: unknown): raw is MoveInput {
  if (!raw || typeof raw !== 'object') {
    return false
  }
  const candidate = raw as Record<string, unknown>
  if (typeof candidate.from !== 'string' || typeof candidate.to !== 'string') {
    return false
  }
  if (!SQUARE_RE.test(candidate.from) || !SQUARE_RE.test(candidate.to)) {
    return false
  }
  if (
    candidate.promotion !== undefined &&
    (typeof candidate.promotion !== 'string' ||
      !PROMOTION_PIECES.has(candidate.promotion as PromotionPiece))
  ) {
    return false
  }
  return true
}

export function createChessServer(options: ChessServerOptions = {}): ChessRoomServer {
  const configuredPort = options.port ?? 3001
  const configuredHost = options.host ?? '127.0.0.1'
  const startedAt = Date.now()

  const rooms = new Map<string, ChessRoom>()
  const sessions = new Map<WebSocket, SocketSession>()

  const httpServer = http.createServer((req, res) => {
    const reqUrl = req.url ?? '/'
    if (req.method === 'GET' && (reqUrl === '/health' || reqUrl === '/')) {
      res.writeHead(200, {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      })
      res.end(
        JSON.stringify({
          status: 'ok',
          service: 'vue-chess-room-server',
          activeRooms: rooms.size,
          uptimeMs: Date.now() - startedAt,
        }),
      )
      return
    }
    res.writeHead(404, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: 'Not found' }))
  })

  const wss = new WebSocketServer({
    server: httpServer,
    maxPayload: 8 * 1024,
  })

  function broadcastState(room: ChessRoom): void {
    const snapshot = buildSnapshot(room)
    const message: ServerMessage = { type: 'state_update', snapshot }
    sendJson(room.players.w, message)
    sendJson(room.players.b, message)
  }

  function detachSocketFromRoom(socket: WebSocket, notifyOpponent: boolean): void {
    const session = sessions.get(socket)
    if (!session || !session.roomCode || !session.color) {
      return
    }

    const room = rooms.get(session.roomCode)
    const leavingColor = session.color
    session.roomCode = null
    session.color = null

    if (!room) {
      return
    }

    if (room.players[leavingColor] === socket) {
      room.players[leavingColor] = null
    }
    room.updatedAt = Date.now()

    const otherColor = oppositeColor(leavingColor)
    const remainingSocket = room.players[otherColor]

    if (!remainingSocket || remainingSocket.readyState !== WebSocket.OPEN) {
      rooms.delete(room.code)
      return
    }

    if (room.status === 'playing') {
      room.status = 'finished'
      room.rematchRequestedBy = null
      const winnerLabel = otherColor === 'w' ? 'White' : 'Black'
      room.outcome = {
        reason: 'disconnect',
        winner: otherColor,
        message: `Opponent disconnected — ${winnerLabel} wins by forfeit.`,
      }
    }

    if (notifyOpponent) {
      const snapshot = buildSnapshot(room)
      sendJson(remainingSocket, {
        type: 'opponent_disconnected',
        snapshot,
        message: 'Your opponent left the room.',
      })
    }
  }

  function handleCreateRoom(socket: WebSocket): void {
    detachSocketFromRoom(socket, true)

    const code = generateRoomCode(new Set(rooms.keys()))
    const now = Date.now()
    const room: ChessRoom = {
      code,
      chess: new Chess(),
      players: { w: socket, b: null },
      status: 'waiting',
      lastMove: null,
      outcome: null,
      rematchRequestedBy: null,
      createdAt: now,
      updatedAt: now,
    }

    rooms.set(code, room)
    sessions.set(socket, { roomCode: code, color: 'w' })

    sendJson(socket, {
      type: 'room_created',
      code,
      color: 'w',
      snapshot: buildSnapshot(room),
    })
  }

  function handleJoinRoom(socket: WebSocket, rawCode: string): void {
    const code = normalizeRoomCode(rawCode)
    if (code.length !== ROOM_CODE_LENGTH) {
      sendJson(socket, {
        type: 'error',
        code: 'INVALID_ROOM_CODE',
        message: 'Room code must be 6 alphanumeric characters.',
      })
      return
    }

    const room = rooms.get(code)
    if (!room) {
      sendJson(socket, {
        type: 'error',
        code: 'ROOM_NOT_FOUND',
        message: `Room ${code} was not found.`,
      })
      return
    }

    const existingSession = sessions.get(socket)
    if (existingSession?.roomCode === code && existingSession.color) {
      sendJson(socket, {
        type: 'room_joined',
        code,
        color: existingSession.color,
        snapshot: buildSnapshot(room),
      })
      return
    }

    let assignedColor: PlayerColor | null = null
    if (!room.players.b || room.players.b.readyState !== WebSocket.OPEN) {
      assignedColor = 'b'
    } else if (!room.players.w || room.players.w.readyState !== WebSocket.OPEN) {
      assignedColor = 'w'
    }

    if (!assignedColor) {
      sendJson(socket, {
        type: 'error',
        code: 'ROOM_FULL',
        message: `Room ${code} already has two active players.`,
      })
      return
    }

    detachSocketFromRoom(socket, true)

    room.players[assignedColor] = socket
    room.updatedAt = Date.now()
    if (room.players.w && room.players.b && room.status === 'waiting') {
      room.status = 'playing'
    }

    sessions.set(socket, { roomCode: code, color: assignedColor })

    const snapshot = buildSnapshot(room)
    sendJson(socket, {
      type: 'room_joined',
      code,
      color: assignedColor,
      snapshot,
    })

    const peer = room.players[oppositeColor(assignedColor)]
    sendJson(peer, {
      type: 'state_update',
      snapshot,
    })
  }

  function handleMakeMove(socket: WebSocket, rawMove: unknown): void {
    const session = sessions.get(socket)
    if (!session?.roomCode || !session.color) {
      sendJson(socket, {
        type: 'error',
        code: 'NOT_IN_ROOM',
        message: 'Join or create a room before making a move.',
      })
      return
    }

    const room = rooms.get(session.roomCode)
    if (!room) {
      sendJson(socket, {
        type: 'error',
        code: 'ROOM_NOT_FOUND',
        message: 'Active room no longer exists.',
      })
      return
    }

    if (room.status !== 'playing') {
      sendJson(socket, {
        type: 'error',
        code: 'GAME_NOT_ACTIVE',
        message:
          room.status === 'waiting'
            ? 'Waiting for an opponent to join before moving.'
            : 'This game has already finished.',
      })
      return
    }

    if (room.chess.turn() !== session.color) {
      sendJson(socket, {
        type: 'error',
        code: 'NOT_YOUR_TURN',
        message: 'It is not your turn to move.',
      })
      return
    }

    if (!isValidMoveInput(rawMove)) {
      sendJson(socket, {
        type: 'error',
        code: 'INVALID_MOVE_PAYLOAD',
        message: 'Move coordinates must be valid algebraic squares (a1–h8).',
      })
      return
    }

    let appliedMove
    try {
      appliedMove = room.chess.move({
        from: rawMove.from,
        to: rawMove.to,
        promotion: rawMove.promotion,
      })
    } catch {
      appliedMove = null
    }

    if (!appliedMove) {
      sendJson(socket, {
        type: 'error',
        code: 'ILLEGAL_MOVE',
        message: `Illegal chess move: ${rawMove.from} -> ${rawMove.to}.`,
      })
      return
    }

    room.lastMove = { from: appliedMove.from, to: appliedMove.to }
    room.updatedAt = Date.now()

    const outcome = detectTerminalOutcome(room.chess, session.color)
    if (outcome) {
      room.status = 'finished'
      room.outcome = outcome
    }

    broadcastState(room)
  }

  function handleResign(socket: WebSocket): void {
    const session = sessions.get(socket)
    if (!session?.roomCode || !session.color) {
      sendJson(socket, {
        type: 'error',
        code: 'NOT_IN_ROOM',
        message: 'You are not in an active room.',
      })
      return
    }

    const room = rooms.get(session.roomCode)
    if (!room || room.status !== 'playing') {
      sendJson(socket, {
        type: 'error',
        code: 'GAME_NOT_ACTIVE',
        message: 'Cannot resign when a game is not in progress.',
      })
      return
    }

    const winner = oppositeColor(session.color)
    const resignerLabel = session.color === 'w' ? 'White' : 'Black'
    const winnerLabel = winner === 'w' ? 'White' : 'Black'
    room.status = 'finished'
    room.rematchRequestedBy = null
    room.outcome = {
      reason: 'resign',
      winner,
      message: `${resignerLabel} resigned — ${winnerLabel} wins.`,
    }
    room.updatedAt = Date.now()

    broadcastState(room)
  }

  function handleRequestRematch(socket: WebSocket): void {
    const session = sessions.get(socket)
    if (!session?.roomCode || !session.color) {
      sendJson(socket, {
        type: 'error',
        code: 'NOT_IN_ROOM',
        message: 'You are not in an active room.',
      })
      return
    }

    const room = rooms.get(session.roomCode)
    if (!room || room.status !== 'finished') {
      sendJson(socket, {
        type: 'error',
        code: 'REMATCH_NOT_ALLOWED',
        message: 'Rematch is only available after the game finishes.',
      })
      return
    }

    const whiteSocket = room.players.w
    const blackSocket = room.players.b
    if (
      !whiteSocket ||
      !blackSocket ||
      whiteSocket.readyState !== WebSocket.OPEN ||
      blackSocket.readyState !== WebSocket.OPEN
    ) {
      sendJson(socket, {
        type: 'error',
        code: 'OPPONENT_OFFLINE',
        message: 'Both players must be connected to start a rematch.',
      })
      return
    }

    if (room.rematchRequestedBy === session.color) {
      broadcastState(room)
      return
    }

    if (room.rematchRequestedBy === null) {
      room.rematchRequestedBy = session.color
      room.updatedAt = Date.now()
      broadcastState(room)
      return
    }

    // Both players agreed: swap colors so each side alternates White/Black fairly.
    room.chess = new Chess()
    room.players.w = blackSocket
    room.players.b = whiteSocket
    room.status = 'playing'
    room.lastMove = null
    room.outcome = null
    room.rematchRequestedBy = null
    room.updatedAt = Date.now()

    sessions.set(room.players.w, { roomCode: room.code, color: 'w' })
    sessions.set(room.players.b, { roomCode: room.code, color: 'b' })

    const snapshot = buildSnapshot(room)
    sendJson(room.players.w, { type: 'rematch_started', color: 'w', snapshot })
    sendJson(room.players.b, { type: 'rematch_started', color: 'b', snapshot })
  }

  function handleClientMessage(socket: WebSocket, raw: string): void {
    let parsed: ClientMessage
    try {
      parsed = JSON.parse(raw) as ClientMessage
    } catch {
      sendJson(socket, {
        type: 'error',
        code: 'INVALID_JSON',
        message: 'Message must be valid JSON.',
      })
      return
    }

    if (!parsed || typeof parsed !== 'object' || typeof parsed.type !== 'string') {
      sendJson(socket, {
        type: 'error',
        code: 'INVALID_MESSAGE',
        message: 'Message must include a valid type field.',
      })
      return
    }

    switch (parsed.type) {
      case 'create_room':
        handleCreateRoom(socket)
        break
      case 'join_room':
        handleJoinRoom(socket, typeof parsed.code === 'string' ? parsed.code : '')
        break
      case 'make_move':
        handleMakeMove(socket, parsed.move)
        break
      case 'resign':
        handleResign(socket)
        break
      case 'request_rematch':
        handleRequestRematch(socket)
        break
      case 'leave_room':
        detachSocketFromRoom(socket, true)
        break
      case 'ping':
        sendJson(socket, { type: 'pong' })
        break
      default:
        sendJson(socket, {
          type: 'error',
          code: 'UNKNOWN_MESSAGE_TYPE',
          message: 'Unsupported message type.',
        })
    }
  }

  wss.on('connection', (socket) => {
    sessions.set(socket, { roomCode: null, color: null })

    socket.on('message', (data) => {
      const text = typeof data === 'string' ? data : data.toString('utf8')
      handleClientMessage(socket, text)
    })

    socket.on('close', () => {
      detachSocketFromRoom(socket, true)
      sessions.delete(socket)
    })

    socket.on('error', () => {
      detachSocketFromRoom(socket, true)
      sessions.delete(socket)
    })
  })

  return {
    start(): Promise<StartedChessServer> {
      return new Promise((resolve, reject) => {
        httpServer.once('error', reject)
        httpServer.listen(configuredPort, configuredHost, () => {
          httpServer.off('error', reject)
          const address = httpServer.address() as AddressInfo
          const hostForUrl = address.address === '::' || address.address === '0.0.0.0'
            ? '127.0.0.1'
            : address.address
          resolve({
            port: address.port,
            host: hostForUrl,
            httpUrl: `http://${hostForUrl}:${address.port}`,
            wsUrl: `ws://${hostForUrl}:${address.port}/ws`,
          })
        })
      })
    },

    async close(): Promise<void> {
      for (const client of wss.clients) {
        client.terminate()
      }
      rooms.clear()
      sessions.clear()
      await new Promise<void>((resolve) => wss.close(() => resolve()))
      await new Promise<void>((resolve) => httpServer.close(() => resolve()))
    },

    getActiveRoomCount(): number {
      return rooms.size
    },

    getRoomSnapshot(code: string): RoomSnapshot | null {
      const room = rooms.get(normalizeRoomCode(code))
      return room ? buildSnapshot(room) : null
    },
  }
}
