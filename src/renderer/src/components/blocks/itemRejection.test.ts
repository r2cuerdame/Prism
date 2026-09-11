import * as React from 'react';
import { Children, isValidElement, type ReactElement, type ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ComponentBlock, LayoutPlan } from '@shared/domain/layoutPlan';
import type { SourceItem, SourceItemKind } from '@shared/domain/sourceItem';
import type { BlockComponent, BlockRenderProps } from './blockContract';
import ArticleListBlock from './ArticleListBlock';
import CommunityPostsBlock from './CommunityPostsBlock';
import HeadlineStripBlock from './HeadlineStripBlock';
import TopicClusterBlock from './TopicClusterBlock';
import VideoQueueBlock from './VideoQueueBlock';
import { AppStore } from '../../state/appStore';

const T0 = '2026-09-11T00:00:00.000Z';

vi.stubGlobal('React', React);

function makeItem(id: string, kind: SourceItemKind): SourceItem {
  return {
    id,
    adapterId: 'adapter',
    sourceId: 'source',
    sourceName: 'Example',
    kind,
    title: `item ${id}`,
    payload:
      kind === 'video'
        ? { videoId: id, channel: 'Channel' }
        : kind === 'post'
          ? { community: 'Community' }
          : { source: 'Example' },
    originalUrl: `https://example.com/${id}`,
    retrievedAt: T0,
    provenanceRef: `prov-${id}`
  };
}

function makeBlock(componentType: string, items: SourceItem[]): ComponentBlock {
  return {
    id: `block-${componentType}`,
    componentType,
    componentVersion: 1,
    sourceItemRefs: items.map((item) => item.id),
    props: componentType === 'topic_cluster' ? { topic: 'Topic', maxItems: 6 } : { maxItems: 6 },
    layout: { span: 6 },
    locked: false,
    docked: false,
    state: {}
  };
}

function descendants(node: ReactNode): ReactElement[] {
  if (!isValidElement(node)) return [];
  const props = node.props as { children?: ReactNode };
  return [node, ...Children.toArray(props.children).flatMap(descendants)];
}

function renderBlock(component: BlockComponent, block: ComponentBlock, items: SourceItem[], onRejectItem: (id: string) => void): ReactElement | null {
  const props: BlockRenderProps = {
    block,
    items,
    dispatch: vi.fn(),
    onRejectItem,
    onOpenOriginal: vi.fn(),
    onInspect: vi.fn()
  };
  return component(props);
}

type PointerHandler = (event: { preventDefault: () => void; stopPropagation: () => void }) => void;

const cases: Array<{
  name: string;
  component: BlockComponent;
  block: ComponentBlock;
  items: SourceItem[];
}> = [
  (() => {
    const items = [makeItem('article-1', 'article')];
    return { name: 'article list', component: ArticleListBlock, block: makeBlock('article_list', items), items };
  })(),
  (() => {
    const items = [makeItem('post-1', 'post')];
    return { name: 'community posts', component: CommunityPostsBlock, block: makeBlock('community_posts', items), items };
  })(),
  (() => {
    const items = [makeItem('headline-1', 'headline'), makeItem('headline-2', 'headline'), makeItem('headline-3', 'headline')];
    return { name: 'headline strip', component: HeadlineStripBlock, block: makeBlock('headline_strip', items), items };
  })(),
  (() => {
    const items = [makeItem('topic-1', 'article'), makeItem('topic-2', 'post')];
    return { name: 'topic cluster', component: TopicClusterBlock, block: makeBlock('topic_cluster', items), items };
  })(),
  (() => {
    const items = [makeItem('video-1', 'video')];
    return { name: 'video queue', component: VideoQueueBlock, block: makeBlock('video_queue', items), items };
  })()
];

describe('content block item rejection affordances', () => {
  it.each(cases)('$name rejects via its button and context menu', ({ component, block, items }) => {
    const onRejectItem = vi.fn();
    const root = renderBlock(component, block, items, onRejectItem);
    const elements = descendants(root);
    const rejectButton = elements.find((element) => {
      const props = element.props as Record<string, unknown>;
      return typeof props['aria-label'] === 'string' && props['aria-label'].endsWith(' 거부');
    });
    const row = elements.find((element) => {
      const props = element.props as Record<string, unknown>;
      return typeof props.onContextMenu === 'function';
    });

    expect(rejectButton).toBeDefined();
    expect(row).toBeDefined();

    const clickEvent = { preventDefault: vi.fn(), stopPropagation: vi.fn() };
    ((rejectButton?.props as Record<string, unknown>).onClick as PointerHandler)(clickEvent);
    expect(clickEvent.stopPropagation).toHaveBeenCalledOnce();
    expect(onRejectItem).toHaveBeenLastCalledWith(items[0].id);

    onRejectItem.mockClear();
    const contextEvent = { preventDefault: vi.fn(), stopPropagation: vi.fn() };
    ((row?.props as Record<string, unknown>).onContextMenu as PointerHandler)(contextEvent);
    expect(contextEvent.preventDefault).toHaveBeenCalledOnce();
    expect(onRejectItem).toHaveBeenLastCalledWith(items[0].id);
  });
});

function makePlan(block: ComponentBlock): LayoutPlan {
  return {
    id: 'plan-1',
    version: 1,
    sessionId: 'session-1',
    blocks: [block],
    generationScope: 'full',
    preservedEdits: { dockedBlockIds: [] },
    plannerMetadata: { planner: 'heuristic', generatedAt: T0, diagnostics: [] }
  };
}

describe('AppStore.rejectItem', () => {
  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('removes through history, records explicit feedback, shows undo guidance, and is undoable', () => {
    vi.useFakeTimers();
    const prefsRecord = vi.fn().mockResolvedValue([]);
    vi.stubGlobal('window', {
      gptb: {
        prefsRecord,
        sessionsSaveSnapshot: vi.fn().mockResolvedValue(undefined),
        sessionsList: vi.fn().mockResolvedValue([])
      }
    });

    const store = new AppStore();
    const sessionId = store.newSession();
    const item = makeItem('reject-me', 'article');
    const block = makeBlock('article_list', [item]);
    store.dispatch({ type: 'apply_plan', plan: makePlan(block), items: [item] }, { silent: true });

    store.rejectItem(item.id);

    const rejected = store.get().sessions[sessionId].history.present;
    expect(rejected.plan?.blocks[0].sourceItemRefs).not.toContain(item.id);
    expect(store.get().toast).toContain('Ctrl+Z');
    expect(prefsRecord).toHaveBeenCalledOnce();
    expect(prefsRecord.mock.calls[0][0][0]).toMatchObject({
      kind: 'reject',
      target: { type: 'item', value: item.originalUrl },
      explicit: true,
      scope: 'global'
    });

    store.undo();
    expect(store.get().sessions[sessionId].history.present.plan?.blocks[0].sourceItemRefs).toContain(item.id);
  });
});
