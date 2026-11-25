# Crownline Chess — Vue 3 + TypeScript Multiplayer & AI

A fast, test-verified **Vue 3 + TypeScript** chess application featuring a custom **Minimax + Alpha-Beta Pruning + Piece-Square Tables AI engine** and **real-time WebSocket private multiplayer rooms** with authoritative server-side anti-cheat validation.

## Features

- **Mode 1 — Play vs AI Opponent (`src/engine/ai.ts`)**
  - Custom Negamax / Minimax search with Alpha-Beta pruning, MVV-LVA move ordering, bounded quiescence search, and middlegame/endgame Piece-Square Tables.
  - 3 selectable difficulty tiers: **Casual (Depth 1)**, **Club (Depth 2)**, and **Tactical (Depth 3)** running under 150ms.
  - Play as White or Black, live centipawn evaluation bar, node/latency telemetry, and undo move support.
- **Mode 2 — Real-Time Private Multiplayer Rooms (`server/roomServer.ts`)**
  - Create a private room with a 6-character invite code and one-click shareable URL (`?room=ABC123`).
  - Opening a shared `?room=CODE` link automatically joins as Black and flips the board perspective.
  - Authoritative server-side `chess.js` move validation (anti-cheat), strict turn enforcement, live WebSocket synchronization, resign, mutual rematch (with automatic color swap), and disconnect forfeit handling.
- **Polished Dark-Mode Interactive Board (`src/components/ChessBoard.vue`)**
  - Crisp Staunton-style inline SVG chess pieces with `8x8` algebraic coordinates.
  - Click-to-move and drag-and-drop with legal quiet-move dots and capture rings.
  - Last-move highlight, pulsing King-in-check indicator, inline pawn promotion selector, board flip toggle, captured pieces + material lead, and scrollable two-column PGN history with copy button.
  - Complete FIDE ruleset via `chess.js`: check, checkmate, stalemate, threefold repetition, insufficient material, castling, en passant, and promotion.

## Architecture

```text
┌───────────────────────────┐         WebSocket (/ws)         ┌──────────────────────────────┐
│   Vue 3 + TS Frontend     │ ◄─────────────────────────────► │   Node.js Room Server (ws)   │
│  • ChessBoard + SVG       │  JSON protocol (shared/protocol)│  • 6-char private rooms      │
│  • useChessGame.ts        │                                 │  • Server-side chess.js      │
│  • Minimax Alpha-Beta AI  │                                 │    anti-cheat validation     │
└───────────────────────────┘                                 │  • Broadcast, resign, rematch│
                                                              └──────────────────────────────┘
```

See [ARCHITECTURE.md](./ARCHITECTURE.md) for detailed module boundaries and invariants.

## Local Setup & Run Commands

### 1. Install dependencies
```bash
npm install
```

### 2. Optional environment configuration
Copy `.env.example` to `.env` if you want to customize ports or point the frontend at a remote WebSocket server:
```bash
cp .env.example .env
```

### 3. Run in development (two terminals)

Terminal 1 — start the authoritative WebSocket room server (`http://127.0.0.1:3001/health`, `ws://127.0.0.1:3001/ws`):
```bash
npm run server
```

Terminal 2 — start the Vue 3 Vite dev server (`http://localhost:5173`, proxies `/ws` and `/health` automatically):
```bash
npm run dev
```

Open two browser tabs at `http://localhost:5173` (or share the `?room=XXXXXX` link) to test live multiplayer, or play immediately against the AI opponent in a single tab.

## Verification & Quality Checks

```bash
# Type-check frontend, shared protocol, server, and tests
npx tsc --noEmit

# Run Vitest unit + real WebSocket integration tests
npm test

# Build optimized production bundle
npm run build
```

## Project Structure

- `shared/protocol.ts` — Shared TypeScript protocol contracts for WebSocket messages and room snapshots.
- `server/roomServer.ts` — HTTP health endpoint + authoritative `ws` room server with FIDE validation.
- `server/index.ts` — Server CLI entrypoint.
- `src/engine/ai.ts` — Negamax + Alpha-Beta + MVV-LVA + Piece-Square Tables AI engine.
- `src/engine/pieces.ts` — Inline SVG Staunton chess pieces and material values.
- `src/composables/useChessGame.ts` — Reactive game state controller for both AI and WebSocket modes.
- `src/components/` — `ChessBoard.vue`, `PromotionModal.vue`, `SidebarPanel.vue`, `StatusBanner.vue`.
- `tests/ai.test.ts` — AI engine tactical, mate-in-1, piece-safety, legality, and latency tests.
- `tests/roomServer.test.ts` — Real WebSocket integration tests covering rooms, anti-cheat rejections, move broadcasts, checkmate, rematch, resign, and disconnect handling.
