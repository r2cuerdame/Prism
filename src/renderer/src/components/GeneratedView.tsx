import { useRef, type ReactElement } from 'react';
import {
  DndContext,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent
} from '@dnd-kit/core';
import { SortableContext, rectSortingStrategy } from '@dnd-kit/sortable';
import type { SessionState } from '@shared/domain/session';
import type { SessionCommand } from '@shared/domain/commands';
import BlockChrome from './BlockChrome';
import { BLOCK_REGISTRY } from './blocks/registry';

interface GeneratedViewProps {
  state: SessionState;
  dispatch: (cmd: SessionCommand) => void;
  onOpenOriginal: (url: string) => void;
  onInspect: (blockId: string) => void;
  onRegenerateBlock: (blockId: string) => void;
}

/**
 * The Generated View: one coherent scrollable page projected from validated
 * Session state — GPTBrowser's primary canvas (GOAL.md §2).
 */
export default function GeneratedView(props: GeneratedViewProps): ReactElement | null {
  const { state, dispatch } = props;
  const gridRef = useRef<HTMLDivElement | null>(null);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  const plan = state.plan;
  if (!plan || plan.blocks.length === 0) return null;

  const onDragEnd = (event: DragEndEvent): void => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const toIndex = plan.blocks.findIndex((b) => b.id === over.id);
    if (toIndex < 0) return;
    dispatch({ type: 'move_block', blockId: String(active.id), toIndex });
  };

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
      <SortableContext items={plan.blocks.map((b) => b.id)} strategy={rectSortingStrategy}>
        <div className="gv-grid" ref={gridRef}>
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
              >
                {Component ? (
                  <Component
                    block={block}
                    items={items}
                    dispatch={dispatch}
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
