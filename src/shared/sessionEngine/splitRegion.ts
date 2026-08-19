import { getCatalogEntry } from '@shared/catalog/catalog';
import type { ComponentBlock, LayoutPlan } from '@shared/domain/layoutPlan';

export type SplitSide = 'left' | 'right' | 'top' | 'bottom';

function clampSpan(block: ComponentBlock, span: number): number {
  const entry = getCatalogEntry(block.componentType);
  const min = entry?.minSpan ?? 1;
  const max = entry?.maxSpan ?? 12;
  return Math.min(max, Math.max(min, Math.round(span)));
}

function minSpanOf(block: ComponentBlock): number {
  return getCatalogEntry(block.componentType)?.minSpan ?? 1;
}

/**
 * Dragging a block onto a region splits that region rather than reordering a
 * list: left/right share the row, top/bottom stack into two bands.
 *
 * Returns null when the move is impossible, so callers can no-op while keeping
 * the previous state's identity (the history layer keys on identity).
 */
export function splitRegion(
  plan: LayoutPlan,
  movedBlockId: string,
  targetBlockId: string,
  side: SplitSide
): ComponentBlock[] | null {
  if (movedBlockId === targetBlockId) return null;
  const blocks = plan.blocks;
  const movedIndex = blocks.findIndex((b) => b.id === movedBlockId);
  const targetIndex = blocks.findIndex((b) => b.id === targetBlockId);
  if (movedIndex < 0 || targetIndex < 0) return null;

  const moved = blocks[movedIndex]!;
  const target = blocks[targetIndex]!;
  const horizontal = side === 'left' || side === 'right';

  let nextTarget = target;
  let nextMovedSpan: number;

  if (horizontal) {
    const half = Math.floor(target.layout.span / 2);
    // A target that cannot give up half its width keeps its size; the drop then
    // degrades to a plain reposition instead of producing an unreadable sliver.
    if (half < minSpanOf(target) || half < minSpanOf(moved)) {
      nextMovedSpan = clampSpan(moved, moved.layout.span);
    } else {
      nextTarget = { ...target, layout: { ...target.layout, span: clampSpan(target, half) } };
      nextMovedSpan = clampSpan(moved, target.layout.span - half);
    }
  } else {
    nextMovedSpan = clampSpan(moved, target.layout.span);
  }

  const nextMoved: ComponentBlock = {
    ...moved,
    layout: { ...moved.layout, span: nextMovedSpan }
  };

  const rest = blocks.filter((b) => b.id !== movedBlockId).map((b) => (b.id === target.id ? nextTarget : b));
  const restTargetIndex = rest.findIndex((b) => b.id === targetBlockId);
  const insertAt = side === 'left' || side === 'top' ? restTargetIndex : restTargetIndex + 1;

  const next = rest.slice();
  next.splice(insertAt, 0, nextMoved);

  // Nothing actually changed (same order, same spans) — let the caller no-op.
  const sameOrder =
    next.length === blocks.length && next.every((b, i) => b.id === blocks[i]!.id);
  const sameSpans = next.every((b, i) => b.layout.span === blocks[i]?.layout.span);
  if (sameOrder && sameSpans) return null;

  return next;
}
