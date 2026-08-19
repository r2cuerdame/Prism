import type { ReactElement } from 'react';
import type { BlockRenderProps } from './blockContract';
import type { SourceItem } from '@shared/domain/sourceItem';
import { getPostPayload } from '@shared/domain/sourceItem';
import './synthesisBlocks.css';

const KIND_LABELS: Record<SourceItem['kind'], string> = {
  video: '영상',
  article: '기사',
  post: '커뮤니티',
  headline: '헤드라인'
};

/** One topic covered by several different sources, gathered into one card. */
export default function TopicClusterBlock(props: BlockRenderProps): ReactElement | null {
  const { block, items, onOpenOriginal, onInspect } = props;

  // Planner props are LLM output — narrow at runtime; catalog `topic_cluster`
  // requires a topic and minItems 2, fallback 'hide'.
  const rawTopic = block.props.topic;
  const topic = typeof rawTopic === 'string' ? rawTopic.trim() : '';
  if (topic.length === 0 || items.length < 2) return null;

  const rawAngle = block.props.angle;
  const angle =
    typeof rawAngle === 'string' && rawAngle.trim().length > 0 ? rawAngle.trim() : null;

  // Distinct participating sources, in item order — makes the cross-source
  // nature of the cluster obvious at a glance.
  const sourceNames = [...new Set(items.map((item) => item.sourceName))];

  // Rows grouped visually by source, preserving first-seen order.
  const groups = new Map<string, SourceItem[]>();
  for (const item of items) {
    const group = groups.get(item.sourceName);
    if (group) group.push(item);
    else groups.set(item.sourceName, [item]);
  }

  // Only the first video/article row shows its thumbnail (keeps the card dense).
  const thumbItemId = items.find(
    (item) =>
      (item.kind === 'video' || item.kind === 'article') &&
      typeof item.media?.thumbnailUrl === 'string' &&
      item.media.thumbnailUrl.length > 0
  )?.id;

  return (
    <section className="gv-topic-cluster">
      <header className="gv-tc-head">
        <h3 className="gv-tc-topic">{topic}</h3>
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
                    <button
                      type="button"
                      className="gv-tc-title"
                      onClick={() => onOpenOriginal(item.originalUrl)}
                    >
                      {item.title}
                    </button>
                  </div>
                  <div className="gv-tc-meta">
                    <button
                      type="button"
                      className="gv-src-chip"
                      onClick={() => onInspect(block.id)}
                    >
                      {item.sourceName}
                    </button>
                    {post && typeof post.points === 'number' ? (
                      <span>▲{post.points}</span>
                    ) : null}
                    {post && typeof post.commentCount === 'number' ? (
                      <span>댓글 {post.commentCount}</span>
                    ) : null}
                    <button
                      type="button"
                      className="gv-tc-open"
                      onClick={() => onOpenOriginal(item.originalUrl)}
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
