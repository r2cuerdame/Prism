import type { ReactElement } from 'react';
import type { BlockRenderProps } from './blockContract';
import { visibleItemCount } from '@shared/catalog/catalog';
import './videoBlocks.css';

export default function HeadlineStripBlock({
  block,
  items,
  onOpenOriginal,
  onInspect
}: BlockRenderProps): ReactElement | null {
  const headlines = items.filter((i) => i.kind === 'headline' || i.kind === 'article');
  if (headlines.length < 3) return null;

  const visible = headlines.slice(
    0,
    visibleItemCount(block.componentType, block.props.maxItems, headlines.length)
  );

  return (
    <div className="gv-headline-strip">
      <div className="gv-headline-scroll">
        {visible.map((item) => (
          <div key={item.id} className="gv-headline-card">
            <div className="gv-item-chips">
              <button
                type="button"
                className="gv-src-chip"
                onClick={() => onInspect(block.id)}
              >
                {item.sourceName}
              </button>
              <button
                type="button"
                className="gv-original-btn"
                onClick={(e) => {
                  e.stopPropagation();
                  onOpenOriginal(item.originalUrl);
                }}
              >
                원본
              </button>
            </div>
            <div className="gv-headline-title">{item.title}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
