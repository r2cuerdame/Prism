import { describe, expect, it } from 'vitest';
import type { ComponentBlock, LayoutPlan } from '@shared/domain/layoutPlan';
import type { SourceItem, SourceItemKind } from '@shared/domain/sourceItem';
import { validateAndRepairPlan } from './validatePlan';

const NOW = '2026-08-19T00:00:00.000Z';

function makeItem(id: string, kind: SourceItemKind): SourceItem {
  return {
    id,
    adapterId: 'test-adapter',
    sourceId: 'test-source',
    sourceName: '테스트 소스',
    kind,
    title: `item ${id}`,
    payload: {},
    originalUrl: `https://example.com/${id}`,
    retrievedAt: NOW,
    provenanceRef: 'prov_1'
  };
}

function makeBlock(over: Partial<ComponentBlock> & { componentType: string }): ComponentBlock {
  return {
    id: over.id ?? `blk_${over.componentType}`,
    componentVersion: 1,
    sourceItemRefs: over.sourceItemRefs ?? [],
    props: over.props ?? {},
    layout: over.layout ?? { span: 6 },
    locked: false,
    docked: false,
    state: {},
    ...over
  };
}

function makePlan(blocks: ComponentBlock[], sessionId = 's1'): LayoutPlan {
  return {
    id: 'plan_1',
    version: 1,
    sessionId,
    blocks,
    generationScope: 'full',
    preservedEdits: { dockedBlockIds: [] },
    plannerMetadata: { planner: 'llm', generatedAt: NOW, diagnostics: [] }
  };
}

const textBlock = (id = 'blk_text'): ComponentBlock =>
  makeBlock({ id, componentType: 'text', props: { text: '안내' }, layout: { span: 12 } });

describe('synthesis citations', () => {
  it('remaps citation indices when refs are dropped, so bullets keep their real source', () => {
    // The planner cited refs 0 and 2; ref 1 does not exist and is dropped,
    // which shifts index 2 down to 1. A stale index would credit item i0.
    const items = [makeItem('i0', 'article'), makeItem('i2', 'post')];
    const block = makeBlock({
      componentType: 'synthesis_brief',
      sourceItemRefs: ['i0', 'ghost', 'i2'],
      layout: { span: 12 },
      props: {
        points: [
          { text: '두 소스가 같은 주제를 다뤄요', cites: [0, 2] },
          { text: '사라진 근거만 있는 문장', cites: [1] }
        ]
      }
    });
    const { plan } = validateAndRepairPlan(makePlan([block]), items, 's1');
    const repaired = plan.blocks.find((b) => b.componentType === 'synthesis_brief');
    expect(repaired?.sourceItemRefs).toEqual(['i0', 'i2']);
    const points = repaired?.props.points as { text: string; cites: number[] }[];
    expect(points[0].cites).toEqual([0, 1]);
    expect(points[1].cites).toEqual([]);
    // Every surviving citation must resolve inside the new refs array.
    for (const p of points) {
      for (const c of p.cites) {
        expect(repaired?.sourceItemRefs[c]).toBeDefined();
      }
    }
  });
});

