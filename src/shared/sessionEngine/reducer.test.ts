import { describe, expect, it } from 'vitest';
import type { SessionState } from '@shared/domain/session';
import { createSessionState } from '@shared/domain/session';
import type { ComponentBlock, LayoutPlan } from '@shared/domain/layoutPlan';
import type { SourceItem } from '@shared/domain/sourceItem';
import type { Intent } from '@shared/domain/intent';
import { applySessionCommand } from './reducer';

const T0 = '2026-08-19T00:00:00.000Z';
const T1 = '2026-08-19T01:00:00.000Z';

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
    componentType: 'article_list',
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

function makePlan(blocks: ComponentBlock[], over: Partial<LayoutPlan> = {}): LayoutPlan {
  return {
    id: 'plan1',
    version: 1,
    sessionId: 's1',
    blocks,
    generationScope: 'full',
    preservedEdits: { dockedBlockIds: blocks.filter((b) => b.docked).map((b) => b.id) },
    plannerMetadata: { planner: 'heuristic', generatedAt: T0, diagnostics: [] },
    ...over
  };
}

function makeIntent(id: string, goal: string | null): Intent {
  return {
    id,
    rawInput: goal ?? 'raw',
    interpreted: goal
      ? {
          goal,
          topics: [],
          moods: [],
          contentBalance: {},
          sourceHints: { include: [], exclude: [] },
          locale: 'ko',
          followUp: false
        }
      : null,
    createdAt: T0
  };
}

function baseState(blocks: ComponentBlock[] = [makeBlock('b1'), makeBlock('b2'), makeBlock('b3')]): SessionState {
  const s = createSessionState('s1', T0);
  return { ...s, plan: makePlan(blocks) };
}

describe('applySessionCommand basics', () => {
  it('block commands are no-ops when plan is null', () => {
    const s = createSessionState('s1', T0);
    for (const cmd of [
      { type: 'move_block', blockId: 'b1', toIndex: 0 },
      { type: 'resize_block', blockId: 'b1', span: 4 },
      { type: 'remove_block', blockId: 'b1' },
      { type: 'dock_block', blockId: 'b1', docked: true },
      { type: 'lock_block', blockId: 'b1', locked: true },
      { type: 'set_block_props', blockId: 'b1', props: { a: 1 } },
      { type: 'set_block_state', blockId: 'b1', state: { a: 1 } },
      { type: 'insert_block', block: makeBlock('nb') }
    ] as const) {
      expect(applySessionCommand(s, cmd, T1)).toBe(s);
    }
  });

  it('unknown blockId is a no-op', () => {
    const s = baseState();
    expect(applySessionCommand(s, { type: 'remove_block', blockId: 'nope' }, T1)).toBe(s);
    expect(applySessionCommand(s, { type: 'move_block', blockId: 'nope', toIndex: 0 }, T1)).toBe(s);
  });

  it('sets updatedAt from at on state-changing commands, defaults to state.updatedAt', () => {
    const s = baseState();
    const next = applySessionCommand(s, { type: 'rename_session', title: 'x' }, T1);
    expect(next.updatedAt).toBe(T1);
    const next2 = applySessionCommand(s, { type: 'rename_session', title: 'x' });
    expect(next2.updatedAt).toBe(T0);
  });
});

describe('move_block', () => {
  it('reorders blocks', () => {
    const s = baseState();
    const next = applySessionCommand(s, { type: 'move_block', blockId: 'b3', toIndex: 0 }, T1);
    expect(next.plan?.blocks.map((b) => b.id)).toEqual(['b3', 'b1', 'b2']);
    expect(s.plan?.blocks.map((b) => b.id)).toEqual(['b1', 'b2', 'b3']); // immutability
  });

  it('clamps toIndex', () => {
    const s = baseState();
    const next = applySessionCommand(s, { type: 'move_block', blockId: 'b1', toIndex: 99 }, T1);
    expect(next.plan?.blocks.map((b) => b.id)).toEqual(['b2', 'b3', 'b1']);
  });

  it('same position is a no-op', () => {
    const s = baseState();
    expect(applySessionCommand(s, { type: 'move_block', blockId: 'b1', toIndex: 0 }, T1)).toBe(s);
  });
});

describe('resize_block', () => {
  it('sets span with clamping', () => {
    const s = baseState();
    const next = applySessionCommand(s, { type: 'resize_block', blockId: 'b1', span: 99 }, T1);
    expect(next.plan?.blocks[0].layout.span).toBe(12);
  });

  it('sets and clears heightPx', () => {
    const s = baseState();
    const withH = applySessionCommand(s, { type: 'resize_block', blockId: 'b1', heightPx: 400 }, T1);
    expect(withH.plan?.blocks[0].layout.heightPx).toBe(400);
    const cleared = applySessionCommand(withH, { type: 'resize_block', blockId: 'b1', heightPx: null }, T1);
    expect(cleared.plan?.blocks[0].layout.heightPx).toBeUndefined();
  });
});

