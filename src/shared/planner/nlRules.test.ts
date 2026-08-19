import { describe, expect, it } from 'vitest';
import type { ComponentBlock } from '@shared/domain/layoutPlan';
import type { SessionState } from '@shared/domain/session';
import { parseEditRules } from './nlRules';

const NOW = '2026-08-19T00:00:00.000Z';

function block(id: string, componentType: string, span: number, props: Record<string, unknown> = {}): ComponentBlock {
  return {
    id,
    componentType,
    componentVersion: 1,
    sourceItemRefs: [],
    props,
    layout: { span },
    locked: false,
    docked: false,
    state: {}
  };
}

function makeState(blocks?: ComponentBlock[]): SessionState {
  const planBlocks = blocks ?? [
    block('b1', 'video_player', 8),
    block('b2', 'article_list', 6, { density: 'comfortable', maxItems: 6 }),
    block('b3', 'community_posts', 6, { showMeta: true })
  ];
  return {
    id: 's1',
    title: '테스트 세션',
    intentHistory: [],
    plan: {
      id: 'plan_1',
      version: 1,
      sessionId: 's1',
      blocks: planBlocks,
      generationScope: 'full',
      preservedEdits: { dockedBlockIds: [] },
      plannerMetadata: { planner: 'heuristic', generatedAt: NOW, diagnostics: [] }
    },
    items: {},
    compositionHints: { mix: {}, notes: [] },
    status: 'ready',
    createdAt: NOW,
    updatedAt: NOW
  };
}

describe('parseEditRules', () => {
  it("'뉴스 줄여줘' → adjust_mix article less + halved maxItems on article_list", () => {
    const cmds = parseEditRules('뉴스 줄여줘', makeState());
    expect(cmds).not.toBeNull();
    expect(cmds).toContainEqual({ type: 'adjust_mix', kind: 'article', direction: 'less' });
    expect(cmds).toContainEqual({
      type: 'set_block_props',
      blockId: 'b2',
      props: { maxItems: 3 }
    });
  });

  it("'영상 빼줘' → remove_block for video blocks", () => {
    const cmds = parseEditRules('영상 빼줘', makeState());
    expect(cmds).toEqual([{ type: 'remove_block', blockId: 'b1', reason: '영상 빼줘' }]);
  });

  it("'영상 더' → adjust_mix video more", () => {
    const cmds = parseEditRules('영상 더', makeState());
    expect(cmds).toEqual([{ type: 'adjust_mix', kind: 'video', direction: 'more' }]);
  });

  it("'커뮤니티를 맨 위로' → move_block toIndex 0", () => {
    const cmds = parseEditRules('커뮤니티를 맨 위로', makeState());
    expect(cmds).toEqual([{ type: 'move_block', blockId: 'b3', toIndex: 0 }]);
  });

  it("'remove the news' → remove_block for article blocks", () => {
    const cmds = parseEditRules('remove the news', makeState());
    expect(cmds).toEqual([
      { type: 'remove_block', blockId: 'b2', reason: 'remove the news' }
    ]);
  });

  it("'두번째 블록 크게' → resize_block span+4 clamped", () => {
    const cmds = parseEditRules('두번째 블록 크게', makeState());
    expect(cmds).toEqual([{ type: 'resize_block', blockId: 'b2', span: 10 }]);
  });

  it('span grows are clamped to catalog maxSpan', () => {
    const state = makeState([block('b1', 'video_player', 10)]);
    const cmds = parseEditRules('첫번째 블록 크게', state);
    expect(cmds).toEqual([{ type: 'resize_block', blockId: 'b1', span: 12 }]);
  });

  it("'두번째 블록 작게' → resize_block span-4 clamped to minSpan", () => {
    const cmds = parseEditRules('두번째 블록 작게', makeState());
    // article_list span 6 - 4 = 2, clamped to minSpan 4
    expect(cmds).toEqual([{ type: 'resize_block', blockId: 'b2', span: 4 }]);
  });

  it("'첫번째 블록 줄여' (ordinal, no kind word) reads as resize smaller", () => {
    const cmds = parseEditRules('첫번째 블록 줄여', makeState());
    // video_player span 8 - 4 = 4, clamped to minSpan 6
    expect(cmds).toEqual([{ type: 'resize_block', blockId: 'b1', span: 6 }]);
  });

  it("'커뮤니티 아래로' → move down by one", () => {
    const cmds = parseEditRules('커뮤니티 아래로', makeState());
    // b3 already last → clamped to length-1
    expect(cmds).toEqual([{ type: 'move_block', blockId: 'b3', toIndex: 2 }]);
  });

  it("'두번째 고정' → dock_block docked true", () => {
    const cmds = parseEditRules('두번째 고정', makeState());
    expect(cmds).toEqual([{ type: 'dock_block', blockId: 'b2', docked: true }]);
  });

  it("'두번째 고정 해제' → dock_block docked false", () => {
    const cmds = parseEditRules('두번째 고정 해제', makeState());
    expect(cmds).toEqual([{ type: 'dock_block', blockId: 'b2', docked: false }]);
  });

  it("'이 세션 고정' with no block target → null", () => {
    expect(parseEditRules('이 세션 고정', makeState())).toBeNull();
  });

  it('gibberish → null', () => {
    expect(parseEditRules('고양이는 야옹야옹 웁니다', makeState())).toBeNull();
    expect(parseEditRules('asdf qwer zxcv', makeState())).toBeNull();
  });

  it('kind action with no matching block in the plan → null for block-only actions', () => {
    const state = makeState([block('b1', 'video_player', 8)]);
    expect(parseEditRules('뉴스 빼줘', state)).toBeNull();
  });

  it('handles a session without a plan safely', () => {
    const state = { ...makeState(), plan: null };
    expect(parseEditRules('첫번째 블록 빼줘', state)).toBeNull();
  });
});
