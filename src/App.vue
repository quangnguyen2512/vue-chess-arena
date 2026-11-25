<script setup lang="ts">
import ChessBoard from './components/ChessBoard.vue'
import SidebarPanel from './components/SidebarPanel.vue'
import StatusBanner from './components/StatusBanner.vue'
import { useChessGame } from './composables/useChessGame'

const game = useChessGame()
</script>

<template>
  <div class="app-root">
    <header class="top-bar">
      <div class="brand">
        <span class="brand-mark" aria-hidden="true">♞</span>
        <div>
          <h1 class="brand-title">Crownline Chess</h1>
          <p class="brand-sub">Vue 3 · TypeScript · Alpha-Beta AI · Live WebSocket Rooms</p>
        </div>
      </div>

      <div class="top-badges">
        <span class="tech-pill">FIDE Validated</span>
        <span class="tech-pill">Server Anti-Cheat</span>
      </div>
    </header>

    <main class="workspace-grid">
      <section class="board-column">
        <StatusBanner
          :game-mode="game.gameMode.value"
          :turn="game.turn.value"
          :in-check="game.inCheck.value"
          :outcome="game.outcome.value"
          :ai-thinking="game.aiThinking.value"
          :ws-status="game.wsStatus.value"
          :room-code="game.roomCode.value"
          :room-status="game.roomStatus.value"
          :my-room-color="game.myRoomColor.value"
          :notice-banner="game.noticeBanner.value"
          :error-banner="game.errorBanner.value"
          @dismiss-banner="game.clearBanners"
        />

        <ChessBoard
          :cells="game.boardCells.value"
          :flipped="game.flipped.value"
          :selected-square="game.selectedSquare.value"
          :last-move="game.lastMove.value"
          :checked-king-square="game.checkedKingSquare.value"
          :legal-targets-map="game.legalTargetsMap.value"
          :can-interact="game.canInteract.value"
          :active-user-color="game.activeUserColor.value"
          :pending-promotion="game.pendingPromotion.value"
          @square-click="game.handleSquareClick"
          @piece-drop="game.handlePieceDrop"
          @confirm-promotion="game.confirmPromotion"
          @cancel-promotion="game.cancelPromotion"
        />
      </section>

      <SidebarPanel
        :game-mode="game.gameMode.value"
        :difficulty="game.difficulty.value"
        :player-side="game.playerSide.value"
        :static-eval-cp="game.staticEvalCp.value"
        :last-ai-stats="game.lastAiStats.value"
        :room-code="game.roomCode.value"
        :room-status="game.roomStatus.value"
        :my-room-color="game.myRoomColor.value"
        :room-players="game.roomPlayers.value"
        :rematch-requested-by="game.rematchRequestedBy.value"
        :invite-url="game.inviteUrl.value"
        :outcome="game.outcome.value"
        :captured-summary="game.capturedSummary.value"
        :move-pairs="game.movePairs.value"
        :pgn="game.pgn.value"
        :can-undo="game.history.value.length > 0 && !game.aiThinking.value"
        @switch-mode="game.switchMode"
        @set-difficulty="game.setDifficulty"
        @new-ai-game="game.startNewAiGame"
        @undo-ai="game.undoAiMove"
        @flip-board="game.toggleBoardFlip"
        @create-room="game.createPrivateRoom"
        @join-room="game.joinPrivateRoom"
        @resign-room="game.resignRoomGame"
        @request-rematch="game.requestRematch"
        @leave-room="game.leavePrivateRoom"
      />
    </main>
  </div>
</template>
