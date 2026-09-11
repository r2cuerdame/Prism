import { describe, expect, it } from 'vitest';
import { getCatalogEntry } from '@shared/catalog/catalog';
import type { InterpretedIntent } from '@shared/domain/intent';
import type { ComponentBlock, LayoutPlan } from '@shared/domain/layoutPlan';
import { LayoutPlanSchema } from '@shared/domain/layoutPlan';
import type { SourceItem, SourceItemKind } from '@shared/domain/sourceItem';
import { SourceItemSchema } from '@shared/domain/sourceItem';
import type { PlanRequest } from './plannerTypes';
import { heuristicPlan } from './heuristicPlanner';
import { detectSiloViolations } from './mixInvariants';

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

/**
 * Items from six distinct sources; three of them (매일경제, Hacker News,
 * IT유튜브) share a topic, and every kind spans at least two sources.
 */
function multiSourceItems(): SourceItem[] {
  return [
    item('v1', 'video', { sourceName: 'IT유튜브', title: '삼성전자 반도체 전망 분석' }),
    item('v2', 'video', { sourceName: 'IT유튜브', title: '고양이 브이로그 일상' }),
    item('v3', 'video', { sourceName: '여행유튜브', title: '제주도 여행 풍경 기록' }),
    item('v4', 'video', { sourceName: '여행유튜브', title: '우주 다큐멘터리 하이라이트' }),
    item('a1', 'article', {
      sourceName: '매일경제',
      title: '삼성전자 반도체 실적 발표',
      publishedAt: '2026-08-18T10:00:00.000Z'
    }),
    item('a2', 'article', {
      sourceName: '매일경제',
      title: '부동산 시장 금리 동향',
      publishedAt: '2026-08-18T09:00:00.000Z'
    }),
    item('a3', 'article', {
      sourceName: '조선일보',
      title: '전기차 배터리 수출 급증',
      publishedAt: '2026-08-18T08:00:00.000Z'
    }),
    item('a4', 'article', {
      sourceName: '조선일보',
      title: '인공지능 규제 법안 논의',
      publishedAt: '2026-08-18T07:00:00.000Z'
    }),
    item('h1', 'headline', {
      sourceName: '매일경제',
      title: '환율 급등 증시 출렁',
      publishedAt: '2026-08-19T01:00:00.000Z'
    }),
    item('h2', 'headline', {
      sourceName: '조선일보',
      title: '태풍 북상 주말 영향',
      publishedAt: '2026-08-19T02:00:00.000Z'
    }),
    item('p1', 'post', {
      sourceName: 'Hacker News',
      title: '삼성전자 3나노 수율 공개',
      payload: { community: 'hn', commentCount: 250 }
    }),
    item('p2', 'post', {
      sourceName: 'Hacker News',
      title: '오픈소스 라이선스 논쟁 정리',
      payload: { community: 'hn', commentCount: 12 }
    }),
    item('p3', 'post', { sourceName: 'Lobsters', title: '러스트 컴파일러 성능 개선' }),
    item('p4', 'post', { sourceName: 'Lobsters', title: '타입스크립트 모노레포 구성' })
  ];
}

/**
 * Sixteen items from four sources whose titles share NO tokens, so
 * clusterByTopic finds nothing and the body must be mixed some other way.
 */
function flatMultiSourceItems(): SourceItem[] {
  return [
    item('v1', 'video', { sourceName: 'IT유튜브', title: '노트북 언박싱' }),
    item('v2', 'video', { sourceName: 'IT유튜브', title: '키보드 조립기' }),
    item('v3', 'video', { sourceName: 'IT유튜브', title: '모니터 비교' }),
    item('v4', 'video', { sourceName: 'IT유튜브', title: '헤드폰 리뷰' }),
    item('a1', 'article', { sourceName: '매일경제', title: '환율 전망' }),
    item('a2', 'article', { sourceName: '매일경제', title: '수출 통계' }),
    item('a3', 'article', { sourceName: '매일경제', title: '유가 흐름' }),
    item('a4', 'article', { sourceName: '매일경제', title: '고용 지표' }),
    item('a5', 'article', { sourceName: '조선일보', title: '국회 본회의' }),
    item('a6', 'article', { sourceName: '조선일보', title: '교육 개편안' }),
    item('h1', 'headline', { sourceName: '조선일보', title: '폭염 경보' }),
    item('h2', 'headline', { sourceName: '조선일보', title: '항공 결항' }),
    item('p1', 'post', { sourceName: 'Hacker News', title: 'Rust async runtime', payload: { community: 'hn' } }),
    item('p2', 'post', { sourceName: 'Hacker News', title: 'Postgres indexing tips', payload: { community: 'hn' } }),
    item('p3', 'post', { sourceName: 'Hacker News', title: 'Wasm sandbox design', payload: { community: 'hn' } }),
    item('p4', 'post', { sourceName: 'Hacker News', title: 'Vim keybinding guide', payload: { community: 'hn' } })
  ];
}

