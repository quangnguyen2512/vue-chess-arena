<script setup lang="ts">
import type { PlayerColor, PromotionPiece } from '../../shared/protocol'
import { getPieceSvgMarkup, PIECE_NAMES } from '../engine/pieces'

defineProps<{
  color: PlayerColor
}>()

const emit = defineEmits<{
  (e: 'select', piece: PromotionPiece): void
  (e: 'cancel'): void
}>()

const options: PromotionPiece[] = ['q', 'r', 'b', 'n']
</script>

<template>
  <div class="promotion-backdrop" role="dialog" aria-modal="true" aria-label="Promote pawn">
    <div class="promotion-card">
      <p class="promotion-title">Promote Pawn</p>
      <div class="promotion-grid">
        <button
          v-for="piece in options"
          :key="piece"
          type="button"
          class="promotion-btn"
          :aria-label="`Promote to ${PIECE_NAMES[piece]}`"
          @click="emit('select', piece)"
        >
          <span class="promotion-piece" v-html="getPieceSvgMarkup(color, piece)" />
          <span class="promotion-label">{{ PIECE_NAMES[piece] }}</span>
        </button>
      </div>
      <button type="button" class="btn-ghost promotion-cancel" @click="emit('cancel')">
        Cancel
      </button>
    </div>
  </div>
</template>
