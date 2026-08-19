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

  const stateActiveId =
    typeof block.state?.activeItemId === 'string' ? block.state.activeItemId : null;
  const active = videos.find((i) => i.id === stateActiveId) ?? videos[0];
  const embedId = active ? embedIdOf(active) : null;

  if (!active || !embedId) {
    return <div className="gv-block-empty">콘텐츠를 준비하지 못했어요</div>;
  }

  const autoplay = block.props.autoplay === true;
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
            onClick={() => onOpenOriginal(active.originalUrl)}
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
                onClick={() =>
                  dispatch({
                    type: 'set_block_state',
                    blockId: block.id,
                    state: { activeItemId: item.id }
                  })
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
                  onClick={() => onOpenOriginal(item.originalUrl)}
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
