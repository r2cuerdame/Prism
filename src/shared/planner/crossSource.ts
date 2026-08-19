import type { SourceItem } from '@shared/domain/sourceItem';

/**
 * Cross-source composition helpers for the offline heuristic planner.
 *
 * Everything here is pure and deterministic: no randomness, no clock reads,
 * stable ordering for equal scores. The goal is ONE synthesized page instead
 * of per-source silos — these helpers find where different sources talk about
 * the same thing and turn that overlap into synthesis points, topic clusters
 * and interleaved lists.
 */

const STOPWORDS = new Set<string>([
  // Korean function words / filler
  '그리고',
  '하지만',
  '그러나',
  '에서',
  '으로',
  '이번',
  '오늘',
  '내일',
  '어제',
  '관련',
  '대한',
  '위한',
  '통해',
  '함께',
  '모든',
  '무엇',
  '어떻게',
  '입니다',
  '합니다',
  '하는',
  '있는',
  '없는',
  '된다',
  '한다',
  '새',
  // English function words / filler
  'the',
  'a',
  'an',
  'of',
  'for',
  'and',
  'to',
  'in',
  'on',
  'is',
  'are',
  'was',
  'were',
  'be',
  'been',
  'it',
  'its',
  'this',
  'that',
  'with',
  'at',
  'by',
  'from',
  'as',
  'has',
  'have',
  'had',
  'how',
  'why',
  'what',
  'when',
  'who',
  'will',
  'can',
  'not',
  'new',
  'now',
  'you',
  'your',
  'about',
  'after',
  'into',
  'over',
  'more',
  'than',
  'today'
]);

/** Hangul jamo, compatibility jamo, and syllables. */
const HANGUL_RE = /[ᄀ-ᇿ㄰-㆏가-힯]/;
const MAX_TOKENS = 20;

