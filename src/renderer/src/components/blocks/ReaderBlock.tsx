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

export default function ReaderBlock({
  block,
  items,
  onOpenOriginal,
  onInspect
}: BlockRenderProps): ReactElement | null {
  const item = items[0];
  if (!item) return null;

  const payload = getArticlePayload(item);
  const body = item.summary ?? payload?.excerpt ?? '';
  const paragraphs = body
    .split(/\n+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  const date = formatDate(item.publishedAt);

  return (
    <article className="gv-reader">
      <h2 className="gv-reader-title">{item.title}</h2>
      <div className="gv-reader-meta">
        <button type="button" className="gv-src-chip" onClick={() => onInspect(block.id)}>
          {item.sourceName}
        </button>
        {date ? <span>{date}</span> : null}
        <button
          type="button"
          className="gv-open-original"
          onClick={() => onOpenOriginal(item.originalUrl)}
        >
          원본
        </button>
      </div>
      <div className="gv-reader-body">
        {paragraphs.map((text, i) => (
          <p key={i}>{text}</p>
        ))}
      </div>
      <footer className="gv-reader-footer">
        <button
          type="button"
          className="gv-reader-open"
          onClick={() => onOpenOriginal(item.originalUrl)}
        >
          원본에서 읽기
        </button>
      </footer>
    </article>
  );
}
