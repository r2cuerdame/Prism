import { getCatalogEntry } from '@shared/catalog/catalog';
import { newId } from '@shared/domain/ids';
import type { ComponentBlock, LayoutPlan } from '@shared/domain/layoutPlan';
import type { SourceItem, SourceItemKind } from '@shared/domain/sourceItem';
import {
  buildSynthesisPoints,
  clusterByTopic,
  interleaveBySource,
  type TopicCluster
} from './crossSource';
import type { PlanRequest, PlanResult } from './plannerTypes';

const KINDS: readonly SourceItemKind[] = ['video', 'article', 'post', 'headline'];

const DEFAULT_WEIGHT: Record<SourceItemKind, number> = {
  video: 0.5,
  article: 0.4,
  post: 0.4,
  headline: 0.3
};

const KIND_LABEL: Record<SourceItemKind, string> = {
  video: '영상',
  article: '기사',
  post: '커뮤니티',
  headline: '헤드라인'
};

function makeBlock(
  type: string,
  refs: string[],
  span: number,
  props: Record<string, unknown>,
  rationale: string
): ComponentBlock | null {
  const entry = getCatalogEntry(type);
  if (!entry) return null;
  const sliced = refs.slice(0, entry.maxItems);
  if (sliced.length < entry.minItems) return null;
  const clamped = Math.min(entry.maxSpan, Math.max(entry.minSpan, Math.round(span)));
  return {
    id: newId('blk'),
    componentType: type,
    componentVersion: entry.version,
    sourceItemRefs: sliced,
    props: { ...entry.defaultProps, ...props },
    layout: { span: clamped },
    locked: false,
    docked: false,
    rationale,
    state: {}
  };
}

function itemTime(item: SourceItem): number {
  const t = Date.parse(item.publishedAt ?? item.retrievedAt);
  return Number.isNaN(t) ? 0 : t;
}

/** Short Korean line naming what a cluster's sources are. */
function clusterAngle(cluster: TopicCluster): string {
  const kinds: string[] = [];
  for (const it of cluster.items) {
    const label = KIND_LABEL[it.kind];
    if (!kinds.includes(label)) kinds.push(label);
  }
  const base = kinds.length >= 2 ? kinds.join('·') : cluster.sources.join('·');
  const line = `${base}에서 함께 다뤄요`;
  return line.length <= 300 ? line : `${line.slice(0, 299)}…`;
}

/**
 * Rebuild the page from a saved Recipe's layout template: template order,
 * template spans (clamped to catalog bounds) and the shaping the user gave each
 * slot — renamed title, dock/lock pins, and props merged OVER what the planner
 * produced so a saved maxItems/density actually applies. Recipes save shape,
 * never content.
 *
 * The template IS the page: a component the template does not list is dropped
 * rather than appended, or a section the user deleted would return on every
 * reopen. source_list is appended later and always stays last, so template
 * slots for it are ignored here. The one exception is a template that nothing
 * on this run can fill — then the planner's own page stands, since an empty
 * page honors no shaping either.
 */
function applyRecipeShape(
  blocks: ComponentBlock[],
  shape: NonNullable<PlanRequest['recipeShape']>
): ComponentBlock[] {
  const rest = [...blocks];
  const ordered: ComponentBlock[] = [];
  for (const slot of shape.layoutTemplate) {
    if (slot.componentType === 'source_list') continue;
    const i = rest.findIndex((b) => b.componentType === slot.componentType);
    if (i === -1) continue;
    const block = rest.splice(i, 1)[0]!;
    const entry = getCatalogEntry(block.componentType);
    const span = entry
      ? Math.min(entry.maxSpan, Math.max(entry.minSpan, Math.round(slot.span)))
      : block.layout.span;
    const props: Record<string, unknown> = { ...block.props, ...(slot.props ?? {}) };
    if (slot.title !== undefined) props.title = slot.title;
    ordered.push({
      ...block,
      props,
      layout: { ...block.layout, span },
      docked: slot.docked ?? block.docked,
      locked: slot.locked ?? block.locked
    });
  }
  return ordered.length > 0 ? ordered : blocks;
}