describe('remove_block', () => {
  it('drops the block but keeps items in the pool', () => {
    const item = makeItem('i1');
    const s: SessionState = {
      ...baseState([makeBlock('b1', { sourceItemRefs: ['i1'] }), makeBlock('b2')]),
      items: { i1: item }
    };
    const next = applySessionCommand(s, { type: 'remove_block', blockId: 'b1' }, T1);
    expect(next.plan?.blocks.map((b) => b.id)).toEqual(['b2']);
    expect(next.items.i1).toBe(item);
  });
});

describe('dock_block / lock_block', () => {
  it('docks and tracks preservedEdits.dockedBlockIds', () => {
    const s = baseState();
    const next = applySessionCommand(s, { type: 'dock_block', blockId: 'b2', docked: true }, T1);
    expect(next.plan?.blocks[1].docked).toBe(true);
    expect(next.plan?.preservedEdits.dockedBlockIds).toEqual(['b2']);
    const undone = applySessionCommand(next, { type: 'dock_block', blockId: 'b2', docked: false }, T1);
    expect(undone.plan?.blocks[1].docked).toBe(false);
    expect(undone.plan?.preservedEdits.dockedBlockIds).toEqual([]);
  });

  it('locks a block', () => {
    const s = baseState();
    const next = applySessionCommand(s, { type: 'lock_block', blockId: 'b1', locked: true }, T1);
    expect(next.plan?.blocks[0].locked).toBe(true);
  });
});

describe('set_block_props / set_block_state', () => {
  it('shallow-merges props', () => {
    const s = baseState([makeBlock('b1', { props: { a: 1, b: 2 } })]);
    const next = applySessionCommand(s, { type: 'set_block_props', blockId: 'b1', props: { b: 3, c: 4 } }, T1);
    expect(next.plan?.blocks[0].props).toEqual({ a: 1, b: 3, c: 4 });
  });

  it('shallow-merges state', () => {
    const s = baseState([makeBlock('b1', { state: { activeItemId: 'x' } })]);
    const next = applySessionCommand(s, { type: 'set_block_state', blockId: 'b1', state: { muted: true } }, T1);
    expect(next.plan?.blocks[0].state).toEqual({ activeItemId: 'x', muted: true });
  });
});

describe('insert_block', () => {
  it('inserts at index and defaults to end', () => {
    const s = baseState();
    const atEnd = applySessionCommand(s, { type: 'insert_block', block: makeBlock('nb') }, T1);
    expect(atEnd.plan?.blocks.map((b) => b.id)).toEqual(['b1', 'b2', 'b3', 'nb']);
    const atOne = applySessionCommand(s, { type: 'insert_block', block: makeBlock('nb'), atIndex: 1 }, T1);
    expect(atOne.plan?.blocks.map((b) => b.id)).toEqual(['b1', 'nb', 'b2', 'b3']);
  });
});

describe('adjust_mix', () => {
  it('sets a kind direction and appends a note', () => {
    const s = baseState();
    const next = applySessionCommand(s, { type: 'adjust_mix', kind: 'video', direction: 'more' }, T1);
    expect(next.compositionHints.mix.video).toBe('more');
    expect(next.compositionHints.notes).toHaveLength(1);
  });

  it("direction 'none' deletes the key", () => {
    const s = baseState();
    const more = applySessionCommand(s, { type: 'adjust_mix', kind: 'video', direction: 'more' }, T1);
    const none = applySessionCommand(more, { type: 'adjust_mix', kind: 'video', direction: 'none' }, T1);
    expect(none.compositionHints.mix.video).toBeUndefined();
  });

  it("kind 'all' applies to every kind", () => {
    const s = baseState();
    const next = applySessionCommand(s, { type: 'adjust_mix', kind: 'all', direction: 'less' }, T1);
    expect(next.compositionHints.mix).toEqual({ video: 'less', article: 'less', post: 'less', headline: 'less' });
  });

  it('caps notes at 10 dropping oldest', () => {
    let s = baseState();
    for (let i = 0; i < 12; i++) {
      s = applySessionCommand(s, { type: 'adjust_mix', kind: 'video', direction: i % 2 ? 'more' : 'less' }, T1);
    }
    expect(s.compositionHints.notes).toHaveLength(10);
  });
});

describe('replace_block', () => {
  it('swaps the block and merges items', () => {
    const s = baseState();
    const item = makeItem('i9');
    const next = applySessionCommand(
      s,
      { type: 'replace_block', blockId: 'b2', block: makeBlock('b2n', { sourceItemRefs: ['i9'] }), items: [item] },
      T1
    );
    expect(next.plan?.blocks.map((b) => b.id)).toEqual(['b1', 'b2n', 'b3']);
    expect(next.items.i9).toBe(item);
  });
});

