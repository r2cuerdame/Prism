import { describe, expect, it } from 'vitest';
import { getPostPayload } from '@shared/domain/sourceItem';
import type { AdapterContext, SourceRequest } from '../types';
import { REDDIT_HOT_FIXTURE } from './__fixtures__/redditFixture';
import { normalizeReddit, redditAdapter, subHotUrl } from './reddit';

const NOW = new Date('2026-08-19T00:00:00.000Z');
const META = { sub: 'technology' };

function req(partial: Partial<SourceRequest> = {}): SourceRequest {
  return { topics: [], moods: [], locale: 'en', limit: 10, ...partial };
}

function ctxWith(getJson: (url: string) => Promise<unknown>): AdapterContext {
  return {
    http: {
      getText: async () => {
        throw new Error('unused');
      },
      getJson: getJson as AdapterContext['http']['getJson']
    },
    now: () => NOW
  };
}

describe('normalizeReddit', () => {
  const result = normalizeReddit(JSON.parse(REDDIT_HOT_FIXTURE), META, NOW);

  it('maps valid posts and skips the titleless one with an error', () => {
    expect(result.items).toHaveLength(3);
    expect(result.errors.length).toBeGreaterThanOrEqual(1);
  });

  it('maps link posts to external originalUrl plus comments url payload', () => {
    const first = result.items[0];
    expect(first.kind).toBe('post');
    expect(first.originalUrl).toBe('https://external.example.com/story');
    const payload = getPostPayload(first);
    expect(payload).toEqual({
      community: 'r/technology',
      points: 1234,
      commentCount: 321,
      commentsUrl: 'https://www.reddit.com/r/technology/comments/abc12/cool_external_link/'
    });
  });

  it('falls back to the comments url for self posts', () => {
    const self = result.items[1];
    expect(self.originalUrl).toBe('https://www.reddit.com/r/technology/comments/def34/self_post/');
    expect(getPostPayload(self)?.commentsUrl).toBe(self.originalUrl);
  });

  it('only keeps http thumbnails (drops "self"/"default")', () => {
    expect(result.items[0].media?.thumbnailUrl).toBe(
      'https://b.thumbs.redditmedia.com/thumb1.jpg'
    );
    expect(result.items[1].media).toBeUndefined();
    expect(result.items[2].media).toBeUndefined();
  });

  it('converts created_utc seconds to ISO publishedAt', () => {
    expect(result.items[0].publishedAt).toBe(new Date(1755500000 * 1000).toISOString());
  });

  it('fills identity fields and provenance', () => {
    for (const item of result.items) {
      expect(item.adapterId).toBe('reddit');
      expect(item.sourceId).toBe('technology');
      expect(item.sourceName).toBe('r/technology');
      expect(item.retrievedAt).toBe(NOW.toISOString());
      const prov = result.provenance.find((p) => p.id === item.provenanceRef);
      expect(prov).toBeDefined();
      expect(prov?.sourceUrl).toBe(item.originalUrl);
    }
  });
});

describe('normalizeReddit (garbage input)', () => {
  it.each([[{}], [null], ['a string'], [[1, 2]], [{ data: { children: 'nope' } }]])(
    'never throws and reports errors for %j',
    (input) => {
      const result = normalizeReddit(input, META, NOW);
      expect(result.items).toEqual([]);
      expect(result.errors.length).toBeGreaterThanOrEqual(1);
    }
  );
});

describe('redditAdapter', () => {
  it('has the frozen identity', () => {
    expect(redditAdapter.id).toBe('reddit');
    expect(redditAdapter.classes).toEqual(['community']);
  });

  it('scores base 0.4 plus topic overlap', () => {
    expect(redditAdapter.matches(req({ topics: ['cooking'] }))).toBeCloseTo(0.4);
    expect(redditAdapter.matches(req({ topics: ['gaming'] }))).toBeCloseTo(0.6);
  });

  it('fetches matching subs and maps posts', async () => {
    const fetched: string[] = [];
    const ctx = ctxWith(async (url) => {
      fetched.push(url);
      return JSON.parse(REDDIT_HOT_FIXTURE);
    });
    const result = await redditAdapter.fetchItems(req({ topics: ['tech'], limit: 10 }), ctx);
    expect(fetched).toEqual([subHotUrl('technology', 10)]);
    expect(result.items).toHaveLength(3);
    const refs = new Set(result.items.map((i) => i.provenanceRef));
    expect(result.provenance.every((p) => refs.has(p.id))).toBe(true);
  });

  it('interleaves subs so the limit is not saturated by the first sub', async () => {
    const fetched: string[] = [];
    const ctx = ctxWith(async (url) => {
      fetched.push(url);
      return JSON.parse(REDDIT_HOT_FIXTURE);
    });
    // tech + gaming + dev select three subs; the fixture yields 3 posts per sub,
    // so a linear slice(0, 3) would come entirely from sub #1.
    const result = await redditAdapter.fetchItems(
      req({ topics: ['tech', 'gaming', 'dev'], limit: 3 }),
      ctx
    );
    expect(fetched).toEqual([
      subHotUrl('technology', 3),
      subHotUrl('gaming', 3),
      subHotUrl('programming', 3)
    ]);
    expect(result.items).toHaveLength(3);
    expect(new Set(result.items.map((i) => i.sourceId)).size).toBe(3);
  });

  it('fires sub requests concurrently instead of one after another', async () => {
    let inFlight = 0;
    let peak = 0;
    const ctx = ctxWith(
      () =>
        new Promise<unknown>((resolve) => {
          inFlight += 1;
          peak = Math.max(peak, inFlight);
          setTimeout(() => {
            inFlight -= 1;
            resolve(JSON.parse(REDDIT_HOT_FIXTURE));
          }, 5);
        })
    );
    await redditAdapter.fetchItems(req({ topics: ['tech', 'gaming', 'dev'] }), ctx);
    expect(peak).toBe(3);
  });

  it('keeps posts from surviving subs when one sub is 403', async () => {
    const ctx = ctxWith(async (url) => {
      if (url.includes('/r/technology/')) throw new Error('HTTP 403 Forbidden');
      return JSON.parse(REDDIT_HOT_FIXTURE);
    });
    const result = await redditAdapter.fetchItems(
      req({ topics: ['tech', 'gaming', 'dev'], limit: 10 }),
      ctx
    );
    expect(result.items.length).toBeGreaterThan(0);
    expect(new Set(result.items.map((i) => i.sourceId)).size).toBe(2);
    expect(result.errors.join(' ')).toContain('403');
  });

  it('degrades gracefully on 403 (expected for unauthenticated reddit)', async () => {
    const ctx = ctxWith(async () => {
      throw new Error('HTTP 403 Forbidden');
    });
    const result = await redditAdapter.fetchItems(req({ topics: ['tech', 'news'] }), ctx);
    expect(result.items).toEqual([]);
    expect(result.errors.length).toBeGreaterThanOrEqual(1);
    expect(result.errors.join(' ')).toContain('403');
  });
});
