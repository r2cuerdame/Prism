import { describe, expect, it } from 'vitest';
import { getCatalogEntry } from '@shared/catalog/catalog';
import type { InterpretedIntent } from '@shared/domain/intent';
import type { ComponentBlock, LayoutPlan } from '@shared/domain/layoutPlan';
import { LayoutPlanSchema } from '@shared/domain/layoutPlan';
import type { SourceItem, SourceItemKind } from '@shared/domain/sourceItem';
import { SourceItemSchema } from '@shared/domain/sourceItem';
import type { PlanRequest } from './plannerTypes';
import { heuristicPlan } from './heuristicPlanner';

function item(id: string, kind: SourceItemKind, extra: Partial<SourceItem> = {}): SourceItem {
  return {
    id,
    adapterId: 'test-adapter',
    sourceId: 'test-source',
    sourceName: '테스트 소스',
    kind,
    title: `제목 ${id}`,
    payload: {},
    originalUrl: `https://example.com/${id}`,
    retrievedAt: '2026-08-19T00:00:00.000Z',
    provenanceRef: 'prov_1',
    ...extra
  };
}

function interp(over: Partial<InterpretedIntent> = {}): InterpretedIntent {
  return {
    goal: '테스트',
    topics: [],
    moods: ['browse'],
    contentBalance: {},
    sourceHints: { include: [], exclude: [] },
    locale: 'ko',
    followUp: false,
    ...over
  };
}

function reqOf(items: SourceItem[], over: Partial<PlanRequest> = {}): PlanRequest {
  return {
    interpretation: interp(),
    items,
    sessionId: 'sess_1',
    preserved: { dockedBlocks: [] },
    hints: { mix: {}, notes: [] },
    ...over
  };
}

function mixedItems(): SourceItem[] {
  return [
    item('v1', 'video'),
    item('v2', 'video'),
    item('v3', 'video'),
    item('v4', 'video'),
    item('a1', 'article', { publishedAt: '2026-08-18T10:00:00.000Z' }),
    item('a2', 'article', { publishedAt: '2026-08-18T09:00:00.000Z' }),
    item('a3', 'article', { publishedAt: '2026-08-18T08:00:00.000Z' }),
    item('a4', 'article', { publishedAt: '2026-08-18T07:00:00.000Z' }),
    item('a5', 'article', { publishedAt: '2026-08-18T06:00:00.000Z' }),
    item('a6', 'article', { publishedAt: '2026-08-18T05:00:00.000Z' }),
    item('h1', 'headline', { publishedAt: '2026-08-19T01:00:00.000Z' }),
    item('h2', 'headline', { publishedAt: '2026-08-19T02:00:00.000Z' }),
    item('p1', 'post'),
    item('p2', 'post'),
    item('p3', 'post')
  ];
}

function types(plan: LayoutPlan): string[] {
  return plan.blocks.map((b) => b.componentType);
}

