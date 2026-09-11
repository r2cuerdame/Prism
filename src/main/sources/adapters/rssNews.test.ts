import { describe, expect, it } from 'vitest';
import type { AdapterContext, SourceRequest } from '../types';
import { ATOM_FIXTURE, RSS2_FIXTURE } from './__fixtures__/rssFixtures';
import { FEED_REGISTRY, parseRssFeed, rssNewsAdapter } from './rssNews';

const NOW = new Date('2026-08-19T00:00:00.000Z');
const META = { url: 'https://example-tech.com/rss', name: 'Example Tech', lang: 'en' as const };

function req(partial: Partial<SourceRequest> = {}): SourceRequest {
  return { topics: [], moods: [], locale: 'en', limit: 10, ...partial };
}

function ctxWith(getText: (url: string) => Promise<string>): AdapterContext {
  return {
    http: {
      getText,
      getJson: async () => {
        throw new Error('unused');
      }
    },
    now: () => NOW
  };
}

describe('parseRssFeed (RSS2)', () => {
  const result = parseRssFeed(RSS2_FIXTURE, META, NOW);

  it('maps valid items and skips the linkless one with an error', () => {
    expect(result.items).toHaveLength(2);
    expect(result.errors.length).toBeGreaterThanOrEqual(1);
  });

  it('decodes CDATA titles and strips HTML tags', () => {
    expect(result.items[0].title).toBe('Breaking: AI & the Future');
  });

  it('plain-texts the description into summary/excerpt', () => {
    const excerpt = result.items[0].payload.excerpt;
    expect(excerpt).toBe('Big news about "AI" today. Read more');
    expect(result.items[0].summary).toBe(excerpt);
  });

  it('decodes entities in plain text fields', () => {
    expect(result.items[1].title).toBe('Chips & Salsa');
    const excerpt = String(result.items[1].payload.excerpt);
    expect(excerpt).toContain("'entities'");
    expect(excerpt).not.toContain('<');
  });

  it('takes thumbnails from media:thumbnail and image enclosures', () => {
    expect(result.items[0].media?.thumbnailUrl).toBe('https://example-tech.com/img/ai.jpg');
    expect(result.items[1].media?.thumbnailUrl).toBe('https://example-tech.com/img/chips.png');
  });

  it('converts pubDate to ISO and drops invalid dates', () => {
    expect(result.items[0].publishedAt).toBe('2026-08-18T08:30:00.000Z');
    expect(result.items[1].publishedAt).toBeUndefined();
  });

  it('fills article kind, feed-host sourceId, provenance and lang', () => {
    for (const item of result.items) {
      expect(item.kind).toBe('article');
      expect(item.adapterId).toBe('rss-news');
      expect(item.sourceId).toBe('example-tech.com');
      expect(item.payload.source).toBe('Example Tech');
      expect(item.lang).toBe('en');
      expect(item.retrievedAt).toBe(NOW.toISOString());
      const prov = result.provenance.find((p) => p.id === item.provenanceRef);
      expect(prov).toBeDefined();
      expect(prov?.sourceUrl).toBe(item.originalUrl);
    }
  });
});

describe('parseRssFeed (Atom)', () => {
  const result = parseRssFeed(ATOM_FIXTURE, META, NOW);

  it('parses entries and skips the titleless one', () => {
    expect(result.items).toHaveLength(2);
    expect(result.errors.length).toBeGreaterThanOrEqual(1);
  });

  it('picks the alternate (or rel-less) link, never rel=self', () => {
    expect(result.items[0].originalUrl).toBe('https://atom.example.com/posts/1');
    expect(result.items[1].originalUrl).toBe('https://atom.example.com/posts/2');
  });

  it('plain-texts html summaries with double-encoded entities', () => {
    expect(result.items[0].summary).toBe('Summary & more');
  });

  it('uses published or updated for the date', () => {
    expect(result.items[0].publishedAt).toBe('2026-08-17T12:00:00.000Z');
    expect(result.items[1].publishedAt).toBe('2026-08-16T09:00:00.000Z');
  });
});

describe('parseRssFeed (garbage input)', () => {
  it.each(['', '<not-xml', '{}', 'just some text', '<root><child/></root>'])(
    'never throws and reports errors for %j',
    (input) => {
      const result = parseRssFeed(input, META, NOW);
      expect(result.items).toEqual([]);
      expect(result.errors.length).toBeGreaterThanOrEqual(1);
    }
  );
});