/**
 * Deterministic offline planner. Composes ONE synthesized page from available
 * items using COMPONENT_CATALOG constraints: a cross-source synthesis brief
 * and topic clusters open the page, kind-driven sections (with sources
 * interleaved) fill the rest, and a single source_list closes it. Never emits
 * blocks for preserved docked blocks (the session reducer re-inserts them).
 */
export function heuristicPlan(req: PlanRequest): PlanResult {
  const issues: string[] = [];

  const dockedBlockIds = req.preserved.dockedBlocks.map((b) => b.id);
  const dockedRefs = new Set(req.preserved.dockedBlocks.flatMap((b) => b.sourceItemRefs));
  const available = req.items.filter((it) => !dockedRefs.has(it.id));

  const byKind: Record<SourceItemKind, SourceItem[]> = {
    video: [],
    article: [],
    post: [],
    headline: []
  };
  for (const it of available) byKind[it.kind].push(it);

  const mix = req.hints.mix;
  for (const kind of KINDS) {
    if (mix[kind] === 'less' && byKind[kind].length > 0) {
      const kept = Math.floor(byKind[kind].length / 2);
      byKind[kind] = byKind[kind].slice(0, kept);
      if (kept === 0) issues.push(`'${kind}' 항목은 줄이기 힌트에 따라 제외했습니다.`);
    }
  }

  // The working pool after mix filtering, in original order.
  const keptIds = new Set<string>(KINDS.flatMap((k) => byKind[k].map((it) => it.id)));
  const pool = available.filter((it) => keptIds.has(it.id));
  const distinctSources = new Set(pool.map((it) => it.sourceName));

  // --- synthesis opener ---------------------------------------------------
  // Citing an item does not consume it: a bullet about an article and the
  // article's own card are different things, so the body still shows it.
  const crossBlocks: ComponentBlock[] = [];
  const openerClusters = clusterByTopic(pool);

  if (pool.length >= 2 && distinctSources.size >= 2) {
    const synth = buildSynthesisPoints(pool, openerClusters);
    if (synth.points.length > 0 && synth.citedItems.length >= 2) {
      const brief = makeBlock(
        'synthesis_brief',
        synth.citedItems.map((it) => it.id),
        12,
        { points: synth.points },
        `${distinctSources.size}개 소스에서 모은 내용을 하나의 브리핑으로 합성했어요.`
      );
      if (brief) crossBlocks.push(brief);
    }
  }

  // --- video anchor -------------------------------------------------------
  // Kept as a functional anchor (you can actually watch here), deliberately
  // small so the body stays topic-driven rather than kind-driven.
  const ANCHOR_VIDEO_CAP = 6;
  const anchorUsed = new Set<string>();
  const anchorVideos =
    mix.video === 'less' ? [] : interleaveBySource(byKind.video).slice(0, ANCHOR_VIDEO_CAP);
  for (const v of anchorVideos) anchorUsed.add(v.id);

  // Everything the anchor did not take is composed BY TOPIC, across kinds and
  // sources — the page is not "a video section, then a news section".
  const bodyPool = pool.filter((it) => !anchorUsed.has(it.id));
  // A saved Recipe shape wins over topic composition — the user shaped that
  // page themselves, so honor their sections instead of re-deriving a body.
  // A template that saved topic cards is the exception: it needs cards to fill
  // its slots, so that page stays topic-composed.
  const recipeWantsClusters =
    req.recipeShape?.layoutTemplate.some((s) => s.componentType === 'topic_cluster') ?? false;
  const followRecipe = req.recipeShape !== undefined && !recipeWantsClusters;
  const multiSource = followRecipe
    ? []
    : clusterByTopic(bodyPool, { minSources: 2, maxClusters: 6 });
  // No single-source cards: one card holding only one outlet reads as "this
  // section is that site". Those items fall through to the mixed cards below,
  // where they alternate with everything else.
  const bodyClusters = multiSource;

  const clusterBlocks: ComponentBlock[] = [];
  const clustered = new Set<string>();
  bodyClusters.forEach((cluster, i) => {
    const refs = interleaveBySource(cluster.items).map((it) => it.id);
    const lastAlone = i === bodyClusters.length - 1 && bodyClusters.length % 2 === 1;
    const block = makeBlock(
      'topic_cluster',
      refs,
      bodyClusters.length === 1 || lastAlone ? 12 : 6,
      { topic: cluster.topic, angle: clusterAngle(cluster) },
      cluster.sources.length >= 2
        ? `${cluster.sources.length}개 소스가 같은 주제를 다뤄 한 카드로 묶었어요.`
        : '같은 흐름의 이야기를 한 카드로 묶었어요.'
    );
    if (block) {
      clusterBlocks.push(block);
      for (const r of block.sourceItemRefs) clustered.add(r);
    }
  });

  // Leftovers become mixed cards too, never per-kind sections.
  const MIXED_CAP = 8;
  const leftovers = interleaveBySource(bodyPool.filter((it) => !clustered.has(it.id)));
  const mixedLabels = followRecipe
    ? []
    : ['그 밖에 눈에 띈 것들', '더 둘러보기', '이어서 볼 것들', '마저 훑어보기'];
  for (let i = 0; i < mixedLabels.length; i++) {
    const slice = leftovers.slice(i * MIXED_CAP, (i + 1) * MIXED_CAP);
    if (slice.length < 2) break;
    const block = makeBlock(
      'topic_cluster',
      slice.map((it) => it.id),
      6,
      { topic: mixedLabels[i]!, angle: '주제가 겹치지 않는 것들을 종류 구분 없이 모았어요' },
      '남은 항목을 종류를 섞어 한 카드로 모았어요.'
    );
    if (block) {
      clusterBlocks.push(block);
      for (const r of block.sourceItemRefs) clustered.add(r);
    }
  }

  // Kind sections survive only as the fallback for a pool that refuses to
  // cluster (e.g. a handful of unrelated items).
  const remaining = clusterBlocks.length > 0 ? [] : bodyPool;

  const remainingByKind: Record<SourceItemKind, SourceItem[]> = {
    video: [],
    article: [],
    post: [],
    headline: []
  };
  for (const it of remaining) remainingByKind[it.kind].push(it);

  // --- video anchor blocks -------------------------------------------------
  const videoBlocks: ComponentBlock[] = [];
  const vids = anchorVideos.map((v) => v.id);
  if (vids.length > 0) {
    if (vids.length === 1) {
      const p = makeBlock('video_player', vids, 12, {}, '요청과 관련된 영상 한 편을 크게 보여줍니다.');
      if (p) videoBlocks.push(p);
    } else {
      const playerCount = Math.min(6, Math.ceil(vids.length / 2));
      const queueCap = mix.video === 'more' ? 12 : 6;
      const p = makeBlock(
        'video_player',
        vids.slice(0, playerCount),
        8,
        {},
        '볼거리의 중심이 되는 영상 플레이어입니다.'
      );
      if (p) videoBlocks.push(p);
      const queueRefs = vids.slice(playerCount, playerCount + queueCap);
      if (queueRefs.length > 0) {
        const q = makeBlock('video_queue', queueRefs, 4, { title: '다음 영상' }, '이어서 볼 수 있는 영상 목록입니다.');
        if (q) videoBlocks.push(q);
      }
    }
  }

  // --- news section (headline strip + article list) -----------------------
  // Newest first, then interleaved across sources so no list is one outlet's
  // silo when alternatives exist.
  const newsPool = interleaveBySource(
    [...remainingByKind.article, ...remainingByKind.headline].sort(
      (a, b) => itemTime(b) - itemTime(a)
    )
  );

  const headlineBlocks: ComponentBlock[] = [];
  let stripRefs: string[] = [];
  if (newsPool.length >= 3 && mix.headline !== 'less') {
    const stripCap = mix.headline === 'more' ? 10 : 5;
    stripRefs = newsPool.slice(0, stripCap).map((it) => it.id);
    const s = makeBlock('headline_strip', stripRefs, 12, {}, '여러 소스의 최근 소식을 한 줄로 섞어 훑어봅니다.');
    if (s) headlineBlocks.push(s);
    else stripRefs = [];
  }

  const articleBlocks: ComponentBlock[] = [];
  const remainingArticles = newsPool.filter((it) => !stripRefs.includes(it.id)).map((it) => it.id);
  const articleCap = mix.article === 'more' ? 12 : 6;
  const articleRefs = remainingArticles.slice(0, articleCap);

  const postBlocks: ComponentBlock[] = [];
  const postRefs = interleaveBySource(remainingByKind.post).map((p) => p.id);

  const hasPosts = postRefs.length > 0;
  const hasArticles = articleRefs.length > 0;

  if (hasArticles) {
    const articleProps: Record<string, unknown> = {
      maxItems: Math.min(articleRefs.length, articleCap)
    };
    if (req.recipeShape) articleProps.density = req.recipeShape.density;
    const a = makeBlock(
      'article_list',
      articleRefs,
      hasPosts ? 6 : 12,
      articleProps,
      '읽어볼 만한 기사를 소스를 섞어 모았습니다.'
    );
    if (a) articleBlocks.push(a);
  }

  if (hasPosts) {
    const c = makeBlock(
      'community_posts',
      postRefs,
      hasArticles ? 6 : 12,
      {},
      '관련 커뮤니티의 토론을 모았습니다.'
    );
    if (c) postBlocks.push(c);
  }

  // --- fallback kind sections, ordered by contentBalance weight ------------
  const weight = (k: SourceItemKind): number =>
    req.interpretation.contentBalance[k] ?? DEFAULT_WEIGHT[k];
  const sections: { kind: SourceItemKind; blocks: ComponentBlock[] }[] = [
    { kind: 'headline', blocks: headlineBlocks },
    { kind: 'article', blocks: articleBlocks },
    { kind: 'post', blocks: postBlocks }
  ];
  const orderedSections = sections
    .map((s, i) => ({ ...s, i }))
    .sort((a, b) => weight(b.kind) - weight(a.kind) || a.i - b.i);

  // Synthesis, then the watchable anchor, then the topic-composed body.
  let blocks: ComponentBlock[] = [
    ...crossBlocks,
    ...videoBlocks,
    ...clusterBlocks,
    ...orderedSections.flatMap((s) => s.blocks)
  ];

  // --- Recipe shape: preferred section order/spans ------------------------
  if (req.recipeShape) blocks = applyRecipeShape(blocks, req.recipeShape);

  // --- source_list (always last) ------------------------------------------
  const usedRefs: string[] = [];
  for (const b of blocks) {
    for (const r of b.sourceItemRefs) if (!usedRefs.includes(r)) usedRefs.push(r);
  }
  if (usedRefs.length > 0) {
    const src = makeBlock('source_list', usedRefs, 12, {}, '이 페이지를 구성한 모든 출처입니다.');
    if (src) blocks.push(src);
  }

  // --- guarantee at least one block ---------------------------------------
  if (blocks.length === 0) {
    const empty = makeBlock(
      'text',
      [],
      12,
      { text: '아직 가져온 콘텐츠가 없어요. 의도를 조금 더 구체적으로 입력해 보세요.' },
      '표시할 콘텐츠가 없어 안내 문구를 보여줍니다.'
    );
    if (empty) blocks.push(empty);
    if (req.items.length === 0) issues.push('사용 가능한 소스 아이템이 없습니다.');
  }

  const plan: LayoutPlan = {
    id: newId('plan'),
    version: 1,
    sessionId: req.sessionId,
    blocks,
    generationScope: 'full',
    preservedEdits: { dockedBlockIds },
    plannerMetadata: {
      planner: 'heuristic',
      generatedAt: new Date().toISOString(),
      diagnostics: []
    }
  };

  return { plan, issues };
}
