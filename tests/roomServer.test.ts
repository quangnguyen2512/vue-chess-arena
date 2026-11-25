import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { WebSocket } from 'ws'
import {
  createChessServer,
  type ChessRoomServer,
  type StartedChessServer,
} from '../server/roomServer.js'
import type { ClientMessage, ServerMessage } from '../shared/protocol.js'

class TestWsClient {
  readonly ws: WebSocket
  private readonly queue: ServerMessage[] = []
  private readonly waiters: Array<{
    predicate: (msg: ServerMessage) => boolean
    resolve: (msg: ServerMessage) => void
    reject: (err: Error) => void
    timer: ReturnType<typeof setTimeout>
  }> = []

  constructor(url: string) {
    this.ws = new WebSocket(url)
    this.ws.on('message', (data) => {
      const parsed = JSON.parse(data.toString('utf8')) as ServerMessage
      const idx = this.waiters.findIndex((w) => w.predicate(parsed))
      if (idx !== -1) {
        const [waiter] = this.waiters.splice(idx, 1)
        clearTimeout(waiter.timer)
        waiter.resolve(parsed)
      } else {
        this.queue.push(parsed)
      }
    })
  }

  async waitOpen(): Promise<void> {
    if (this.ws.readyState === WebSocket.OPEN) return
    await new Promise<void>((resolve, reject) => {
      this.ws.once('open', () => resolve())
      this.ws.once('error', reject)
    })
  }

  send(msg: ClientMessage): void {
    this.ws.send(JSON.stringify(msg))
  }

  nextMessage<T extends ServerMessage['type']>(
    type?: T,
    timeoutMs = 3000,
  ): Promise<Extract<ServerMessage, { type: T }>> {
    const predicate = (m: ServerMessage) => (type ? m.type === type : true)
    const queuedIdx = this.queue.findIndex(predicate)
    if (queuedIdx !== -1) {
      const [msg] = this.queue.splice(queuedIdx, 1)
      return Promise.resolve(msg as Extract<ServerMessage, { type: T }>)
    }

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        const idx = this.waiters.findIndex((w) => w.timer === timer)
        if (idx !== -1) this.waiters.splice(idx, 1)
        reject(new Error(`Timed out waiting for WS message type=${type ?? 'any'}`))
      }, timeoutMs)

      this.waiters.push({
        predicate,
        resolve: resolve as (msg: ServerMessage) => void,
        reject,
        timer,
      })
    })
  }

  async close(): Promise<void> {
    if (this.ws.readyState === WebSocket.CLOSED) return
    await new Promise<void>((resolve) => {
      this.ws.once('close', () => resolve())
      this.ws.close()
    })
  }
}

