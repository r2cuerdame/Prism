import type { ReactElement } from 'react';
import type { BlockRenderProps } from './blockContract';
import { getVideoPayload } from '@shared/domain/sourceItem';
import './videoBlocks.css';

export default function VideoQueueBlock({
  block,
  items,
  onOpenOriginal,
  onInspect
}: BlockRenderProps): ReactElement | null {
  const videos = items.filter((i) => i.kind === 'video');
  if (videos.length === 0) return null;

  const title = typeof block.props.title === 'string' ? block.props.title : null;

  return (
    <div className="gv-video-queue">
      {title ? <div className="gv-block-caption">{title}</div> : null}
      <ul className="gv-video-queue-list">
        {videos.map((item) => {
          const channel = getVideoPayload(item)?.channel;
          return (
            <li key={item.id} className="gv-video-queue-row">
              <button
                type="button"
                className="gv-video-queue-main"
                onClick={() => onOpenOriginal(item.originalUrl)}
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
                  onClick={() => onOpenOriginal(item.originalUrl)}
                >
                  원본
                </button>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
