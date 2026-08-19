import { getCatalogEntry } from '@shared/catalog/catalog';
import { newId } from '@shared/domain/ids';
import type { ComponentBlock, LayoutPlan } from '@shared/domain/layoutPlan';
import type { SourceItem, SourceItemKind } from '@shared/domain/sourceItem';
import type { PlanRequest, PlanResult } from './plannerTypes';

const KINDS: readonly SourceItemKind[] = ['video', 'article', 'post', 'headline'];

const DEFAULT_WEIGHT: Record<SourceItemKind, number> = {
  video: 0.5,
  article: 0.4,
  post: 0.4,
  headline: 0.3
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

/**
 * Deterministic offline planner. Composes a LayoutPlan from available items
 * using COMPONENT_CATALOG constraints. Never emits blocks for preserved docked
 * blocks (the session reducer re-inserts them).
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

  // --- video section ---------------------------------------------------
  const videoBlocks: ComponentBlock[] = [];
  const vids = byKind.video.map((v) => v.id);
  const videoLess = mix.video === 'less';
  if (vids.length > 0) {
    if (videoLess) {
      const q = makeBlock('video_queue', vids, 4, { title: '추천 영상' }, '영상 비중을 줄여 간단한 목록으로 구성했습니다.');
      if (q) videoBlocks.push(q);
    } else if (vids.length === 1) {
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

  // --- news section (headline strip + article list) ---------------------
  const newsPool = [...byKind.article, ...byKind.headline].sort((a, b) => itemTime(b) - itemTime(a));

  const headlineBlocks: ComponentBlock[] = [];
  let stripRefs: string[] = [];
  if (newsPool.length >= 3 && mix.headline !== 'less') {
    const stripCap = mix.headline === 'more' ? 10 : 5;
    stripRefs = newsPool.slice(0, stripCap).map((it) => it.id);
    const s = makeBlock('headline_strip', stripRefs, 12, {}, '가장 최근 소식을 한 줄로 훑어봅니다.');
    if (s) headlineBlocks.push(s);
    else stripRefs = [];
  }

  const articleBlocks: ComponentBlock[] = [];
  const remainingArticles = newsPool.filter((it) => !stripRefs.includes(it.id)).map((it) => it.id);
  const articleCap = mix.article === 'more' ? 12 : 6;
  const articleRefs = remainingArticles.slice(0, articleCap);

  const postBlocks: ComponentBlock[] = [];
  const postRefs = byKind.post.map((p) => p.id);

  const hasPosts = postRefs.length > 0;
  const hasArticles = articleRefs.length > 0;

  if (hasArticles) {
    const a = makeBlock(
      'article_list',
      articleRefs,
      hasPosts ? 6 : 12,
      { maxItems: Math.min(articleRefs.length, articleCap) },
      '읽어볼 만한 기사 목록입니다.'
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

  // --- ordering by contentBalance weight --------------------------------
  const weight = (k: SourceItemKind): number =>
    req.interpretation.contentBalance[k] ?? DEFAULT_WEIGHT[k];
  const sections: { kind: SourceItemKind; blocks: ComponentBlock[] }[] = [
    { kind: 'video', blocks: videoBlocks },
    { kind: 'headline', blocks: headlineBlocks },
    { kind: 'article', blocks: articleBlocks },
    { kind: 'post', blocks: postBlocks }
  ];
  const ordered = sections
    .map((s, i) => ({ ...s, i }))
    .sort((a, b) => weight(b.kind) - weight(a.kind) || a.i - b.i);

  const blocks: ComponentBlock[] = ordered.flatMap((s) => s.blocks);

  // --- source_list (always last) ----------------------------------------
  const usedRefs: string[] = [];
  for (const b of blocks) {
    for (const r of b.sourceItemRefs) if (!usedRefs.includes(r)) usedRefs.push(r);
  }
  if (usedRefs.length > 0) {
    const src = makeBlock('source_list', usedRefs, 12, {}, '이 페이지를 구성한 모든 출처입니다.');
    if (src) blocks.push(src);
  }

  // --- guarantee at least one block -------------------------------------
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
