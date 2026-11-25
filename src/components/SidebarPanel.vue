<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import type {
  DifficultyLevel,
  GameOutcome,
  PieceType,
  PlayerColor,
  RoomStatus,
  SerializedMove,
} from '../../shared/protocol'
import type { GameMode } from '../composables/useChessGame'
import type { AIMoveResult } from '../engine/ai'
import { getPieceSvgMarkup } from '../engine/pieces'

const props = defineProps<{
  gameMode: GameMode
  difficulty: DifficultyLevel
  playerSide: PlayerColor
  staticEvalCp: number
  lastAiStats: AIMoveResult | null
  roomCode: string | null
  roomStatus: RoomStatus | null
  myRoomColor: PlayerColor | null
  roomPlayers: { w: boolean; b: boolean }
  rematchRequestedBy: PlayerColor | null
  inviteUrl: string | null
  outcome: GameOutcome | null
  capturedSummary: {
    byWhite: PieceType[]
    byBlack: PieceType[]
    whiteAdvantage: number
    blackAdvantage: number
  }
  movePairs: Array<{ moveNumber: number; white?: SerializedMove; black?: SerializedMove }>
  pgn: string
  canUndo: boolean
}>()

const emit = defineEmits<{
  (e: 'switch-mode', mode: GameMode): void
  (e: 'set-difficulty', level: DifficultyLevel): void
  (e: 'new-ai-game', side?: PlayerColor): void
  (e: 'undo-ai'): void
  (e: 'flip-board'): void
  (e: 'create-room'): void
  (e: 'join-room', code: string): void
  (e: 'resign-room'): void
  (e: 'request-rematch'): void
  (e: 'leave-room'): void
}>()

const joinInput = ref('')
const copiedLink = ref(false)
const copiedPgn = ref(false)
const movesScrollRef = ref<HTMLElement | null>(null)

const difficultyOptions: Array<{ id: DifficultyLevel; label: string; sub: string }> = [
  { id: 'casual', label: 'Casual', sub: 'Depth 1' },
  { id: 'club', label: 'Club', sub: 'Depth 2' },
  { id: 'tactical', label: 'Tactical', sub: 'Depth 3' },
]

const formattedEval = computed(() => {
  const pawns = props.staticEvalCp / 100
  const sign = pawns > 0 ? '+' : ''
  return `${sign}${pawns.toFixed(2)}`
})

const evalBarWhitePercent = computed(() => {
  const clamped = Math.max(-800, Math.min(800, props.staticEvalCp))
  return Math.round(50 + (clamped / 800) * 45)
})

const rematchLabel = computed(() => {
  if (!props.rematchRequestedBy) {
    return 'Request Rematch'
  }
  if (props.rematchRequestedBy === props.myRoomColor) {
    return 'Rematch Requested...'
  }
  return 'Accept Rematch'
})

async function copyInviteLink(): Promise<void> {
  if (!props.inviteUrl) return
  try {
    await navigator.clipboard.writeText(props.inviteUrl)
    copiedLink.value = true
    setTimeout(() => {
      copiedLink.value = false
    }, 1800)
  } catch {
    // Clipboard blocked in non-secure context; select fallback handled cleanly
  }
}

async function copyPgnText(): Promise<void> {
  if (!props.pgn) return
  try {
    await navigator.clipboard.writeText(props.pgn)
    copiedPgn.value = true
    setTimeout(() => {
      copiedPgn.value = false
    }, 1800)
  } catch {
    // Ignore clipboard rejection
  }
}

function submitJoin(): void {
  emit('join-room', joinInput.value)
}

watch(
  () => props.movePairs.length,
  async () => {
    await nextTick()
    if (movesScrollRef.value) {
      movesScrollRef.value.scrollTop = movesScrollRef.value.scrollHeight
    }
  },
)
</script>