describe('validateAndRepairPlan', () => {
  it('total garbage falls back to a single text block with issues', () => {
    for (const garbage of [42, 'nope', null, undefined, { foo: 1 }]) {
      const { plan, issues } = validateAndRepairPlan(garbage, [], 's1');
      expect(plan.blocks).toHaveLength(1);
      expect(plan.blocks[0]!.componentType).toBe('text');
      expect(plan.blocks[0]!.props.text).toContain('만들지 못했어요');
      expect(plan.sessionId).toBe('s1');
      expect(plan.version).toBe(1);
      expect(issues.length).toBeGreaterThan(0);
    }
  });

  it('drops blocks with unknown componentType', () => {
    const raw = makePlan([makeBlock({ id: 'u1', componentType: 'fancy_widget' }), textBlock()]);
    const { plan, issues } = validateAndRepairPlan(raw, [], 's1');
    expect(plan.blocks).toHaveLength(1);
    expect(plan.blocks[0]!.componentType).toBe('text');
    expect(issues.some((i) => i.includes('fancy_widget'))).toBe(true);
  });

  it('replaces invalid props with catalog defaults', () => {
    const items = [makeItem('a1', 'article')];
    const raw = makePlan([
      makeBlock({
        id: 'b1',
        componentType: 'article_list',
        props: { density: 'weird' },
        sourceItemRefs: ['a1'],
        layout: { span: 6 }
      })
    ]);
    const { plan, issues } = validateAndRepairPlan(raw, items, 's1');
    expect(plan.blocks[0]!.props).toEqual({ density: 'comfortable', maxItems: 6 });
    expect(issues.length).toBeGreaterThan(0);
  });

  it('merges valid props over defaults', () => {
    const items = [makeItem('a1', 'article')];
    const raw = makePlan([
      makeBlock({
        id: 'b1',
        componentType: 'article_list',
        props: { title: '기사', density: 'compact' },
        sourceItemRefs: ['a1'],
        layout: { span: 6 }
      })
    ]);
    const { plan } = validateAndRepairPlan(raw, items, 's1');
    expect(plan.blocks[0]!.props).toEqual({ density: 'compact', maxItems: 6, title: '기사' });
  });

  it('filters refs by existence and accepted kind', () => {
    const items = [makeItem('a1', 'article'), makeItem('v1', 'video')];
    const raw = makePlan([
      makeBlock({
        id: 'b1',
        componentType: 'article_list',
        sourceItemRefs: ['a1', 'v1', 'missing'],
        layout: { span: 6 }
      })
    ]);
    const { plan, issues } = validateAndRepairPlan(raw, items, 's1');
    expect(plan.blocks[0]!.sourceItemRefs).toEqual(['a1']);
    expect(issues.length).toBeGreaterThan(0);
  });

  it('clears refs for components that accept no items', () => {
    const items = [makeItem('a1', 'article')];
    const raw = makePlan([
      makeBlock({
        id: 'b1',
        componentType: 'text',
        props: { text: '메모' },
        sourceItemRefs: ['a1'],
        layout: { span: 12 }
      })
    ]);
    const { plan } = validateAndRepairPlan(raw, items, 's1');
    expect(plan.blocks[0]!.sourceItemRefs).toEqual([]);
  });

  it('clamps span to catalog bounds', () => {
    const items = [makeItem('a1', 'article')];
    const raw = makePlan([
      makeBlock({
        id: 'b1',
        componentType: 'article_list',
        sourceItemRefs: ['a1'],
        layout: { span: 1 }
      })
    ]);
    const { plan, issues } = validateAndRepairPlan(raw, items, 's1');
    expect(plan.blocks[0]!.layout.span).toBe(4); // article_list minSpan
    expect(issues.some((i) => i.includes('span'))).toBe(true);
  });

  it('drops a block below minItems when fallback is hide', () => {
    const items = [makeItem('h1', 'headline')];
    const raw = makePlan([
      makeBlock({
        id: 'b1',
        componentType: 'headline_strip', // minItems 3, fallback hide
        sourceItemRefs: ['h1'],
        layout: { span: 12 }
      }),
      textBlock()
    ]);
    const { plan, issues } = validateAndRepairPlan(raw, items, 's1');
    expect(plan.blocks.map((b) => b.componentType)).toEqual(['text']);
    expect(issues.some((i) => i.includes('headline_strip'))).toBe(true);
  });

  it('keeps a block below minItems when fallback is placeholder', () => {
    const raw = makePlan([
      makeBlock({
        id: 'b1',
        componentType: 'article_list', // minItems 1, fallback placeholder
        sourceItemRefs: [],
        layout: { span: 6 }
      })
    ]);
    const { plan, issues } = validateAndRepairPlan(raw, [], 's1');
    expect(plan.blocks).toHaveLength(1);
    expect(plan.blocks[0]!.componentType).toBe('article_list');
    expect(issues.length).toBeGreaterThan(0);
  });

  it('slices refs down to maxItems', () => {
    const items = Array.from({ length: 15 }, (_, i) => makeItem(`a${i}`, 'article'));
    const raw = makePlan([
      makeBlock({
        id: 'b1',
        componentType: 'article_list', // maxItems 12
        sourceItemRefs: items.map((i) => i.id),
        layout: { span: 6 }
      })
    ]);
    const { plan } = validateAndRepairPlan(raw, items, 's1');
    expect(plan.blocks[0]!.sourceItemRefs).toHaveLength(12);
  });

  it('regenerates duplicate block ids', () => {
    const raw = makePlan([textBlock('dup'), textBlock('dup')]);
    const { plan, issues } = validateAndRepairPlan(raw, [], 's1');
    expect(plan.blocks).toHaveLength(2);
    expect(plan.blocks[0]!.id).toBe('dup');
    expect(plan.blocks[1]!.id).not.toBe('dup');
    expect(issues.some((i) => i.includes('dup'))).toBe(true);
  });

  it('injects the fallback text block when every block is dropped', () => {
    const raw = makePlan([makeBlock({ id: 'u1', componentType: 'nope_widget' })]);
    const { plan } = validateAndRepairPlan(raw, [], 's1');
    expect(plan.blocks).toHaveLength(1);
    expect(plan.blocks[0]!.componentType).toBe('text');
  });

  it('salvages valid blocks from a structurally broken plan', () => {
    const raw = {
      id: 'p9',
      blocks: [textBlock('t1'), { id: 'broken' }]
    };
    const { plan, issues } = validateAndRepairPlan(raw, [], 'sess-9');
    expect(plan.id).toBe('p9');
    expect(plan.version).toBe(1);
    expect(plan.sessionId).toBe('sess-9');
    expect(plan.blocks).toHaveLength(1);
    expect(plan.blocks[0]!.componentType).toBe('text');
    expect(issues.length).toBeGreaterThan(0);
  });

  it('forces sessionId to the given session', () => {
    const raw = makePlan([textBlock()], 'someone-else');
    const { plan } = validateAndRepairPlan(raw, [], 'mine');
    expect(plan.sessionId).toBe('mine');
  });
});
