import { getCatalogEntry } from '@shared/catalog/catalog';
import { newId } from '@shared/domain/ids';
import type { ComponentBlock, LayoutPlan } from '@shared/domain/layoutPlan';
import type { SourceItem } from '@shared/domain/sourceItem';
import { interleaveBySource } from './crossSource';

/**
 * Mixed-composition invariants for the Generated View.
 *
 * Product rule (README / GOAL.md): the page is NEVER organized as one section
 * per website or one section per content type. Blocks mix sources by topic.
 * `detectSiloViolations` names the ways a plan devolves into silos and
 * `enforceMixedComposition` repairs them with interleaved topic_cluster
 * cards. Both are pure and deterministic (block ids aside).
 */

export type SiloViolationKind =
  | 'site-silo'
  | 'kind-silo'
  | 'single-source-block'
  | 'grouped-by-source';

export interface SiloViolation {
  kind: SiloViolationKind;
  blockIds: string[];
  /** Korean, user-inspectable. */
  detail: string;
}

/** Opener, anchor and provenance are structural; the body is everything else. */
const NON_BODY_TYPES = new Set(['source_list', 'synthesis_brief', 'video_player', 'video_queue']);

const CLUSTER_TYPE = 'topic_cluster';
const CLUSTER_MAX = 8;
const CLUSTER_MIN = 2;
const CLUSTER_LABELS = ['함께 보기', '이어서 함께 보기', '더 함께 보기', '마저 함께 보기'];
const CLUSTER_ANGLE = '소스와 종류를 섞어 한 카드로 모았어요';

function isBodyBlock(b: ComponentBlock): boolean {
  return b.sourceItemRefs.length > 0 && !NON_BODY_TYPES.has(b.componentType);
}

/** Refs resolved to items, unresolvable refs dropped, order kept. */
function resolve(refs: string[], byId: Map<string, SourceItem>): SourceItem[] {
  const out: SourceItem[] = [];
  for (const r of refs) {
    const it = byId.get(r);
    if (it) out.push(it);
  }
  return out;
}

function distinctSources(items: SourceItem[]): string[] {
  const out: string[] = [];
  for (const it of items) if (!out.includes(it.sourceName)) out.push(it.sourceName);
  return out;
}

function distinctKinds(items: SourceItem[]): string[] {
  const out: string[] = [];
  for (const it of items) if (!out.includes(it.kind)) out.push(it.kind);
  return out;
}

/** Items the block's catalog entry could show at all (null accepts every kind). */
function poolFor(block: ComponentBlock, items: SourceItem[]): SourceItem[] {
  const entry = getCatalogEntry(block.componentType);
  const accepts = entry?.acceptsKinds ?? null;
  if (accepts === null) return items;
  return items.filter((it) => accepts.includes(it.kind));
}

/** Kind-specific list component: acceptsKinds is a non-empty allow-list. */
function isKindSpecific(block: ComponentBlock): boolean {
  const accepts = getCatalogEntry(block.componentType)?.acceptsKinds;
  return Array.isArray(accepts) && accepts.length > 0;
}

/** Count of adjacent positions where sourceName changes. */
function sourceRuns(items: SourceItem[]): number {
  let changes = 0;
  for (let i = 1; i < items.length; i++) {
    if (items[i]!.sourceName !== items[i - 1]!.sourceName) changes += 1;
  }
  return changes;
}

/** Minimum adjacent same-source pairs any ordering can achieve for these counts. */
function minimumAdjacentRepeats(items: SourceItem[]): number {
  const counts = new Map<string, number>();
  for (const it of items) counts.set(it.sourceName, (counts.get(it.sourceName) ?? 0) + 1);
  const maxCount = Math.max(0, ...counts.values());
  const rest = items.length - maxCount;
  return Math.max(0, maxCount - rest - 1);
}

