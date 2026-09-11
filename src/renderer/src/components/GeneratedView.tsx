import { useCallback, useRef, useState, type ReactElement } from 'react';
import {
  DndContext,
  PointerSensor,
  pointerWithin,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragMoveEvent,
  type DragStartEvent
} from '@dnd-kit/core';
import { SortableContext, type SortingStrategy } from '@dnd-kit/sortable';
import type { SessionState } from '@shared/domain/session';
import type { SessionCommand } from '@shared/domain/commands';
import type { SplitSide } from '@shared/sessionEngine/splitRegion';
import BlockChrome from './BlockChrome';
import { BLOCK_REGISTRY } from './blocks/registry';

interface GeneratedViewProps {
  state: SessionState;
  dispatch: (cmd: SessionCommand) => void;
  onOpenOriginal: (url: string) => void;
  onInspect: (blockId: string) => void;
  onRegenerateBlock: (blockId: string) => void;
  onRejectItem?: (itemId: string) => void;
}

interface DropTarget {
  blockId: string;
  side: SplitSide;
}

/**
 * Blocks hold still while dragging: a sorting shuffle would promise a reorder,
 * but the drop splits a region. The edge indicator is the only preview.
 */
const noShuffle: SortingStrategy = () => null;

/**
 * Which edge of a block the pointer is over. The top/bottom bands win over the
 * left/right halves, so a drop near a corner reads as stacking rather than as
 * an accidental side-by-side split.
 */
function sideFromPointer(rect: DOMRect, x: number, y: number): SplitSide {
  const band = Math.min(rect.height / 3, 90);
  if (y - rect.top < band) return 'top';
  if (rect.bottom - y < band) return 'bottom';
  return x - rect.left < rect.width / 2 ? 'left' : 'right';
}

/**
 * The Generated View: one coherent scrollable page projected from validated
 * Session state — Prism's primary canvas (GOAL.md §2). Dragging a block
 * onto another splits that region instead of merely reordering a list.
 */
export default function GeneratedView(props: GeneratedViewProps): ReactElement | null {
  const { state, dispatch } = props;
  const gridRef = useRef<HTMLDivElement | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<DropTarget | null>(null);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  const onDragStart = useCallback((event: DragStartEvent) => {
    setDragging(String(event.active.id));
    setDropTarget(null);
  }, []);

  const onDragMove = useCallback((event: DragMoveEvent) => {
    const over = event.over;
    const activeId = String(event.active.id);
    if (!over || String(over.id) === activeId) {
      setDropTarget(null);
      return;
    }
    // Aim with the pointer, not the dragged block's centre: on a wide block the
    // two are far apart and the highlighted edge would not match the hand.
    const activator = event.activatorEvent as { clientX?: number; clientY?: number } | null;
    if (!activator || activator.clientX === undefined || activator.clientY === undefined) {
      return;
    }
    const x = activator.clientX + event.delta.x;
    const y = activator.clientY + event.delta.y;
    const rect = over.rect;
    const domRect = new DOMRect(rect.left, rect.top, rect.width, rect.height);
    setDropTarget({ blockId: String(over.id), side: sideFromPointer(domRect, x, y) });
  }, []);

  const onDragEnd = useCallback(
    (event: DragEndEvent) => {
      const activeId = String(event.active.id);
      const target = dropTarget;
      setDragging(null);
      setDropTarget(null);
      if (!target || target.blockId === activeId) return;
      dispatch({
        type: 'split_region',
        blockId: activeId,
        targetBlockId: target.blockId,
        side: target.side
      });
    },
    [dispatch, dropTarget]
  );

  const onDragCancel = useCallback(() => {
    setDragging(null);
    setDropTarget(null);
  }, []);

  const plan = state.plan;
  if (!plan || plan.blocks.length === 0) return null;

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={pointerWithin}
      onDragStart={onDragStart}
      onDragMove={onDragMove}
      onDragEnd={onDragEnd}
      onDragCancel={onDragCancel}
    >
      <SortableContext items={plan.blocks.map((b) => b.id)} strategy={noShuffle}>
        <div className={`gv-grid${dragging ? ' gv-grid--dragging' : ''}`} ref={gridRef}>
          {plan.blocks.map((block) => {
            const Component = BLOCK_REGISTRY[block.componentType];
            const items = block.sourceItemRefs
              .map((id) => state.items[id])
              .filter((i): i is NonNullable<typeof i> => Boolean(i));
            return (
              <BlockChrome
                key={block.id}
                block={block}
                gridEl={() => gridRef.current}
                dispatch={dispatch}
                onInspect={props.onInspect}
                onRegenerateBlock={props.onRegenerateBlock}
                dropSide={dropTarget?.blockId === block.id ? dropTarget.side : null}
              >
                {Component ? (
                  <Component
                    block={block}
                    items={items}
                    dispatch={dispatch}
                    onRejectItem={props.onRejectItem}
                    onOpenOriginal={props.onOpenOriginal}
                    onInspect={props.onInspect}
                  />
                ) : (
                  <div className="gv-block-empty">지원하지 않는 컴포넌트예요</div>
                )}
              </BlockChrome>
            );
          })}
        </div>
      </SortableContext>
    </DndContext>
  );
}
