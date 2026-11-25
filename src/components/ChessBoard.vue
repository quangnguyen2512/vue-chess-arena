<script setup lang="ts">
import { ref } from 'vue'
import type { Square } from 'chess.js'
import type { PlayerColor, PromotionPiece } from '../../shared/protocol'
import type { BoardCell, PendingPromotion } from '../composables/useChessGame'
import { getPieceSvgMarkup, PIECE_NAMES } from '../engine/pieces'
import PromotionModal from './PromotionModal.vue'

const props = defineProps<{
  cells: BoardCell[]
  flipped: boolean
  selectedSquare: Square | null
  lastMove: { from: string; to: string } | null
  checkedKingSquare: Square | null
  legalTargetsMap: Record<string, { capture: boolean; promotion: boolean }>
  canInteract: boolean
  activeUserColor: PlayerColor | null
  pendingPromotion: PendingPromotion | null
}>()

const emit = defineEmits<{
  (e: 'square-click', square: Square): void
  (e: 'piece-drop', from: Square, to: Square): void
  (e: 'confirm-promotion', piece: PromotionPiece): void
  (e: 'cancel-promotion'): void
}>()

const draggedFrom = ref<Square | null>(null)
const dragOverSquare = ref<Square | null>(null)

function isDraggable(cell: BoardCell): boolean {
  return (
    props.canInteract &&
    cell.piece !== null &&
    cell.piece.color === props.activeUserColor
  )
}

function onDragStart(event: DragEvent, cell: BoardCell): void {
  if (!isDraggable(cell)) {
    event.preventDefault()
    return
  }
  draggedFrom.value = cell.square
  event.dataTransfer?.setData('text/plain', cell.square)
  if (props.selectedSquare !== cell.square) {
    emit('square-click', cell.square)
  }
}

function onDragOver(event: DragEvent, square: Square): void {
  if (!draggedFrom.value) {
    return
  }
  event.preventDefault()
  dragOverSquare.value = square
}

function onDrop(event: DragEvent, targetSquare: Square): void {
  event.preventDefault()
  const origin = draggedFrom.value ?? (event.dataTransfer?.getData('text/plain') as Square | undefined)
  draggedFrom.value = null
  dragOverSquare.value = null
  if (origin && origin !== targetSquare) {
    emit('piece-drop', origin, targetSquare)
  }
}

function onDragEnd(): void {
  draggedFrom.value = null
  dragOverSquare.value = null
}

function showRankCoord(cell: BoardCell): boolean {
  return props.flipped ? cell.col === 7 : cell.col === 0
}

function showFileCoord(cell: BoardCell): boolean {
  return props.flipped ? cell.row === 0 : cell.row === 7
}

function getSquareClasses(cell: BoardCell) {
  const isSelected = props.selectedSquare === cell.square
  const isLastMove =
    props.lastMove?.from === cell.square || props.lastMove?.to === cell.square
  const isCheck = props.checkedKingSquare === cell.square
  const legal = props.legalTargetsMap[cell.square]
  const isDragOver = dragOverSquare.value === cell.square

  return {
    'sq-light': cell.isLight,
    'sq-dark': !cell.isLight,
    'sq-selected': isSelected,
    'sq-last-move': isLastMove,
    'sq-in-check': isCheck,
    'sq-legal-target': Boolean(legal),
    'sq-drag-over': isDragOver,
  }
}
</script>

<template>
  <div class="board-shell">
    <div class="chess-board" role="grid" aria-label="Interactive chess board">
      <button
        v-for="cell in cells"
        :key="cell.square"
        type="button"
        class="board-square"
        :class="getSquareClasses(cell)"
        :aria-label="
          cell.piece
            ? `${cell.square} ${cell.piece.color === 'w' ? 'White' : 'Black'} ${PIECE_NAMES[cell.piece.type]}`
            : cell.square
        "
        @click="emit('square-click', cell.square)"
        @dragover="onDragOver($event, cell.square)"
        @drop="onDrop($event, cell.square)"
      >
        <span v-if="showRankCoord(cell)" class="coord coord-rank">
          {{ 8 - cell.row }}
        </span>
        <span v-if="showFileCoord(cell)" class="coord coord-file">
          {{ cell.square[0] }}
        </span>

        <span
          v-if="legalTargetsMap[cell.square]"
          class="legal-marker"
          :class="{
            'legal-capture': legalTargetsMap[cell.square].capture || Boolean(cell.piece),
            'legal-quiet': !legalTargetsMap[cell.square].capture && !cell.piece,
          }"
        />

        <span
          v-if="cell.piece"
          class="piece-wrapper"
          :class="{ 'piece-draggable': isDraggable(cell) }"
          :draggable="isDraggable(cell)"
          @dragstart="onDragStart($event, cell)"
          @dragend="onDragEnd"
          v-html="getPieceSvgMarkup(cell.piece.color, cell.piece.type)"
        />
      </button>

      <PromotionModal
        v-if="pendingPromotion"
        :color="pendingPromotion.color"
        @select="(piece) => emit('confirm-promotion', piece)"
        @cancel="emit('cancel-promotion')"
      />
    </div>
  </div>
</template>