/** Pure. Reports how a plan devolves into per-site / per-kind sections. */
export function detectSiloViolations(plan: LayoutPlan, items: SourceItem[]): SiloViolation[] {
  const byId = new Map(items.map((it) => [it.id, it]));
  const violations: SiloViolation[] = [];
  const body = plan.blocks.filter(isBodyBlock);
  const resolved = new Map<string, SourceItem[]>();
  for (const b of body) resolved.set(b.id, resolve(b.sourceItemRefs, byId));

  // --- site-silo: several multi-item blocks, each one outlet, outlets differ --
  const singleSourceBlocks = body.filter((b) => {
    const its = resolved.get(b.id)!;
    return its.length >= 2 && distinctSources(its).length === 1;
  });
  if (singleSourceBlocks.length >= 2) {
    const names = distinctSources(singleSourceBlocks.map((b) => resolved.get(b.id)![0]!));
    if (names.length >= 2) {
      violations.push({
        kind: 'site-silo',
        blockIds: singleSourceBlocks.map((b) => b.id),
        detail: `사이트별로 나뉜 목록이 ${singleSourceBlocks.length}개 있어요 (${names.join(', ')}). 페이지가 "사이트 A의 목록, 사이트 B의 목록"으로 읽혀요.`
      });
    }
  }

  // --- single-source-block: one outlet although the pool offers more ---------
  for (const b of singleSourceBlocks) {
    const poolSources = distinctSources(poolFor(b, items));
    if (poolSources.length < 2) continue;
    const name = resolved.get(b.id)![0]!.sourceName;
    violations.push({
      kind: 'single-source-block',
      blockIds: [b.id],
      detail: `'${b.componentType}' 블록이 ${name} 항목만 담고 있어요. 같은 종류의 항목이 ${poolSources.length}개 소스에 있는데도요.`
    });
  }

  // --- kind-silo: the body is nothing but per-kind lists ---------------------
  const hasCluster = body.some((b) => b.componentType === CLUSTER_TYPE);
  if (body.length > 0 && !hasCluster && body.every(isKindSpecific)) {
    const bodyKinds = distinctKinds(body.flatMap((b) => resolved.get(b.id)!));
    const poolKinds = distinctKinds(items);
    const poolSources = distinctSources(items);
    if (bodyKinds.length >= 2 && poolKinds.length >= 2 && poolSources.length >= 2) {
      violations.push({
        kind: 'kind-silo',
        blockIds: body.map((b) => b.id),
        detail: `본문이 종류별 목록(${body.map((b) => b.componentType).join(', ')})으로만 이루어져 있어요. 주제로 섞인 카드가 하나도 없어요.`
      });
    }
  }

  // --- grouped-by-source: mixed refs laid out as contiguous per-source runs --
  for (const b of body) {
    const its = resolved.get(b.id)!;
    const sources = distinctSources(its);
    if (sources.length < 2 || its.length <= sources.length) continue;
    if (sourceRuns(its) === sources.length - 1) {
      violations.push({
        kind: 'grouped-by-source',
        blockIds: [b.id],
        detail: `'${b.componentType}' 블록의 항목이 소스별로 뭉쳐 있어요 (${sources.join(' → ')}). 소스를 번갈아 배치해야 해요.`
      });
    }
  }

  return violations;
}

/** Contiguous, size-balanced chunks of at most CLUSTER_MAX. Never drops an item when n >= 2. */
function chunkBalanced<T>(list: T[]): T[][] {
  if (list.length < CLUSTER_MIN) return [];
  const count = Math.ceil(list.length / CLUSTER_MAX);
  const base = Math.floor(list.length / count);
  const extra = list.length % count;
  const out: T[][] = [];
  let at = 0;
  for (let i = 0; i < count; i++) {
    const size = base + (i < extra ? 1 : 0);
    out.push(list.slice(at, at + size));
    at += size;
  }
  return out.filter((c) => c.length >= CLUSTER_MIN);
}

function clusterLabel(i: number): string {
  return CLUSTER_LABELS[i] ?? `${CLUSTER_LABELS[0]} ${i + 1}`;
}

function makeCluster(items: SourceItem[], index: number, count: number): ComponentBlock | null {
  const entry = getCatalogEntry(CLUSTER_TYPE);
  if (!entry) return null;
  const refs = items.slice(0, entry.maxItems).map((it) => it.id);
  if (refs.length < entry.minItems) return null;
  const lastAlone = index === count - 1 && count % 2 === 1;
  const span = count === 1 || lastAlone ? 12 : 6;
  const sources = distinctSources(items);
  return {
    id: newId('blk'),
    componentType: CLUSTER_TYPE,
    componentVersion: entry.version,
    sourceItemRefs: refs,
    props: { ...entry.defaultProps, topic: clusterLabel(index), angle: CLUSTER_ANGLE },
    layout: { span: Math.min(entry.maxSpan, Math.max(entry.minSpan, span)) },
    locked: false,
    docked: false,
    rationale: `사이트별·종류별로 나뉘어 있던 항목을 ${sources.length}개 소스를 섞어 한 카드로 다시 모았어요.`,
    state: {}
  };
}

