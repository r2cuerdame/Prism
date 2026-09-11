import { describe, expect, it } from 'vitest';
import { getCatalogEntry } from '@shared/catalog/catalog';
import type { ComponentBlock, LayoutPlan } from '@shared/domain/layoutPlan';
import { LayoutPlanSchema } from '@shared/domain/layoutPlan';
import type { SourceItem, SourceItemKind } from '@shared/domain/sourceItem';
import { detectSiloViolations, enforceMixedComposition } from './mixInvariants';

function item(id: string, kind: SourceItemKind, sourceName: string, title = `제목 ${id}`): SourceItem {
  return {
    id,
    adapterId: 'test-adapter',
    sourceId: sourceName,
    sourceName,
    kind,
    title,
    payload: {},
    originalUrl: `https://example.com/${id}`,
    retrievedAt: '2026-08-19T00:00:00.000Z',
    provenanceRef: 'prov_1'
  };
}

function block(
  id: string,
  componentType: string,
  refs: string[],
  span = 6,
  props: Record<string, unknown> = {}
): ComponentBlock {
  return {
    id,
    componentType,
    componentVersion: 1,
    sourceItemRefs: refs,
    props,
    layout: { span },
    locked: false,
    docked: false,
    state: {}
  };
}

function planOf(blocks: ComponentBlock[]): LayoutPlan {
  return {
    id: 'plan_1',
    version: 1,
    sessionId: 'sess_1',
    blocks,
    generationScope: 'full',
    preservedEdits: { dockedBlockIds: [] },
    plannerMetadata: { planner: 'heuristic', generatedAt: '2026-08-19T00:00:00.000Z', diagnostics: [] }
  };
}

function sourceList(blocks: ComponentBlock[]): ComponentBlock {
  const refs: string[] = [];
  for (const b of blocks) for (const r of b.sourceItemRefs) if (!refs.includes(r)) refs.push(r);
  return block('blk_src', 'source_list', refs, 12, { title: '출처' });
}

function sourcesOf(items: SourceItem[], b: ComponentBlock): Set<string> {
  const byId = new Map(items.map((i) => [i.id, i]));
  const set = new Set<string>();
  for (const r of b.sourceItemRefs) {
    const it = byId.get(r);
    if (it) set.add(it.sourceName);
  }
  return set;
}

function bodyBlocks(plan: LayoutPlan): ComponentBlock[] {
  const skip = new Set(['source_list', 'synthesis_brief', 'video_player', 'video_queue']);
  return plan.blocks.filter((b) => b.sourceItemRefs.length > 0 && !skip.has(b.componentType));
}

function expectCatalogConstraints(plan: LayoutPlan): void {
  for (const b of plan.blocks) {
    const entry = getCatalogEntry(b.componentType);
    expect(entry).toBeDefined();
    expect(b.layout.span).toBeGreaterThanOrEqual(entry!.minSpan);
    expect(b.layout.span).toBeLessThanOrEqual(entry!.maxSpan);
    expect(b.sourceItemRefs.length).toBeGreaterThanOrEqual(entry!.minItems);
    expect(b.sourceItemRefs.length).toBeLessThanOrEqual(entry!.maxItems);
  }
}

function shape(plan: LayoutPlan): unknown {
  return plan.blocks.map((b) => ({
    type: b.componentType,
    refs: b.sourceItemRefs,
    span: b.layout.span
  }));
}

// --- fixtures ---------------------------------------------------------------

/** Three outlets, each with its own list: the page GOAL.md forbids. */
function siloItems(): SourceItem[] {
  return [
    item('m1', 'article', '매일경제'),
    item('m2', 'article', '매일경제'),
    item('m3', 'article', '매일경제'),
    item('c1', 'article', '조선일보'),
    item('c2', 'article', '조선일보'),
    item('c3', 'article', '조선일보'),
    item('h1', 'post', 'Hacker News'),
    item('h2', 'post', 'Hacker News'),
    item('h3', 'post', 'Hacker News')
  ];
}

function siloPlan(): LayoutPlan {
  const body = [
    block('blk_m', 'article_list', ['m1', 'm2', 'm3'], 6, { title: '매일경제' }),
    block('blk_c', 'article_list', ['c1', 'c2', 'c3'], 6, { title: '조선일보' }),
    block('blk_h', 'community_posts', ['h1', 'h2', 'h3'], 12, { title: 'Hacker News' })
  ];
  return planOf([...body, sourceList(body)]);
}

