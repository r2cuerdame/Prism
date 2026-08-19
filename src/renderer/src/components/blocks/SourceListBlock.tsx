import type { ReactElement } from 'react';
import type { BlockRenderProps } from './blockContract';
import type { SourceItem } from '@shared/domain/sourceItem';
import { visibleItemCount } from '@shared/catalog/catalog';
import './contentBlocks.css';

function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}

function formatTime(iso: string): string | null {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' });
}

export default function SourceListBlock({
  block,
  items,
  onOpenOriginal,
  onInspect
}: BlockRenderProps): ReactElement | null {
  if (items.length === 0) return null;

  const visible = items.slice(
    0,
    visibleItemCount(block.componentType, block.props.maxItems, items.length)
  );

  const groups = new Map<string, SourceItem[]>();
  for (const item of visible) {
    const list = groups.get(item.sourceName);
    if (list) list.push(item);
    else groups.set(item.sourceName, [item]);
  }

  return (
    <section className="gv-source-list">
      {[...groups.entries()].map(([sourceName, groupItems]) => (
        <div key={sourceName} className="gv-source-group">
          <div className="gv-source-group-header">
            <span>{sourceName}</span>
            <span className="gv-source-count">{groupItems.length}건</span>
            <button
              type="button"
              className="gv-source-inspect"
              onClick={() => onInspect(block.id)}
            >
              자세히
            </button>
          </div>
          {groupItems.map((item) => {
            const host = hostOf(item.originalUrl);
            const time = formatTime(item.retrievedAt);
            return (
              <div key={item.id} className="gv-source-row">
                <span className="gv-source-item-title">{item.title}</span>
                {host ? <span className="gv-source-host">{host}</span> : null}
                {time ? <span className="gv-source-time">{time}</span> : null}
                {/* This list is the evidence, so every row keeps a way out. */}
                <button
                  type="button"
                  className="gv-open-original"
                  onClick={(e) => {
                    e.stopPropagation();
                    onOpenOriginal(item.originalUrl);
                  }}
                >
                  원본
                </button>
              </div>
            );
          })}
        </div>
      ))}
    </section>
  );
}
