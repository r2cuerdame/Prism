import { describe, expect, it } from 'vitest';
import type { InterpretedIntent } from '@shared/domain/intent';
import type { Provenance } from '@shared/domain/provenance';
import type { SourceItem, SourceItemKind } from '@shared/domain/sourceItem';
import type {
  AdapterContext,
  AdapterResult,
  SourceAdapter,
  SourceClass,
  SourceRequest
} from './types';
import { emptyProfile, type InterestProfile } from '@shared/preference/interestProfile';
import { gatherSources } from './orchestrator';

function makeIntent(overrides: Partial<InterpretedIntent> = {}): InterpretedIntent {
  return {
    goal: 'browse',
    topics: ['ai'],
    moods: [],
    contentBalance: {},
    sourceHints: { include: [], exclude: [] },
    locale: 'ko',
    followUp: false,
    ...overrides
  };
}

function makeItem(adapterId: string, n: number, kind: SourceItemKind = 'article', url?: string): SourceItem {
  return {
    id: `${adapterId}-item-${n}`,
    adapterId,
    sourceId: adapterId,
    sourceName: adapterId,
    kind,
    title: `item ${n}`,
    payload: {},
    originalUrl: url ?? `https://example.com/${adapterId}/${n}`,
    retrievedAt: '2026-08-19T00:00:00.000Z',
    provenanceRef: `${adapterId}-prov-${n}`
  };
}

function makeProv(adapterId: string, n: number): Provenance {
  return {
    id: `${adapterId}-prov-${n}`,
    sourceUrl: `https://example.com/${adapterId}/${n}`,
    sourceName: adapterId,
    adapterId,
    retrievedAt: '2026-08-19T00:00:00.000Z',
    transformations: []
  };
}

interface FakeOpts {
  score?: number;
  itemCount?: number;
  kind?: SourceItemKind;
  urls?: string[];
  neverResolve?: boolean;
  reject?: boolean;
  errors?: string[];
  onRequest?: (req: SourceRequest) => void;
}

function makeAdapter(id: string, classes: SourceClass[], opts: FakeOpts = {}): SourceAdapter {
  const count = opts.itemCount ?? 3;
  const items: SourceItem[] = [];
  const provenance: Provenance[] = [];
  for (let i = 0; i < count; i++) {
    items.push(makeItem(id, i, opts.kind ?? 'article', opts.urls?.[i]));
    provenance.push(makeProv(id, i));
  }
  return {
    id,
    name: `Adapter ${id}`,
    classes,
    matches(req) {
      opts.onRequest?.(req);
      return opts.score ?? 0.5;
    },
    fetchItems(): Promise<AdapterResult> {
      if (opts.neverResolve) return new Promise<AdapterResult>(() => undefined);
      if (opts.reject) return Promise.reject(new Error('boom'));
      return Promise.resolve({ items, provenance, errors: opts.errors ?? [] });
    }
  };
}

const ctx: AdapterContext = {
  http: {
    getText: () => Promise.reject(new Error('no network in tests')),
    getJson: () => Promise.reject(new Error('no network in tests'))
  },
  now: () => new Date('2026-08-19T00:00:00.000Z')
};