/** Two kinds, each list already mixed by source — but the page is per kind. */
function kindSiloItems(): SourceItem[] {
  return [
    item('a1', 'article', '매일경제'),
    item('a2', 'article', '조선일보'),
    item('a3', 'article', '매일경제'),
    item('a4', 'article', '조선일보'),
    item('p1', 'post', 'Hacker News'),
    item('p2', 'post', 'Lobsters'),
    item('p3', 'post', 'Hacker News'),
    item('p4', 'post', 'Lobsters')
  ];
}

function kindSiloPlan(): LayoutPlan {
  const body = [
    block('blk_a', 'article_list', ['a1', 'a2', 'a3', 'a4'], 6),
    block('blk_p', 'community_posts', ['p1', 'p2', 'p3', 'p4'], 6)
  ];
  return planOf([...body, sourceList(body)]);
}

function cleanPlan(items: SourceItem[]): LayoutPlan {
  const body = [
    block('blk_t1', 'topic_cluster', ['m1', 'h1', 'c1', 'h2'], 6, { topic: '반도체' }),
    block('blk_t2', 'topic_cluster', ['c2', 'm2', 'h3', 'm3', 'c3'], 6, { topic: '금리' })
  ];
  void items;
  return planOf([...body, sourceList(body)]);
}

// --- tests ------------------------------------------------------------------

describe('detectSiloViolations', () => {
  it('reports site-silo for a page of per-site lists', () => {
    const v = detectSiloViolations(siloPlan(), siloItems());
    const silo = v.find((x) => x.kind === 'site-silo');
    expect(silo).toBeDefined();
    expect(silo!.blockIds).toEqual(['blk_m', 'blk_c', 'blk_h']);
    expect(silo!.detail.length).toBeGreaterThan(0);
  });

  it('reports single-source-block when the pool offers other outlets', () => {
    const v = detectSiloViolations(siloPlan(), siloItems());
    const single = v.filter((x) => x.kind === 'single-source-block');
    // Articles come from two outlets, so each article-only list is a silo;
    // posts come from one community only, so that block is legitimately single-source.
    expect(single.map((x) => x.blockIds[0])).toEqual(['blk_m', 'blk_c']);
  });

  it('reports kind-silo for a per-kind page with no topic composition', () => {
    const v = detectSiloViolations(kindSiloPlan(), kindSiloItems());
    const kind = v.find((x) => x.kind === 'kind-silo');
    expect(kind).toBeDefined();
    expect(kind!.blockIds).toEqual(['blk_a', 'blk_p']);
    expect(v.some((x) => x.kind === 'site-silo')).toBe(false);
  });

  it('reports grouped-by-source for a mixed block ordered in per-source runs', () => {
    const items = siloItems();
    const body = [block('blk_g', 'topic_cluster', ['m1', 'm2', 'c1', 'c2', 'h1', 'h2'], 12, { topic: '묶음' })];
    const v = detectSiloViolations(planOf([...body, sourceList(body)]), items);
    expect(v.map((x) => x.kind)).toEqual(['grouped-by-source']);
    expect(v[0]!.blockIds).toEqual(['blk_g']);
  });

  it('is silent on a topic-composed plan', () => {
    expect(detectSiloViolations(cleanPlan(siloItems()), siloItems())).toEqual([]);
  });

  it('is silent when the whole pool is one source', () => {
    const items = [
      item('s1', 'article', '테스트 소스'),
      item('s2', 'article', '테스트 소스'),
      item('s3', 'article', '테스트 소스'),
      item('s4', 'post', '테스트 소스'),
      item('s5', 'post', '테스트 소스')
    ];
    const body = [
      block('blk_a', 'article_list', ['s1', 's2', 's3'], 6),
      block('blk_p', 'community_posts', ['s4', 's5'], 6)
    ];
    expect(detectSiloViolations(planOf([...body, sourceList(body)]), items)).toEqual([]);
  });

  it('ignores the opener, the anchor and provenance', () => {
    const items = [
      ...siloItems(),
      item('v1', 'video', 'IT유튜브'),
      item('v2', 'video', 'IT유튜브'),
      item('v3', 'video', 'IT유튜브')
    ];
    const blocks = [
      block('blk_s', 'synthesis_brief', ['m1', 'm2', 'c1'], 12, { points: [{ text: '요약', cites: [0, 2] }] }),
      block('blk_v', 'video_player', ['v1', 'v2'], 8),
      block('blk_q', 'video_queue', ['v3'], 4),
      block('blk_t', 'topic_cluster', ['m3', 'h1', 'c2', 'h2'], 12, { topic: '묶음' })
    ];
    expect(detectSiloViolations(planOf([...blocks, sourceList(blocks)]), items)).toEqual([]);
  });
});

