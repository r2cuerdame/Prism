import { describe, expect, it } from 'vitest';
import { getVideoPayload } from '@shared/domain/sourceItem';
import type { AdapterContext, SourceRequest } from '../types';
import { YOUTUBE_FEED_FIXTURE } from './__fixtures__/youtubeFixture';
import { CHANNEL_REGISTRY, channelFeedUrl, parseYoutubeFeed, youtubeAdapter } from './youtube';

const NOW = new Date('2026-08-19T00:00:00.000Z');
const META = { channelId: 'UCsBjURrPoezykLs9EqgamOA', name: 'Fireship' };

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

describe('parseYoutubeFeed', () => {
  const result = parseYoutubeFeed(YOUTUBE_FEED_FIXTURE, META, NOW);

  it('maps valid entries and skips the one without yt:videoId', () => {
    expect(result.items).toHaveLength(2);
    expect(result.errors.length).toBeGreaterThanOrEqual(1);
  });

  it('maps videoId into embedId, payload and watch url', () => {
    const first = result.items[0];
    expect(first.kind).toBe('video');
    expect(first.media?.embedId).toBe('abc123XYZ_1');
    expect(first.originalUrl).toBe('https://www.youtube.com/watch?v=abc123XYZ_1');
    const payload = getVideoPayload(first);
    expect(payload).toEqual({ videoId: 'abc123XYZ_1', channel: 'Fireship', durationText: undefined });
  });

  it('takes thumbnail and description from media:group', () => {
    expect(result.items[0].media?.thumbnailUrl).toBe(
      'https://i.ytimg.com/vi/abc123XYZ_1/hqdefault.jpg'
    );
    expect(result.items[0].summary).toBe('Learn React fast & easy in 100 seconds.');
  });

  it('converts published to ISO', () => {
    expect(result.items[0].publishedAt).toBe('2026-08-15T10:00:00.000Z');
  });

  it('fills identity fields and provenance', () => {
    for (const item of result.items) {
      expect(item.adapterId).toBe('youtube');
      expect(item.sourceId).toBe(META.channelId);
      expect(item.sourceName).toBe('Fireship');
      expect(item.retrievedAt).toBe(NOW.toISOString());
      const prov = result.provenance.find((p) => p.id === item.provenanceRef);
      expect(prov).toBeDefined();
      expect(prov?.sourceUrl).toBe(item.originalUrl);
    }
  });
});

describe('parseYoutubeFeed (garbage input)', () => {
  it.each(['', '<not-xml', '{}', '<rss><channel/></rss>'])(
    'never throws and reports errors for %j',
    (input) => {
      const result = parseYoutubeFeed(input, META, NOW);
      expect(result.items).toEqual([]);
      expect(result.errors.length).toBeGreaterThanOrEqual(1);
    }
  );
});

describe('youtubeAdapter', () => {
  it('has the frozen identity', () => {
    expect(youtubeAdapter.id).toBe('youtube');
    expect(youtubeAdapter.classes).toEqual(['video']);
  });

  it('always scores at least 0.4 and boosts topic overlap', () => {
    expect(youtubeAdapter.matches(req({ topics: ['cooking'] }))).toBeGreaterThanOrEqual(0.4);
    expect(youtubeAdapter.matches(req({ topics: ['dev'] }))).toBeGreaterThan(
      youtubeAdapter.matches(req({ topics: ['cooking'] }))
    );
  });

  it('fetches matching channel feeds and caps at limit', async () => {
    const fetched: string[] = [];
    const ctx = ctxWith(async (url) => {
      fetched.push(url);
      return YOUTUBE_FEED_FIXTURE;
    });
    const result = await youtubeAdapter.fetchItems(req({ topics: ['ai'], limit: 3 }), ctx);
    expect(fetched.length).toBeGreaterThanOrEqual(1);
    expect(fetched.length).toBeLessThanOrEqual(3);
    for (const url of fetched) {
      expect(CHANNEL_REGISTRY.some((c) => channelFeedUrl(c.channelId) === url)).toBe(true);
    }
    expect(result.items.length).toBeLessThanOrEqual(3);
    expect(result.items.length).toBeGreaterThan(0);
    expect(result.items.every((i) => i.kind === 'video')).toBe(true);
    expect(result.items.every((i) => i.lang === 'en')).toBe(true);
    const refs = new Set(result.items.map((i) => i.provenanceRef));
    expect(result.provenance.every((p) => refs.has(p.id))).toBe(true);
  });

  it('falls back to general/science channels for unknown topics', async () => {
    const fetched: string[] = [];
    const ctx = ctxWith(async (url) => {
      fetched.push(url);
      return YOUTUBE_FEED_FIXTURE;
    });
    await youtubeAdapter.fetchItems(req({ topics: ['knitting'] }), ctx);
    expect(fetched.length).toBeGreaterThanOrEqual(1);
  });

  it('collects per-feed failures instead of throwing', async () => {
    const ctx = ctxWith(async () => {
      throw new Error('offline');
    });
    const result = await youtubeAdapter.fetchItems(req({ topics: ['science'] }), ctx);
    expect(result.items).toEqual([]);
    expect(result.errors.join(' ')).toContain('offline');
  });
});