describe('heuristicPlan', () => {
  it('uses valid fixtures', () => {
    for (const it2 of mixedItems()) {
      expect(SourceItemSchema.safeParse(it2).success).toBe(true);
    }
  });

  it('composes a full page from mixed items with source_list last', () => {
    const { plan, issues } = heuristicPlan(reqOf(mixedItems()));
    expect(issues).toEqual([]);
    const t = types(plan);
    expect(t).toContain('video_player');
    expect(t).toContain('video_queue');
    expect(t).toContain('headline_strip');
    expect(t).toContain('article_list');
    expect(t).toContain('community_posts');
    expect(t).toContain('source_list');
    expect(plan.blocks[plan.blocks.length - 1]!.componentType).toBe('source_list');
    expect(t.filter((x) => x === 'source_list')).toHaveLength(1);
    expect(LayoutPlanSchema.safeParse(plan).success).toBe(true);
    expect(plan.version).toBe(1);
    expect(plan.sessionId).toBe('sess_1');
    expect(plan.plannerMetadata.planner).toBe('heuristic');
  });

  it('keeps every block within catalog constraints', () => {
    const { plan } = heuristicPlan(reqOf(mixedItems()));
    for (const b of plan.blocks) {
      const entry = getCatalogEntry(b.componentType);
      expect(entry).toBeDefined();
      expect(b.layout.span).toBeGreaterThanOrEqual(entry!.minSpan);
      expect(b.layout.span).toBeLessThanOrEqual(entry!.maxSpan);
      expect(b.sourceItemRefs.length).toBeGreaterThanOrEqual(entry!.minItems);
      expect(b.sourceItemRefs.length).toBeLessThanOrEqual(entry!.maxItems);
    }
  });

  it('reduces video presence when hints.mix.video is "less"', () => {
    const { plan } = heuristicPlan(
      reqOf(mixedItems(), { hints: { mix: { video: 'less' }, notes: [] } })
    );
    const t = types(plan);
    expect(t).not.toContain('video_player');
    const videoRefs = plan.blocks
      .filter((b) => b.componentType === 'video_queue')
      .flatMap((b) => b.sourceItemRefs);
    expect(videoRefs.length).toBeLessThanOrEqual(2);
  });

  it('drops a kind entirely when halving leaves nothing', () => {
    const { plan, issues } = heuristicPlan(
      reqOf([item('v1', 'video'), item('a1', 'article'), item('a2', 'article'), item('a3', 'article')], {
        hints: { mix: { video: 'less' }, notes: [] }
      })
    );
    const t = types(plan);
    expect(t).not.toContain('video_player');
    expect(t).not.toContain('video_queue');
    expect(issues.length).toBeGreaterThan(0);
  });

  it('renders a single video as a full-width player', () => {
    const { plan } = heuristicPlan(reqOf([item('v1', 'video')]));
    const player = plan.blocks.find((b) => b.componentType === 'video_player');
    expect(player).toBeDefined();
    expect(player!.layout.span).toBe(12);
    expect(types(plan)).not.toContain('video_queue');
  });

  it('emits one Korean text block when there are no items', () => {
    const { plan } = heuristicPlan(reqOf([]));
    expect(plan.blocks).toHaveLength(1);
    const b = plan.blocks[0]!;
    expect(b.componentType).toBe('text');
    expect(b.layout.span).toBe(12);
    expect(String(b.props.text)).toContain('아직 가져온 콘텐츠가 없어요');
    expect(LayoutPlanSchema.safeParse(plan).success).toBe(true);
  });

  it('respects preserved docked blocks: ids recorded, refs not re-emitted', () => {
    const docked: ComponentBlock = {
      id: 'blk_docked',
      componentType: 'video_queue',
      componentVersion: 1,
      sourceItemRefs: ['v1', 'v2'],
      props: {},
      layout: { span: 4 },
      locked: false,
      docked: true,
      state: {}
    };
    const { plan } = heuristicPlan(
      reqOf(mixedItems(), { preserved: { dockedBlocks: [docked] } })
    );
    expect(plan.preservedEdits.dockedBlockIds).toEqual(['blk_docked']);
    for (const b of plan.blocks) {
      expect(b.id).not.toBe('blk_docked');
      expect(b.sourceItemRefs).not.toContain('v1');
      expect(b.sourceItemRefs).not.toContain('v2');
    }
  });

  it('orders sections by contentBalance weight (video-heavy first)', () => {
    const { plan } = heuristicPlan(
      reqOf(mixedItems(), {
        interpretation: interp({ contentBalance: { video: 0.9, article: 0.2, post: 0.1, headline: 0.1 } })
      })
    );
    const t = types(plan);
    expect(t.indexOf('video_player')).toBeLessThan(t.indexOf('article_list'));
    expect(t.indexOf('article_list')).toBeLessThan(t.indexOf('community_posts'));
  });
});