function clip(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

/**
 * Lowercase, strip punctuation, split on whitespace, drop stopwords and
 * too-short tokens. Length-1 tokens are always dropped; length-2 tokens are
 * kept when they contain Hangul (Korean two-char words carry meaning) or are
 * known topical acronyms — 'ai' is exactly the kind of token that should
 * cluster. Other two-letter Latin fragments are noise. Capped at MAX_TOKENS.
 */
const SHORT_TOPICAL = new Set(['ai', 'ml', 'ar', 'vr', 'xr', 'ui', 'ux', 'os', 'pc', 'tv', 'ev', '5g', '6g', 'gp']);

export function tokenize(title: string): Set<string> {
  const out = new Set<string>();
  const parts = title.toLowerCase().split(/[^\p{L}\p{N}]+/u);
  for (const tok of parts) {
    if (out.size >= MAX_TOKENS) break;
    if (tok.length < 2) continue;
    if (tok.length === 2 && !HANGUL_RE.test(tok) && !SHORT_TOPICAL.has(tok)) continue;
    if (STOPWORDS.has(tok)) continue;
    out.add(tok);
  }
  return out;
}

/** Two titles talk about the same thing: >=2 shared tokens, or one long one. */
function related(a: Set<string>, b: Set<string>): boolean {
  let shared = 0;
  for (const t of a) {
    if (!b.has(t)) continue;
    if (t.length >= 4) return true;
    shared += 1;
    if (shared >= 2) return true;
  }
  return false;
}

export interface TopicCluster {
  topic: string;
  items: SourceItem[];
  /** Distinct sourceName values in order of first appearance. */
  sources: string[];
}

export interface ClusterOptions {
  /** Minimum distinct sourceName count for a cluster to survive. Default 2. */
  minSources?: number;
  /** Maximum clusters returned. Default 3. */
  maxClusters?: number;
}

/** Most representative topic label: the shortest title, trimmed to ~60 chars. */
function representativeTopic(items: SourceItem[]): string {
  let best = items[0]!.title;
  for (const it of items) {
    if (it.title.length < best.length) best = it.title;
  }
  return clip(best.trim(), 60);
}

/**
 * Greedy deterministic agglomeration on title-token overlap. Only clusters
 * spanning >= minSources DISTINCT sourceName values are kept — a cluster is
 * interesting precisely because several outlets cover the same thread.
 * Sorted by (distinct source count desc, item count desc, first item id).
 */
export function clusterByTopic(items: SourceItem[], opts: ClusterOptions = {}): TopicCluster[] {
  const minSources = opts.minSources ?? 2;
  const maxClusters = opts.maxClusters ?? 3;
  const tokens = items.map((it) => tokenize(it.title));

  const groups: number[][] = [];
  for (let i = 0; i < items.length; i++) {
    let placed = false;
    for (const g of groups) {
      if (g.some((j) => related(tokens[i]!, tokens[j]!))) {
        g.push(i);
        placed = true;
        break;
      }
    }
    if (!placed) groups.push([i]);
  }

  const clusters: TopicCluster[] = [];
  for (const g of groups) {
    const clusterItems = g.map((j) => items[j]!);
    const sources: string[] = [];
    for (const it of clusterItems) {
      if (!sources.includes(it.sourceName)) sources.push(it.sourceName);
    }
    if (sources.length < minSources) continue;
    clusters.push({ topic: representativeTopic(clusterItems), items: clusterItems, sources });
  }

  clusters.sort((a, b) => {
    if (b.sources.length !== a.sources.length) return b.sources.length - a.sources.length;
    if (b.items.length !== a.items.length) return b.items.length - a.items.length;
    const aid = a.items[0]!.id;
    const bid = b.items[0]!.id;
    return aid < bid ? -1 : aid > bid ? 1 : 0;
  });

  return clusters.slice(0, maxClusters);
}

/**
 * Round-robin across sourceName buckets (buckets in order of first
 * appearance, each bucket keeping its relative order) so a list block never
 * shows a long single-outlet run when alternatives exist.
 */
export function interleaveBySource<T extends { sourceName: string }>(items: T[]): T[] {
  const order: string[] = [];
  const buckets = new Map<string, T[]>();
  for (const it of items) {
    let bucket = buckets.get(it.sourceName);
    if (!bucket) {
      bucket = [];
      buckets.set(it.sourceName, bucket);
      order.push(it.sourceName);
    }
    bucket.push(it);
  }
  const out: T[] = [];
  for (let round = 0; out.length < items.length; round++) {
    for (const name of order) {
      const bucket = buckets.get(name)!;
      if (round < bucket.length) out.push(bucket[round]!);
    }
  }
  return out;
}

export interface SynthesisPoint {
  text: string;
  /** Indices into the citedItems array returned alongside. */
  cites: number[];
}

export interface SynthesisResult {
  points: SynthesisPoint[];
  /** Deduped ordered items the cite indices refer to (block sourceItemRefs). */
  citedItems: SourceItem[];
}

/** Catalog cap for synthesis_brief sourceItemRefs — indices must stay valid. */
const MAX_CITED_ITEMS = 20;
const MAX_POINT_TEXT = 400;
const HOT_COMMENT_THRESHOLD = 100;

const KIND_KO: Record<string, string> = {
  video: '영상',
  article: '기사',
  headline: '기사',
  post: '커뮤니티'
};

function commentCount(item: SourceItem): number | null {
  if (item.kind !== 'post') return null;
  const n = item.payload['commentCount'];
  return typeof n === 'number' && Number.isFinite(n) ? n : null;
}

/**
 * Rule-based (no LLM) Korean synthesis: 2-4 short points that merge what the
 * sources collectively say, each backed by cite indices into citedItems.
 * Never throws on empty input.
 */
export function buildSynthesisPoints(
  items: SourceItem[],
  clusters: TopicCluster[]
): SynthesisResult {
  const points: SynthesisPoint[] = [];
  const citedItems: SourceItem[] = [];
  if (items.length === 0) return { points, citedItems };

  const cite = (item: SourceItem): number => {
    const existing = citedItems.findIndex((c) => c.id === item.id);
    if (existing >= 0) return existing;
    if (citedItems.length >= MAX_CITED_ITEMS) return -1;
    citedItems.push(item);
    return citedItems.length - 1;
  };

  // 1. Convergence points: topics several sources cover together (max 2).
  for (const cluster of clusters.slice(0, 2)) {
    const cites: number[] = [];
    for (const source of cluster.sources) {
      const first = cluster.items.find((it) => it.sourceName === source);
      if (!first) continue;
      const idx = cite(first);
      if (idx >= 0) cites.push(idx);
    }
    points.push({
      text: clip(
        `여러 소스가 ${clip(cluster.topic, 120)}을(를) 함께 다루고 있어요 — ${cluster.sources.join(', ')}.`,
        MAX_POINT_TEXT
      ),
      cites
    });
  }

  // 2. Coverage point: what was gathered, from where, in what shape.
  const sourceOrder: string[] = [];
  const bySource = new Map<string, SourceItem[]>();
  for (const it of items) {
    let bucket = bySource.get(it.sourceName);
    if (!bucket) {
      bucket = [];
      bySource.set(it.sourceName, bucket);
      sourceOrder.push(it.sourceName);
    }
    bucket.push(it);
  }
  const rankedSources = [...sourceOrder].sort((a, b) => {
    const diff = bySource.get(b)!.length - bySource.get(a)!.length;
    if (diff !== 0) return diff;
    return sourceOrder.indexOf(a) - sourceOrder.indexOf(b);
  });
  const kindCounts: Record<string, number> = { 영상: 0, 기사: 0, 커뮤니티: 0 };
  for (const it of items) {
    const label = KIND_KO[it.kind];
    if (label) kindCounts[label] = (kindCounts[label] ?? 0) + 1;
  }
  const kindParts = (['영상', '기사', '커뮤니티'] as const)
    .filter((label) => (kindCounts[label] ?? 0) > 0)
    .map((label) => `${label} ${kindCounts[label]}개`);
  const namedSources = rankedSources.slice(0, 2).join('·');
  const where =
    rankedSources.length > 2
      ? `${namedSources} 등 ${rankedSources.length}곳에서`
      : rankedSources.length === 2
        ? `${namedSources} 2곳에서`
        : `${namedSources}에서`;
  const coverageCites: number[] = [];
  for (const source of rankedSources.slice(0, 3)) {
    const idx = cite(bySource.get(source)![0]!);
    if (idx >= 0) coverageCites.push(idx);
  }
  points.push({
    text: clip(
      `오늘은 ${where} ${items.length}개를 모았어요. ${kindParts.join(', ')}.`,
      MAX_POINT_TEXT
    ),
    cites: coverageCites
  });

  // 3. Community pulse: the busiest discussion, when one is genuinely busy.
  let hottest: SourceItem | null = null;
  let hottestCount = 0;
  for (const it of items) {
    const n = commentCount(it);
    if (n !== null && n >= HOT_COMMENT_THRESHOLD && n > hottestCount) {
      hottest = it;
      hottestCount = n;
    }
  }
  if (hottest) {
    const idx = cite(hottest);
    points.push({
      text: clip(
        `커뮤니티에서는 "${clip(hottest.title, 120)}"이(가) 댓글 ${hottestCount}개로 가장 활발해요.`,
        MAX_POINT_TEXT
      ),
      cites: idx >= 0 ? [idx] : []
    });
  }

  return { points, citedItems };
}
