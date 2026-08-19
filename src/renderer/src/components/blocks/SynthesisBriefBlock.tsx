import type { ReactElement } from 'react';
import type { BlockRenderProps } from './blockContract';
import type { SourceItem } from '@shared/domain/sourceItem';
import './synthesisBlocks.css';

interface BriefPoint {
  text: string;
  cites: number[];
}

/**
 * Planner props are LLM output — narrow at runtime and drop malformed
 * entries instead of crashing (catalog `synthesis_brief`, fallback 'hide').
 */
function narrowPoints(raw: unknown): BriefPoint[] {
  if (!Array.isArray(raw)) return [];
  const points: BriefPoint[] = [];
  for (const entry of raw) {
    if (typeof entry !== 'object' || entry === null) continue;
    const rec = entry as Record<string, unknown>;
    if (typeof rec.text !== 'string' || rec.text.trim().length === 0) continue;
    const cites = Array.isArray(rec.cites)
      ? rec.cites.filter(
          (c): c is number => typeof c === 'number' && Number.isInteger(c) && c >= 0
        )
      : [];
    points.push({ text: rec.text, cites });
  }
  return points;
}

/** Cross-source opening synthesis: bullet claims with per-claim citations. */
export default function SynthesisBriefBlock(props: BlockRenderProps): ReactElement | null {
  const { block, items, onOpenOriginal, onInspect } = props;

  const points = narrowPoints(block.props.points);
  // Catalog minItems is 2 — a synthesis over fewer than 2 resolved items hides.
  if (points.length === 0 || items.length < 2) return null;

  const rawTitle = block.props.title;
  const caption =
    typeof rawTitle === 'string' && rawTitle.trim().length > 0 ? rawTitle : '이 페이지 요약';

  const sourceCount = new Set(items.map((item) => item.sourceName)).size;

  return (
    <section className="gv-syn-brief">
      <h3 className="gv-syn-caption">{caption}</h3>
      <ul className="gv-syn-points">
        {points.map((point, pointIndex) => {
          // `cites` are indices into block.sourceItemRefs → props.items.
          // Unresolvable indices are skipped; chips renumber from 1.
          const cited: SourceItem[] = point.cites
            .filter((index) => index >= 0 && index < items.length)
            .map((index) => items[index]);
          return (
            <li key={pointIndex} className="gv-syn-point">
              <span className="gv-syn-point-text">{point.text}</span>
              {cited.map((item, citeIndex) => (
                <button
                  key={`${item.id}-${citeIndex}`}
                  type="button"
                  className="gv-syn-cite"
                  title={item.sourceName}
                  onClick={() => onOpenOriginal(item.originalUrl)}
                >
                  {citeIndex + 1}
                </button>
              ))}
            </li>
          );
        })}
      </ul>
      <div className="gv-syn-footer">
        <span>
          출처 {sourceCount}곳 · 항목 {items.length}개
        </span>
        <button type="button" className="gv-syn-inspect" onClick={() => onInspect(block.id)}>
          자세히
        </button>
      </div>
    </section>
  );
}
