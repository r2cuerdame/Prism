import type { ReactElement } from 'react';
import type { BlockRenderProps } from './blockContract';
import type { SourceItem } from '@shared/domain/sourceItem';
import { getPostPayload } from '@shared/domain/sourceItem';
import { visibleItemCount } from '@shared/catalog/catalog';
import './synthesisBlocks.css';

const KIND_LABELS: Record<SourceItem['kind'], string> = {
  video: '영상',
  article: '기사',
  post: '커뮤니티',
  headline: '헤드라인'
};

/** One topic covered by several different sources, gathered into one card. */
export default function TopicClusterBlock(props: BlockRenderProps): ReactElement | null {
  const { block, items, dispatch, onOpenOriginal, onInspect } = props;

  // Planner props are LLM output — narrow at runtime; catalog `topic_cluster`
  // requires a heading and minItems 2, fallback 'hide'.
  const rawTitle = block.props.title;
  const rawTopic = block.props.topic;
  const title = typeof rawTitle === 'string' ? rawTitle.trim() : '';
  const topic = typeof rawTopic === 'string' ? rawTopic.trim() : '';
  // The chrome header already prints props.title, so the card shows the topic
  // and only falls back to the title when the planner gave no topic.
  const heading = topic.length > 0 ? topic : title;
  if (heading.length === 0 || items.length < 2) return null;
  const showHeading = topic.length > 0 || title.length === 0;

  const rawAngle = block.props.angle;
  const angle =
    typeof rawAngle === 'string' && rawAngle.trim().length > 0 ? rawAngle.trim() : null;

  const visible = items.slice(
    0,
    visibleItemCount(block.componentType, block.props.maxItems, items.length)
  );

  // Distinct participating sources, in item order — makes the cross-source
  // nature of the cluster obvious at a glance.
  const sourceNames = [...new Set(visible.map((item) => item.sourceName))];

  // Rows grouped visually by source, preserving first-seen order.
  const groups = new Map<string, SourceItem[]>();
  for (const item of visible) {
    const group = groups.get(item.sourceName);
    if (group) group.push(item);
    else groups.set(item.sourceName, [item]);
  }

  // Only the first video/article row shows its thumbnail (keeps the card dense).
  const thumbItemId = visible.find(
    (item) =>
      (item.kind === 'video' || item.kind === 'article') &&
      typeof item.media?.thumbnailUrl === 'string' &&
      item.media.thumbnailUrl.length > 0
  )?.id;

  return (
    <section className="gv-topic-cluster">
      <header className="gv-tc-head">
        {showHeading ? <h3 className="gv-tc-topic">{heading}</h3> : null}
        {angle ? <p className="gv-tc-angle">{angle}</p> : null}
        <div className="gv-tc-sources">{sourceNames.join(' · ')}</div>
      </header>
      {[...groups.entries()].map(([sourceName, groupItems]) => (
        <div key={sourceName} className="gv-tc-group">
          {groupItems.map((item) => {
            const post = getPostPayload(item);
            const thumb =
              item.id === thumbItemId ? item.media?.thumbnailUrl : undefined;
            return (
              <div key={item.id} className="gv-tc-row">
                {thumb ? (
                  <img
                    className="gv-tc-thumb"
                    src={thumb}
                    alt=""
                    loading="lazy"
                    onError={(e) => {
                      e.currentTarget.style.display = 'none';
                    }}
                  />
                ) : null}
                <div className="gv-tc-main">
                  <div className="gv-tc-title-line">
                    <span className="gv-tc-kind">{KIND_LABELS[item.kind]}</span>
                    <span className="gv-tc-title">{item.title}</span>
                  </div>
                  <div className="gv-tc-meta">
                    <button
                      type="button"
                      className="gv-src-chip"
                      onClick={() => onInspect(block.id)}
                    >
                      {item.sourceName}
                    </button>
                    {item.kind === 'video' ? (
                      <button
                        type="button"
                        className="gv-tc-play"
                        aria-label={`${item.title} 재생`}
                        onClick={(e) => {
                          e.stopPropagation();
                          dispatch({ type: 'play_item', itemId: item.id });
                        }}
                      >
                        ▶ 재생
                      </button>
                    ) : null}
                    {post && typeof post.points === 'number' ? (
                      <span>▲{post.points}</span>
                    ) : null}
                    {post && typeof post.commentCount === 'number' ? (
                      <span>댓글 {post.commentCount}</span>
                    ) : null}
                    <button
                      type="button"
                      className="gv-tc-open"
                      onClick={(e) => {
                        e.stopPropagation();
                        onOpenOriginal(item.originalUrl);
                      }}
                    >
                      원본
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      ))}
    </section>
  );
}
