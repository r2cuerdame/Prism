import { describe, expect, it, vi } from 'vitest';
import type { LayoutPlan } from '@shared/domain/layoutPlan';
import type { SourceItem } from '@shared/domain/sourceItem';
import type { LlmRunner } from './llmRunner';
import { refreshSynthesisLlm } from './llmSynthesis';

function item(id: string, title: string, sourceName: string): SourceItem {
  return {
    id,
    adapterId: 'rss-news',
    sourceId: 'feed',
    sourceName,
    kind: 'article',
    title,
    summary: `${title} 요약`,
    payload: {},
    originalUrl: `https://example.com/${id}`,
    retrievedAt: '2026-08-24T00:00:00Z',
    provenanceRef: 'prov-1'
  };
}

function plan(): LayoutPlan {
  return {
    id: 'plan-1',
    version: 1,
    sessionId: 'ses-1',
    blocks: [
      {
        id: 'blk-brief',
        componentType: 'synthesis_brief',
        componentVersion: 1,
        sourceItemRefs: ['a', 'b', 'c'],
        props: { points: [{ text: '옛 불릿', cites: [0] }] },
        layout: { span: 12 },
        locked: false,
        docked: false,
        state: {}
      },
      {
        id: 'blk-cluster',
        componentType: 'topic_cluster',
        componentVersion: 1,
        sourceItemRefs: ['d', 'e'],
        props: { topic: '옛 주제', angle: '옛 앵글' },
        layout: { span: 6 },
        locked: false,
        docked: false,
        state: {}
      },
      {
        id: 'blk-articles',
        componentType: 'article_list',
        componentVersion: 1,
        sourceItemRefs: ['f'],
        props: { title: '기사' },
        layout: { span: 6 },
        locked: false,
        docked: false,
        state: {}
      }
    ],
    generationScope: 'full',
    preservedEdits: { dockedBlockIds: [] },
    plannerMetadata: { planner: 'heuristic', generatedAt: '2026-08-24T00:00:00Z', diagnostics: [] }
  };
}

const ITEMS = [
  item('a', 'AI 칩 경쟁', '연합뉴스IT'),
  item('b', 'AI chip race', 'Hacker News'),
  item('c', '새 GPU 발표', 'The Verge'),
  item('d', '게임 엔진 소식', 'Reddit'),
  item('e', 'Engine update', 'Lobsters'),
  item('f', '무관한 기사', 'BBC')
];

function runnerReturning(value: unknown): LlmRunner {
  return { ready: true, provider: 'codex', model: 'test', run: vi.fn().mockResolvedValue(value) };
}

describe('refreshSynthesisLlm', () => {
  it('rewrites only synthesis text, clamping cites to the block refs', async () => {
    const runner = runnerReturning({
      blocks: [
        { index: 0, points: [{ text: '새 불릿', cites: [0, 2, 7] }], topic: null, angle: null },
        { index: 1, points: null, topic: '새 주제', angle: '새 앵글' },
        { index: 9, points: null, topic: '유령', angle: null }
      ]
    });

    const out = await refreshSynthesisLlm(runner, plan(), ITEMS, '테스트 목표');

    expect(out).not.toBeNull();
    const [brief, cluster, articles] = out!.blocks;
    expect(brief.props.points).toEqual([{ text: '새 불릿', cites: [0, 2] }]);
    expect(cluster.props.topic).toBe('새 주제');
    expect(cluster.props.angle).toBe('새 앵글');
    // Structure is never touched: refs, spans and other blocks stay identical.
    expect(brief.sourceItemRefs).toEqual(['a', 'b', 'c']);
    expect(articles.props).toEqual({ title: '기사' });
    expect(out!.blocks).toHaveLength(3);
  });

  it('sends only synthesis-bearing blocks in the prompt', async () => {
    const runner = runnerReturning({ blocks: [] });

    await refreshSynthesisLlm(runner, plan(), ITEMS, '테스트 목표');

    const prompt = vi.mocked(runner.run).mock.calls[0]![1] as string;
    expect(prompt).toContain('AI 칩 경쟁');
    expect(prompt).toContain('게임 엔진 소식');
    expect(prompt).not.toContain('무관한 기사');
  });

  it('does not mutate the input plan', async () => {
    const input = plan();
    const before = structuredClone(input);
    const runner = runnerReturning({
      blocks: [{ index: 0, points: [{ text: '새 불릿', cites: [0] }], topic: null, angle: null }]
    });

    await refreshSynthesisLlm(runner, input, ITEMS, '테스트 목표');

    expect(input).toEqual(before);
  });

  it('returns null when the runner fails, so heuristic text stands', async () => {
    const runner = runnerReturning(null);

    await expect(refreshSynthesisLlm(runner, plan(), ITEMS, '테스트 목표')).resolves.toBeNull();
  });

  it('returns null without calling the runner when nothing needs synthesis', async () => {
    const runner = runnerReturning({ blocks: [] });
    const bare = plan();
    bare.blocks = bare.blocks.filter((b) => b.componentType === 'article_list');

    await expect(refreshSynthesisLlm(runner, bare, ITEMS, '테스트 목표')).resolves.toBeNull();
    expect(runner.run).not.toHaveBeenCalled();
  });

  it('keeps the old points when the model returns empty text', async () => {
    const runner = runnerReturning({
      blocks: [{ index: 0, points: [{ text: '   ', cites: [0] }], topic: null, angle: null }]
    });

    const out = await refreshSynthesisLlm(runner, plan(), ITEMS, '테스트 목표');

    // Nothing usable came back for the brief and nothing else changed → null.
    expect(out).toBeNull();
  });
});