describe('gatherSources selection', () => {
  it('drops adapters with score <= 0', async () => {
    const a = makeAdapter('a', ['news'], { score: 0.5 });
    const b = makeAdapter('b', ['news'], { score: 0 });
    const res = await gatherSources(makeIntent(), [a, b], ctx);
    expect(res.reports.map((r) => r.adapterId)).toEqual(['a']);
  });

  it('excludes adapters by id or class, case-insensitive', async () => {
    const a = makeAdapter('HackerNews', ['community'], { score: 0.9 });
    const b = makeAdapter('yt', ['video'], { score: 0.9 });
    const c = makeAdapter('rss', ['news'], { score: 0.9 });
    const intent = makeIntent({
      sourceHints: { include: [], exclude: ['hackernews', 'VIDEO'] }
    });
    const res = await gatherSources(intent, [a, b, c], ctx);
    expect(res.reports.map((r) => r.adapterId)).toEqual(['rss']);
  });

  it('include keeps only listed matches plus high-score adapters', async () => {
    const a = makeAdapter('reddit', ['community'], { score: 0.5 });
    const b = makeAdapter('rss', ['news'], { score: 0.5 });
    const c = makeAdapter('yt', ['video'], { score: 0.85 });
    const intent = makeIntent({ sourceHints: { include: ['reddit'], exclude: [] } });
    const res = await gatherSources(intent, [a, b, c], ctx);
    const ids = res.reports.map((r) => r.adapterId).sort();
    expect(ids).toEqual(['reddit', 'yt']);
  });

  it('takes at most 5 adapters sorted by score desc', async () => {
    const adapters = [0.3, 0.9, 0.5, 0.7, 0.4, 0.8, 0.6].map((score, i) =>
      makeAdapter(`a${i}`, ['news'], { score, itemCount: 1 })
    );
    const res = await gatherSources(makeIntent(), adapters, ctx);
    expect(res.reports.map((r) => r.adapterId)).toEqual(['a1', 'a5', 'a3', 'a6', 'a2']);
  });
});

describe('gatherSources limits', () => {
  it('derives per-adapter limit from contentBalance monotonically', async () => {
    const seen: Record<string, number> = {};
    const capture = (id: string) => (req: SourceRequest) => {
      seen[id] = req.limit;
    };
    const lo = makeAdapter('lo', ['video'], { onRequest: capture('lo') });
    const hi = makeAdapter('hi', ['video'], { onRequest: capture('hi') });
    await gatherSources(makeIntent({ contentBalance: { video: 0.2 } }), [lo], ctx);
    await gatherSources(makeIntent({ contentBalance: { video: 0.9 } }), [hi], ctx);
    expect(seen.lo).toBe(Math.round(6 + 12 * 0.2));
    expect(seen.hi).toBe(Math.round(6 + 12 * 0.9));
    expect(seen.hi).toBeGreaterThan(seen.lo);
  });

  it('defaults weight to 0.4 and clamps to 4..18', async () => {
    const seen: Record<string, number> = {};
    const capture = (id: string) => (req: SourceRequest) => {
      seen[id] = req.limit;
    };
    const def = makeAdapter('def', ['news'], { onRequest: capture('def') });
    const min = makeAdapter('min', ['news'], { onRequest: capture('min') });
    await gatherSources(makeIntent(), [def], ctx);
    await gatherSources(makeIntent({ contentBalance: { article: 0 } }), [min], ctx);
    expect(seen.def).toBe(Math.round(6 + 12 * 0.4));
    expect(seen.min).toBe(6); // round(6 + 0) = 6, above clamp floor 4
  });
});

describe('gatherSources partial results', () => {
  it('reports timeout as ok:false while other adapters deliver', async () => {
    const slow = makeAdapter('slow', ['news'], { score: 0.9, neverResolve: true });
    const fast = makeAdapter('fast', ['news'], { score: 0.5, itemCount: 2 });
    const res = await gatherSources(makeIntent(), [slow, fast], ctx, {
      perAdapterTimeoutMs: 20
    });
    const slowReport = res.reports.find((r) => r.adapterId === 'slow');
    const fastReport = res.reports.find((r) => r.adapterId === 'fast');
    expect(slowReport).toMatchObject({ ok: false, count: 0 });
    expect(slowReport?.error).toMatch(/timeout/);
    expect(fastReport).toMatchObject({ ok: true, count: 2 });
    expect(res.items).toHaveLength(2);
  });

  it('reports rejection as ok:false with the error message', async () => {
    const bad = makeAdapter('bad', ['news'], { reject: true });
    const good = makeAdapter('good', ['news'], { itemCount: 1 });
    const res = await gatherSources(makeIntent(), [bad, good], ctx);
    const badReport = res.reports.find((r) => r.adapterId === 'bad');
    expect(badReport).toMatchObject({ ok: false, count: 0, error: 'boom' });
    expect(res.items).toHaveLength(1);
  });
});

