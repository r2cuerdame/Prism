import { describe, expect, it } from 'vitest';
import type { Provenance } from '@shared/domain/provenance';
import type { SourceItem } from '@shared/domain/sourceItem';
import type { AdapterResult } from '../types';
import { fetchTargetsInterleaved } from './fanOut';

function item(source: string, n: number): SourceItem {
  return {
    id: `${source}-${n}`,
    kind: 'article',
    title: `${source} ${n}`,
    originalUrl: `https://${source}.example/${n}`,
    adapterId: 'test',
    sourceId: source,
    sourceName: source,
    retrievedAt: '2026-08-19T00:00:00.000Z',
    provenanceRef: `prov-${source}-${n}`,
    payload: {}
  } as SourceItem;
}

function prov(source: string, n: number): Provenance {
  return {
    id: `prov-${source}-${n}`,
    sourceUrl: `https://${source}.example/${n}`
  } as Provenance;
}

function batch(source: string, count: number, errors: string[] = []): AdapterResult {
  const items: SourceItem[] = [];
  const provenance: Provenance[] = [];
  for (let n = 0; n < count; n++) {
    items.push(item(source, n));
    provenance.push(prov(source, n));
  }
  return { items, provenance, errors };
}

const fail = (t: string, e: unknown) => `${t}: ${e instanceof Error ? e.message : String(e)}`;

describe('fetchTargetsInterleaved', () => {
  it('round-robins across targets so every target is represented before the cap', async () => {
    const result = await fetchTargetsInterleaved(
      ['a', 'b', 'c'],
      async (t) => batch(t, 15),
      fail,
      6
    );
    expect(result.items.map((i) => i.id)).toEqual(['a-0', 'b-0', 'c-0', 'a-1', 'b-1', 'c-1']);
    expect(result.errors).toEqual([]);
  });

  it('keeps each target relative order and fills from longer targets once short ones run out', async () => {
    const result = await fetchTargetsInterleaved(
      ['a', 'b'],
      async (t) => batch(t, t === 'a' ? 1 : 4),
      fail,
      10
    );
    expect(result.items.map((i) => i.id)).toEqual(['a-0', 'b-0', 'b-1', 'b-2', 'b-3']);
  });

  it('starts every fetch before any resolves (concurrent, not sequential)', async () => {
    let started = 0;
    let startedWhenFirstResolved = -1;
    const result = await fetchTargetsInterleaved(
      ['a', 'b', 'c'],
      (t) => {
        started += 1;
        return new Promise<AdapterResult>((resolve) => {
          setTimeout(
            () => {
              if (startedWhenFirstResolved < 0) startedWhenFirstResolved = started;
              resolve(batch(t, 2));
            },
            t === 'a' ? 30 : 5
          );
        });
      },
      fail,
      10
    );
    expect(startedWhenFirstResolved).toBe(3);
    // Order follows target order, not completion order.
    expect(result.items.map((i) => i.id)).toEqual(['a-0', 'b-0', 'c-0', 'a-1', 'b-1', 'c-1']);
  });

  it('one failing target does not sink the others and is reported via describeFailure', async () => {
    const result = await fetchTargetsInterleaved(
      ['a', 'boom', 'c'],
      async (t) => {
        if (t === 'boom') throw new Error('HTTP 503');
        return batch(t, 2);
      },
      fail,
      10
    );
    expect(result.items.map((i) => i.id)).toEqual(['a-0', 'c-0', 'a-1', 'c-1']);
    expect(result.errors).toEqual(['boom: HTTP 503']);
  });

  it('survives a fetcher that throws synchronously', async () => {
    const result = await fetchTargetsInterleaved(
      ['a', 'sync'],
      (t) => {
        if (t === 'sync') throw new Error('sync boom');
        return Promise.resolve(batch(t, 1));
      },
      fail,
      10
    );
    expect(result.items.map((i) => i.id)).toEqual(['a-0']);
    expect(result.errors).toEqual(['sync: sync boom']);
  });

  it('merges per-target parse errors in target order and only keeps provenance for kept items', async () => {
    const result = await fetchTargetsInterleaved(
      ['a', 'b'],
      async (t) => batch(t, 3, [`${t} parse warning`]),
      fail,
      3
    );
    expect(result.items.map((i) => i.id)).toEqual(['a-0', 'b-0', 'a-1']);
    expect(result.provenance.map((p) => p.id).sort()).toEqual(
      ['prov-a-0', 'prov-a-1', 'prov-b-0'].sort()
    );
    expect(result.errors).toEqual(['a parse warning', 'b parse warning']);
  });

  it('returns an empty result for zero targets', async () => {
    const result = await fetchTargetsInterleaved([], async () => batch('x', 1), fail, 5);
    expect(result).toEqual({ items: [], provenance: [], errors: [] });
  });
});
