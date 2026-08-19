import type { ReactElement } from 'react';
import type { BlockRenderProps } from './blockContract';
import type { SourceItem } from '@shared/domain/sourceItem';
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

  const caption = typeof block.props.title === 'string' ? block.props.title : '출처';

  const groups = new Map<string, SourceItem[]>();
  for (const item of items) {
    const list = groups.get(item.sourceName);
    if (list) list.push(item);
    else groups.set(item.sourceName, [item]);
  }

  return (
    <section className="gv-source-list">
      <h3 className="gv-block-title">{caption}</h3>
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
                <button
                  type="button"
                  className="gv-source-item-title"
                  onClick={() => onOpenOriginal(item.originalUrl)}
                >
                  {item.title}
                </button>
                {host ? <span className="gv-source-host">{host}</span> : null}
                {time ? <span className="gv-source-time">{time}</span> : null}
              </div>
            );
          })}
        </div>
      ))}
    </section>
  );
}
