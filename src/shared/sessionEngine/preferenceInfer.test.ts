import { describe, expect, it } from 'vitest';
import type { SessionState } from '@shared/domain/session';
import { createSessionState } from '@shared/domain/session';
import type { ComponentBlock, LayoutPlan } from '@shared/domain/layoutPlan';
import type { SourceItem } from '@shared/domain/sourceItem';
import { PreferenceSignalSchema } from '@shared/domain/preference';
import { inferPreferenceSignals } from './preferenceInfer';

const T0 = '2026-08-19T00:00:00.000Z';
const AT = '2026-08-19T12:00:00.000Z';
const AT_PLUS_30D = new Date(Date.parse(AT) + 30 * 24 * 60 * 60 * 1000).toISOString();

function makeItem(id: string, over: Partial<SourceItem> = {}): SourceItem {
  return {
    id,
    adapterId: 'ad1',
    sourceId: 'src1',
    sourceName: 'Hacker News',
    kind: 'post',
    title: `item ${id}`,
    payload: {},
    originalUrl: 'https://example.com/' + id,
    retrievedAt: T0,
    provenanceRef: 'prov1',
    ...over
  };
}

function makeBlock(id: string, over: Partial<ComponentBlock> = {}): ComponentBlock {
  return {
    id,
    componentType: 'community_posts',
    componentVersion: 1,
    sourceItemRefs: [],
    props: {},
    layout: { span: 6 },
    locked: false,
    docked: false,
    state: {},
    ...over
  };
}

function makePlan(blocks: ComponentBlock[]): LayoutPlan {
  return {
    id: 'plan1',
    version: 1,
    sessionId: 's1',
    blocks,
    generationScope: 'full',
    preservedEdits: { dockedBlockIds: [] },
    plannerMetadata: { planner: 'heuristic', generatedAt: T0, diagnostics: [] }
  };
}

function stateWith(blocks: ComponentBlock[], items: SourceItem[] = []): SessionState {
  const s = createSessionState('s1', T0);
  return {
    ...s,
    plan: makePlan(blocks),
    items: Object.fromEntries(items.map((it) => [it.id, it]))
  };
}

describe('inferPreferenceSignals: remove_block', () => {
  it('emits a negative signal per distinct kind and per distinct source', () => {
    const items = [
      makeItem('i1', { kind: 'post', sourceName: 'Hacker News' }),
      makeItem('i2', { kind: 'post', sourceName: 'Hacker News' }),
      makeItem('i3', { kind: 'headline', sourceName: 'Lobsters' })
    ];
    const s = stateWith([makeBlock('b1', { sourceItemRefs: ['i1', 'i2', 'i3'] })], items);
    const signals = inferPreferenceSignals(s, { type: 'remove_block', blockId: 'b1' }, AT);

    const kindSignals = signals.filter((sg) => sg.target.type === 'kind');
    const sourceSignals = signals.filter((sg) => sg.target.type === 'source');
    expect(kindSignals.map((sg) => sg.target.value).sort()).toEqual(['headline', 'post']);
    expect(sourceSignals.map((sg) => sg.target.value).sort()).toEqual(['Hacker News', 'Lobsters']);
    for (const sg of kindSignals) {
      expect(sg.kind).toBe('remove');
      expect(sg.confidence).toBe(0.4);
      expect(sg.explicit).toBe(false);
      expect(sg.scope).toBe('session');
      expect(sg.createdAt).toBe(AT);
      expect(sg.expiresAt).toBe(AT_PLUS_30D);
      expect(sg.context.sessionId).toBe('s1');
    }
    for (const sg of sourceSignals) expect(sg.confidence).toBe(0.3);
    const postSignal = kindSignals.find((sg) => sg.target.value === 'post');
    expect(postSignal?.interpretation).toContain('커뮤니티 글');
    for (const sg of signals) expect(PreferenceSignalSchema.safeParse(sg).success).toBe(true);
  });

  it('unknown block yields no signals', () => {
    const s = stateWith([makeBlock('b1')]);
    expect(inferPreferenceSignals(s, { type: 'remove_block', blockId: 'nope' }, AT)).toEqual([]);
  });
});

describe('inferPreferenceSignals: dock_block', () => {
  it('docking emits a component signal (0.7) plus per-kind positives (0.5)', () => {
    const items = [makeItem('i1', { kind: 'video' }), makeItem('i2', { kind: 'video' })];
    const s = stateWith(
      [makeBlock('b1', { componentType: 'video_queue', sourceItemRefs: ['i1', 'i2'] })],
      items
    );
    const signals = inferPreferenceSignals(s, { type: 'dock_block', blockId: 'b1', docked: true }, AT);
    expect(signals).toHaveLength(2);
    const comp = signals.find((sg) => sg.target.type === 'component');
    expect(comp?.target.value).toBe('video_queue');
    expect(comp?.confidence).toBe(0.7);
    expect(comp?.kind).toBe('dock');
    const kindSig = signals.find((sg) => sg.target.type === 'kind');
    expect(kindSig?.target.value).toBe('video');
    expect(kindSig?.confidence).toBe(0.5);
    for (const sg of signals) {
      expect(sg.explicit).toBe(false);
      expect(sg.expiresAt).toBe(AT_PLUS_30D);
    }
  });

  it('undocking emits nothing', () => {
    const s = stateWith([makeBlock('b1', { docked: true })]);
    expect(inferPreferenceSignals(s, { type: 'dock_block', blockId: 'b1', docked: false }, AT)).toEqual([]);
  });
});