describe('gatherSources merge', () => {
  it('dedupes items by originalUrl keeping the first', async () => {
    const shared = 'https://example.com/shared';
    const a = makeAdapter('a', ['news'], {
      score: 0.9,
      itemCount: 2,
      urls: [shared, 'https://example.com/a/1']
    });
    const b = makeAdapter('b', ['news'], {
      score: 0.5,
      itemCount: 2,
      urls: [shared, 'https://example.com/b/1']
    });
    const res = await gatherSources(makeIntent(), [a, b], ctx);
    expect(res.items).toHaveLength(3);
    const holders = res.items.filter((it) => it.originalUrl === shared);
    expect(holders).toHaveLength(1);
    expect(holders[0].adapterId).toBe('a'); // higher score = first
  });

  it('round-robins across adapters so one source cannot flood the cap', async () => {
    const big = makeAdapter('big', ['news'], { score: 0.9, itemCount: 50 });
    const s1 = makeAdapter('s1', ['news'], { score: 0.5, itemCount: 5 });
    const s2 = makeAdapter('s2', ['community'], { score: 0.5, itemCount: 5, kind: 'post' });
    const res = await gatherSources(makeIntent(), [big, s1, s2], ctx, { totalLimit: 12 });
    expect(res.items).toHaveLength(12);
    const byAdapter = (id: string) => res.items.filter((it) => it.adapterId === id).length;
    expect(byAdapter('big')).toBe(4);
    expect(byAdapter('s1')).toBe(4);
    expect(byAdapter('s2')).toBe(4);
  });

  it('exhausted small adapters let others fill the remainder', async () => {
    const big = makeAdapter('big', ['news'], { itemCount: 20 });
    const small = makeAdapter('small', ['news'], { itemCount: 2 });
    const res = await gatherSources(makeIntent(), [big, small], ctx, { totalLimit: 10 });
    expect(res.items).toHaveLength(10);
    expect(res.items.filter((it) => it.adapterId === 'small')).toHaveLength(2);
    expect(res.items.filter((it) => it.adapterId === 'big')).toHaveLength(8);
  });

  it('keeps only provenance referenced by kept items', async () => {
    const a = makeAdapter('a', ['news'], { itemCount: 4 });
    const res = await gatherSources(makeIntent(), [a], ctx, { totalLimit: 2 });
    expect(res.items).toHaveLength(2);
    const refs = new Set(res.items.map((it) => it.provenanceRef));
    expect(res.provenance).toHaveLength(2);
    for (const p of res.provenance) expect(refs.has(p.id)).toBe(true);
  });

  it('report count reflects kept (post-dedupe, post-cap) items', async () => {
    const a = makeAdapter('a', ['news'], { itemCount: 10 });
    const res = await gatherSources(makeIntent(), [a], ctx, { totalLimit: 3 });
    expect(res.reports[0]).toMatchObject({ adapterId: 'a', ok: true, count: 3 });
  });
});

