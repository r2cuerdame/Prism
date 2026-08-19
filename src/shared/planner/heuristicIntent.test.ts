import { describe, expect, it } from 'vitest';
import { InterpretedIntentSchema } from '@shared/domain/intent';
import { interpretIntentRules } from './heuristicIntent';

describe('interpretIntentRules', () => {
  it('interprets vague Korean boredom as browse with a balanced mix', () => {
    const r = interpretIntentRules('심심해');
    expect(r.locale).toBe('ko');
    expect(r.moods).toContain('browse');
    expect(r.followUp).toBe(false);
    expect(r.contentBalance).toEqual({ video: 0.5, article: 0.4, post: 0.4, headline: 0.3 });
    expect(r.goal).toBe('가벼운 웹 둘러보기');
    expect(InterpretedIntentSchema.safeParse(r).success).toBe(true);
  });

  it('detects topics and raises video/article balance for "AI 뉴스와 영상 보여줘"', () => {
    const r = interpretIntentRules('AI 뉴스와 영상 보여줘');
    expect(r.locale).toBe('ko');
    expect(r.topics).toContain('ai');
    expect(r.topics).toContain('news');
    expect(r.contentBalance.video).toBeGreaterThanOrEqual(0.7);
    expect(r.contentBalance.article).toBeGreaterThanOrEqual(0.7);
    expect(r.contentBalance.headline).toBeGreaterThanOrEqual(0.5);
  });

  it('handles English input with locale en and gaming topic', () => {
    const r = interpretIntentRules('show me gaming news');
    expect(r.locale).toBe('en');
    expect(r.topics).toContain('gaming');
    expect(r.topics).toContain('news');
  });

  it('marks calm mood for relaxed Korean input', () => {
    const r = interpretIntentRules('조용하고 잔잔한 거 틀어줘');
    expect(r.moods).toContain('calm');
    expect(r.contentBalance.video).toBeCloseTo(0.7);
  });

  it('merges follow-up on top of the prior interpretation', () => {
    const prior = interpretIntentRules('AI 뉴스 보여줘');
    const next = interpretIntentRules('영상도 보여줘', prior);
    expect(next.followUp).toBe(true);
    expect(next.topics).toContain('ai');
    expect(next.topics).toContain('news');
    expect(next.contentBalance.video).toBeCloseTo(0.8);
    // prior article weight carried over
    expect(next.contentBalance.article).toBeCloseTo(0.7);
  });

  it('uses short concrete input as a query when no topic matched', () => {
    const r = interpretIntentRules('BTS 영상 보여줘');
    expect(r.topics).toHaveLength(0);
    expect(r.query).toBe('BTS');
    expect(r.contentBalance.video).toBeCloseTo(0.8);
  });

  it('never throws on empty input and falls back to browse defaults', () => {
    const r = interpretIntentRules('');
    expect(r.moods).toContain('browse');
    expect(r.followUp).toBe(false);
    expect(r.contentBalance.video).toBeCloseTo(0.5);
    expect(r.goal.length).toBeGreaterThan(0);
    expect(InterpretedIntentSchema.safeParse(r).success).toBe(true);
  });
});
