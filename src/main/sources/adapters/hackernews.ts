import { newId } from '@shared/domain/ids';
import type { Provenance } from '@shared/domain/provenance';
import type { SourceItem } from '@shared/domain/sourceItem';
import type { AdapterResult, SourceAdapter, SourceRequest } from '../types';

const RELEVANT_TOPICS = ['ai', 'dev', 'tech', 'science'];

function isHttpUrl(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  try {
    const u = new URL(value);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

export function normalizeHackerNews(json: unknown, now: Date): AdapterResult {
  const items: SourceItem[] = [];
  const provenance: Provenance[] = [];
  const errors: string[] = [];
  const retrievedAt = now.toISOString();

  const root = json as { hits?: unknown } | null;
  if (!root || typeof root !== 'object' || !Array.isArray(root.hits)) {
    errors.push('Hacker News: response has no hits array');
    return { items, provenance, errors };
  }

  for (const raw of root.hits) {
    const hit = raw as Record<string, unknown> | null;
    if (!hit || typeof hit !== 'object') {
      errors.push('Hacker News: skipped non-object hit');
      continue;
    }
    const objectID = typeof hit.objectID === 'string' ? hit.objectID : null;
    const title = typeof hit.title === 'string' && hit.title.length > 0 ? hit.title : null;
    if (!objectID || !title) {
      errors.push(`Hacker News: skipped malformed hit (objectID=${String(hit.objectID ?? 'missing')})`);
      continue;
    }

    const commentsUrl = `https://news.ycombinator.com/item?id=${objectID}`;
    const originalUrl = isHttpUrl(hit.url) ? hit.url : commentsUrl;

    const prov: Provenance = {
      id: newId('prov'),
      sourceUrl: originalUrl,
      sourceName: 'Hacker News',
      adapterId: 'hackernews',
      retrievedAt,
      transformations: ['normalized from Algolia HN API']
    };

    const item: SourceItem = {
      id: newId('item'),
      adapterId: 'hackernews',
      sourceId: 'news.ycombinator.com',
      sourceName: 'Hacker News',
      kind: 'post',
      title,
      payload: {
        community: 'Hacker News',
        points: typeof hit.points === 'number' ? hit.points : undefined,
        commentCount: typeof hit.num_comments === 'number' ? hit.num_comments : undefined,
        commentsUrl
      },
      originalUrl,
      publishedAt: typeof hit.created_at === 'string' ? hit.created_at : undefined,
      retrievedAt,
      provenanceRef: prov.id,
      lang: 'en'
    };

    items.push(item);
    provenance.push(prov);
  }

  return { items, provenance, errors };
}

export const hackerNewsAdapter: SourceAdapter = {
  id: 'hackernews',
  name: 'Hacker News',
  classes: ['community'],
  matches(req: SourceRequest): number {
    let score = req.locale === 'ko' ? 0.4 : 0.6;
    const topics = req.topics.map((t) => t.toLowerCase());
    if (topics.some((t) => RELEVANT_TOPICS.includes(t))) score += 0.2;
    return Math.min(score, 1);
  },
  async fetchItems(req, ctx): Promise<AdapterResult> {
    const url = req.query
      ? `https://hn.algolia.com/api/v1/search?query=${encodeURIComponent(req.query)}&tags=story&hitsPerPage=${req.limit}`
      : `https://hn.algolia.com/api/v1/search?tags=front_page&hitsPerPage=${req.limit}`;
    try {
      const json = await ctx.http.getJson(url);
      return normalizeHackerNews(json, ctx.now());
    } catch (err) {
      return {
        items: [],
        provenance: [],
        errors: [err instanceof Error ? err.message : String(err)]
      };
    }
  }
};
