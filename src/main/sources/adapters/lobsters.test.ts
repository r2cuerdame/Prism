import { describe, expect, it } from 'vitest';
import { lobstersFixture } from './__fixtures__/lobstersFixture';
import { lobstersAdapter, normalizeLobsters } from './lobsters';

const NOW = new Date('2026-08-19T00:00:00.000Z');

describe('normalizeLobsters', () => {
  const result = normalizeLobsters(JSON.parse(lobstersFixture), NOW);

  it('normalizes valid entries and skips the malformed one', () => {
    expect(result.items).toHaveLength(4);
    expect(result.provenance).toHaveLength(4);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain('ghi789');
  });

  it('maps identity fields', () => {
    const item = result.items[0];
    expect(item.adapterId).toBe('lobsters');
    expect(item.sourceId).toBe('lobste.rs');
    expect(item.sourceName).toBe('Lobsters');
    expect(item.kind).toBe('post');
    expect(item.title).toBe('Rust 2027 roadmap discussion');
    expect(item.lang).toBe('en');
    expect(item.retrievedAt).toBe(NOW.toISOString());
    expect(item.publishedAt).toBe('2026-08-18T08:00:00.000-05:00');
  });

  it('uses url when present, comments_url when empty', () => {
    expect(result.items[0].originalUrl).toBe('https://blog.rust-lang.org/2027-roadmap');
    expect(result.items[1].originalUrl).toBe(
      'https://lobste.rs/s/def456/what_i_learned_running_my_own_mail_server'
    );
  });

  it('fills post payload', () => {
    const item = result.items[1];
    expect(item.payload).toMatchObject({
      community: 'Lobsters',
      points: 28,
      commentCount: 33,
      commentsUrl: 'https://lobste.rs/s/def456/what_i_learned_running_my_own_mail_server'
    });
  });

  it('links each item to its provenance record', () => {
    for (let i = 0; i < result.items.length; i++) {
      const prov = result.provenance[i];
      expect(result.items[i].provenanceRef).toBe(prov.id);
      expect(prov.adapterId).toBe('lobsters');
      expect(prov.sourceName).toBe('Lobsters');
      expect(prov.sourceUrl).toBe(result.items[i].originalUrl);
    }
  });

  it('never throws on garbage input', () => {
    for (const garbage of [{}, null, 'x', 42, { stories: [] }]) {
      const r = normalizeLobsters(garbage, NOW);
      expect(r.items).toEqual([]);
      expect(r.errors.length).toBeGreaterThan(0);
    }
    expect(normalizeLobsters([null, 'x', {}], NOW).items).toEqual([]);
  });
});

describe('lobstersAdapter', () => {
  it('has stable identity', () => {
    expect(lobstersAdapter.id).toBe('lobsters');
    expect(lobstersAdapter.name).toBe('Lobsters');
    expect(lobstersAdapter.classes).toEqual(['community']);
  });

  it('scores relevance', () => {
    const base = { moods: [], locale: 'en' as const, limit: 10 };
    expect(lobstersAdapter.matches({ ...base, topics: [] })).toBeCloseTo(0.4);
    expect(lobstersAdapter.matches({ ...base, topics: ['dev'] })).toBeCloseTo(0.7);
    expect(lobstersAdapter.matches({ ...base, topics: ['tech', 'dev'] })).toBeCloseTo(0.7);
  });

  it('fetches hottest.json and normalizes', async () => {
    let requested = '';
    const ctx = {
      http: {
        getText: () => Promise.resolve(''),
        getJson: <T = unknown>(url: string): Promise<T> => {
          requested = url;
          return Promise.resolve(JSON.parse(lobstersFixture) as T);
        }
      },
      now: () => NOW
    };
    const r = await lobstersAdapter.fetchItems({ topics: [], moods: [], locale: 'en', limit: 10 }, ctx);
    expect(requested).toBe('https://lobste.rs/hottest.json');
    expect(r.items).toHaveLength(4);
  });

  it('returns errors instead of throwing when fetch fails', async () => {
    const ctx = {
      http: {
        getText: () => Promise.reject(new Error('boom')),
        getJson: () => Promise.reject(new Error('HTTP 503 lobste.rs'))
      },
      now: () => NOW
    };
    const r = await lobstersAdapter.fetchItems({ topics: [], moods: [], locale: 'en', limit: 10 }, ctx);
    expect(r.items).toEqual([]);
    expect(r.errors).toEqual(['HTTP 503 lobste.rs']);
  });
});
