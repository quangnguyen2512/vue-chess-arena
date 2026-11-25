import { createChessServer } from './roomServer.js'

const port = Number.parseInt(process.env.PORT ?? '3001', 10)
const host = process.env.HOST ?? '127.0.0.1'

const server = createChessServer({ port, host })

server
  .start()
  .then((info) => {
    console.log(`[chess-server] HTTP health: ${info.httpUrl}/health`)
    console.log(`[chess-server] WebSocket:   ${info.wsUrl}`)
  })
  .catch((err) => {
    console.error('[chess-server] Failed to start:', err)
    process.exit(1)
  })

const shutdown = async () => {
  await server.close()
  process.exit(0)
}

process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
