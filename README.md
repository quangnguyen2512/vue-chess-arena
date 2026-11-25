# Crownline Chess — Vue 3 + TypeScript Multiplayer & AI

A fast, test-verified **Vue 3 + TypeScript** chess application featuring a custom **Minimax + Alpha-Beta Pruning + Piece-Square Tables AI engine** and **real-time WebSocket private multiplayer rooms** with authoritative server-side anti-cheat validation — deployable as a **single-port, 1-process web + WebSocket app** in 60 seconds.

## Features

- **Mode 1 — Play vs AI Opponent (`src/engine/ai.ts`)**
  - Custom Negamax / Minimax search with Alpha-Beta pruning, MVV-LVA move ordering, bounded quiescence search, and middlegame/endgame Piece-Square Tables.
  - 3 selectable difficulty tiers: **Casual (Depth 1)**, **Club (Depth 2)**, and **Tactical (Depth 3)** running under 150ms.
  - Play as White or Black, live centipawn evaluation bar, node/latency telemetry, and undo move support.
- **Mode 2 — Real-Time Private Multiplayer Rooms (`server/roomServer.ts`)**
  - Create a private room with a 6-character invite code and one-click shareable URL (`?room=ABC123`).
  - Opening a shared `?room=CODE` link automatically joins as Black and flips the board perspective.
  - Authoritative server-side `chess.js` move validation (anti-cheat), strict turn enforcement, live WebSocket synchronization, resign, mutual rematch (with automatic color swap), and instant disconnect forfeit + one-click message clearing / new room creation.
- **Polished Dark-Mode Interactive Board (`src/components/ChessBoard.vue`)**
  - Crisp Staunton-style inline SVG chess pieces with `8x8` algebraic coordinates.
  - Click-to-move and drag-and-drop with legal quiet-move dots and capture rings.
  - Last-move highlight, pulsing King-in-check indicator, inline pawn promotion selector, board flip toggle, captured pieces + material lead, and scrollable two-column PGN history with copy button.
  - Complete FIDE ruleset via `chess.js`: check, checkmate, stalemate, threefold repetition, insufficient material, castling, en passant, and promotion.

## Architecture (Single-Port Unified Production Mode)

```text
                       Single $PORT (HTTP + WebSocket)
┌───────────────────────────┐                   ┌────────────────────────────────┐
│   Vue 3 + TS Frontend     │ ◄─── GET / ─────► │   Node.js Unified Server (ws)  │
│  • ChessBoard + SVG       │ ◄─── WS /ws ────► │  • Serves built dist/ SPA      │
│  • useChessGame.ts        │   shared/protocol │  • 6-char private WS rooms     │
│  • Minimax Alpha-Beta AI  │                   │  • Server-side chess.js rules  │
└───────────────────────────┘                   │  • GET /health telemetry       │
                                                └────────────────────────────────┘
```

See [ARCHITECTURE.md](./ARCHITECTURE.md) for detailed module boundaries and invariants.

## Quick Start

### Option A — Single-Process Production Mode (1 Port for Frontend + WebSocket)
```bash
npm install
npm run build
npm start
```
Open `http://127.0.0.1:3001` in two browser tabs (or share the `?room=XXXXXX` invite link) — the Node server serves both the built `dist/` Vue 3 SPA and live `/ws` WebSocket multiplayer rooms on `$PORT` (default `3001`).

### Option B — 60-Second Docker Deploy (Render / Railway / Fly.io / Local)
```bash
docker build -t vue-chess-arena .
docker run --rm -p 3001:3001 vue-chess-arena
```
Any container platform that injects `$PORT` works out of the box with zero extra environment variables.

### Option C — Local Hot-Reload Development (Two Terminals)
```bash
# Terminal 1 — WebSocket room server (http://127.0.0.1:3001/health, ws://127.0.0.1:3001/ws)
npm run server

# Terminal 2 — Vite HMR dev server (http://localhost:5173, proxies /ws & /health)
npm run dev
```

## Verification & Quality Checks

```bash
# Type-check Vue templates, shared protocol, server, and tests (0 errors)
npm run typecheck

# Run Vitest unit + real WebSocket + single-port static SPA integration tests
npm test

# Build optimized Vite SPA (dist/) + compiled production server (dist-server/)
npm run build
```

## Project Structure

- `shared/protocol.ts` — Shared TypeScript protocol contracts for WebSocket messages and room snapshots.
- `server/roomServer.ts` — Unified HTTP static SPA (`dist/`) + `/health` + authoritative `ws` (`/ws`) room server.
- `server/index.ts` — Production/dev server entrypoint (`0.0.0.0:$PORT`).
- `Dockerfile` — Multi-stage `node:22-alpine` 1-process deployment image.
- `src/engine/ai.ts` — Negamax + Alpha-Beta + MVV-LVA + Piece-Square Tables AI engine.
- `src/engine/pieces.ts` — Inline SVG Staunton chess pieces and material values.
- `src/composables/useChessGame.ts` — Reactive game state controller for both AI and WebSocket modes.
- `src/components/` — `ChessBoard.vue`, `PromotionModal.vue`, `SidebarPanel.vue`, `StatusBanner.vue`.
- `tests/ai.test.ts` — AI engine tactical, mate-in-1, piece-safety, legality, and latency tests.
- `tests/roomServer.test.ts` — Real WebSocket + single-port static SPA integration tests.