<template>
  <aside class="sidebar">
    <!-- Mode Switcher -->
    <div class="panel-card">
      <div class="mode-tabs" role="tablist" aria-label="Game mode">
        <button
          type="button"
          role="tab"
          class="mode-tab"
          :class="{ active: gameMode === 'ai' }"
          :aria-selected="gameMode === 'ai'"
          @click="emit('switch-mode', 'ai')"
        >
          Play vs AI
        </button>
        <button
          type="button"
          role="tab"
          class="mode-tab"
          :class="{ active: gameMode === 'multiplayer' }"
          :aria-selected="gameMode === 'multiplayer'"
          @click="emit('switch-mode', 'multiplayer')"
        >
          Multiplayer Room
        </button>
      </div>

      <!-- AI Controls -->
      <div v-if="gameMode === 'ai'" class="controls-section">
        <div class="field-group">
          <span class="field-label">Engine Strength</span>
          <div class="segmented-3">
            <button
              v-for="opt in difficultyOptions"
              :key="opt.id"
              type="button"
              class="seg-btn"
              :class="{ active: difficulty === opt.id }"
              @click="emit('set-difficulty', opt.id)"
            >
              <span class="seg-title">{{ opt.label }}</span>
              <span class="seg-sub">{{ opt.sub }}</span>
            </button>
          </div>
        </div>

        <div class="field-group">
          <span class="field-label">Play As</span>
          <div class="segmented-2">
            <button
              type="button"
              class="seg-btn"
              :class="{ active: playerSide === 'w' }"
              @click="emit('new-ai-game', 'w')"
            >
              White
            </button>
            <button
              type="button"
              class="seg-btn"
              :class="{ active: playerSide === 'b' }"
              @click="emit('new-ai-game', 'b')"
            >
              Black
            </button>
          </div>
        </div>

        <div class="action-row">
          <button type="button" class="btn-primary" @click="emit('new-ai-game')">
            New Game
          </button>
          <button
            type="button"
            class="btn-secondary"
            :disabled="!canUndo"
            @click="emit('undo-ai')"
          >
            Undo
          </button>
          <button type="button" class="btn-secondary" @click="emit('flip-board')">
            Flip
          </button>
        </div>

        <div class="eval-box">
          <div class="eval-header">
            <span class="field-label">Position Eval</span>
            <span class="eval-number">{{ formattedEval }}</span>
          </div>
          <div class="eval-track">
            <div class="eval-fill" :style="{ width: `${evalBarWhitePercent}%` }" />
          </div>
          <p v-if="lastAiStats" class="telemetry-note">
            Last AI: <strong>{{ lastAiStats.san }}</strong> ·
            D{{ lastAiStats.depth }} ·
            {{ lastAiStats.nodesEvaluated.toLocaleString() }} nodes ·
            {{ lastAiStats.durationMs.toFixed(1) }} ms
          </p>
        </div>
      </div>

      <!-- Multiplayer Controls -->
      <div v-else class="controls-section">
        <template v-if="!roomCode">
          <button type="button" class="btn-primary btn-full" @click="emit('create-room')">
            Create Private Room
          </button>

          <form class="join-form" @submit.prevent="submitJoin">
            <input
              v-model="joinInput"
              type="text"
              maxlength="6"
              placeholder="6-CHAR CODE"
              class="room-input"
              aria-label="Room invite code"
            />
            <button type="submit" class="btn-secondary">Join</button>
          </form>
        </template>

        <template v-else>
          <div class="room-badge-row">
            <div>
              <span class="field-label">Private Room</span>
              <div class="room-code-display">{{ roomCode }}</div>
            </div>
            <div class="room-role-pill">
              You: {{ myRoomColor === 'w' ? 'White' : 'Black' }}
            </div>
          </div>

          <div v-if="inviteUrl" class="invite-box">
            <input
              type="text"
              readonly
              :value="inviteUrl"
              class="invite-url-input"
              aria-label="Shareable room link"
            />
            <button type="button" class="btn-primary" @click="copyInviteLink">
              {{ copiedLink ? 'Copied!' : 'Copy Link' }}
            </button>
          </div>

          <div class="action-row">
            <button
              v-if="roomStatus === 'playing'"
              type="button"
              class="btn-danger"
              @click="emit('resign-room')"
            >
              Resign
            </button>
            <button
              v-if="roomStatus === 'finished' && roomPlayers.w && roomPlayers.b"
              type="button"
              class="btn-primary"
              :disabled="rematchRequestedBy === myRoomColor"
              @click="emit('request-rematch')"
            >
              {{ rematchLabel }}
            </button>
            <button
              v-else-if="roomStatus === 'finished'"
              type="button"
              class="btn-primary"
              @click="emit('create-room')"
            >
              New Room
            </button>
            <button type="button" class="btn-secondary" @click="emit('flip-board')">
              Flip
            </button>
            <button type="button" class="btn-ghost" @click="emit('leave-room')">
              Leave
            </button>
          </div>
        </template>
      </div>
    </div>

    <!-- Captured Pieces -->
    <div class="panel-card">
      <span class="field-label">Captured Material</span>
      <div class="captured-rows">
        <div class="captured-row">
          <span class="captured-side">White</span>
          <div class="captured-icons">
            <span
              v-for="(piece, idx) in capturedSummary.byWhite"
              :key="`w-${piece}-${idx}`"
              class="mini-piece"
              v-html="getPieceSvgMarkup('b', piece)"
            />
            <span v-if="capturedSummary.byWhite.length === 0" class="muted-dash">—</span>
          </div>
          <span v-if="capturedSummary.whiteAdvantage > 0" class="adv-chip">
            +{{ capturedSummary.whiteAdvantage }}
          </span>
        </div>

        <div class="captured-row">
          <span class="captured-side">Black</span>
          <div class="captured-icons">
            <span
              v-for="(piece, idx) in capturedSummary.byBlack"
              :key="`b-${piece}-${idx}`"
              class="mini-piece"
              v-html="getPieceSvgMarkup('w', piece)"
            />
            <span v-if="capturedSummary.byBlack.length === 0" class="muted-dash">—</span>
          </div>
          <span v-if="capturedSummary.blackAdvantage > 0" class="adv-chip">
            +{{ capturedSummary.blackAdvantage }}
          </span>
        </div>
      </div>
    </div>

    <!-- Move History (PGN) -->
    <div class="panel-card moves-card">
      <div class="moves-header">
        <span class="field-label">Move History (PGN)</span>
        <button
          type="button"
          class="btn-mini"
          :disabled="!pgn"
          @click="copyPgnText"
        >
          {{ copiedPgn ? 'Copied' : 'Copy PGN' }}
        </button>
      </div>

      <div ref="movesScrollRef" class="moves-list">
        <p v-if="movePairs.length === 0" class="moves-empty">
          No moves yet. Select a piece to begin.
        </p>
        <div
          v-for="pair in movePairs"
          :key="pair.moveNumber"
          class="move-row"
        >
          <span class="move-num">{{ pair.moveNumber }}.</span>
          <span class="move-san">{{ pair.white?.san ?? '' }}</span>
          <span class="move-san">{{ pair.black?.san ?? '' }}</span>
        </div>
      </div>
    </div>
  </aside>
</template>