describe('inferPreferenceSignals: adjust_mix', () => {
  it('emits an explicit signal with confidence 0.9 and no expiry', () => {
    const s = stateWith([]);
    const signals = inferPreferenceSignals(s, { type: 'adjust_mix', kind: 'article', direction: 'less' }, AT);
    expect(signals).toHaveLength(1);
    expect(signals[0].kind).toBe('adjust_mix');
    expect(signals[0].target).toEqual({ type: 'kind', value: 'article' });
    expect(signals[0].confidence).toBe(0.9);
    expect(signals[0].explicit).toBe(true);
    expect(signals[0].scope).toBe('session');
    expect(signals[0].expiresAt).toBeUndefined();
  });

  it("kind 'all' expands to all four kinds", () => {
    const s = stateWith([]);
    const signals = inferPreferenceSignals(s, { type: 'adjust_mix', kind: 'all', direction: 'more' }, AT);
    expect(signals.map((sg) => sg.target.value).sort()).toEqual(['article', 'headline', 'post', 'video']);
  });

  it("direction 'none' emits nothing", () => {
    const s = stateWith([]);
    expect(inferPreferenceSignals(s, { type: 'adjust_mix', kind: 'video', direction: 'none' }, AT)).toEqual([]);
  });
});

describe('inferPreferenceSignals: resize_block / move_block', () => {
  it('span increase emits a weak positive component signal', () => {
    const s = stateWith([makeBlock('b1', { componentType: 'reader', layout: { span: 6 } })]);
    const signals = inferPreferenceSignals(s, { type: 'resize_block', blockId: 'b1', span: 10 }, AT);
    expect(signals).toHaveLength(1);
    expect(signals[0].kind).toBe('resize');
    expect(signals[0].target).toEqual({ type: 'component', value: 'reader' });
    expect(signals[0].confidence).toBe(0.3);
    expect(signals[0].interpretation).toContain('더');
  });

  it('span decrease emits a negative-flavored interpretation', () => {
    const s = stateWith([makeBlock('b1', { componentType: 'reader', layout: { span: 6 } })]);
    const signals = inferPreferenceSignals(s, { type: 'resize_block', blockId: 'b1', span: 3 }, AT);
    expect(signals).toHaveLength(1);
    expect(signals[0].interpretation).toContain('덜');
  });

  it('height-only resize emits nothing', () => {
    const s = stateWith([makeBlock('b1')]);
    expect(inferPreferenceSignals(s, { type: 'resize_block', blockId: 'b1', heightPx: 300 }, AT)).toEqual([]);
  });

  it('moving a block to the top emits a weak component positive', () => {
    const s = stateWith([makeBlock('b1'), makeBlock('b2', { componentType: 'headline_strip' })]);
    const signals = inferPreferenceSignals(s, { type: 'move_block', blockId: 'b2', toIndex: 0 }, AT);
    expect(signals).toHaveLength(1);
    expect(signals[0].kind).toBe('drag');
    expect(signals[0].target).toEqual({ type: 'component', value: 'headline_strip' });
    expect(signals[0].confidence).toBe(0.3);
  });

  it('moving to a non-top index emits nothing', () => {
    const s = stateWith([makeBlock('b1'), makeBlock('b2')]);
    expect(inferPreferenceSignals(s, { type: 'move_block', blockId: 'b1', toIndex: 1 }, AT)).toEqual([]);
  });
});

describe('inferPreferenceSignals: other commands', () => {
  it('returns [] for commands without inference rules', () => {
    const s = stateWith([makeBlock('b1')]);
    expect(inferPreferenceSignals(s, { type: 'rename_session', title: 'x' }, AT)).toEqual([]);
    expect(inferPreferenceSignals(s, { type: 'lock_block', blockId: 'b1', locked: true }, AT)).toEqual([]);
    expect(inferPreferenceSignals(s, { type: 'set_status', status: 'ready' }, AT)).toEqual([]);
  });

  it('signals get unique sig_ ids', () => {
    const items = [makeItem('i1', { kind: 'post' }), makeItem('i2', { kind: 'video' })];
    const s = stateWith([makeBlock('b1', { sourceItemRefs: ['i1', 'i2'] })], items);
    const signals = inferPreferenceSignals(s, { type: 'remove_block', blockId: 'b1' }, AT);
    const ids = signals.map((sg) => sg.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id.startsWith('sig_')).toBe(true);
  });
});

describe('inferPreferenceSignals: remove_item', () => {
  it('emits an explicit negative item reject and a weak implicit source remove', () => {
    const itm = makeItem('i1', { title: 'AI 칩 경쟁 심화', sourceName: 'Hacker News', originalUrl: 'https://news.ycombinator.com/item?id=123' });
    const s = stateWith([makeBlock('b1', { sourceItemRefs: ['i1'] })], [itm]);
    const signals = inferPreferenceSignals(s, { type: 'remove_item', itemId: 'i1' }, AT);
    expect(signals).toHaveLength(2);

    const [itemSig, sourceSig] = signals;
    expect(itemSig.kind).toBe('reject');
    expect(itemSig.target).toEqual({ type: 'item', value: 'https://news.ycombinator.com/item?id=123' });
    expect(itemSig.explicit).toBe(true);
    expect(itemSig.confidence).toBe(1.0);
    expect(itemSig.polarity).toBe('negative');
    expect(itemSig.origin).toBe('context_menu');
    expect(itemSig.terms).toBeDefined();

    expect(sourceSig.kind).toBe('remove');
    expect(sourceSig.target).toEqual({ type: 'source', value: 'Hacker News' });
    expect(sourceSig.explicit).toBe(false);
    expect(sourceSig.confidence).toBe(0.3);
    expect(sourceSig.polarity).toBe('negative');
  });
});
