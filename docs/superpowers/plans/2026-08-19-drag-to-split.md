# Drag-to-split regions

User request (2026-08-19): "세션드래그가 보이는게 아니야 조화롭게 나오다가 뭔가 내가 끌면
그 영역이 쪼개지는거야" — dragging a block should not merely reorder a list. The page
arrives harmoniously composed, and when the user drags a block onto a region, **that
region splits** and the dragged block takes part of it.

## Why this fits the product

GOAL.md treats the Generated View as a surface the user shapes directly, not a document
they scroll. Reordering is the weakest possible form of that. Splitting is the honest
one: the page is a set of regions, and the user's hand decides how they divide.

## Model

Keep the 12-column flow grid (blocks carry `layout.span`), but give drops a *side*:

- Drop on the **left/right half** of a target block → vertical split. The target's span
  is halved (clamped to its catalog `minSpan`), the dragged block is placed immediately
  before/after it with the remaining span, so the two share one row.
- Drop on the **top/bottom third** of a target block → horizontal split. The dragged
  block is inserted before/after the target and takes the target's full span, so the
  region becomes two stacked bands.
- Both operands are clamped to each component's catalog `minSpan`/`maxSpan`. When the
  target cannot shrink below its `minSpan`, fall back to a plain insert (no split).

## Command

`split_region { blockId, targetBlockId, side: 'left' | 'right' | 'top' | 'bottom' }`

Reducer rules (pure, total, no-op on anything invalid):
- both ids must exist in the current plan and differ, else return the SAME state object
  (the history layer keys on identity).
- left/right: `half = clamp(floor(target.span / 2), targetEntry.minSpan, targetEntry.maxSpan)`;
  target keeps `half`; the moved block gets `clamp(target.span - half, movedEntry.minSpan,
  movedEntry.maxSpan)`; the moved block is spliced out and re-inserted before (left) or
  after (right) the target's index.
- top/bottom: the moved block takes `clamp(target.span, movedEntry.minSpan, movedEntry.maxSpan)`
  and is re-inserted before (top) or after (bottom) the target.
- `move_block` stays for keyboard/fallback reordering; `split_region` is what pointer
  drags emit.

## Interaction

`GeneratedView` supplies dnd-kit with `pointerWithin` collision detection and tracks the
pointer offset inside the hovered block's rect to derive the side (edge thirds win over
halves: top/bottom third → horizontal, otherwise left/right half). The hovered block
renders a drop indicator on that side — a 3px accent bar with a soft accent wash — so the
split is visible before it happens. `onDragEnd` dispatches `split_region`.

Preference inference records a `drag` signal for the moved block's component and kinds,
same as `move_block` does today.

## Verification

- reducer unit tests for every side, the clamp fallback, and the identity no-ops
- a live app pass: drag a topic cluster onto the right half of another and confirm the
  row splits into two 6-span cards
