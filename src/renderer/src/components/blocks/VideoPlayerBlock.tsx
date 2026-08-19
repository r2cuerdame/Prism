import type { ReactElement } from 'react';
import type { BlockRenderProps } from './blockContract';
import type { SourceItem } from '@shared/domain/sourceItem';
import { getVideoPayload } from '@shared/domain/sourceItem';
import './videoBlocks.css';

function embedIdOf(item: SourceItem): string | null {
  return getVideoPayload(item)?.videoId ?? item.media?.embedId ?? null;
}

export default function VideoPlayerBlock({
  block,
  items,
  dispatch,
  onOpenOriginal,
  onInspect
}: BlockRenderProps): ReactElement | null {
  const videos = items.filter((i) => i.kind === 'video');

  // activeItemId is set by `play_item` from anywhere on the page; fall back to
  // the first video when it is missing or points at an item we no longer hold.
  const stateActiveId =
    typeof block.state?.activeItemId === 'string' ? block.state.activeItemId : null;
  const active = videos.find((i) => i.id === stateActiveId) ?? videos[0];
  const embedId = active ? embedIdOf(active) : null;

  if (!active || !embedId) {
    return <div className="gv-block-empty">콘텐츠를 준비하지 못했어요</div>;
  }

  // A resolved activeItemId means the user explicitly picked this video, so
  // start it; props.autoplay stays the first-render switch.
  const userPicked = stateActiveId !== null && active.id === stateActiveId;
  const autoplay = block.props.autoplay === true || userPicked;
  const src = `https://www.youtube-nocookie.com/embed/${embedId}?rel=0${autoplay ? '&autoplay=1' : ''}`;
  const channel = getVideoPayload(active)?.channel;
  const queue = videos.filter((i) => i.id !== active.id);

  return (
    <div className="gv-video-player">
      <div className="gv-video-frame">
        <iframe
          src={src}
          title={active.title}
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
          allowFullScreen
          referrerPolicy="strict-origin-when-cross-origin"
        />
      </div>
      <div className="gv-video-meta">
        <div className="gv-video-title">{active.title}</div>
        {channel ? <div className="gv-video-channel">{channel}</div> : null}
        <div className="gv-item-chips">
          <button
            type="button"
            className="gv-src-chip"
            onClick={() => onInspect(block.id)}
          >
            {active.sourceName}
          </button>
          <button
            type="button"
            className="gv-original-btn"
            onClick={(e) => {
              e.stopPropagation();
              onOpenOriginal(active.originalUrl);
            }}
          >
            원본
          </button>
        </div>
      </div>
      {queue.length > 0 ? (
        <div className="gv-video-player-queue">
          {queue.map((item) => (
            <div key={item.id} className="gv-video-card">
              <button
                type="button"
                className="gv-video-card-main"
                aria-label={`${item.title} 재생`}
                onClick={() =>
                  dispatch({ type: 'play_item', itemId: item.id, playerBlockId: block.id })
                }
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
                <span className="gv-video-card-title">{item.title}</span>
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
              </div>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
