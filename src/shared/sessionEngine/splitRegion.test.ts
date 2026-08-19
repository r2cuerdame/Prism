import { describe, expect, it } from 'vitest';
import type { ComponentBlock, LayoutPlan } from '@shared/domain/layoutPlan';
import { splitRegion } from './splitRegion';

const NOW = '2026-08-19T00:00:00.000Z';

function block(id: string, componentType: string, span: number): ComponentBlock {
  return {
    id,
    componentType,
    componentVersion: 1,
    sourceItemRefs: [],
    props: {},
    layout: { span },
    locked: false,
    docked: false,
    state: {}
  };
}

function plan(blocks: ComponentBlock[]): LayoutPlan {
  return {
    id: 'plan_1',
    version: 1,
    sessionId: 's1',
    blocks,
    generationScope: 'full',
    preservedEdits: { dockedBlockIds: [] },
    plannerMetadata: { planner: 'heuristic', generatedAt: NOW, diagnostics: [] }
  };
}

/** topic_cluster: minSpan 4, maxSpan 12. article_list: minSpan 4, maxSpan 12. */
const wide = (): LayoutPlan =>
  plan([
    block('a', 'topic_cluster', 12),
    block('b', 'article_list', 12),
    block('c', 'community_posts', 12)
  ]);

describe('splitRegion', () => {
  it('splits a full-width target in half when dropped on its right', () => {
    const next = splitRegion(wide(), 'c', 'a', 'right');
    expect(next).not.toBeNull();
    expect(next!.map((b) => b.id)).toEqual(['a', 'c', 'b']);
    expect(next!.find((b) => b.id === 'a')!.layout.span).toBe(6);
    expect(next!.find((b) => b.id === 'c')!.layout.span).toBe(6);
  });

  it('places the moved block before the target when dropped on its left', () => {
    const next = splitRegion(wide(), 'c', 'b', 'left');
    expect(next!.map((b) => b.id)).toEqual(['a', 'c', 'b']);
    expect(next!.find((b) => b.id === 'b')!.layout.span).toBe(6);
    expect(next!.find((b) => b.id === 'c')!.layout.span).toBe(6);
  });

  it('stacks into bands on a top/bottom drop, taking the target width', () => {
    const p = plan([block('a', 'topic_cluster', 6), block('b', 'article_list', 12)]);
    const below = splitRegion(p, 'a', 'b', 'bottom');
    expect(below!.map((b) => b.id)).toEqual(['b', 'a']);
    expect(below!.find((b) => b.id === 'a')!.layout.span).toBe(12);
    expect(below!.find((b) => b.id === 'b')!.layout.span).toBe(12);

    const above = splitRegion(p, 'a', 'b', 'top');
    expect(above!.map((b) => b.id)).toEqual(['a', 'b']);
  });

  it('keeps the target intact when halving would go under its minimum span', () => {
    // article_list minSpan is 4, so a span-6 target cannot give up half; the
    // drop degrades to a reposition rather than producing an unreadable sliver.
    const p = plan([block('b', 'community_posts', 6), block('a', 'article_list', 6)]);
    const next = splitRegion(p, 'b', 'a', 'right');
    expect(next!.map((b) => b.id)).toEqual(['a', 'b']);
    expect(next!.find((b) => b.id === 'a')!.layout.span).toBe(6);
    expect(next!.find((b) => b.id === 'b')!.layout.span).toBe(6);
  });

  it('clamps the moved block to its own catalog bounds', () => {
    // divider is pinned to span 12 by the catalog, so it cannot become a half
    // and the target keeps its width too.
    const p = plan([block('d', 'divider', 12), block('a', 'topic_cluster', 12)]);
    const next = splitRegion(p, 'd', 'a', 'right');
    expect(next!.map((b) => b.id)).toEqual(['a', 'd']);
    expect(next!.find((b) => b.id === 'd')!.layout.span).toBe(12);
    expect(next!.find((b) => b.id === 'a')!.layout.span).toBe(12);
  });

  it('returns null for unknown ids, self-drops and no-op drops', () => {
    const p = wide();
    expect(splitRegion(p, 'a', 'a', 'left')).toBeNull();
    expect(splitRegion(p, 'ghost', 'a', 'left')).toBeNull();
    expect(splitRegion(p, 'a', 'ghost', 'left')).toBeNull();
    // 'a' dropped above 'a' is already its position and changes no span.
    const stacked = plan([block('a', 'topic_cluster', 12), block('b', 'article_list', 12)]);
    expect(splitRegion(stacked, 'a', 'b', 'top')).toBeNull();
  });

  it('does not mutate the input plan', () => {
    const p = wide();
    const before = JSON.stringify(p);
    splitRegion(p, 'c', 'a', 'right');
    expect(JSON.stringify(p)).toBe(before);
  });
});