describe('rssNewsAdapter', () => {
  it('has the frozen identity', () => {
    expect(rssNewsAdapter.id).toBe('rss-news');
    expect(rssNewsAdapter.classes).toEqual(['news']);
  });

  it('scores topic overlap higher than unrelated topics', () => {
    const relevant = rssNewsAdapter.matches(req({ topics: ['ai'] }));
    const unrelated = rssNewsAdapter.matches(req({ topics: ['cooking'] }));
    expect(relevant).toBeGreaterThan(unrelated);
    expect(relevant).toBeLessThanOrEqual(1);
    expect(unrelated).toBeGreaterThanOrEqual(0.5);
  });

  it('fetches matching feeds, merges items and caps at limit', async () => {
    const fetched: string[] = [];
    const ctx = ctxWith(async (url) => {
      fetched.push(url);
      return RSS2_FIXTURE;
    });
    const result = await rssNewsAdapter.fetchItems(req({ topics: ['ai'], limit: 3 }), ctx);
    expect(fetched.length).toBeGreaterThanOrEqual(1);
    expect(fetched.length).toBeLessThanOrEqual(3);
    for (const url of fetched) {
      expect(FEED_REGISTRY.some((f) => f.url === url)).toBe(true);
    }
    expect(result.items.length).toBeLessThanOrEqual(3);
    expect(result.items.length).toBeGreaterThan(0);
    const refs = new Set(result.items.map((i) => i.provenanceRef));
    expect(result.provenance.every((p) => refs.has(p.id))).toBe(true);
  });

  it('interleaves feeds so the limit is not saturated by the first feed', async () => {
    const fetched: string[] = [];
    const ctx = ctxWith(async (url) => {
      fetched.push(url);
      return RSS2_FIXTURE;
    });
    // 'tech' matches more than three feeds; the fixture yields 2 items per feed,
    // so a linear slice(0, 3) would come entirely from feed #1.
    const result = await rssNewsAdapter.fetchItems(req({ topics: ['tech'], limit: 3 }), ctx);
    expect(fetched).toHaveLength(3);
    expect(result.items).toHaveLength(3);
    expect(new Set(result.items.map((i) => i.sourceName)).size).toBe(3);
  });

  it('fires feed requests concurrently instead of one after another', async () => {
    let inFlight = 0;
    let peak = 0;
    const ctx = ctxWith(
      () =>
        new Promise<string>((resolve) => {
          inFlight += 1;
          peak = Math.max(peak, inFlight);
          setTimeout(() => {
            inFlight -= 1;
            resolve(RSS2_FIXTURE);
          }, 5);
        })
    );
    await rssNewsAdapter.fetchItems(req({ topics: ['tech'] }), ctx);
    expect(peak).toBe(3);
  });

  it('keeps items from surviving feeds when one feed fails', async () => {
    let calls = 0;
    const ctx = ctxWith(async () => {
      calls += 1;
      if (calls === 1) throw new Error('network down');
      return RSS2_FIXTURE;
    });
    const result = await rssNewsAdapter.fetchItems(req({ topics: ['tech'], limit: 10 }), ctx);
    expect(result.items.length).toBeGreaterThan(0);
    expect(new Set(result.items.map((i) => i.sourceName)).size).toBe(2);
    expect(result.errors.join(' ')).toContain('network down');
  });

  it('collects per-feed fetch failures instead of throwing', async () => {
    const ctx = ctxWith(async () => {
      throw new Error('network down');
    });
    const result = await rssNewsAdapter.fetchItems(req({ topics: ['news'] }), ctx);
    expect(result.items).toEqual([]);
    expect(result.errors.length).toBeGreaterThanOrEqual(1);
    expect(result.errors.join(' ')).toContain('network down');
  });

  it('falls back to general/news feeds when no topic matches', async () => {
    const fetched: string[] = [];
    const ctx = ctxWith(async (url) => {
      fetched.push(url);
      return RSS2_FIXTURE;
    });
    await rssNewsAdapter.fetchItems(req({ topics: ['knitting'], locale: 'ko' }), ctx);
    expect(fetched.length).toBeGreaterThanOrEqual(1);
    const koFirst = FEED_REGISTRY.find((f) => f.url === fetched[0]);
    expect(koFirst?.lang).toBe('ko');
  });
});
