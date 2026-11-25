<script setup lang="ts">
import { computed } from 'vue'
import type { GameOutcome, PlayerColor, RoomStatus } from '../../shared/protocol'
import type { ConnectionStatus, GameMode } from '../composables/useChessGame'

const props = defineProps<{
  gameMode: GameMode
  turn: PlayerColor
  inCheck: boolean
  outcome: GameOutcome | null
  aiThinking: boolean
  wsStatus: ConnectionStatus
  roomCode: string | null
  roomStatus: RoomStatus | null
  myRoomColor: PlayerColor | null
  noticeBanner: string | null
  errorBanner: string | null
}>()

const headline = computed(() => {
  if (props.outcome) {
    return props.outcome.message
  }
  if (props.gameMode === 'multiplayer') {
    if (!props.roomCode) {
      return 'Create a private room or enter an invite code to play live.'
    }
    if (props.roomStatus === 'waiting') {
      return `Room ${props.roomCode} waiting for opponent to join...`
    }
    const isMyTurn = props.myRoomColor === props.turn
    const checkSuffix = props.inCheck ? ' (Check!)' : ''
    return isMyTurn
      ? `Your turn (${props.turn === 'w' ? 'White' : 'Black'})${checkSuffix}`
      : `Opponent's turn (${props.turn === 'w' ? 'White' : 'Black'})${checkSuffix}`
  }

  if (props.aiThinking) {
    return 'AI Engine is calculating...'
  }
  const sideLabel = props.turn === 'w' ? 'White' : 'Black'
  return props.inCheck ? `${sideLabel} to move — Check!` : `${sideLabel} to move`
})

const toneClass = computed(() => {
  if (props.outcome) return 'banner-finish'
  if (props.inCheck) return 'banner-check'
  if (props.aiThinking) return 'banner-thinking'
  return 'banner-active'
})
</script>

<template>
  <div class="status-stack">
    <div class="status-banner" :class="toneClass">
      <div class="status-left">
        <span
          class="turn-dot"
          :class="{
            'dot-white': turn === 'w',
            'dot-black': turn === 'b',
            'dot-pulse': aiThinking || inCheck,
          }"
        />
        <span class="status-text">{{ headline }}</span>
      </div>

      <span
        v-if="gameMode === 'multiplayer'"
        class="ws-pill"
        :class="`ws-${wsStatus}`"
      >
        {{ wsStatus === 'connected' ? 'Live WS' : wsStatus }}
      </span>
    </div>

    <div v-if="errorBanner" class="alert-strip alert-error" role="alert">
      {{ errorBanner }}
    </div>
    <div v-else-if="noticeBanner" class="alert-strip alert-notice" role="status">
      {{ noticeBanner }}
    </div>
  </div>
</template>
