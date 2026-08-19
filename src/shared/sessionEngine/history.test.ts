import { describe, expect, it } from 'vitest';
import type { SessionState } from '@shared/domain/session';
import { createSessionState } from '@shared/domain/session';
import type { ComponentBlock, LayoutPlan } from '@shared/domain/layoutPlan';
import type { Intent } from '@shared/domain/intent';
import { canRedo, canUndo, createHistory, pushHistory, redoHistory, undoHistory } from './history';

const T0 = '2026-08-19T00:00:00.000Z';
const T1 = '2026-08-19T01:00:00.000Z';

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

function makePlan(id: string, blocks: ComponentBlock[]): LayoutPlan {
  return {
    id,
    version: 1,
    sessionId: 's1',
    blocks,
    generationScope: 'full',
    preservedEdits: { dockedBlockIds: [] },
    plannerMetadata: { planner: 'heuristic', generatedAt: T0, diagnostics: [] }
  };
}

function makeIntent(goal: string): Intent {
  return {
    id: 'in1',
    rawInput: goal,
    interpreted: {
      goal,
      topics: [],
      moods: [],
      contentBalance: {},
      sourceHints: { include: [], exclude: [] },
      locale: 'ko',
      followUp: false
    },
    createdAt: T0
  };
}

function stateWithPlan(): SessionState {
  const s = createSessionState('s1', T0);
  return { ...s, plan: makePlan('plan0', [makeBlock('b1'), makeBlock('b2')]) };
}

describe('createHistory', () => {
  it('starts empty around the initial state', () => {
    const s = stateWithPlan();
    const h = createHistory(s);
    expect(h.present).toBe(s);
    expect(h.past).toEqual([]);
    expect(h.future).toEqual([]);
    expect(h.snapshots).toEqual([]);
    expect(canUndo(h)).toBe(false);
    expect(canRedo(h)).toBe(false);
  });
});

describe('pushHistory', () => {
  it('pushes past entries for normal commands and clears future', () => {
    const h0 = createHistory(stateWithPlan());
    const h1 = pushHistory(h0, { type: 'rename_session', title: 'a' }, T1);
    expect(h1.past).toHaveLength(1);
    expect(h1.present.title).toBe('a');
    const h2 = undoHistory(h1);
    expect(h2.future).toHaveLength(1);
    const h3 = pushHistory(h2, { type: 'rename_session', title: 'b' }, T1);
    expect(h3.future).toEqual([]);
    expect(h3.past).toHaveLength(1);
  });

  it('no-op command returns the same history object', () => {
    const h0 = createHistory(stateWithPlan());
    const h1 = pushHistory(h0, { type: 'remove_block', blockId: 'missing' }, T1);
    expect(h1).toBe(h0);
  });

  it('transient set_block_state replaces present without growing past', () => {
    const h0 = createHistory(stateWithPlan());
    const h1 = pushHistory(h0, { type: 'set_block_state', blockId: 'b1', state: { active: 'x' } }, T1);
    expect(h1.past).toHaveLength(0);
    expect(h1.present.plan?.blocks[0].state).toEqual({ active: 'x' });
    const h2 = pushHistory(h1, { type: 'set_status', status: 'loading' }, T1);
    expect(h2.past).toHaveLength(0);
    expect(h2.present.status).toBe('loading');
  });

  it('caps past at 100 dropping oldest', () => {
    let h = createHistory(stateWithPlan());
    for (let i = 0; i < 110; i++) {
      h = pushHistory(h, { type: 'rename_session', title: `t${i}` }, T1);
    }
    expect(h.past).toHaveLength(100);
    expect(h.past[0].title).toBe('t9');
    expect(h.present.title).toBe('t109');
  });

  it('undo/redo round-trip restores states', () => {
    const h0 = createHistory(stateWithPlan());
    const h1 = pushHistory(h0, { type: 'rename_session', title: 'a' }, T1);
    const h2 = pushHistory(h1, { type: 'rename_session', title: 'b' }, T1);
    const u1 = undoHistory(h2);
    expect(u1.present.title).toBe('a');
    const u2 = undoHistory(u1);
    expect(u2.present.title).toBe('새 세션');
    expect(undoHistory(u2)).toBe(u2); // empty past unchanged
    const r1 = redoHistory(u2);
    expect(r1.present.title).toBe('a');
    const r2 = redoHistory(r1);
    expect(r2.present.title).toBe('b');
    expect(redoHistory(r2)).toBe(r2); // empty future unchanged
  });
});

describe('snapshots', () => {
  it('apply_plan appends a snapshot labeled by the latest intent goal', () => {
    let h = createHistory(stateWithPlan());
    h = pushHistory(h, { type: 'add_intent', intent: makeIntent('심심할 때 볼거리') }, T1);
    h = pushHistory(h, { type: 'apply_plan', plan: makePlan('plan1', [makeBlock('n1')]) }, T1);
    expect(h.snapshots).toHaveLength(1);
    expect(h.snapshots[0].planId).toBe('plan1');
    expect(h.snapshots[0].at).toBe(T1);
    expect(h.snapshots[0].label).toBe('심심할 때 볼거리');
    expect(h.snapshots[0].state).toBe(h.present);
  });

  it("labels '재생성' without an interpreted goal", () => {
    let h = createHistory(stateWithPlan());
    h = pushHistory(h, { type: 'apply_plan', plan: makePlan('plan1', [makeBlock('n1')]) }, T1);
    expect(h.snapshots[0].label).toBe('재생성');
  });

  it('caps snapshots at 30 dropping oldest', () => {
    let h = createHistory(stateWithPlan());
    for (let i = 0; i < 35; i++) {
      h = pushHistory(h, { type: 'apply_plan', plan: makePlan(`plan${i}`, [makeBlock(`n${i}`)]) }, T1);
    }
    expect(h.snapshots).toHaveLength(30);
    expect(h.snapshots[0].planId).toBe('plan5');
    expect(h.snapshots[29].planId).toBe('plan34');
  });

  it('snapshots survive undo/redo', () => {
    let h = createHistory(stateWithPlan());
    h = pushHistory(h, { type: 'apply_plan', plan: makePlan('plan1', [makeBlock('n1')]) }, T1);
    const undone = undoHistory(h);
    expect(undone.snapshots).toHaveLength(1);
    expect(redoHistory(undone).snapshots).toHaveLength(1);
  });
});