function types(plan: LayoutPlan): string[] {
  return plan.blocks.map((b) => b.componentType);
}

function sourcesOfRefs(plan: LayoutPlan, items: SourceItem[], block: ComponentBlock): Set<string> {
  const byId = new Map(items.map((i) => [i.id, i]));
  const set = new Set<string>();
  for (const r of block.sourceItemRefs) {
    const it2 = byId.get(r);
    if (it2) set.add(it2.sourceName);
  }
  return set;
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

describe('heuristicPlan', () => {
  it('uses valid fixtures', () => {
    for (const it2 of [...mixedItems(), ...multiSourceItems()]) {
      expect(SourceItemSchema.safeParse(it2).success).toBe(true);
    }
  });

  it('composes a full page from mixed items with source_list last', () => {
    const { plan, issues } = heuristicPlan(reqOf(mixedItems()));
    expect(issues).toEqual([]);
    const t = types(plan);
    // A watchable anchor plus a topic-composed body — not one block per kind.
    expect(t).toContain('video_player');
    expect(t).toContain('video_queue');
    expect(t).toContain('topic_cluster');
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
    expectCatalogConstraints(plan);
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

  it('puts the watchable anchor before the topic-composed body', () => {
    const { plan } = heuristicPlan(
      reqOf(mixedItems(), {
        interpretation: interp({ contentBalance: { video: 0.9, article: 0.2, post: 0.1, headline: 0.1 } })
      })
    );
    const t = types(plan);
    const player = t.indexOf('video_player');
    expect(player).toBeGreaterThanOrEqual(0);
    const body = t.findIndex((x, i) => i > player && x !== 'video_queue' && x !== 'source_list');
    // Anything that follows the anchor is body composition, never a kind silo.
    if (body >= 0) expect(t[body]).toBe('topic_cluster');
  });
});

describe('heuristicPlan cross-source synthesis', () => {
  it('opens with a synthesis_brief whose cites resolve, then a topic_cluster spanning sources', () => {
    const items = multiSourceItems();
    const { plan } = heuristicPlan(reqOf(items));

    const first = plan.blocks[0]!;
    expect(first.componentType).toBe('synthesis_brief');
    expect(first.layout.span).toBe(12);
    const points = first.props.points as { text: string; cites: number[] }[];
    expect(points.length).toBeGreaterThan(0);
    for (const p of points) {
      expect(p.text.length).toBeGreaterThan(0);
      for (const c of p.cites) {
        expect(c).toBeGreaterThanOrEqual(0);
        expect(c).toBeLessThan(first.sourceItemRefs.length);
      }
    }

    const clusters = plan.blocks.filter((b) => b.componentType === 'topic_cluster');
    expect(clusters.length).toBeGreaterThanOrEqual(1);
    // At least one thread must genuinely span sources — that is the point.
    expect(clusters.some((c) => sourcesOfRefs(plan, items, c).size >= 2)).toBe(true);
    for (const c of clusters) {
      expect(String(c.props.topic).length).toBeGreaterThan(0);
      expect(String(c.props.angle).length).toBeGreaterThan(0);
      expect(c.rationale).toBeTruthy();
    }

    expect(plan.blocks[plan.blocks.length - 1]!.componentType).toBe('source_list');
    expect(LayoutPlanSchema.safeParse(plan).success).toBe(true);
    expectCatalogConstraints(plan);
  });

  it('never fills a multi-item block from a single source when the pool has several', () => {
    const items = multiSourceItems();
    const { plan } = heuristicPlan(reqOf(items));
    for (const b of plan.blocks) {
      if (b.sourceItemRefs.length < 2) continue;
      expect(sourcesOfRefs(plan, items, b).size).toBeGreaterThanOrEqual(2);
    }
  });

  it('shows each item once in the body: the anchor and the clusters never overlap', () => {
    const items = multiSourceItems();
    const { plan } = heuristicPlan(reqOf(items));
    const anchorRefs = new Set(
      plan.blocks
        .filter((b) => b.componentType === 'video_player' || b.componentType === 'video_queue')
        .flatMap((b) => b.sourceItemRefs)
    );
    const clusterRefs = plan.blocks
      .filter((b) => b.componentType === 'topic_cluster')
      .flatMap((b) => b.sourceItemRefs);
    for (const r of clusterRefs) expect(anchorRefs.has(r)).toBe(false);
    // Clusters must not repeat an item between themselves either.
    expect(new Set(clusterRefs).size).toBe(clusterRefs.length);
  });

  it('allows reuse when synthesis would otherwise leave the page empty', () => {
    const pair = [
      item('x1', 'article', { sourceName: '매일경제', title: '삼성전자 반도체 실적 발표' }),
      item('x2', 'post', {
        sourceName: 'Hacker News',
        title: '삼성전자 반도체 투자 논쟁',
        payload: { community: 'hn' }
      })
    ];
    const { plan } = heuristicPlan(reqOf(pair));
    const t = types(plan);
    expect(t[0]).toBe('synthesis_brief');
    expect(t).toContain('topic_cluster');
    expect(t[t.length - 1]).toBe('source_list');
    expect(plan.blocks.length).toBeGreaterThanOrEqual(3);
    expectCatalogConstraints(plan);
  });

  it('single-source pool: no synthesis brief, but still a topic-composed page', () => {
    const { plan } = heuristicPlan(reqOf(mixedItems()));
    const t = types(plan);
    // Synthesis is about what SOURCES jointly say, so one source earns none.
    expect(t).not.toContain('synthesis_brief');
    expect(plan.blocks.length).toBeGreaterThanOrEqual(1);
    expect(t[t.length - 1]).toBe('source_list');
    expect(LayoutPlanSchema.safeParse(plan).success).toBe(true);
    expectCatalogConstraints(plan);
  });

  it('follows recipeShape order and spans, applies density, keeps source_list last', () => {
    const items = multiSourceItems();
    const { plan } = heuristicPlan(
      reqOf(items, {
        hints: { mix: { headline: 'less' }, notes: [] },
        recipeShape: {
          name: '아침 브리핑',
          layoutTemplate: [
            { componentType: 'community_posts', span: 12 },
            { componentType: 'article_list', span: 8 },
            { componentType: 'video_player', span: 6 }
          ],
          density: 'compact'
        }
      })
    );
    const t = types(plan);
    expect(t.slice(0, 3)).toEqual(['community_posts', 'article_list', 'video_player']);
    const posts = plan.blocks[0]!;
    const articles = plan.blocks[1]!;
    const player = plan.blocks[2]!;
    expect(posts.layout.span).toBe(12);
    expect(articles.layout.span).toBe(8);
    expect(articles.props.density).toBe('compact');
    expect(player.layout.span).toBe(6);
    expect(t[t.length - 1]).toBe('source_list');
    expect(t.filter((x) => x === 'source_list')).toHaveLength(1);
    // The template is the page: even the synthesis opener is dropped when the
    // saved shape does not list it.
    expect(t).not.toContain('synthesis_brief');
    expect(t).toEqual(['community_posts', 'article_list', 'video_player', 'source_list']);
    expectCatalogConstraints(plan);
  });

  it('applies a template slot title, pins and props to the block filling it', () => {
    const items = multiSourceItems();
    const { plan } = heuristicPlan(
      reqOf(items, {
        recipeShape: {
          name: '나만의 아침',
          layoutTemplate: [
            {
              componentType: 'community_posts',
              span: 12,
              title: '오늘의 토론',
              docked: true,
              locked: true,
              props: { maxItems: 3, showMeta: false }
            },
            { componentType: 'article_list', span: 6 }
          ],
          density: 'comfortable'
        }
      })
    );
    const posts = plan.blocks.find((b) => b.componentType === 'community_posts');
    expect(posts).toBeDefined();
    expect(posts!.props.title).toBe('오늘의 토론');
    expect(posts!.props.maxItems).toBe(3);
    expect(posts!.props.showMeta).toBe(false);
    expect(posts!.docked).toBe(true);
    expect(posts!.locked).toBe(true);
    expect(posts!.layout.span).toBe(12);
    // A slot with no shaping leaves the planner's own props alone.
    const articles = plan.blocks.find((b) => b.componentType === 'article_list');
    expect(articles!.props.title).toBeUndefined();
    expect(articles!.docked).toBe(false);
    expect(articles!.locked).toBe(false);
    expectCatalogConstraints(plan);
  });

  it('never brings back a component the template left out', () => {
    const items = multiSourceItems();
    const { plan } = heuristicPlan(
      reqOf(items, {
        recipeShape: {
          name: '기사만',
          layoutTemplate: [{ componentType: 'article_list', span: 12 }],
          density: 'comfortable'
        }
      })
    );
    const t = types(plan);
    // Everything the user deleted before saving stays deleted on reopen.
    expect(t).toEqual(['article_list', 'source_list']);
    expect(t[t.length - 1]).toBe('source_list');
    expectCatalogConstraints(plan);
  });

  it('fills topic_cluster slots when the saved page was topic-composed', () => {
    const items = multiSourceItems();
    const { plan } = heuristicPlan(
      reqOf(items, {
        recipeShape: {
          name: '주제 중심',
          layoutTemplate: [
            { componentType: 'topic_cluster', span: 12, title: '내가 고른 묶음' },
            { componentType: 'synthesis_brief', span: 12 }
          ],
          density: 'comfortable'
        }
      })
    );
    const t = types(plan);
    expect(t).toEqual(['topic_cluster', 'synthesis_brief', 'source_list']);
    expect(plan.blocks[0]!.props.title).toBe('내가 고른 묶음');
    // The cluster's own topic is regenerated, never restored from the Recipe.
    expect(String(plan.blocks[0]!.props.topic).length).toBeGreaterThan(0);
    expectCatalogConstraints(plan);
  });

  it('falls back to the planner page when no template slot can be filled', () => {
    const items = multiSourceItems();
    const { plan } = heuristicPlan(
      reqOf(items, {
        recipeShape: {
          name: '읽기 전용',
          layoutTemplate: [{ componentType: 'reader', span: 8 }],
          density: 'comfortable'
        }
      })
    );
    // An empty page honors no shaping either — the planner's own page stands.
    expect(plan.blocks.length).toBeGreaterThan(1);
    expect(types(plan)[types(plan).length - 1]).toBe('source_list');
    expectCatalogConstraints(plan);
  });

  it('clamps out-of-range recipeShape spans to catalog bounds', () => {
    const items = multiSourceItems();
    const { plan } = heuristicPlan(
      reqOf(items, {
        recipeShape: {
          name: '넓게',
          layoutTemplate: [{ componentType: 'video_player', span: 2 }],
          density: 'comfortable'
        }
      })
    );
    const player = plan.blocks.find((b) => b.componentType === 'video_player');
    expect(player).toBeDefined();
    expect(player!.layout.span).toBe(6); // video_player minSpan
    expectCatalogConstraints(plan);
  });

  it('never devolves into site-silo sections for a normal multi-source request', () => {
    const skip = new Set(['source_list', 'synthesis_brief', 'video_player', 'video_queue']);
    for (const items of [multiSourceItems(), flatMultiSourceItems()]) {
      for (const it2 of items) expect(SourceItemSchema.safeParse(it2).success).toBe(true);
      const { plan } = heuristicPlan(reqOf(items));
      expect(detectSiloViolations(plan, items)).toEqual([]);
      const body = plan.blocks.filter(
        (b) => b.sourceItemRefs.length > 0 && !skip.has(b.componentType)
      );
      expect(body.length).toBeGreaterThan(0);
      expect(body.some((b) => sourcesOfRefs(plan, items, b).size >= 2)).toBe(true);
      expect(types(plan)[types(plan).length - 1]).toBe('source_list');
      expectCatalogConstraints(plan);
    }
  });

  it('regression: the silo check does fail a page built as one list per site', () => {
    const items = flatMultiSourceItems();
    const silo = (id: string, type: string, refs: string[]): ComponentBlock => ({
      id,
      componentType: type,
      componentVersion: 1,
      sourceItemRefs: refs,
      props: {},
      layout: { span: 6 },
      locked: false,
      docked: false,
      state: {}
    });
    const devolved: LayoutPlan = {
      id: 'plan_silo',
      version: 1,
      sessionId: 'sess_1',
      blocks: [
        silo('blk_m', 'article_list', ['a1', 'a2', 'a3', 'a4']),
        silo('blk_c', 'article_list', ['a5', 'a6', 'h1', 'h2']),
        silo('blk_h', 'community_posts', ['p1', 'p2', 'p3', 'p4']),
        silo('blk_src', 'source_list', items.map((i) => i.id))
      ],
      generationScope: 'full',
      preservedEdits: { dockedBlockIds: [] },
      plannerMetadata: { planner: 'heuristic', generatedAt: '2026-08-19T00:00:00.000Z', diagnostics: [] }
    };
    const violations = detectSiloViolations(devolved, items);
    expect(violations.length).toBeGreaterThan(0);
    expect(violations.map((v) => v.kind)).toContain('site-silo');
  });

  it('is structurally deterministic for the same request', () => {
    const items = multiSourceItems();
    const shape = (plan: LayoutPlan): unknown =>
      plan.blocks.map((b) => ({
        type: b.componentType,
        refs: b.sourceItemRefs,
        span: b.layout.span,
        props: b.props
      }));
    expect(shape(heuristicPlan(reqOf(items)).plan)).toEqual(
      shape(heuristicPlan(reqOf(items)).plan)
    );
  });
});
