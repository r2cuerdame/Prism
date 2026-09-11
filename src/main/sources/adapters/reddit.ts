import { newId } from '@shared/domain/ids';
import type { Provenance } from '@shared/domain/provenance';
import type { SourceItem } from '@shared/domain/sourceItem';
import type {
  AdapterContext,
  AdapterResult,
  SourceAdapter,
  SourceRequest
} from '../types';
import { fetchTargetsInterleaved } from './fanOut';

export interface SubRegistryEntry {
  sub: string;
  topics: string[];
}

export const SUB_REGISTRY: SubRegistryEntry[] = [
  { sub: 'technology', topics: ['tech'] },
  { sub: 'gaming', topics: ['gaming'] },
  { sub: 'worldnews', topics: ['world', 'news'] },
  { sub: 'programming', topics: ['dev'] },
  { sub: 'videos', topics: ['general'] }
];

export function subHotUrl(sub: string, limit: number): string {
  return `https://www.reddit.com/r/${sub}/hot.json?limit=${limit}&raw_json=1`;
}

function str(v: unknown): string | undefined {
  return typeof v === 'string' && v.length > 0 ? v : undefined;
}

function num(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}

function isHttpUrl(s: string | undefined): s is string {
  return typeof s === 'string' && /^https?:\/\//i.test(s);
}

export function normalizeReddit(
  json: unknown,
  meta: { sub: string },
  now: Date
): AdapterResult {
  const items: SourceItem[] = [];
  const provenance: Provenance[] = [];
  const errors: string[] = [];
  const retrievedAt = now.toISOString();

  try {
    const root =
      json && typeof json === 'object' ? (json as Record<string, unknown>) : {};
    const data =
      root['data'] && typeof root['data'] === 'object'
        ? (root['data'] as Record<string, unknown>)
        : {};
    const children = Array.isArray(data['children']) ? data['children'] : null;
    if (!children) {
      errors.push(`r/${meta.sub}: 응답 형식이 예상과 다릅니다`);
      return { items, provenance, errors };
    }
    for (const child of children) {
      const c =
        child && typeof child === 'object'
          ? (child as Record<string, unknown>)
          : {};
      const d =
        c['data'] && typeof c['data'] === 'object'
          ? (c['data'] as Record<string, unknown>)
          : {};
      const title = str(d['title']);
      const permalink = str(d['permalink']);
      if (!title || !permalink) {
        errors.push(`r/${meta.sub}: 제목 또는 permalink가 없는 게시물을 건너뜀`);
        continue;
      }
      const commentsUrl = `https://www.reddit.com${permalink}`;
      const external = str(d['url_overridden_by_dest']) ?? str(d['url']);
      const originalUrl = isHttpUrl(external) ? external : commentsUrl;
      const points = num(d['score']);
      const commentCount = num(d['num_comments']);
      const createdUtc = num(d['created_utc']);
      const community = str(d['subreddit_name_prefixed']) ?? `r/${meta.sub}`;
      const thumbnail = str(d['thumbnail']);
      const thumbnailUrl = isHttpUrl(thumbnail) ? thumbnail : undefined;

      const provId = newId('prov');
      provenance.push({
        id: provId,
        sourceUrl: originalUrl,
        sourceName: community,
        adapterId: 'reddit',
        retrievedAt,
        transformations: ['Reddit hot 목록 정규화']
      });
      items.push({
        id: newId('item'),
        adapterId: 'reddit',
        sourceId: meta.sub,
        sourceName: community,
        kind: 'post',
        title,
        media: thumbnailUrl ? { thumbnailUrl } : undefined,
        payload: {
          community,
          ...(points !== undefined ? { points } : {}),
          ...(commentCount !== undefined ? { commentCount } : {}),
          commentsUrl
        },
        originalUrl,
        publishedAt:
          createdUtc !== undefined
            ? new Date(createdUtc * 1000).toISOString()
            : undefined,
        retrievedAt,
        provenanceRef: provId
      });
    }
  } catch (e) {
    errors.push(
      `r/${meta.sub}: 처리 오류 (${e instanceof Error ? e.message : String(e)})`
    );
  }
  return { items, provenance, errors };
}

function selectSubs(req: SourceRequest): SubRegistryEntry[] {
  const topics = new Set(req.topics.map((t) => t.toLowerCase()));
  let candidates = SUB_REGISTRY.filter((s) => s.topics.some((t) => topics.has(t)));
  if (candidates.length === 0) {
    candidates = SUB_REGISTRY.filter((s) => s.topics.includes('general'));
  }
  return candidates.slice(0, 3);
}

export const redditAdapter: SourceAdapter = {
  id: 'reddit',
  name: 'Reddit',
  classes: ['community'],
  matches(req: SourceRequest): number {
    const topics = new Set(req.topics.map((t) => t.toLowerCase()));
    const registryTopics = new Set(SUB_REGISTRY.flatMap((s) => s.topics));
    let score = 0.4;
    if ([...topics].some((t) => registryTopics.has(t))) score += 0.2;
    return Math.min(1, score);
  },
  fetchItems(req: SourceRequest, ctx: AdapterContext): Promise<AdapterResult> {
    const perSub = Math.max(1, Math.min(req.limit, 25));
    return fetchTargetsInterleaved(
      selectSubs(req),
      async (entry) => {
        const json = await ctx.http.getJson(subHotUrl(entry.sub, perSub));
        return normalizeReddit(json, { sub: entry.sub }, ctx.now());
      },
      // Reddit blocks unauthenticated clients often (403) — expected, degrade gracefully.
      (entry, e) => `r/${entry.sub}: 요청 실패 (${e instanceof Error ? e.message : String(e)})`,
      req.limit
    );
  }
};
