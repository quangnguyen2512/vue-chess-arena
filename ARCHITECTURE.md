# ARCHITECTURE — Crownline Chess (Vue 3 + TypeScript)

Real-time multiplayer and Minimax Alpha-Beta AI chess application built with Vue 3, TypeScript, `chess.js`, and a lightweight authoritative Node.js WebSocket server (`ws`).

## Core Invariants
1. **100% FIDE Rule Correctness:** Both client interaction hints and server-side validation delegate legal move generation, check, checkmate, stalemate, castling, en passant, promotion, and draw detection to `chess.js`.
2. **Authoritative Server Anti-Cheat:** In multiplayer rooms, the server owns the canonical `Chess` instance (`server/roomServer.ts`). Clients only send `{ from, to, promotion }` intents; out-of-turn, malformed, or illegal moves are rejected before broadcast.
3. **Sub-150ms Responsive AI:** `src/engine/ai.ts` runs Negamax with Alpha-Beta pruning, MVV-LVA move ordering, Piece-Square Tables, and bounded quiescence search with explicit depth levels (`casual=1`, `club=2`, `tactical=3`) and a soft time guard.

## Directory Boundaries
```text
freelancer_7d24f83a8e67_vue_chess/
├── shared/
│   └── protocol.ts             # Shared strict WebSocket & room snapshot types
├── server/
│   ├── roomServer.ts           # Authoritative RoomManager + HTTP /health + WS server
│   └── index.ts                # CLI entrypoint (PORT/HOST via env)
├── src/
│   ├── engine/
│   │   ├── ai.ts               # Minimax/Negamax + Alpha-Beta + PST AI engine
│   │   └── pieces.ts           # Crisp Staunton SVG pieces & material metadata
│   ├── composables/
│   │   └── useChessGame.ts     # Unified reactive controller (AI mode + live WS room + ?room= URL sync)
│   ├── components/
│   │   ├── ChessBoard.vue      # Interactive 8x8 dark-mode board (click + drag-drop + highlights)
│   │   ├── PromotionModal.vue  # Pawn promotion piece picker
│   │   ├── StatusBanner.vue    # Turn, check, game outcome & WS connection status
│   │   └── SidebarPanel.vue    # Mode switch, AI controls, room invite/copy, captured material, PGN
│   ├── App.vue                 # Responsive workspace shell
│   ├── main.ts                 # Vue 3 entrypoint
│   └── style.css               # Dark-mode visual theme
└── tests/
    ├── ai.test.ts              # Vitest AI tactical, mate-in-1, legality & speed suite
    └── roomServer.test.ts      # Vitest end-to-end WebSocket multiplayer room suite
```

## Execution & Data Flow
```text
Play vs AI:   ChessBoard -> useChessGame -> chess.js -> src/engine/ai.ts (Alpha-Beta) -> UI update
Multiplayer:  ChessBoard -> useChessGame -> WS /ws -> server/roomServer.ts (chess.js anti-cheat)
                                                              |
                                                 broadcast RoomSnapshot -> White & Black clients
```
