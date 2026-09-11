import { describe, expect, it } from 'vitest';
import type { PreferenceSignal } from '@shared/domain/preference';
import {
  buildInterestProfile,
  emptyProfile,
  signalWeight,
  summarizeProfile
} from './interestProfile';

function makeSignal(over: Partial<PreferenceSignal> = {}): PreferenceSignal {
  return {
    id: 'sig_1',
    kind: 'reject',
    target: { type: 'topic', value: 'cryptocurrency' },
    context: { sessionId: 's1' },
    interpretation: '가상화폐 주제를 거부했어요',
    scope: 'global',
    confidence: 1.0,
    explicit: true,
    polarity: 'negative',
    createdAt: '2026-08-19T00:00:00.000Z',
    ...over
  };
}

describe('interestProfile', () => {
  it('creates empty profile', () => {
    const p = emptyProfile();
    expect(p.signalCount).toBe(0);
    expect(p.negative.sources).toHaveLength(0);
    expect(p.positive.sources).toHaveLength(0);
  });

  it('aggregates explicit negative signals into hard negative entries', () => {
    const sig = makeSignal({
      target: { type: 'source', value: 'Reddit' },
      kind: 'reject',
      explicit: true,
      polarity: 'negative'
    });
    const profile = buildInterestProfile([sig]);
    expect(profile.negative.sources).toHaveLength(1);
    expect(profile.negative.sources[0].hard).toBe(true);
    expect(profile.negative.sources[0].value).toBe('Reddit');
    expect(profile.negative.sources[0].score).toBeLessThan(0);
  });

  it('aggregates implicit signals with soft scores and non-hard status', () => {
    const sig = makeSignal({
      target: { type: 'kind', value: 'video' },
      kind: 'remove',
      explicit: false,
      confidence: 0.4
    });
    const profile = buildInterestProfile([sig]);
    expect(profile.negative.kinds).toHaveLength(1);
    expect(profile.negative.kinds[0].hard).toBe(false);
  });

  it('filters by sessionId when sessionId option is passed', () => {
    const s1 = makeSignal({
      id: 's1',
      context: { sessionId: 's1' },
      scope: 'session',
      target: { type: 'topic', value: 'rust' }
    });
    const s2 = makeSignal({
      id: 's2',
      context: { sessionId: 's2' },
      scope: 'session',
      target: { type: 'topic', value: 'golang' }
    });

    const p1 = buildInterestProfile([s1, s2], { sessionId: 's1' });
    expect(p1.negative.topics.map((t) => t.value)).toEqual(['rust']);

    // When no sessionId is passed, both session signals apply
    const pAll = buildInterestProfile([s1, s2]);
    expect(pAll.negative.topics.map((t) => t.value).sort()).toEqual(['golang', 'rust']);
  });

  it('decays implicit signals over time', () => {
    const now = Date.parse('2026-08-19T00:00:00.000Z');
    const recent = makeSignal({
      createdAt: '2026-08-19T00:00:00.000Z',
      explicit: false,
      confidence: 0.8
    });
    const old = makeSignal({
      createdAt: '2026-08-05T00:00:00.000Z', // 14 days ago (1 half life)
      explicit: false,
      confidence: 0.8
    });

    const wRecent = signalWeight(recent, now);
    const wOld = signalWeight(old, now);
    expect(wRecent).toBeCloseTo(0.8, 2);
    expect(wOld).toBeCloseTo(0.4, 2);
  });

  it('summarizeProfile outputs Korean summary with [반드시 제외] for hard negatives', () => {
    const sigs = [
      makeSignal({
        target: { type: 'source', value: 'SpamNews' },
        explicit: true,
        kind: 'reject',
        polarity: 'negative'
      }),
      makeSignal({
        target: { type: 'kind', value: 'article' },
        explicit: false,
        kind: 'dock',
        polarity: 'positive',
        confidence: 0.8
      })
    ];
    const profile = buildInterestProfile(sigs);
    const summary = summarizeProfile(profile);
    expect(summary).toContain('[반드시 제외]');
    expect(summary).toContain('SpamNews');
    expect(summary).toContain('article');
    expect(summary).toContain('선호 높음');
  });
});