describe('gatherSources preference profile integration', () => {
  it('excludes hard-negative source when >= 2 candidates remain', async () => {
    const a = makeAdapter('a', ['news'], { score: 0.9, itemCount: 3 });
    const b = makeAdapter('b', ['news'], { score: 0.8, itemCount: 3 });
    const c = makeAdapter('c', ['community'], { score: 0.7, itemCount: 3 });

    const profile: InterestProfile = {
      ...emptyProfile(),
      negative: {
        ...emptyProfile().negative,
        sources: [
          {
            type: 'source',
            value: 'c',
            score: -1.0,
            explicit: true,
            hard: true,
            terms: [],
            signalIds: ['s1'],
            interpretations: ['c 제거']
          }
        ]
      }
    };

    const res = await gatherSources(makeIntent(), [a, b, c], ctx, { profile });
    const adapterIds = new Set(res.items.map((it) => it.adapterId));
    expect(adapterIds.has('a')).toBe(true);
    expect(adapterIds.has('b')).toBe(true);
    expect(adapterIds.has('c')).toBe(false);
  });

  it('preserves diversity floor (>=2 candidates) even if a candidate is hard-negative', async () => {
    const a = makeAdapter('a', ['news'], { score: 0.9, itemCount: 3 });
    const b = makeAdapter('b', ['news'], { score: 0.8, itemCount: 3 });

    const profile: InterestProfile = {
      ...emptyProfile(),
      negative: {
        ...emptyProfile().negative,
        sources: [
          {
            type: 'source',
            value: 'b',
            score: -1.0,
            explicit: true,
            hard: true,
            terms: [],
            signalIds: ['s1'],
            interpretations: ['b 제거']
          }
        ]
      }
    };

    // Only 2 candidates total; dropping b would leave 1, violating diversity floor
    const res = await gatherSources(makeIntent(), [a, b], ctx, { profile });
    const adapterIds = new Set(res.items.map((it) => it.adapterId));
    expect(adapterIds.has('a')).toBe(true);
    expect(adapterIds.has('b')).toBe(true);
  });

  it('filters out items matching hard rejected URLs or terms', async () => {
    const badUrl = 'https://example.com/a/bad-item';
    const a = makeAdapter('a', ['news'], {
      score: 0.9,
      itemCount: 3,
      urls: ['https://example.com/a/1', badUrl, 'https://example.com/a/3']
    });
    const b = makeAdapter('b', ['news'], { score: 0.8, itemCount: 2 });

    const profile: InterestProfile = {
      ...emptyProfile(),
      negative: {
        ...emptyProfile().negative,
        items: [
          {
            type: 'item',
            value: badUrl,
            score: -1.0,
            explicit: true,
            hard: true,
            terms: ['bad-item'],
            signalIds: ['s1'],
            interpretations: ['거부된 항목']
          }
        ]
      }
    };

    const res = await gatherSources(makeIntent(), [a, b], ctx, { profile });
    expect(res.items.some((it) => it.originalUrl === badUrl)).toBe(false);
  });

  it('preserves item diversity floor (>= 2 sources) if all items of an adapter are rejected', async () => {
    const a = makeAdapter('a', ['news'], {
      score: 0.9,
      itemCount: 2,
      urls: ['https://example.com/a/1', 'https://example.com/a/2']
    });
    const b = makeAdapter('b', ['news'], {
      score: 0.8,
      itemCount: 2,
      urls: ['https://example.com/b/1', 'https://example.com/b/2']
    });

    // Hard reject all items of b
    const profile: InterestProfile = {
      ...emptyProfile(),
      negative: {
        ...emptyProfile().negative,
        items: [
          {
            type: 'item',
            value: 'https://example.com/b/1',
            score: -1.0,
            explicit: true,
            hard: true,
            terms: [],
            signalIds: ['s1'],
            interpretations: ['거부']
          },
          {
            type: 'item',
            value: 'https://example.com/b/2',
            score: -1.0,
            explicit: true,
            hard: true,
            terms: [],
            signalIds: ['s2'],
            interpretations: ['거부']
          }
        ]
      }
    };

    const res = await gatherSources(makeIntent(), [a, b], ctx, { profile });
    // Diversity floor should ensure b still has at least 1 item
    const adapterIds = new Set(res.items.map((it) => it.adapterId));
    expect(adapterIds.has('a')).toBe(true);
    expect(adapterIds.has('b')).toBe(true);
  });

  it('ranks items by preference score before round-robin merge', async () => {
    const a = makeAdapter('a', ['news'], {
      score: 0.9,
      itemCount: 2,
      urls: ['https://example.com/a/first', 'https://example.com/a/second']
    });

    // Make second item match a positive topic
    const profile: InterestProfile = {
      ...emptyProfile(),
      positive: {
        ...emptyProfile().positive,
        topics: [
          {
            type: 'topic',
            value: 'item 1', // title of second item (index 1) is 'item 1'
            score: 2.0,
            explicit: true,
            hard: false,
            terms: ['item', '1'],
            signalIds: ['s1'],
            interpretations: ['item 1 선호']
          }
        ]
      }
    };

    const res = await gatherSources(makeIntent(), [a], ctx, { profile, totalLimit: 1 });
    expect(res.items).toHaveLength(1);
    expect(res.items[0].originalUrl).toBe('https://example.com/a/second');
  });
});
