import type { SessionState, CompositionHints } from '@shared/domain/session';
import type { SessionCommand } from '@shared/domain/commands';
import type { ComponentBlock, LayoutPlan } from '@shared/domain/layoutPlan';
import type { SourceItem, SourceItemKind } from '@shared/domain/sourceItem';
import { SOURCE_ITEM_KINDS } from '@shared/domain/sourceItem';

const DEFAULT_TITLE = '새 세션';
const MAX_NOTES = 10;
const MAX_INTENTS = 20;
const MAX_UNREFERENCED_ITEMS = 100;
const MAX_TITLE_LEN = 24;

const KIND_LABEL: Record<SourceItemKind, string> = {
  video: '영상',
  article: '기사',
  post: '커뮤니티 글',
  headline: '헤드라인'
};

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

function findBlockIndex(plan: LayoutPlan | null, blockId: string): number {
  if (!plan) return -1;
  return plan.blocks.findIndex((b) => b.id === blockId);
}

function withBlocks(state: SessionState, blocks: ComponentBlock[], at: string): SessionState {
  if (!state.plan) return state;
  return { ...state, plan: { ...state.plan, blocks }, updatedAt: at };
}

function replaceBlockAt(blocks: ComponentBlock[], index: number, block: ComponentBlock): ComponentBlock[] {
  const next = blocks.slice();
  next[index] = block;
  return next;
}

/**
 * Pure session reducer. Never throws: unknown block ids / structurally
 * impossible commands return the state reference UNCHANGED.
 */
export function applySessionCommand(state: SessionState, cmd: SessionCommand, at?: string): SessionState {
  const ts = at ?? state.updatedAt;

  switch (cmd.type) {
    case 'move_block': {
      const idx = findBlockIndex(state.plan, cmd.blockId);
      if (idx < 0 || !state.plan) return state;
      const blocks = state.plan.blocks;
      const to = clamp(cmd.toIndex, 0, blocks.length - 1);
      if (to === idx) return state;
      const next = blocks.slice();
      const [moved] = next.splice(idx, 1);
      next.splice(to, 0, moved);
      return withBlocks(state, next, ts);
    }

    case 'resize_block': {
      const idx = findBlockIndex(state.plan, cmd.blockId);
      if (idx < 0 || !state.plan) return state;
      if (cmd.span === undefined && cmd.heightPx === undefined) return state;
      const block = state.plan.blocks[idx];
      const layout = { ...block.layout };
      if (cmd.span !== undefined) layout.span = clamp(cmd.span, 1, 12);
      if (cmd.heightPx !== undefined) {
        if (cmd.heightPx === null) delete layout.heightPx;
        else layout.heightPx = clamp(cmd.heightPx, 120, 2000);
      }
      const blocks = replaceBlockAt(state.plan.blocks, idx, { ...block, layout });
      return withBlocks(state, blocks, ts);
    }

    case 'remove_block': {
      const idx = findBlockIndex(state.plan, cmd.blockId);
      if (idx < 0 || !state.plan) return state;
      const blocks = state.plan.blocks.filter((b) => b.id !== cmd.blockId);
      const dockedBlockIds = state.plan.preservedEdits.dockedBlockIds.filter((id) => id !== cmd.blockId);
      return {
        ...state,
        plan: { ...state.plan, blocks, preservedEdits: { dockedBlockIds } },
        updatedAt: ts
      };
    }

    case 'dock_block': {
      const idx = findBlockIndex(state.plan, cmd.blockId);
      if (idx < 0 || !state.plan) return state;
      const block = state.plan.blocks[idx];
      const blocks = replaceBlockAt(state.plan.blocks, idx, { ...block, docked: cmd.docked });
      const prevIds = state.plan.preservedEdits.dockedBlockIds;
      const dockedBlockIds = cmd.docked
        ? prevIds.includes(cmd.blockId)
          ? prevIds
          : [...prevIds, cmd.blockId]
        : prevIds.filter((id) => id !== cmd.blockId);
      return {
        ...state,
        plan: { ...state.plan, blocks, preservedEdits: { dockedBlockIds } },
        updatedAt: ts
      };
    }

    case 'lock_block': {
      const idx = findBlockIndex(state.plan, cmd.blockId);
      if (idx < 0 || !state.plan) return state;
      const block = state.plan.blocks[idx];
      const blocks = replaceBlockAt(state.plan.blocks, idx, { ...block, locked: cmd.locked });
      return withBlocks(state, blocks, ts);
    }

    case 'set_block_props': {
      const idx = findBlockIndex(state.plan, cmd.blockId);
      if (idx < 0 || !state.plan) return state;
      const block = state.plan.blocks[idx];
      const blocks = replaceBlockAt(state.plan.blocks, idx, {
        ...block,
        props: { ...block.props, ...cmd.props }
      });
      return withBlocks(state, blocks, ts);
    }

    case 'set_block_state': {
      const idx = findBlockIndex(state.plan, cmd.blockId);
      if (idx < 0 || !state.plan) return state;
      const block = state.plan.blocks[idx];
      const blocks = replaceBlockAt(state.plan.blocks, idx, {
        ...block,
        state: { ...block.state, ...cmd.state }
      });
      return withBlocks(state, blocks, ts);
    }

    case 'insert_block': {
      if (!state.plan) return state;
      const blocks = state.plan.blocks.slice();
      const idx = cmd.atIndex === undefined ? blocks.length : clamp(cmd.atIndex, 0, blocks.length);
      blocks.splice(idx, 0, cmd.block);
      return withBlocks(state, blocks, ts);
    }

    case 'adjust_mix': {
      const kinds: SourceItemKind[] = cmd.kind === 'all' ? SOURCE_ITEM_KINDS : [cmd.kind];
      const mix: CompositionHints['mix'] = { ...state.compositionHints.mix };
      for (const kind of kinds) {
        if (cmd.direction === 'none') delete mix[kind];
        else mix[kind] = cmd.direction;
      }
      const label = cmd.kind === 'all' ? '전체' : KIND_LABEL[cmd.kind];
      const note =
        cmd.direction === 'more'
          ? `${label} 더 보기`
          : cmd.direction === 'less'
            ? `${label} 줄이기`
            : `${label} 기본으로`;
      let notes = [...state.compositionHints.notes, note];
      if (notes.length > MAX_NOTES) notes = notes.slice(notes.length - MAX_NOTES);
      return { ...state, compositionHints: { mix, notes }, updatedAt: ts };
    }

    case 'replace_block': {
      const idx = findBlockIndex(state.plan, cmd.blockId);
      if (idx < 0 || !state.plan) return state;
      const blocks = replaceBlockAt(state.plan.blocks, idx, cmd.block);
      const items = mergeItems(state.items, cmd.items);
      return { ...state, plan: { ...state.plan, blocks }, items, updatedAt: ts };
    }

    case 'apply_plan': {
      return applyPlan(state, cmd.plan, cmd.items, ts);
    }

    case 'add_intent': {
      let intentHistory = [...state.intentHistory, cmd.intent];
      if (intentHistory.length > MAX_INTENTS) {
        intentHistory = intentHistory.slice(intentHistory.length - MAX_INTENTS);
      }
      let title = state.title;
      const goal = cmd.intent.interpreted?.goal;
      if (title === DEFAULT_TITLE && goal) title = goal.slice(0, MAX_TITLE_LEN);
      return { ...state, intentHistory, title, updatedAt: ts };
    }

    case 'set_status': {
      return { ...state, status: cmd.status, statusDetail: cmd.detail, updatedAt: ts };
    }

    case 'rename_session': {
      return { ...state, title: cmd.title, updatedAt: ts };
    }

    default:
      return state;
  }
}

