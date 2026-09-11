import type { ReactElement } from 'react';
import type { BlockRenderProps } from './blockContract';
import { getArticlePayload } from '@shared/domain/sourceItem';
import './contentBlocks.css';

function formatDate(iso: string | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString('ko-KR');
}

export default function ArticleListBlock({
  block,
  items,
  onOpenOriginal,
  onInspect,
  dispatch
}: BlockRenderProps): ReactElement {
  const p = block.props;
  const density = p.density === 'compact' ? 'compact' : 'comfortable';
  const maxItems =
    typeof p.maxItems === 'number' && Number.isFinite(p.maxItems)
      ? Math.max(1, Math.floor(p.maxItems))
      : 6;

  const visible = items.slice(0, maxItems);

  if (visible.length === 0) {
    return <div className="gv-block-empty">표시할 기사가 없습니다.</div>;
  }

  return (
    <section className={`gv-article-list gv-article-list--${density}`}>
      {visible.map((item) => {
        const payload = getArticlePayload(item);
        const date = formatDate(item.publishedAt);
        const thumb = item.media?.thumbnailUrl;
        return (
          <article
            key={item.id}
            className="gv-article-row"
            onContextMenu={(e) => {
              e.preventDefault();
              dispatch?.({ type: 'remove_item', itemId: item.id });
            }}
          >
            {thumb ? (
              <img
                className="gv-article-thumb"
                src={thumb}
                alt=""
                loading="lazy"
                onError={(e) => {
                  e.currentTarget.style.display = 'none';
                }}
              />
            ) : null}
            <div className="gv-article-body">
              <h4 className="gv-article-title">{item.title}</h4>
              {density === 'comfortable' && (item.summary ?? payload?.excerpt) ? (
                <p className="gv-article-summary">{item.summary ?? payload?.excerpt}</p>
              ) : null}
              <div className="gv-article-meta">
                <button
                  type="button"
                  className="gv-src-chip"
                  onClick={() => onInspect(block.id)}
                >
                  {item.sourceName}
                </button>
                {date ? <span>{date}</span> : null}
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
                <button
                  type="button"
                  className="gv-article-remove"
                  title="이 항목 거부 (다시 보지 않기)"
                  aria-label="이 항목 거부"
                  onClick={(e) => {
                    e.stopPropagation();
                    dispatch?.({ type: 'remove_item', itemId: item.id });
                  }}
                >
                  ✕
                </button>
              </div>
            </div>
          </article>
        );
      })}
    </section>
  );
}
