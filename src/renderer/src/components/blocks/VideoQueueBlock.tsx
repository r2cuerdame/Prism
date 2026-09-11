import type { ReactElement } from 'react';
import type { BlockRenderProps } from './blockContract';
import { getVideoPayload } from '@shared/domain/sourceItem';
import { visibleItemCount } from '@shared/catalog/catalog';
import './videoBlocks.css';

export default function VideoQueueBlock({
  block,
  items,
  dispatch,
  onRejectItem,
  onOpenOriginal,
  onInspect
}: BlockRenderProps): ReactElement | null {
  const videos = items.filter((i) => i.kind === 'video');
  if (videos.length === 0) return null;

  const visible = videos.slice(
    0,
    visibleItemCount(block.componentType, block.props.maxItems, videos.length)
  );

  // The player is a SEPARATE block, so which video is playing is not knowable
  // from here — show a '재생' affordance instead of a faked active state.
  return (
    <div className="gv-video-queue">
      <ul className="gv-video-queue-list">
        {visible.map((item) => {
          const channel = getVideoPayload(item)?.channel;
          return (
            <li
              key={item.id}
              className="gv-video-queue-row"
              onContextMenu={(event) => {
                event.preventDefault();
                onRejectItem ? onRejectItem(item.id) : dispatch({ type: 'remove_item', itemId: item.id });
              }}
            >
              <button
                type="button"
                className="gv-video-queue-main"
                aria-label={`${item.title} 재생`}
                onClick={() => dispatch({ type: 'play_item', itemId: item.id })}
              >
                {item.media?.thumbnailUrl ? (
                  <img
                    src={item.media.thumbnailUrl}
                    alt={item.title}
                    loading="lazy"
                    onError={(e) => {
                      e.currentTarget.style.display = 'none';
                    }}
                  />
                ) : null}
                <span className="gv-video-queue-text">
                  <span className="gv-video-queue-title">{item.title}</span>
                  {channel ? <span className="gv-video-queue-channel">{channel}</span> : null}
                  <span className="gv-video-queue-play" aria-hidden="true">
                    ▶ 재생
                  </span>
                </span>
              </button>
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
                <button
                  type="button"
                  className="gv-reject-item"
                  aria-label={`${item.title} 거부`}
                  title="이 항목 거부"
                  onClick={(event) => {
                    event.stopPropagation();
                    onRejectItem ? onRejectItem(item.id) : dispatch({ type: 'remove_item', itemId: item.id });
                  }}
                >
                  ✕
                </button>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
