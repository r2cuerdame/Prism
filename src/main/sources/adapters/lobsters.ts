import { newId } from '@shared/domain/ids';
import type { Provenance } from '@shared/domain/provenance';
import type { SourceItem } from '@shared/domain/sourceItem';
import type { AdapterResult, SourceAdapter, SourceRequest } from '../types';

const RELEVANT_TOPICS = ['dev', 'tech'];

function isHttpUrl(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  try {
    const u = new URL(value);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

export function normalizeLobsters(json: unknown, now: Date): AdapterResult {
  const items: SourceItem[] = [];
  const provenance: Provenance[] = [];
  const errors: string[] = [];
  const retrievedAt = now.toISOString();

  if (!Array.isArray(json)) {
    errors.push('Lobsters: response is not an array');
    return { items, provenance, errors };
  }

  for (const raw of json) {
    const entry = raw as Record<string, unknown> | null;
    if (!entry || typeof entry !== 'object') {
      errors.push('Lobsters: skipped non-object entry');
      continue;
    }
    const title = typeof entry.title === 'string' && entry.title.length > 0 ? entry.title : null;
    const shortId = typeof entry.short_id === 'string' ? entry.short_id : null;
    const commentsUrl = isHttpUrl(entry.comments_url)
      ? entry.comments_url
      : shortId
        ? `https://lobste.rs/s/${shortId}`
        : null;
    if (!title || !commentsUrl) {
      errors.push(`Lobsters: skipped malformed entry (short_id=${String(entry.short_id ?? 'missing')})`);
      continue;
    }

    const originalUrl = isHttpUrl(entry.url) ? entry.url : commentsUrl;

    const prov: Provenance = {
      id: newId('prov'),
      sourceUrl: originalUrl,
      sourceName: 'Lobsters',
      adapterId: 'lobsters',
      retrievedAt,
      transformations: ['normalized from lobste.rs hottest.json']
    };

    const item: SourceItem = {
      id: newId('item'),
      adapterId: 'lobsters',
      sourceId: 'lobste.rs',
      sourceName: 'Lobsters',
      kind: 'post',
      title,
      payload: {
        community: 'Lobsters',
        points: typeof entry.score === 'number' ? entry.score : undefined,
        commentCount: typeof entry.comment_count === 'number' ? entry.comment_count : undefined,
        commentsUrl
      },
      originalUrl,
      publishedAt: typeof entry.created_at === 'string' ? entry.created_at : undefined,
      retrievedAt,
      provenanceRef: prov.id,
      lang: 'en'
    };

    items.push(item);
    provenance.push(prov);
  }

  return { items, provenance, errors };
}

export const lobstersAdapter: SourceAdapter = {
  id: 'lobsters',
  name: 'Lobsters',
  classes: ['community'],
  matches(req: SourceRequest): number {
    let score = 0.4;
    const topics = req.topics.map((t) => t.toLowerCase());
    if (topics.some((t) => RELEVANT_TOPICS.includes(t))) score += 0.3;
    return Math.min(score, 1);
  },
  async fetchItems(_req, ctx): Promise<AdapterResult> {
    try {
      const json = await ctx.http.getJson('https://lobste.rs/hottest.json');
      return normalizeLobsters(json, ctx.now());
    } catch (err) {
      return {
        items: [],
        provenance: [],
        errors: [err instanceof Error ? err.message : String(err)]
      };
    }
  }
};