describe('add_intent', () => {
  it('appends and caps at 20', () => {
    let s = baseState();
    for (let i = 0; i < 25; i++) {
      s = applySessionCommand(s, { type: 'add_intent', intent: makeIntent(`in${i}`, null) }, T1);
    }
    expect(s.intentHistory).toHaveLength(20);
    expect(s.intentHistory[0].id).toBe('in5');
  });

  it('retitles a default-titled session from the interpreted goal (max 24 chars)', () => {
    const s = baseState();
    const longGoal = '아주아주 긴 목표 문장이라서 스물네 글자를 넘어가는 제목입니다';
    const next = applySessionCommand(s, { type: 'add_intent', intent: makeIntent('in1', longGoal) }, T1);
    expect(next.title).toBe(longGoal.slice(0, 24));
  });

  it('does not retitle a renamed session', () => {
    const s = { ...baseState(), title: '내 세션' };
    const next = applySessionCommand(s, { type: 'add_intent', intent: makeIntent('in1', '목표') }, T1);
    expect(next.title).toBe('내 세션');
  });
});

describe('set_status / rename_session', () => {
  it('sets status and detail', () => {
    const s = baseState();
    const next = applySessionCommand(s, { type: 'set_status', status: 'failed', detail: '오류' }, T1);
    expect(next.status).toBe('failed');
    expect(next.statusDetail).toBe('오류');
  });

  it('renames the session', () => {
    const s = baseState();
    expect(applySessionCommand(s, { type: 'rename_session', title: '새 이름' }, T1).title).toBe('새 이름');
  });
});

describe('apply_plan', () => {
  it('replaces the plan, merges items, sets ready status', () => {
    const s: SessionState = { ...baseState(), status: 'planning', statusDetail: '생성 중' };
    const item = makeItem('i1');
    const plan = makePlan([makeBlock('nb1', { sourceItemRefs: ['i1'] })], { id: 'plan2' });
    const next = applySessionCommand(s, { type: 'apply_plan', plan, items: [item] }, T1);
    expect(next.plan?.id).toBe('plan2');
    expect(next.plan?.blocks.map((b) => b.id)).toEqual(['nb1']);
    expect(next.items.i1).toBe(item);
    expect(next.status).toBe('ready');
    expect(next.statusDetail).toBeUndefined();
    expect(next.updatedAt).toBe(T1);
  });

  it('re-inserts docked blocks missing from the new plan at min(old index, length)', () => {
    const docked = makeBlock('dock1', { docked: true });
    const s = baseState([makeBlock('b1'), docked, makeBlock('b3')]);
    const plan = makePlan([makeBlock('n1'), makeBlock('n2')], { id: 'plan2' });
    const next = applySessionCommand(s, { type: 'apply_plan', plan }, T1);
    expect(next.plan?.blocks.map((b) => b.id)).toEqual(['n1', 'dock1', 'n2']);
    expect(next.plan?.preservedEdits.dockedBlockIds).toEqual(['dock1']);
  });

  it('clamps re-insert index to new blocks length', () => {
    const docked = makeBlock('dock1', { docked: true });
    const s = baseState([makeBlock('b1'), makeBlock('b2'), makeBlock('b3'), docked]);
    const plan = makePlan([makeBlock('n1')], { id: 'plan2' });
    const next = applySessionCommand(s, { type: 'apply_plan', plan }, T1);
    expect(next.plan?.blocks.map((b) => b.id)).toEqual(['n1', 'dock1']);
  });

  it('does not duplicate docked blocks the new plan already contains', () => {
    const docked = makeBlock('dock1', { docked: true });
    const s = baseState([docked, makeBlock('b2')]);
    const plan = makePlan([docked, makeBlock('n1')], { id: 'plan2' });
    const next = applySessionCommand(s, { type: 'apply_plan', plan }, T1);
    expect(next.plan?.blocks.map((b) => b.id)).toEqual(['dock1', 'n1']);
  });

  it('prunes unreferenced items to the 100 most recently retrieved', () => {
    const items: Record<string, SourceItem> = {};
    for (let i = 0; i < 120; i++) {
      const id = `u${i}`;
      items[id] = makeItem(id, {
        retrievedAt: new Date(Date.parse(T0) + i * 1000).toISOString()
      });
    }
    items.ref1 = makeItem('ref1', { retrievedAt: '2000-01-01T00:00:00.000Z' });
    const s: SessionState = { ...baseState(), items };
    const plan = makePlan([makeBlock('n1', { sourceItemRefs: ['ref1'] })], { id: 'plan2' });
    const next = applySessionCommand(s, { type: 'apply_plan', plan }, T1);
    expect(Object.keys(next.items)).toHaveLength(101);
    expect(next.items.ref1).toBeDefined(); // referenced survives despite old retrievedAt
    expect(next.items.u119).toBeDefined(); // newest unreferenced kept
    expect(next.items.u0).toBeUndefined(); // oldest unreferenced pruned
    expect(next.items.u19).toBeUndefined();
    expect(next.items.u20).toBeDefined();
  });

  it('works when there is no current plan', () => {
    const s = createSessionState('s1', T0);
    const plan = makePlan([makeBlock('n1')], { id: 'plan2' });
    const next = applySessionCommand(s, { type: 'apply_plan', plan }, T1);
    expect(next.plan?.blocks.map((b) => b.id)).toEqual(['n1']);
    expect(next.status).toBe('ready');
  });
});
