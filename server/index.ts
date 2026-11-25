import { createChessServer } from './roomServer.js'

const port = Number.parseInt(process.env.PORT ?? '3001', 10)
const host = process.env.HOST ?? '0.0.0.0'

const server = createChessServer({ port, host })

server
  .start()
  .then((info) => {
    console.log(`[chess-server] App / HTTP:  ${info.httpUrl}`)
    console.log(`[chess-server] Health:      ${info.httpUrl}/health`)
    console.log(`[chess-server] WebSocket:   ${info.wsUrl}`)
    if (info.staticDir) {
      console.log(`[chess-server] Static SPA:  ${info.staticDir}`)
    } else {
      console.log('[chess-server] Static SPA:  disabled (run `npm run build` to bundle dist/)')
    }
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