describe('Multiplayer Chess WebSocket Room Server', () => {
  let server: ChessRoomServer
  let info: StartedChessServer
  const openClients: TestWsClient[] = []

  async function connectClient(): Promise<TestWsClient> {
    const client = new TestWsClient(info.wsUrl)
    await client.waitOpen()
    openClients.push(client)
    return client
  }

  beforeEach(async () => {
    server = createChessServer({ port: 0, host: '127.0.0.1' })
    info = await server.start()
  })

  afterEach(async () => {
    await Promise.all(openClients.map((c) => c.close()))
    openClients.length = 0
    await server.close()
  })

  it('serves HTTP /health telemetry', async () => {
    const res = await fetch(`${info.httpUrl}/health`)
    expect(res.status).toBe(200)
    const body = (await res.json()) as { status: string; activeRooms: number }
    expect(body.status).toBe('ok')
    expect(body.activeRooms).toBe(0)
  })

  it('creates room, joins opponent, rejects out-of-turn & illegal moves, and broadcasts valid moves', async () => {
    const white = await connectClient()
    const black = await connectClient()
    const intruder = await connectClient()

    // 1. White creates a private room
    white.send({ type: 'create_room' })
    const created = await white.nextMessage('room_created')
    expect(created.code).toMatch(/^[A-Z0-9]{6}$/)
    expect(created.color).toBe('w')
    expect(created.snapshot.status).toBe('waiting')

    // Moving before opponent joins is rejected
    white.send({ type: 'make_move', move: { from: 'e2', to: 'e4' } })
    const waitErr = await white.nextMessage('error')
    expect(waitErr.code).toBe('GAME_NOT_ACTIVE')

    // 2. Black joins with lowercase code
    black.send({ type: 'join_room', code: created.code.toLowerCase() })
    const joined = await black.nextMessage('room_joined')
    const whiteReady = await white.nextMessage('state_update')
    expect(joined.color).toBe('b')
    expect(joined.snapshot.status).toBe('playing')
    expect(whiteReady.snapshot.status).toBe('playing')
    expect(whiteReady.snapshot.players).toEqual({ w: true, b: true })

    // 3. Third client cannot hijack full room
    intruder.send({ type: 'join_room', code: created.code })
    const fullErr = await intruder.nextMessage('error')
    expect(fullErr.code).toBe('ROOM_FULL')

    // 4. Reject Black out-of-turn move
    black.send({ type: 'make_move', move: { from: 'e7', to: 'e5' } })
    const turnErr = await black.nextMessage('error')
    expect(turnErr.code).toBe('NOT_YOUR_TURN')

    // 5. Reject White illegal move (anti-cheat)
    white.send({ type: 'make_move', move: { from: 'e2', to: 'e5' } })
    const illegalErr = await white.nextMessage('error')
    expect(illegalErr.code).toBe('ILLEGAL_MOVE')

    // 6. Broadcast valid White move to BOTH players
    white.send({ type: 'make_move', move: { from: 'e2', to: 'e4' } })
    const [wState1, bState1] = await Promise.all([
      white.nextMessage('state_update'),
      black.nextMessage('state_update'),
    ])
    expect(wState1.snapshot.turn).toBe('b')
    expect(bState1.snapshot.turn).toBe('b')
    expect(wState1.snapshot.fen).toBe(bState1.snapshot.fen)
    expect(bState1.snapshot.lastMove).toEqual({ from: 'e2', to: 'e4' })
    expect(bState1.snapshot.history[0].san).toBe('e4')

    // 7. Black replies legally
    black.send({ type: 'make_move', move: { from: 'e7', to: 'e5' } })
    const [wState2, bState2] = await Promise.all([
      white.nextMessage('state_update'),
      black.nextMessage('state_update'),
    ])
    expect(wState2.snapshot.turn).toBe('w')
    expect(bState2.snapshot.history.map((m) => m.san)).toEqual(['e4', 'e5'])
  })

  it('detects checkmate and completes mutual rematch with swapped colors', async () => {
    const playerA = await connectClient()
    const playerB = await connectClient()

    playerA.send({ type: 'create_room' })
    const created = await playerA.nextMessage('room_created')

    playerB.send({ type: 'join_room', code: created.code })
    await playerB.nextMessage('room_joined')
    await playerA.nextMessage('state_update')

    // Play Fool's Mate: 1. f3 e5 2. g4 Qh4#
    const sequence: Array<{ client: TestWsClient; from: string; to: string }> = [
      { client: playerA, from: 'f2', to: 'f3' },
      { client: playerB, from: 'e7', to: 'e5' },
      { client: playerA, from: 'g2', to: 'g4' },
      { client: playerB, from: 'd8', to: 'h4' },
    ]

    let finalSnapshot = created.snapshot
    for (const step of sequence) {
      step.client.send({ type: 'make_move', move: { from: step.from, to: step.to } })
      const [aUpd, bUpd] = await Promise.all([
        playerA.nextMessage('state_update'),
        playerB.nextMessage('state_update'),
      ])
      expect(aUpd.snapshot.fen).toBe(bUpd.snapshot.fen)
      finalSnapshot = aUpd.snapshot
    }

    expect(finalSnapshot.status).toBe('finished')
    expect(finalSnapshot.outcome?.reason).toBe('checkmate')
    expect(finalSnapshot.outcome?.winner).toBe('b')

    // Request rematch from playerA (currently White)
    playerA.send({ type: 'request_rematch' })
    const [aReq, bReq] = await Promise.all([
      playerA.nextMessage('state_update'),
      playerB.nextMessage('state_update'),
    ])
    expect(aReq.snapshot.rematchRequestedBy).toBe('w')
    expect(bReq.snapshot.rematchRequestedBy).toBe('w')

    // Accept rematch from playerB -> fresh board + swapped colors!
    playerB.send({ type: 'request_rematch' })
    const [aRematch, bRematch] = await Promise.all([
      playerA.nextMessage('rematch_started'),
      playerB.nextMessage('rematch_started'),
    ])

    expect(aRematch.color).toBe('b')
    expect(bRematch.color).toBe('w')
    expect(bRematch.snapshot.status).toBe('playing')
    expect(bRematch.snapshot.history).toHaveLength(0)
    expect(bRematch.snapshot.outcome).toBeNull()

    // New White (playerB) makes opening move cleanly
    playerB.send({ type: 'make_move', move: { from: 'd2', to: 'd4' } })
    const [aFirst, bFirst] = await Promise.all([
      playerA.nextMessage('state_update'),
      playerB.nextMessage('state_update'),
    ])
    expect(aFirst.snapshot.history[0].san).toBe('d4')
    expect(bFirst.snapshot.turn).toBe('b')
  })

  it('handles resign and abrupt opponent disconnects cleanly without leaking rooms', async () => {
    const white = await connectClient()
    const black = await connectClient()

    white.send({ type: 'create_room' })
    const created = await white.nextMessage('room_created')
    black.send({ type: 'join_room', code: created.code })
    await black.nextMessage('room_joined')
    await white.nextMessage('state_update')

    // White resigns
    white.send({ type: 'resign' })
    const [wResign, bResign] = await Promise.all([
      white.nextMessage('state_update'),
      black.nextMessage('state_update'),
    ])
    expect(wResign.snapshot.status).toBe('finished')
    expect(bResign.snapshot.outcome).toMatchObject({ reason: 'resign', winner: 'b' })

    // Fresh room to test mid-game disconnect forfeit
    const p1 = await connectClient()
    const p2 = await connectClient()
    p1.send({ type: 'create_room' })
    const room2 = await p1.nextMessage('room_created')
    p2.send({ type: 'join_room', code: room2.code })
    await p2.nextMessage('room_joined')
    await p1.nextMessage('state_update')

    await p2.close()
    const disconnectNotice = await p1.nextMessage('opponent_disconnected')
    expect(disconnectNotice.snapshot.status).toBe('finished')
    expect(disconnectNotice.snapshot.outcome).toMatchObject({
      reason: 'disconnect',
      winner: 'w',
    })

    // Close all sockets -> room map empties cleanly
    await Promise.all([white.close(), black.close(), p1.close()])
    await new Promise((r) => setTimeout(r, 40))
    expect(server.getActiveRoomCount()).toBe(0)
  })

  it('serves static dist/ SPA, ?room= invite routes, hashed assets, /health, and /ws on a single port', async () => {
    const tempDist = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'vue-chess-dist-'))
    await fs.promises.mkdir(path.join(tempDist, 'assets'), { recursive: true })
    await fs.promises.writeFile(
      path.join(tempDist, 'index.html'),
      '<!doctype html><html><body><div id="app">Crownline Chess</div></body></html>',
      'utf8',
    )
    await fs.promises.writeFile(
      path.join(tempDist, 'assets', 'index-abc123.js'),
      'console.log("crownline-chess-bundle");',
      'utf8',
    )

    const unifiedServer = createChessServer({
      port: 0,
      host: '127.0.0.1',
      staticDir: tempDist,
    })
    const unifiedInfo = await unifiedServer.start()
    const unifiedClients: TestWsClient[] = []

    try {
      expect(unifiedInfo.staticDir).toBe(tempDist)

      // 1. Root HTML and ?room=CODE invite URL both serve SPA index.html
      const rootRes = await fetch(`${unifiedInfo.httpUrl}/`)
      expect(rootRes.status).toBe(200)
      expect(rootRes.headers.get('content-type')).toContain('text/html')
      expect(await rootRes.text()).toContain('Crownline Chess')

      const inviteRes = await fetch(`${unifiedInfo.httpUrl}/?room=K7P9QM`)
      expect(inviteRes.status).toBe(200)
      expect(inviteRes.headers.get('content-type')).toContain('text/html')
      expect(await inviteRes.text()).toContain('Crownline Chess')

      // 2. Hashed Vite bundle serves JS with immutable cache header
      const jsRes = await fetch(`${unifiedInfo.httpUrl}/assets/index-abc123.js`)
      expect(jsRes.status).toBe(200)
      expect(jsRes.headers.get('content-type')).toContain('text/javascript')
      expect(jsRes.headers.get('cache-control')).toContain('immutable')
      expect(await jsRes.text()).toContain('crownline-chess-bundle')

      // 3. Missing JS asset returns 404 JSON (never HTML) & encoded path traversal is rejected
      const missingAsset = await fetch(`${unifiedInfo.httpUrl}/assets/missing.js`)
      expect(missingAsset.status).toBe(404)

      const traversalRes = await fetch(`${unifiedInfo.httpUrl}/%2e%2e/package.json`)
      expect([403, 404]).toContain(traversalRes.status)

      // 4. Health check & WebSocket multiplayer work simultaneously on the same port
      const white = new TestWsClient(unifiedInfo.wsUrl)
      const black = new TestWsClient(unifiedInfo.wsUrl)
      unifiedClients.push(white, black)
      await Promise.all([white.waitOpen(), black.waitOpen()])

      white.send({ type: 'create_room' })
      const created = await white.nextMessage('room_created')
      black.send({ type: 'join_room', code: created.code })
      await black.nextMessage('room_joined')
      await white.nextMessage('state_update')

      const healthRes = await fetch(`${unifiedInfo.httpUrl}/health`)
      expect(healthRes.status).toBe(200)
      const healthBody = (await healthRes.json()) as {
        status: string
        activeRooms: number
        staticFrontend: boolean
      }
      expect(healthBody).toMatchObject({
        status: 'ok',
        activeRooms: 1,
        staticFrontend: true,
      })
    } finally {
      await Promise.all(unifiedClients.map((c) => c.close()))
      await unifiedServer.close()
      await fs.promises.rm(tempDist, { recursive: true, force: true })
    }
  })
})
