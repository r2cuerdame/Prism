import { describe, expect, it } from 'vitest';
import { hackerNewsFixture } from './__fixtures__/hackernewsFixture';
import { hackerNewsAdapter, normalizeHackerNews } from './hackernews';

const NOW = new Date('2026-08-19T00:00:00.000Z');

describe('normalizeHackerNews', () => {
  const result = normalizeHackerNews(JSON.parse(hackerNewsFixture), NOW);

  it('normalizes valid hits and skips the malformed one', () => {
    expect(result.items).toHaveLength(5);
    expect(result.provenance).toHaveLength(5);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain('41001004');
  });

  it('maps identity fields', () => {
    const item = result.items[0];
    expect(item.adapterId).toBe('hackernews');
    expect(item.sourceId).toBe('news.ycombinator.com');
    expect(item.sourceName).toBe('Hacker News');
    expect(item.kind).toBe('post');
    expect(item.title).toBe('Show HN: A tiny local-first browser engine');
    expect(item.lang).toBe('en');
    expect(item.retrievedAt).toBe(NOW.toISOString());
    expect(item.publishedAt).toBe('2026-08-18T09:12:00.000Z');
  });

  it('uses hit.url when valid http(s)', () => {
    expect(result.items[0].originalUrl).toBe('https://example.com/tiny-browser');
  });

  it('falls back to the HN item page for null or non-http urls', () => {
    const askHn = result.items[1];
    expect(askHn.originalUrl).toBe('https://news.ycombinator.com/item?id=41001002');
    const ftp = result.items.find((i) => i.title === 'Postgres 19 released');
    expect(ftp?.originalUrl).toBe('https://news.ycombinator.com/item?id=41001005');
  });

  it('fills post payload', () => {
    const item = result.items[2];
    expect(item.payload).toMatchObject({
      community: 'Hacker News',
      points: 540,
      commentCount: 210,
      commentsUrl: 'https://news.ycombinator.com/item?id=41001003'
    });
  });

  it('links each item to its provenance record', () => {
    for (let i = 0; i < result.items.length; i++) {
      const prov = result.provenance[i];
      expect(result.items[i].provenanceRef).toBe(prov.id);
      expect(prov.adapterId).toBe('hackernews');
      expect(prov.transformations).toEqual(['normalized from Algolia HN API']);
      expect(prov.sourceUrl).toBe(result.items[i].originalUrl);
    }
  });

  it('never throws on garbage input', () => {
    for (const garbage of [{}, null, 'x', 42, [], { hits: 'nope' }]) {
      const r = normalizeHackerNews(garbage, NOW);
      expect(r.items).toEqual([]);
      expect(r.errors.length).toBeGreaterThan(0);
    }
  });
});

describe('hackerNewsAdapter', () => {
  it('has stable identity', () => {
    expect(hackerNewsAdapter.id).toBe('hackernews');
    expect(hackerNewsAdapter.name).toBe('Hacker News');
    expect(hackerNewsAdapter.classes).toEqual(['community']);
  });

  it('scores relevance', () => {
    const base = { moods: [], locale: 'en' as const, limit: 10 };
    expect(hackerNewsAdapter.matches({ ...base, topics: [] })).toBeCloseTo(0.6);
    expect(hackerNewsAdapter.matches({ ...base, topics: ['ai'] })).toBeCloseTo(0.8);
    expect(hackerNewsAdapter.matches({ ...base, topics: ['dev'], locale: 'ko' })).toBeCloseTo(0.6);
    expect(hackerNewsAdapter.matches({ ...base, topics: [], locale: 'ko' })).toBeCloseTo(0.4);
  });

  it('returns errors instead of throwing when fetch fails', async () => {
    const ctx = {
      http: {
        getText: () => Promise.reject(new Error('HTTP 500 hn.algolia.com')),
        getJson: () => Promise.reject(new Error('HTTP 500 hn.algolia.com'))
      },
      now: () => NOW
    };
    const r = await hackerNewsAdapter.fetchItems(
      { topics: [], moods: [], locale: 'en', limit: 10 },
      ctx
    );
    expect(r.items).toEqual([]);
    expect(r.errors).toEqual(['HTTP 500 hn.algolia.com']);
  });

  it('builds the query url and normalizes the response', async () => {
    let requested = '';
    const ctx = {
      http: {
        getText: () => Promise.resolve(''),
        getJson: <T = unknown>(url: string): Promise<T> => {
          requested = url;
          return Promise.resolve(JSON.parse(hackerNewsFixture) as T);
        }
      },
      now: () => NOW
    };
    const r = await hackerNewsAdapter.fetchItems(
      { topics: [], moods: [], query: 'rust lang', locale: 'en', limit: 7 },
      ctx
    );
    expect(requested).toBe(
      'https://hn.algolia.com/api/v1/search?query=rust%20lang&tags=story&hitsPerPage=7'
    );
    expect(r.items).toHaveLength(5);
  });

  it('uses front_page when no query', async () => {
    let requested = '';
    const ctx = {
      http: {
        getText: () => Promise.resolve(''),
        getJson: <T = unknown>(url: string): Promise<T> => {
          requested = url;
          return Promise.resolve(JSON.parse(hackerNewsFixture) as T);
        }
      },
      now: () => NOW
    };
    await hackerNewsAdapter.fetchItems({ topics: [], moods: [], locale: 'en', limit: 12 }, ctx);
    expect(requested).toBe('https://hn.algolia.com/api/v1/search?tags=front_page&hitsPerPage=12');
  });
});
