import type { ReactElement } from 'react';
import type { BlockRenderProps } from './blockContract';
import { getPostPayload } from '@shared/domain/sourceItem';
import './contentBlocks.css';

export default function CommunityPostsBlock({
  block,
  items,
  onOpenOriginal,
  onInspect
}: BlockRenderProps): ReactElement {
  const p = block.props;
  const title = typeof p.title === 'string' ? p.title : undefined;
  const showMeta = typeof p.showMeta === 'boolean' ? p.showMeta : true;

  if (items.length === 0) {
    return <div className="gv-block-empty">표시할 커뮤니티 글이 없습니다.</div>;
  }

  return (
    <section className="gv-post-list">
      {title ? <h3 className="gv-block-title">{title}</h3> : null}
      {items.map((item) => {
        const payload = getPostPayload(item);
        return (
          <div key={item.id} className="gv-post-row">
            <button
              type="button"
              className="gv-post-title"
              onClick={() => onOpenOriginal(item.originalUrl)}
            >
              {item.title}
            </button>
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
                onClick={() =>
                  onOpenOriginal(payload?.commentsUrl ?? item.originalUrl)
                }
              >
                댓글
              </button>
              <button
                type="button"
                className="gv-open-original"
                onClick={() => onOpenOriginal(item.originalUrl)}
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
