# ARCHITECTURE — Crownline Chess (Vue 3 + TypeScript)

Real-time multiplayer and Minimax Alpha-Beta AI chess application built with Vue 3, TypeScript, `chess.js`, and a unified single-port Node.js HTTP + WebSocket server (`ws`).

## Core Invariants
1. **100% FIDE Rule Correctness:** Both client interaction hints and server-side validation delegate legal move generation, check, checkmate, stalemate, castling, en passant, promotion, and draw detection to `chess.js`.
2. **Authoritative Server Anti-Cheat:** In multiplayer rooms, the server owns the canonical `Chess` instance (`server/roomServer.ts`). Clients only send `{ from, to, promotion }` intents; out-of-turn, malformed, or illegal moves are rejected before broadcast.
3. **Sub-150ms Responsive AI:** `src/engine/ai.ts` runs Negamax with Alpha-Beta pruning, MVV-LVA move ordering, Piece-Square Tables, and bounded quiescence search with explicit depth levels (`casual=1`, `club=2`, `tactical=3`) and a soft time guard.
4. **Single-Port Zero-Config Deployment:** In production (`npm run build && npm start` or `Dockerfile`), `server/roomServer.ts` serves the built `dist/` SPA (including `?room=CODE` links), `/health` JSON telemetry, and `/ws` multiplayer WebSockets on a single `$PORT`.

## Directory Boundaries
```text
freelancer_7d24f83a8e67_vue_chess/
├── Dockerfile                  # 2-stage node:22-alpine 1-process container
├── tsconfig.server.json        # Compiles server/ + shared/ -> dist-server/
├── shared/
│   └── protocol.ts             # Shared strict WebSocket & room snapshot types
├── server/
│   ├── roomServer.ts           # Static dist/ SPA + /health + authoritative /ws rooms
│   └── index.ts                # CLI entrypoint (0.0.0.0:$PORT)
├── src/
│   ├── engine/
│   │   ├── ai.ts               # Minimax/Negamax + Alpha-Beta + PST AI engine
│   │   └── pieces.ts           # Crisp Staunton SVG pieces & material metadata
│   ├── composables/
│   │   └── useChessGame.ts     # Unified reactive controller (AI + WS room + ?room= sync)
│   ├── components/
│   │   ├── ChessBoard.vue      # Interactive 8x8 dark-mode board (click + drag-drop)
│   │   ├── PromotionModal.vue  # Pawn promotion piece picker
│   │   ├── StatusBanner.vue    # Turn, check, outcome, WS status & dismissible alerts
│   │   └── SidebarPanel.vue    # Mode switch, AI controls, room invite/rematch/new room, PGN
│   ├── App.vue                 # Responsive workspace shell
│   ├── main.ts                 # Vue 3 entrypoint
│   └── style.css               # Dark-mode visual theme
└── tests/
    ├── ai.test.ts              # Vitest AI tactical, mate-in-1, legality & speed suite
    └── roomServer.test.ts      # Vitest WebSocket + single-port static SPA suite
```

## Execution & Data Flow
```text
Play vs AI:   ChessBoard -> useChessGame -> chess.js -> src/engine/ai.ts (Alpha-Beta) -> UI update
Multiplayer:  Browser (GET /?room=CODE -> dist/index.html) -> WS /ws -> server/roomServer.ts
                                                                              |
                                                                 broadcast RoomSnapshot -> White & Black
```