describe('enforceMixedComposition', () => {
  it('rebuilds per-site lists into topic_cluster cards that each span several sources', () => {
    const items = siloItems();
    const { plan, issues, violations } = enforceMixedComposition(siloPlan(), items);
    expect(violations.some((v) => v.kind === 'site-silo')).toBe(true);
    expect(issues.length).toBeGreaterThan(0);
    for (const s of issues) expect(s).toMatch(/[가-힣]/);

    const body = bodyBlocks(plan);
    expect(body.length).toBeGreaterThan(0);
    for (const b of body) {
      expect(b.componentType).toBe('topic_cluster');
      expect(sourcesOf(items, b).size).toBeGreaterThanOrEqual(2);
      expect(String(b.props.topic).length).toBeGreaterThan(0);
      expect(String(b.props.angle).length).toBeGreaterThan(0);
      expect(b.rationale).toMatch(/[가-힣]/);
      expect(b.id).toMatch(/^blk_/);
    }
    expect(plan.blocks.map((b) => b.componentType)).not.toContain('article_list');
    expect(plan.blocks.map((b) => b.componentType)).not.toContain('community_posts');
    // Every item survives the repair, exactly once in the body.
    const refs = body.flatMap((b) => b.sourceItemRefs);
    expect(new Set(refs).size).toBe(refs.length);
    expect(refs.length).toBe(items.length);

    expect(detectSiloViolations(plan, items)).toEqual([]);
    expect(LayoutPlanSchema.safeParse(plan).success).toBe(true);
    expectCatalogConstraints(plan);
  });

  it('repairs a per-kind page into mixed clusters', () => {
    const items = kindSiloItems();
    const { plan, violations } = enforceMixedComposition(kindSiloPlan(), items);
    expect(violations.some((v) => v.kind === 'kind-silo')).toBe(true);
    const body = bodyBlocks(plan);
    expect(body.length).toBeGreaterThan(0);
    for (const b of body) {
      expect(b.componentType).toBe('topic_cluster');
      expect(sourcesOf(items, b).size).toBeGreaterThanOrEqual(2);
    }
    // Kinds are mixed inside a card, not split per card.
    const byId = new Map(items.map((i) => [i.id, i]));
    const kinds = new Set(body[0]!.sourceItemRefs.map((r) => byId.get(r)!.kind));
    expect(kinds.size).toBe(2);
    // One chunk of eight takes the full width.
    expect(body).toHaveLength(1);
    expect(body[0]!.layout.span).toBe(12);
    expect(detectSiloViolations(plan, items)).toEqual([]);
    expectCatalogConstraints(plan);
  });

  it('re-interleaves a block grouped by source so the order alternates', () => {
    const items = siloItems();
    const body = [block('blk_g', 'topic_cluster', ['m1', 'm2', 'c1', 'c2'], 12, { topic: '묶음' })];
    const { plan, issues, violations } = enforceMixedComposition(planOf([...body, sourceList(body)]), items);
    expect(violations.map((v) => v.kind)).toEqual(['grouped-by-source']);
    expect(issues.length).toBeGreaterThan(0);
    const fixed = plan.blocks.find((b) => b.id === 'blk_g');
    expect(fixed).toBeDefined();
    expect(fixed!.sourceItemRefs).toEqual(['m1', 'c1', 'm2', 'c2']);
    expect(fixed!.componentType).toBe('topic_cluster');
    expect(detectSiloViolations(plan, items)).toEqual([]);
    expectCatalogConstraints(plan);
  });

  it('returns the identical plan object for a clean topic-composed page', () => {
    const items = siloItems();
    const input = cleanPlan(items);
    const out = enforceMixedComposition(input, items);
    expect(out.plan).toBe(input);
    expect(out.issues).toEqual([]);
    expect(out.violations).toEqual([]);
  });

  it('leaves a single-source pool alone', () => {
    const items = [
      item('s1', 'article', '테스트 소스'),
      item('s2', 'article', '테스트 소스'),
      item('s3', 'post', '테스트 소스'),
      item('s4', 'post', '테스트 소스')
    ];
    const body = [
      block('blk_a', 'article_list', ['s1', 's2'], 6),
      block('blk_p', 'community_posts', ['s3', 's4'], 6)
    ];
    const input = planOf([...body, sourceList(body)]);
    const out = enforceMixedComposition(input, items);
    expect(out.plan).toBe(input);
    expect(out.violations).toEqual([]);
  });

  it('keeps source_list last and the untouched blocks in place', () => {
    const items = [
      ...siloItems(),
      item('v1', 'video', 'IT유튜브'),
      item('v2', 'video', 'IT유튜브')
    ];
    const body = [
      block('blk_s', 'synthesis_brief', ['m1', 'h1'], 12, { points: [{ text: '요약', cites: [0, 1] }] }),
      block('blk_v', 'video_player', ['v1', 'v2'], 8),
      block('blk_head', 'heading', [], 12, { text: '오늘의 소식' }),
      block('blk_m', 'article_list', ['m1', 'm2', 'm3'], 6),
      block('blk_c', 'article_list', ['c1', 'c2', 'c3'], 6),
      block('blk_txt', 'text', [], 12, { text: '안내' }),
      block('blk_h', 'community_posts', ['h1', 'h2', 'h3'], 12)
    ];
    const input = planOf([...body, sourceList(body)]);
    const { plan } = enforceMixedComposition(input, items);
    const t = plan.blocks.map((b) => b.componentType);
    expect(t[t.length - 1]).toBe('source_list');
    expect(t.filter((x) => x === 'source_list')).toHaveLength(1);
    // Opener, anchor and structural blocks are the same objects, same order.
    expect(plan.blocks[0]).toBe(input.blocks[0]);
    expect(plan.blocks[1]).toBe(input.blocks[1]);
    expect(plan.blocks[2]).toBe(input.blocks[2]);
    // The clusters land where the first offending block was; the text note
    // that sat between the silos keeps its relative position after them.
    expect(t[3]).toBe('topic_cluster');
    const lastCluster = t.lastIndexOf('topic_cluster');
    expect(t[lastCluster + 1]).toBe('text');
    expect(t).not.toContain('article_list');
    expect(t).not.toContain('community_posts');
    expect(LayoutPlanSchema.safeParse(plan).success).toBe(true);
    expectCatalogConstraints(plan);
  });

  it('splits a large merged pool into several cards without dropping items', () => {
    const items: SourceItem[] = [];
    for (let i = 0; i < 9; i++) items.push(item(`a${i}`, 'article', '매일경제'));
    for (let i = 0; i < 9; i++) items.push(item(`b${i}`, 'article', '조선일보'));
    const body = [
      block('blk_a', 'article_list', items.slice(0, 9).map((i) => i.id), 6),
      block('blk_b', 'article_list', items.slice(9).map((i) => i.id), 6)
    ];
    const { plan } = enforceMixedComposition(planOf([...body, sourceList(body)]), items);
    const clusters = bodyBlocks(plan);
    expect(clusters.length).toBeGreaterThanOrEqual(3);
    const refs = clusters.flatMap((b) => b.sourceItemRefs);
    expect(refs).toHaveLength(18);
    expect(new Set(refs).size).toBe(18);
    for (const c of clusters) {
      expect(c.sourceItemRefs.length).toBeLessThanOrEqual(8);
      expect(c.sourceItemRefs.length).toBeGreaterThanOrEqual(2);
      expect(sourcesOf(items, c).size).toBe(2);
    }
    // Two-up grid: an odd trailing card goes full width.
    if (clusters.length % 2 === 1) expect(clusters[clusters.length - 1]!.layout.span).toBe(12);
    expectCatalogConstraints(plan);
  });

  it('is deterministic modulo block ids', () => {
    const items = siloItems();
    const a = enforceMixedComposition(siloPlan(), items);
    const b = enforceMixedComposition(siloPlan(), items);
    expect(shape(a.plan)).toEqual(shape(b.plan));
    expect(a.issues).toEqual(b.issues);
    expect(a.violations).toEqual(b.violations);
  });
});
