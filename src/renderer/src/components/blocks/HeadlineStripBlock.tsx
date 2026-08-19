import type { ReactElement } from 'react';
import type { BlockRenderProps } from './blockContract';
import './videoBlocks.css';

export default function HeadlineStripBlock({
  block,
  items,
  onOpenOriginal,
  onInspect
}: BlockRenderProps): ReactElement | null {
  const headlines = items.filter((i) => i.kind === 'headline' || i.kind === 'article');
  if (headlines.length < 3) return null;

  const title = typeof block.props.title === 'string' ? block.props.title : null;

  return (
    <div className="gv-headline-strip">
      {title ? <div className="gv-block-caption">{title}</div> : null}
      <div className="gv-headline-scroll">
        {headlines.map((item) => (
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
                onClick={() => onOpenOriginal(item.originalUrl)}
              >
                원본
              </button>
            </div>
            <button
              type="button"
              className="gv-headline-title"
              onClick={() => onOpenOriginal(item.originalUrl)}
            >
              {item.title}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
