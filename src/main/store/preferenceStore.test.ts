import { describe, expect, it } from 'vitest';
import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { PreferenceSignal } from '@shared/domain/preference';
import { createPreferenceStore } from './preferenceStore';

async function tmpDir(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), 'gptb-'));
}

let seq = 0;
function makeSignal(overrides: Partial<PreferenceSignal> = {}): PreferenceSignal {
  seq += 1;
  return {
    id: `sig_${seq}`,
    kind: 'remove',
    target: { type: 'kind', value: 'post' },
    context: { sessionId: 's1' },
    interpretation: '커뮤니티 글을 제거함',
    scope: 'session',
    confidence: 0.6,
    explicit: false,
    createdAt: new Date().toISOString(),
    ...overrides
  };
}

describe('preferenceStore', () => {
  it('records and lists signals', async () => {
    const store = createPreferenceStore(await tmpDir());
    await store.record([makeSignal(), makeSignal()]);
    expect(await store.list()).toHaveLength(2);
  });

  it('prunes expired signals', async () => {
    const store = createPreferenceStore(await tmpDir());
    const past = new Date(Date.now() - 1000).toISOString();
    const future = new Date(Date.now() + 3_600_000).toISOString();
    await store.record([
      makeSignal({ id: 'exp', expiresAt: past }),
      makeSignal({ id: 'ok', expiresAt: future })
    ]);
    const list = await store.list();
    expect(list.map((s) => s.id)).toEqual(['ok']);
  });

  it('caps at 500 dropping oldest', async () => {
    const store = createPreferenceStore(await tmpDir());
    const batch = Array.from({ length: 510 }, (_, i) => makeSignal({ id: `bulk_${i}` }));
    await store.record(batch);
    const list = await store.list();
    expect(list).toHaveLength(500);
    expect(list[0].id).toBe('bulk_10');
    expect(list[499].id).toBe('bulk_509');
  });

  it('clear(id) removes one, clear() removes all', async () => {
    const store = createPreferenceStore(await tmpDir());
    await store.record([makeSignal({ id: 'a' }), makeSignal({ id: 'b' })]);
    const afterOne = await store.clear('a');
    expect(afterOne.map((s) => s.id)).toEqual(['b']);
    const afterAll = await store.clear();
    expect(afterAll).toEqual([]);
    expect(await store.list()).toEqual([]);
  });

  it('summarizeForPlanner emits Korean lines with negative preference for removes', async () => {
    const store = createPreferenceStore(await tmpDir());
    await store.record([
      makeSignal({ kind: 'remove', target: { type: 'kind', value: 'post' } }),
      makeSignal({ kind: 'remove', target: { type: 'kind', value: 'post' } }),
      makeSignal({ kind: 'remove', target: { type: 'kind', value: 'post' } }),
      makeSignal({
        kind: 'dock',
        target: { type: 'kind', value: 'video' },
        interpretation: '영상 블록을 고정함'
      })
    ]);
    const summary = await store.summarizeForPlanner();
    expect(summary).not.toBe('');
    const lines = summary.split('\n');
    expect(lines.length).toBeLessThanOrEqual(8);
    expect(summary).toContain('post');
    expect(summary).toContain('낮음');
    expect(summary).toContain('높음');
    expect(lines.every((l) => l.startsWith('- '))).toBe(true);
  });

  it('summarizeForPlanner treats adjust_mix with less/줄 as negative', async () => {
    const store = createPreferenceStore(await tmpDir());
    await store.record([
      makeSignal({
        kind: 'adjust_mix',
        target: { type: 'kind', value: 'headline' },
        interpretation: '헤드라인을 줄여 달라고 함',
        explicit: true
      })
    ]);
    const summary = await store.summarizeForPlanner();
    expect(summary).toContain('headline');
    expect(summary).toContain('낮음');
  });

  it('summarizeForPlanner returns empty string with no signals', async () => {
    const store = createPreferenceStore(await tmpDir());
    expect(await store.summarizeForPlanner()).toBe('');
  });

  it('getProfile returns structured InterestProfile', async () => {
    const store = createPreferenceStore(await tmpDir());
    await store.record([
      makeSignal({
        kind: 'reject',
        target: { type: 'source', value: 'Reddit' },
        explicit: true,
        polarity: 'negative'
      }),
      makeSignal({
        kind: 'dock',
        target: { type: 'source', value: 'Hacker News' },
        explicit: true,
        polarity: 'positive'
      })
    ]);
    const profile = await store.getProfile();
    expect(profile.signalCount).toBe(2);
    expect(profile.negative.sources.some((s) => s.value === 'Reddit' && s.hard)).toBe(true);
    expect(profile.positive.sources.some((s) => s.value === 'Hacker News')).toBe(true);
  });
});