function mergeItems(
  pool: Record<string, SourceItem>,
  incoming: SourceItem[] | undefined
): Record<string, SourceItem> {
  if (!incoming || incoming.length === 0) return pool;
  const merged = { ...pool };
  for (const item of incoming) merged[item.id] = item;
  return merged;
}

function applyPlan(
  state: SessionState,
  plan: LayoutPlan,
  newItems: SourceItem[] | undefined,
  ts: string
): SessionState {
  const blocks = plan.blocks.slice();

  // Re-insert docked blocks the new plan dropped, near their old position.
  if (state.plan) {
    const newIds = new Set(plan.blocks.map((b) => b.id));
    state.plan.blocks.forEach((block, oldIndex) => {
      if (block.docked && !newIds.has(block.id)) {
        blocks.splice(Math.min(oldIndex, blocks.length), 0, block);
      }
    });
  }

  const dockedBlockIds = blocks.filter((b) => b.docked).map((b) => b.id);
  const finalPlan: LayoutPlan = { ...plan, blocks, preservedEdits: { dockedBlockIds } };

  // Merge new items, then prune the pool: referenced items always survive,
  // plus at most 100 most-recently-retrieved unreferenced ones.
  const merged = mergeItems(state.items, newItems);
  const referenced = new Set<string>();
  for (const block of blocks) for (const ref of block.sourceItemRefs) referenced.add(ref);

  const items: Record<string, SourceItem> = {};
  for (const id of referenced) {
    const item = merged[id];
    if (item) items[id] = item;
  }
  const unreferenced = Object.values(merged).filter((it) => !referenced.has(it.id));
  unreferenced.sort((a, b) => b.retrievedAt.localeCompare(a.retrievedAt));
  for (const item of unreferenced.slice(0, MAX_UNREFERENCED_ITEMS)) items[item.id] = item;

  return {
    ...state,
    plan: finalPlan,
    items,
    status: 'ready',
    statusDetail: undefined,
    updatedAt: ts
  };
}
