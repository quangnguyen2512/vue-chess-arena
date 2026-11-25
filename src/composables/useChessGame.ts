import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { Chess, type Square } from 'chess.js'
import {
  normalizeRoomCode,
  oppositeColor,
  type ClientMessage,
  type DifficultyLevel,
  type GameOutcome,
  type MoveInput,
  type PieceType,
  type PlayerColor,
  type PromotionPiece,
  type RoomSnapshot,
  type RoomStatus,
  type SerializedMove,
  type ServerMessage,
} from '../../shared/protocol'
import { evaluatePosition, findBestMove, type AIMoveResult } from '../engine/ai'
import { PIECE_MATERIAL } from '../engine/pieces'

export type GameMode = 'ai' | 'multiplayer'
export type ConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'error'

export interface BoardCell {
  square: Square
  row: number
  col: number
  isLight: boolean
  piece: { type: PieceType; color: PlayerColor } | null
}

export interface PendingPromotion {
  from: Square
  to: Square
  color: PlayerColor
}

const PIECE_SORT_ORDER: Record<PieceType, number> = {
  q: 5,
  r: 4,
  b: 3,
  n: 2,
  p: 1,
  k: 0,
}

function serializeChessHistory(chess: Chess): SerializedMove[] {
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

function detectLocalOutcome(chess: Chess, lastMover: PlayerColor): GameOutcome | null {
  if (chess.isCheckmate()) {
    const winnerName = lastMover === 'w' ? 'White' : 'Black'
    return {
      reason: 'checkmate',
      winner: lastMover,
      message: `Checkmate — ${winnerName} wins!`,
    }
  }
  if (chess.isStalemate()) {
    return { reason: 'stalemate', winner: null, message: 'Draw by stalemate.' }
  }
  if (chess.isThreefoldRepetition()) {
    return { reason: 'threefold', winner: null, message: 'Draw by threefold repetition.' }
  }
  if (chess.isInsufficientMaterial()) {
    return { reason: 'insufficient', winner: null, message: 'Draw by insufficient material.' }
  }
  if (chess.isDraw()) {
    return { reason: 'draw', winner: null, message: 'Game drawn by 50-move rule.' }
  }
  return null
}

function resolveWebSocketUrl(): string {
  const configured = import.meta.env.VITE_WS_URL
  if (typeof configured === 'string' && configured.trim().length > 0) {
    return configured.trim()
  }
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  return `${protocol}//${window.location.host}/ws`
}

function updateRoomUrlParam(code: string | null): void {
  if (typeof window === 'undefined') {
    return
  }
  const url = new URL(window.location.href)
  if (code) {
    url.searchParams.set('room', code)
  } else {
    url.searchParams.delete('room')
  }
  window.history.replaceState({}, '', url.toString())
}

export function useChessGame() {
  const chess = new Chess()

  // Core game state
  const gameMode = ref<GameMode>('ai')
  const difficulty = ref<DifficultyLevel>('club')
  const playerSide = ref<PlayerColor>('w')
  const flipped = ref<boolean>(false)

  const fen = ref<string>(chess.fen())
  const turn = ref<PlayerColor>('w')
  const history = ref<SerializedMove[]>([])
  const pgn = ref<string>('')
  const lastMove = ref<{ from: string; to: string } | null>(null)
  const inCheck = ref<boolean>(false)
  const outcome = ref<GameOutcome | null>(null)
  const staticEvalCp = ref<number>(0)

  // Interaction state
  const selectedSquare = ref<Square | null>(null)
  const pendingPromotion = ref<PendingPromotion | null>(null)
  const aiThinking = ref<boolean>(false)
  const lastAiStats = ref<AIMoveResult | null>(null)
  const noticeBanner = ref<string | null>(null)
  const errorBanner = ref<string | null>(null)

  // Multiplayer room state
  const wsStatus = ref<ConnectionStatus>('disconnected')
  const roomCode = ref<string | null>(null)
  const roomStatus = ref<RoomStatus | null>(null)
  const myRoomColor = ref<PlayerColor | null>(null)
  const roomPlayers = ref<{ w: boolean; b: boolean }>({ w: false, b: false })
  const rematchRequestedBy = ref<PlayerColor | null>(null)

  let socket: WebSocket | null = null
  let aiTimer: ReturnType<typeof setTimeout> | null = null
  let aiToken = 0

  function clearBanners(): void {
    errorBanner.value = null
    noticeBanner.value = null
  }

  function cancelPendingAi(): void {
    aiToken += 1
    if (aiTimer !== null) {
      clearTimeout(aiTimer)
      aiTimer = null
    }
    aiThinking.value = false
  }

  function syncFromLocalChess(lastMover?: PlayerColor): void {
    fen.value = chess.fen()
    turn.value = chess.turn()
    history.value = serializeChessHistory(chess)
    pgn.value = chess.pgn()
    inCheck.value = chess.inCheck()
    staticEvalCp.value = evaluatePosition(chess)

    const recent = history.value[history.value.length - 1]
    lastMove.value = recent ? { from: recent.from, to: recent.to } : null

    if (lastMover) {
      outcome.value = detectLocalOutcome(chess, lastMover)
    } else if (chess.isGameOver()) {
      outcome.value = detectLocalOutcome(chess, oppositeColor(chess.turn()))
    } else {
      outcome.value = null
    }
  }

  function applyRoomSnapshot(snapshot: RoomSnapshot): void {
    chess.load(snapshot.fen)
    fen.value = snapshot.fen
    turn.value = snapshot.turn
    roomCode.value = snapshot.code
    roomStatus.value = snapshot.status
    roomPlayers.value = snapshot.players
    history.value = snapshot.history
    pgn.value = snapshot.pgn
    lastMove.value = snapshot.lastMove
    inCheck.value = snapshot.inCheck
    outcome.value = snapshot.outcome
    rematchRequestedBy.value = snapshot.rematchRequestedBy
    staticEvalCp.value = evaluatePosition(chess)
    selectedSquare.value = null
    pendingPromotion.value = null
  }

  const activeUserColor = computed<PlayerColor | null>(() => {
    return gameMode.value === 'ai' ? playerSide.value : myRoomColor.value
  })

  const canInteract = computed<boolean>(() => {
    if (outcome.value !== null) {
      return false
    }
    if (gameMode.value === 'ai') {
      return !aiThinking.value && turn.value === playerSide.value
    }
    return (
      roomStatus.value === 'playing' &&
      myRoomColor.value !== null &&
      turn.value === myRoomColor.value
    )
  })

  const boardCells = computed<BoardCell[]>(() => {
    // Reading fen.value guarantees Vue reactivity whenever the board updates
    void fen.value
    const grid = chess.board()
    const cells: BoardCell[] = []

    const rowIndices = flipped.value ? [7, 6, 5, 4, 3, 2, 1, 0] : [0, 1, 2, 3, 4, 5, 6, 7]
    const colIndices = flipped.value ? [7, 6, 5, 4, 3, 2, 1, 0] : [0, 1, 2, 3, 4, 5, 6, 7]
    const files = 'abcdefgh'

    for (const row of rowIndices) {
      for (const col of colIndices) {
        const piece = grid[row][col]
        const square = `${files[col]}${8 - row}` as Square
        cells.push({
          square,
          row,
          col,
          isLight: (row + col) % 2 === 0,
          piece: piece ? { type: piece.type as PieceType, color: piece.color } : null,
        })
      }
    }
    return cells
  })

  const checkedKingSquare = computed<Square | null>(() => {
    void fen.value
    if (!inCheck.value) {
      return null
    }
    const grid = chess.board()
    const files = 'abcdefgh'
    for (let row = 0; row < 8; row++) {
      for (let col = 0; col < 8; col++) {
        const p = grid[row][col]
        if (p && p.type === 'k' && p.color === turn.value) {
          return `${files[col]}${8 - row}` as Square
        }
      }
    }
    return null
  })

  const legalMovesForSelected = computed(() => {
    void fen.value
    if (!selectedSquare.value || !canInteract.value) {
      return []
    }
    return chess.moves({ square: selectedSquare.value, verbose: true })
  })

  const legalTargetsMap = computed<Record<string, { capture: boolean; promotion: boolean }>>(() => {
    const map: Record<string, { capture: boolean; promotion: boolean }> = {}
    for (const move of legalMovesForSelected.value) {
      const existing = map[move.to]
      map[move.to] = {
        capture: Boolean(move.captured) || existing?.capture || false,
        promotion: Boolean(move.promotion) || existing?.promotion || false,
      }
    }
    return map
  })

  const capturedSummary = computed(() => {
    void fen.value
    const byWhite: PieceType[] = []
    const byBlack: PieceType[] = []

    for (const move of history.value) {
      if (move.captured) {
        if (move.color === 'w') {
          byWhite.push(move.captured)
        } else {
          byBlack.push(move.captured)
        }
      }
    }

    byWhite.sort((a, b) => PIECE_SORT_ORDER[b] - PIECE_SORT_ORDER[a])
    byBlack.sort((a, b) => PIECE_SORT_ORDER[b] - PIECE_SORT_ORDER[a])

    let whiteMaterial = 0
    let blackMaterial = 0
    for (const rank of chess.board()) {
      for (const piece of rank) {
        if (!piece) continue
        const val = PIECE_MATERIAL[piece.type as PieceType]
        if (piece.color === 'w') whiteMaterial += val
        else blackMaterial += val
      }
    }

    const diff = whiteMaterial - blackMaterial
    return {
      byWhite,
      byBlack,
      whiteAdvantage: diff > 0 ? diff : 0,
      blackAdvantage: diff < 0 ? Math.abs(diff) : 0,
    }
  })

  const movePairs = computed(() => {
    const pairs: Array<{ moveNumber: number; white?: SerializedMove; black?: SerializedMove }> = []
    for (let i = 0; i < history.value.length; i += 2) {
      pairs.push({
        moveNumber: Math.floor(i / 2) + 1,
        white: history.value[i],
        black: history.value[i + 1],
      })
    }
    return pairs
  })

  const inviteUrl = computed<string | null>(() => {
    if (!roomCode.value || typeof window === 'undefined') {
      return null
    }
    return `${window.location.origin}${window.location.pathname}?room=${roomCode.value}`
  })

  function scheduleAiMoveIfNeeded(): void {
    if (
      gameMode.value !== 'ai' ||
      outcome.value !== null ||
      turn.value === playerSide.value
    ) {
      return
    }

    const token = ++aiToken
    aiThinking.value = true
    const targetFen = chess.fen()
    const level = difficulty.value

    aiTimer = setTimeout(() => {
      if (token !== aiToken || gameMode.value !== 'ai') {
        return
      }
      const aiMove = findBestMove(targetFen, level)
      aiThinking.value = false
      aiTimer = null

      if (!aiMove || token !== aiToken) {
        return
      }

      const applied = chess.move({
        from: aiMove.from,
        to: aiMove.to,
        promotion: aiMove.promotion,
      })
      if (applied) {
        lastAiStats.value = aiMove
        syncFromLocalChess(applied.color)
      }
    }, 45)
  }

  function commitMove(move: MoveInput): void {
    clearBanners()
    pendingPromotion.value = null
    selectedSquare.value = null

    if (gameMode.value === 'ai') {
      let applied
      try {
        applied = chess.move({
          from: move.from,
          to: move.to,
          promotion: move.promotion,
        })
      } catch {
        applied = null
      }
      if (!applied) {
        errorBanner.value = 'That move is not legal in this position.'
        return
      }
      syncFromLocalChess(applied.color)
      scheduleAiMoveIfNeeded()
      return
    }

    // Multiplayer mode: send move to authoritative room server
    sendWsMessage({ type: 'make_move', move })
  }

  function attemptMoveBetween(from: Square, to: Square): boolean {
    if (!canInteract.value) {
      return false
    }
    const candidates = chess
      .moves({ square: from, verbose: true })
      .filter((m) => m.to === to)

    if (candidates.length === 0) {
      return false
    }

    const requiresPromotion = candidates.some((m) => Boolean(m.promotion))
    if (requiresPromotion) {
      pendingPromotion.value = { from, to, color: turn.value }
      selectedSquare.value = null
      return true
    }

    commitMove({ from, to })
    return true
  }

  function handleSquareClick(square: Square): void {
    if (!canInteract.value) {
      return
    }

    if (selectedSquare.value === square) {
      selectedSquare.value = null
      return
    }

    if (selectedSquare.value && attemptMoveBetween(selectedSquare.value, square)) {
      return
    }

    const piece = chess.get(square)
    if (piece && piece.color === activeUserColor.value) {
      selectedSquare.value = square
    } else {
      selectedSquare.value = null
    }
  }

  function handlePieceDrop(from: Square, to: Square): void {
    if (from === to || !canInteract.value) {
      return
    }
    const piece = chess.get(from)
    if (!piece || piece.color !== activeUserColor.value) {
      return
    }
    attemptMoveBetween(from, to)
  }

  function confirmPromotion(piece: PromotionPiece): void {
    if (!pendingPromotion.value) {
      return
    }
    const { from, to } = pendingPromotion.value
    commitMove({ from, to, promotion: piece })
  }

  function cancelPromotion(): void {
    pendingPromotion.value = null
  }

  function startNewAiGame(side?: PlayerColor): void {
    cancelPendingAi()
    clearBanners()
    if (side) {
      playerSide.value = side
    }
    chess.reset()
    flipped.value = playerSide.value === 'b'
    selectedSquare.value = null
    pendingPromotion.value = null
    lastAiStats.value = null
    syncFromLocalChess()
    scheduleAiMoveIfNeeded()
  }

  function undoAiMove(): void {
    if (gameMode.value !== 'ai' || history.value.length === 0) {
      return
    }
    cancelPendingAi()
    clearBanners()
    selectedSquare.value = null
    pendingPromotion.value = null

    // Step back until it's the human player's turn again (usually 2 plies)
    chess.undo()
    if (chess.turn() !== playerSide.value && chess.history().length > 0) {
      chess.undo()
    }
    syncFromLocalChess()
  }

  function setDifficulty(level: DifficultyLevel): void {
    difficulty.value = level
  }

  function toggleBoardFlip(): void {
    flipped.value = !flipped.value
  }

  // --- Multiplayer WebSocket client ---
  function handleServerMessage(msg: ServerMessage): void {
    switch (msg.type) {
      case 'room_created':
        clearBanners()
        myRoomColor.value = msg.color
        flipped.value = msg.color === 'b'
        applyRoomSnapshot(msg.snapshot)
        updateRoomUrlParam(msg.code)
        noticeBanner.value = `Room ${msg.code} ready — share the invite link so your opponent can join as Black.`
        break

      case 'room_joined':
        clearBanners()
        myRoomColor.value = msg.color
        flipped.value = msg.color === 'b'
        applyRoomSnapshot(msg.snapshot)
        updateRoomUrlParam(msg.code)
        noticeBanner.value = `Joined room ${msg.code} as ${msg.color === 'w' ? 'White' : 'Black'}.`
        break

      case 'state_update':
        errorBanner.value = null
        applyRoomSnapshot(msg.snapshot)
        if (msg.snapshot.status === 'playing' && msg.snapshot.history.length === 0) {
          noticeBanner.value = 'Opponent connected — game live!'
        }
        break

      case 'rematch_started':
        clearBanners()
        myRoomColor.value = msg.color
        flipped.value = msg.color === 'b'
        applyRoomSnapshot(msg.snapshot)
        noticeBanner.value = `Rematch started — colors swapped! You are now ${msg.color === 'w' ? 'White' : 'Black'}.`
        break

      case 'opponent_disconnected':
        applyRoomSnapshot(msg.snapshot)
        noticeBanner.value = msg.message
        break

      case 'error':
        errorBanner.value = msg.message
        break

      case 'pong':
        break
    }
  }

  function ensureSocketConnected(): Promise<WebSocket> {
    if (socket && socket.readyState === WebSocket.OPEN) {
      return Promise.resolve(socket)
    }

    if (socket) {
      socket.close()
      socket = null
    }

    wsStatus.value = 'connecting'
    const wsUrl = resolveWebSocketUrl()

    return new Promise((resolve, reject) => {
      const ws = new WebSocket(wsUrl)
      socket = ws
      let settled = false

      ws.addEventListener('open', () => {
        wsStatus.value = 'connected'
        settled = true
        resolve(ws)
      })

      ws.addEventListener('message', (event) => {
        try {
          const parsed = JSON.parse(String(event.data)) as ServerMessage
          handleServerMessage(parsed)
        } catch {
          errorBanner.value = 'Received malformed update from room server.'
        }
      })

      ws.addEventListener('close', () => {
        if (socket === ws) {
          socket = null
          wsStatus.value = 'disconnected'
        }
        if (!settled) {
          settled = true
          reject(new Error('Could not reach multiplayer server. Start it with `npm run server`.'))
        }
      })

      ws.addEventListener('error', () => {
        wsStatus.value = 'error'
        if (!settled) {
          settled = true
          reject(new Error('Multiplayer WebSocket connection failed. Start the server with `npm run server`.'))
        }
      })
    })
  }

  function sendWsMessage(payload: ClientMessage): void {
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      errorBanner.value = 'Not connected to the multiplayer server.'
      return
    }
    socket.send(JSON.stringify(payload))
  }

  async function createPrivateRoom(): Promise<void> {
    cancelPendingAi()
    clearBanners()
    gameMode.value = 'multiplayer'
    try {
      const ws = await ensureSocketConnected()
      ws.send(JSON.stringify({ type: 'create_room' } satisfies ClientMessage))
    } catch (err) {
      errorBanner.value = err instanceof Error ? err.message : 'Failed to connect.'
    }
  }

  async function joinPrivateRoom(rawCode: string): Promise<void> {
    const code = normalizeRoomCode(rawCode)
    if (code.length !== 6) {
      errorBanner.value = 'Enter a 6-character room invite code (e.g. K7P9QM).'
      return
    }
    cancelPendingAi()
    clearBanners()
    gameMode.value = 'multiplayer'
    try {
      const ws = await ensureSocketConnected()
      ws.send(JSON.stringify({ type: 'join_room', code } satisfies ClientMessage))
    } catch (err) {
      errorBanner.value = err instanceof Error ? err.message : 'Failed to connect.'
    }
  }

  function resignRoomGame(): void {
    if (gameMode.value !== 'multiplayer' || roomStatus.value !== 'playing') {
      return
    }
    sendWsMessage({ type: 'resign' })
  }

  function requestRematch(): void {
    if (gameMode.value !== 'multiplayer' || roomStatus.value !== 'finished') {
      return
    }
    sendWsMessage({ type: 'request_rematch' })
  }

  function leavePrivateRoom(): void {
    if (socket && socket.readyState === WebSocket.OPEN && roomCode.value) {
      sendWsMessage({ type: 'leave_room' })
    }
    roomCode.value = null
    roomStatus.value = null
    myRoomColor.value = null
    roomPlayers.value = { w: false, b: false }
    rematchRequestedBy.value = null
    updateRoomUrlParam(null)
    chess.reset()
    syncFromLocalChess()
    clearBanners()
  }

  function switchMode(nextMode: GameMode): void {
    if (gameMode.value === nextMode) {
      return
    }
    if (gameMode.value === 'multiplayer' && roomCode.value) {
      leavePrivateRoom()
    }
    gameMode.value = nextMode
    clearBanners()
    if (nextMode === 'ai') {
      startNewAiGame()
    } else {
      cancelPendingAi()
      chess.reset()
      flipped.value = false
      syncFromLocalChess()
    }
  }

  onMounted(() => {
    const params = new URLSearchParams(window.location.search)
    const invitedRoom = params.get('room')
    if (invitedRoom) {
      const normalized = normalizeRoomCode(invitedRoom)
      if (normalized.length === 6) {
        void joinPrivateRoom(normalized)
      }
    }
  })

  onBeforeUnmount(() => {
    cancelPendingAi()
    if (socket) {
      socket.close()
      socket = null
    }
  })

  return {
    // State
    gameMode,
    difficulty,
    playerSide,
    flipped,
    fen,
    turn,
    history,
    pgn,
    lastMove,
    inCheck,
    outcome,
    staticEvalCp,
    selectedSquare,
    pendingPromotion,
    aiThinking,
    lastAiStats,
    noticeBanner,
    errorBanner,
    wsStatus,
    roomCode,
    roomStatus,
    myRoomColor,
    roomPlayers,
    rematchRequestedBy,

    // Computed
    activeUserColor,
    canInteract,
    boardCells,
    checkedKingSquare,
    legalTargetsMap,
    capturedSummary,
    movePairs,
    inviteUrl,

    // Actions
    handleSquareClick,
    handlePieceDrop,
    confirmPromotion,
    cancelPromotion,
    startNewAiGame,
    undoAiMove,
    setDifficulty,
    toggleBoardFlip,
    switchMode,
    createPrivateRoom,
    joinPrivateRoom,
    resignRoomGame,
    requestRematch,
    leavePrivateRoom,
  }
}
