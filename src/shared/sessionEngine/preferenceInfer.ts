import type { SessionState } from '@shared/domain/session';
import type { SessionCommand } from '@shared/domain/commands';
import type { PreferenceSignal } from '@shared/domain/preference';
import type { ComponentBlock } from '@shared/domain/layoutPlan';
import type { SourceItem, SourceItemKind } from '@shared/domain/sourceItem';
import { SOURCE_ITEM_KINDS } from '@shared/domain/sourceItem';
import { newId } from '@shared/domain/ids';
import { tokenize } from '@shared/planner/crossSource';

const KIND_LABEL: Record<SourceItemKind, string> = {
  video: '영상',
  article: '기사',
  post: '커뮤니티 글',
  headline: '헤드라인'
};

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

function plus30Days(at: string): string {
  return new Date(Date.parse(at) + THIRTY_DAYS_MS).toISOString();
}

function findBlock(state: SessionState, blockId: string): ComponentBlock | null {
  return state.plan?.blocks.find((b) => b.id === blockId) ?? null;
}

function blockItems(state: SessionState, block: ComponentBlock): SourceItem[] {
  const items: SourceItem[] = [];
  for (const ref of block.sourceItemRefs) {
    const item = state.items[ref];
    if (item) items.push(item);
  }
  return items;
}

function latestIntentGoal(state: SessionState): string | undefined {
  for (let i = state.intentHistory.length - 1; i >= 0; i--) {
    const goal = state.intentHistory[i].interpreted?.goal;
    if (goal) return goal;
  }
  return undefined;
}

interface SignalSpec {
  kind: PreferenceSignal['kind'];
  targetType: PreferenceSignal['target']['type'];
  targetValue: string;
  confidence: number;
  interpretation: string;
  explicit?: boolean;
  scope?: PreferenceSignal['scope'];
  polarity?: 'negative' | 'positive';
  origin?: PreferenceSignal['origin'];
  terms?: string[];
}

/**
 * Cautious, inspectable preference inference from a single user action
 * (GOAL.md § learner). Implicit signals expire after 30 days.
 */
export function inferPreferenceSignals(
  prev: SessionState,
  cmd: SessionCommand,
  at: string
): PreferenceSignal[] {
  const make = (spec: SignalSpec): PreferenceSignal => ({
    id: newId('sig'),
    kind: spec.kind,
    target: { type: spec.targetType, value: spec.targetValue },
    context: { sessionId: prev.id, intentGoal: latestIntentGoal(prev) },
    interpretation: spec.interpretation,
    scope: spec.scope ?? 'session',
    confidence: spec.confidence,
    explicit: spec.explicit ?? false,
    polarity: spec.polarity,
    origin: spec.origin,
    terms: spec.terms,
    createdAt: at,
    ...(spec.explicit ? {} : { expiresAt: plus30Days(at) })
  });

  switch (cmd.type) {
    case 'remove_item': {
      const item = prev.items[cmd.itemId];
      if (!item) return [];
      const terms = [...tokenize(item.title)].slice(0, 10);
      return [
        make({
          kind: 'reject',
          targetType: 'item',
          targetValue: item.originalUrl || item.id,
          confidence: 1.0,
          explicit: true,
          polarity: 'negative',
          origin: 'context_menu',
          scope: 'global',
          terms,
          interpretation: `"${item.title.slice(0, 40)}" 항목을 직접 거부했어요`
        }),
        make({
          kind: 'remove',
          targetType: 'source',
          targetValue: item.sourceName,
          confidence: 0.3,
          explicit: false,
          polarity: 'negative',
          scope: 'session',
          interpretation: `${item.sourceName} 항목을 제거했어요 — 이 출처를 덜 원할 수 있어요`
        })
      ];
    }

    case 'remove_block': {
      const block = findBlock(prev, cmd.blockId);
      if (!block) return [];
      const items = blockItems(prev, block);
      const kinds = [...new Set(items.map((it) => it.kind))];
      const sources = [...new Set(items.map((it) => it.sourceName))];
      return [
        ...kinds.map((kind) =>
          make({
            kind: 'remove',
            targetType: 'kind',
            targetValue: kind,
            confidence: 0.4,
            polarity: 'negative',
            interpretation: `${KIND_LABEL[kind]}을(를) 제거했어요 — 이 종류를 덜 원할 수 있어요`
          })
        ),
        ...sources.map((sourceName) =>
          make({
            kind: 'remove',
            targetType: 'source',
            targetValue: sourceName,
            confidence: 0.3,
            polarity: 'negative',
            interpretation: `${sourceName} 출처를 제거했어요 — 이 출처를 덜 원할 수 있어요`
          })
        )
      ];
    }

    case 'dock_block': {
      if (!cmd.docked) return [];
      const block = findBlock(prev, cmd.blockId);
      if (!block) return [];
      const kinds = [...new Set(blockItems(prev, block).map((it) => it.kind))];
      return [
        make({
          kind: 'dock',
          targetType: 'component',
          targetValue: block.componentType,
          confidence: 0.7,
          polarity: 'positive',
          interpretation: '블록을 고정했어요 — 이 구성요소를 계속 보고 싶을 수 있어요'
        }),
        ...kinds.map((kind) =>
          make({
            kind: 'dock',
            targetType: 'kind',
            targetValue: kind,
            confidence: 0.5,
            polarity: 'positive',
            interpretation: `${KIND_LABEL[kind]}이(가) 있는 블록을 고정했어요 — 이 종류를 더 원할 수 있어요`
          })
        )
      ];
    }

    case 'adjust_mix': {
      if (cmd.direction === 'none') return [];
      const kinds: SourceItemKind[] = cmd.kind === 'all' ? SOURCE_ITEM_KINDS : [cmd.kind];
      return kinds.map((kind) =>
        make({
          kind: 'adjust_mix',
          targetType: 'kind',
          targetValue: kind,
          confidence: 0.9,
          explicit: true,
          polarity: cmd.direction === 'more' ? 'positive' : 'negative',
          origin: 'composer',
          interpretation:
            cmd.direction === 'more'
              ? `${KIND_LABEL[kind]}을(를) 더 원한다고 직접 말했어요`
              : `${KIND_LABEL[kind]}을(를) 덜 원한다고 직접 말했어요`
        })
      );
    }

    case 'resize_block': {
      if (cmd.span === undefined) return [];
      const block = findBlock(prev, cmd.blockId);
      if (!block || cmd.span === block.layout.span) return [];
      const grew = cmd.span > block.layout.span;
      return [
        make({
          kind: 'resize',
          targetType: 'component',
          targetValue: block.componentType,
          confidence: 0.3,
          interpretation: grew
            ? '블록을 키웠어요 — 이 구성요소를 더 원할 수 있어요'
            : '블록을 줄였어요 — 이 구성요소를 덜 원할 수 있어요'
        })
      ];
    }

    case 'move_block': {
      if (cmd.toIndex !== 0) return [];
      const block = findBlock(prev, cmd.blockId);
      if (!block) return [];
      const idx = prev.plan?.blocks.indexOf(block) ?? -1;
      if (idx <= 0) return [];
      return [
        make({
          kind: 'drag',
          targetType: 'component',
          targetValue: block.componentType,
          confidence: 0.3,
          interpretation: '블록을 맨 위로 옮겼어요 — 이 구성요소를 중요하게 여길 수 있어요'
        })
      ];
    }

    default:
      return [];
  }
}
