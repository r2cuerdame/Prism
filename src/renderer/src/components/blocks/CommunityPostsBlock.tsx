import type { ReactElement } from 'react';
import type { BlockRenderProps } from './blockContract';
import { getPostPayload } from '@shared/domain/sourceItem';
import { visibleItemCount } from '@shared/catalog/catalog';
import './contentBlocks.css';

export default function CommunityPostsBlock({
  block,
  items,
  onOpenOriginal,
  onInspect
}: BlockRenderProps): ReactElement {
  const p = block.props;
  const showMeta = typeof p.showMeta === 'boolean' ? p.showMeta : true;
  const visible = items.slice(0, visibleItemCount(block.componentType, p.maxItems, items.length));

  if (visible.length === 0) {
    return <div className="gv-block-empty">표시할 커뮤니티 글이 없습니다.</div>;
  }

  return (
    <section className="gv-post-list">
      {visible.map((item) => {
        const payload = getPostPayload(item);
        return (
          <div key={item.id} className="gv-post-row">
            <h4 className="gv-post-title">{item.title}</h4>
            <div className="gv-post-meta">
              <button
                type="button"
                className="gv-src-chip"
                onClick={() => onInspect(block.id)}
              >
                {item.sourceName}
              </button>
              {showMeta && payload ? (
                <>
                  <span>{payload.community}</span>
                  {typeof payload.points === 'number' ? <span>▲{payload.points}</span> : null}
                  {typeof payload.commentCount === 'number' ? (
                    <span>댓글 {payload.commentCount}</span>
                  ) : null}
                </>
              ) : null}
              <button
                type="button"
                className="gv-open-original"
                onClick={(e) => {
                  e.stopPropagation();
                  onOpenOriginal(payload?.commentsUrl ?? item.originalUrl);
                }}
              >
                댓글
              </button>
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
          </div>
        );
      })}
    </section>
  );
}
