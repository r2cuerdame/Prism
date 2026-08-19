import { useRef, useState, type ReactElement, type ReactNode } from 'react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { ComponentBlock } from '@shared/domain/layoutPlan';
import type { SessionCommand } from '@shared/domain/commands';
import { getCatalogEntry } from '@shared/catalog/catalog';
import type { SplitSide } from '@shared/sessionEngine/splitRegion';
import { appStore } from '@renderer/state/appStore';
import '@renderer/styles/dragSplit.css';

interface BlockChromeProps {
  block: ComponentBlock;
  gridEl: () => HTMLElement | null;
  dispatch: (cmd: SessionCommand) => void;
  onInspect: (blockId: string) => void;
  onRegenerateBlock: (blockId: string) => void;
  /** Edge this block is about to be split on, while a drag hovers it. */
  dropSide?: SplitSide | null;
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
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState('');
  const cancelTitle = useRef(false);
  const [tuneOpen, setTuneOpen] = useState(false);
  const [tuneText, setTuneText] = useState('');

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

  const startTitleEdit = (): void => {
    cancelTitle.current = false;
    setTitleDraft(title);
    setEditingTitle(true);
  };

  /** Empty commit is legal: it means "go back to the default section name". */
  const commitTitle = (): void => {
    setEditingTitle(false);
    if (cancelTitle.current) {
      cancelTitle.current = false;
      return;
    }
    const next = titleDraft.trim();
    const current = typeof block.props.title === 'string' ? block.props.title : '';
    if (next === current) return;
    dispatch({ type: 'set_block_props', blockId: block.id, props: { title: next } });
  };

  const applyTune = (): void => {
    const value = tuneText.trim();
    setTuneText('');
    setTuneOpen(false);
    if (value === '') return;
    void appStore.tuneBlock(block.id, value);
  };

  return (
    <div
      ref={setNodeRef}
      className={`gv-block${isDragging ? ' gv-block--dragging' : ''}${block.docked ? ' gv-block--docked' : ''}${tuneOpen ? ' gv-block--tuning' : ''}${props.dropSide ? ' gv-block--drop' : ''}`}
      style={{
        gridColumn: `span ${span}`,
        transform: CSS.Transform.toString(transform),
        transition
      }}
    >
      {props.dropSide && (
        <>
          <div className={`gv-drop-wash gv-drop-wash--${props.dropSide}`} />
          <div className={`gv-drop-hint gv-drop-hint--${props.dropSide}`} />
        </>
      )}
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
        {editingTitle ? (
          <input
            className="gv-title-input"
            aria-label="섹션 제목"
            autoFocus
            value={titleDraft}
            onChange={(e) => setTitleDraft(e.target.value)}
            onBlur={commitTitle}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
                e.preventDefault();
                commitTitle();
              } else if (e.key === 'Escape') {
                e.preventDefault();
                cancelTitle.current = true;
                setEditingTitle(false);
              }
            }}
          />
        ) : (
          <button
            className="gv-block-title"
            title="클릭해서 섹션 제목을 고쳐요"
            aria-label={`섹션 제목 "${title}" 수정`}
            onClick={startTitleEdit}
          >
            {title}
          </button>
        )}
        {block.docked && <span className="gv-badge">고정됨</span>}
        {block.locked && <span className="gv-badge">잠김</span>}
        <span className="gv-block-tools">
          <button
            title="이 섹션을 말로 조정해요"
            aria-label="섹션 튜닝"
            className={tuneOpen ? 'gv-tool--active' : ''}
            onClick={() => setTuneOpen((v) => !v)}
          >
            ✎
          </button>
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
      {tuneOpen && (
        <div className="gv-block-tune">
          <input
            autoFocus
            aria-label="이 섹션 튜닝"
            value={tuneText}
            placeholder="이 섹션을 어떻게 바꿀까요? 예: 더 짧게 · 크게 · 고정"
            onChange={(e) => setTuneText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
                e.preventDefault();
                applyTune();
              } else if (e.key === 'Escape') {
                e.preventDefault();
                setTuneOpen(false);
              }
            }}
          />
          <button className="gv-block-tune-apply" aria-label="섹션 튜닝 적용" onClick={applyTune}>
            적용
          </button>
        </div>
      )}
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