/**
 * Pure. Repairs violations using interleaveBySource and topic_cluster blocks;
 * returns a new plan plus Korean issue strings (empty when nothing changed —
 * then the very same plan object comes back). Never throws and never returns
 * an invalid plan: catalog min/max items and spans are respected, source_list
 * stays last, and synthesis_brief / video_player / video_queue / heading /
 * text / divider are never touched.
 */
export function enforceMixedComposition(
  plan: LayoutPlan,
  items: SourceItem[]
): { plan: LayoutPlan; issues: string[]; violations: SiloViolation[] } {
  try {
    return doEnforce(plan, items);
  } catch {
    return { plan, issues: [], violations: [] };
  }
}

function doEnforce(
  plan: LayoutPlan,
  items: SourceItem[]
): { plan: LayoutPlan; issues: string[]; violations: SiloViolation[] } {
  const violations = detectSiloViolations(plan, items);
  if (violations.length === 0) return { plan, issues: [], violations };

  const byId = new Map(items.map((it) => [it.id, it]));
  const issues: string[] = [];
  let blocks: ComponentBlock[] = [...plan.blocks];
  let changed = false;

  // --- 1. grouped-by-source: re-interleave in place ---------------------------
  const grouped = new Set(
    violations.filter((v) => v.kind === 'grouped-by-source').flatMap((v) => v.blockIds)
  );
  if (grouped.size > 0) {
    blocks = blocks.map((b) => {
      if (!grouped.has(b.id)) return b;
      const known = resolve(b.sourceItemRefs, byId);
      const unknown = b.sourceItemRefs.filter((r) => !byId.has(r));
      const refs = [...interleaveBySource(known).map((it) => it.id), ...unknown];
      if (refs.every((r, i) => r === b.sourceItemRefs[i])) return b;
      changed = true;
      issues.push(`소스별로 뭉쳐 있던 '${b.componentType}' 블록의 항목을 번갈아 배치했어요.`);
      return { ...b, sourceItemRefs: refs };
    });
  }

  // --- 2. site-silo / kind-silo / single-source-block: merge into clusters ----
  const offendingIds = new Set(
    violations
      .filter((v) => v.kind !== 'grouped-by-source')
      .flatMap((v) => v.blockIds)
  );
  if (offendingIds.size > 0) {
    const offending = blocks.filter((b) => offendingIds.has(b.id));
    const seen = new Set<string>();
    const merged: SourceItem[] = [];
    for (const b of offending) {
      for (const it of resolve(b.sourceItemRefs, byId)) {
        if (seen.has(it.id)) continue;
        seen.add(it.id);
        merged.push(it);
      }
    }
    // A lone single-source block has nothing to alternate with by itself:
    // borrow items no block shows yet from the other outlets in the pool.
    if (distinctSources(merged).length < 2) {
      const referenced = new Set(blocks.flatMap((b) => b.sourceItemRefs));
      const own = merged[0]?.sourceName;
      const spare = items.filter(
        (it) => !referenced.has(it.id) && !seen.has(it.id) && it.sourceName !== own
      );
      for (const it of spare.slice(0, Math.max(1, merged.length))) {
        seen.add(it.id);
        merged.push(it);
      }
    }

    const chunks = chunkBalanced(interleaveBySource(merged));
    const clusters: ComponentBlock[] = [];
    chunks.forEach((chunk, i) => {
      const c = makeCluster(chunk, i, chunks.length);
      if (c) clusters.push(c);
    });

    if (clusters.length > 0) {
      const firstAt = blocks.findIndex((b) => offendingIds.has(b.id));
      const kept = blocks.filter((b) => !offendingIds.has(b.id));
      const insertAt = blocks.slice(0, firstAt).filter((b) => !offendingIds.has(b.id)).length;
      blocks = [...kept.slice(0, insertAt), ...clusters, ...kept.slice(insertAt)];
      changed = true;
      const kinds = [...new Set(violations.filter((v) => v.kind !== 'grouped-by-source').map((v) => v.kind))];
      const what = kinds.includes('kind-silo')
        ? '종류별 목록'
        : kinds.includes('site-silo')
          ? '사이트별 목록'
          : '한 소스만 담은 블록';
      issues.push(
        `${what} ${offending.length}개를 소스와 종류를 섞은 주제 묶음 ${clusters.length}개로 다시 구성했어요.`
      );
    }
  }

  if (!changed) return { plan, issues: [], violations };

  // --- 3. source_list stays last ----------------------------------------------
  const provenance = blocks.filter((b) => b.componentType === 'source_list');
  if (provenance.length > 0) {
    blocks = [...blocks.filter((b) => b.componentType !== 'source_list'), ...provenance];
  }

  return { plan: { ...plan, blocks }, issues, violations };
}
