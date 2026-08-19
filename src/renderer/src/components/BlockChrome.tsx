import { useRef, useState, type ReactElement, type ReactNode } from 'react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { ComponentBlock } from '@shared/domain/layoutPlan';
import type { SessionCommand } from '@shared/domain/commands';
import { getCatalogEntry } from '@shared/catalog/catalog';

interface BlockChromeProps {
  block: ComponentBlock;
  gridEl: () => HTMLElement | null;
  dispatch: (cmd: SessionCommand) => void;
  onInspect: (blockId: string) => void;
  onRegenerateBlock: (blockId: string) => void;
  children: ReactNode;
}

/**
 * The physical frame of every generated block: drag, resize, dock, remove.
 * All edits go through the same SessionCommand bus as language edits.
 */
export default function BlockChrome(props: BlockChromeProps): ReactElement {
  const { block, dispatch } = props;
  const entry = getCatalogEntry(block.componentType);
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: block.id
  });
  const [previewSpan, setPreviewSpan] = useState<number | null>(null);
  const resizeState = useRef<{ startX: number; startSpan: number; colWidth: number } | null>(null);

  const span = previewSpan ?? block.layout.span;
  const minSpan = entry?.minSpan ?? 1;
  const maxSpan = entry?.maxSpan ?? 12;

  const onResizeStart = (e: React.PointerEvent): void => {
    e.preventDefault();
    e.stopPropagation();
    const grid = props.gridEl();
    const width = grid ? grid.getBoundingClientRect().width : 1200;
    resizeState.current = { startX: e.clientX, startSpan: block.layout.span, colWidth: width / 12 };
    const move = (ev: PointerEvent): void => {
      const st = resizeState.current;
      if (!st) return;
      const delta = Math.round((ev.clientX - st.startX) / st.colWidth);
      const next = Math.min(maxSpan, Math.max(minSpan, st.startSpan + delta));
      setPreviewSpan(next);
    };
    const up = (ev: PointerEvent): void => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      const st = resizeState.current;
      resizeState.current = null;
      setPreviewSpan(null);
      if (!st) return;
      const delta = Math.round((ev.clientX - st.startX) / st.colWidth);
      const next = Math.min(maxSpan, Math.max(minSpan, st.startSpan + delta));
      if (next !== block.layout.span) {
        dispatch({ type: 'resize_block', blockId: block.id, span: next });
      }
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const title =
    typeof block.props.title === 'string' && block.props.title.trim() !== ''
      ? block.props.title
      : (entry?.title ?? block.componentType);

  const isPrimitive = entry !== undefined && entry.minItems === 0 && entry.maxItems === 0;

  return (
    <div
      ref={setNodeRef}
      className={`gv-block${isDragging ? ' gv-block--dragging' : ''}${block.docked ? ' gv-block--docked' : ''}`}
      style={{
        gridColumn: `span ${span}`,
        transform: CSS.Transform.toString(transform),
        transition
      }}
    >
      <header className="gv-block-head">
        <button
          className="gv-drag"
          title="드래그하여 이동"
          aria-label="블록 이동"
          {...attributes}
          {...listeners}
        >
          ⠿
        </button>
        <span className="gv-block-title">{title}</span>
        {block.docked && <span className="gv-badge">고정됨</span>}
        {block.locked && <span className="gv-badge">잠김</span>}
        <span className="gv-block-tools">
          {!isPrimitive && (
            <button
              title="이 블록의 출처와 근거 보기"
              aria-label="출처 보기"
              onClick={() => props.onInspect(block.id)}
            >
              ⓘ
            </button>
          )}
          {!isPrimitive && (
            <button
              title="이 블록만 재생성"
              aria-label="블록 재생성"
              onClick={() => props.onRegenerateBlock(block.id)}
            >
              ↻
            </button>
          )}
          <button
            title={block.docked ? '고정 해제 (재생성 시 교체될 수 있음)' : '고정 (재생성해도 유지)'}
            aria-label="블록 고정"
            className={block.docked ? 'gv-tool--active' : ''}
            onClick={() => dispatch({ type: 'dock_block', blockId: block.id, docked: !block.docked })}
          >
            📌
          </button>
          <button
            title="블록 제거"
            aria-label="블록 제거"
            onClick={() => dispatch({ type: 'remove_block', blockId: block.id, reason: 'chrome' })}
          >
            ✕
          </button>
        </span>
      </header>
      <div className="gv-block-body">{props.children}</div>
      <div
        className="gv-resize"
        title="드래그하여 너비 조절"
        onPointerDown={onResizeStart}
        role="separator"
        aria-label="블록 너비 조절"
      />
    </div>
  );
}
