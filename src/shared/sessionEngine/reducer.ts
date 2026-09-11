import type { SessionState, CompositionHints } from '@shared/domain/session';
import type { SessionCommand } from '@shared/domain/commands';
import type { ComponentBlock, LayoutPlan } from '@shared/domain/layoutPlan';
import type { SourceItem, SourceItemKind } from '@shared/domain/sourceItem';
import { SOURCE_ITEM_KINDS } from '@shared/domain/sourceItem';
import type { Provenance } from '@shared/domain/provenance';
import { splitRegion } from './splitRegion';
import { getCatalogEntry } from '@shared/catalog/catalog';
import { newId } from '@shared/domain/ids';

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

    case 'remove_item': {
      if (!state.plan) return state;
      let changed = false;
      const nextBlocks: ComponentBlock[] = [];
      for (const block of state.plan.blocks) {
        if (block.sourceItemRefs.includes(cmd.itemId)) {
          changed = true;
          const nextRefs = block.sourceItemRefs.filter((id) => id !== cmd.itemId);
          const entry = getCatalogEntry(block.componentType);
          if (entry && nextRefs.length < entry.minItems && entry.fallback === 'hide') {
            continue;
          }
          nextBlocks.push({ ...block, sourceItemRefs: nextRefs });
        } else {
          nextBlocks.push(block);
        }
      }
      if (!changed) return state;
      return {
        ...state,
        plan: { ...state.plan, blocks: nextBlocks },
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

    case 'play_item': {
      return playItem(state, cmd.itemId, cmd.playerBlockId, ts);
    }

    case 'split_region': {
      if (!state.plan) return state;
      const blocks = splitRegion(state.plan, cmd.blockId, cmd.targetBlockId, cmd.side);
      if (blocks === null) return state;
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
      const provenance = mergeProvenance(state.provenance, cmd.provenance);
      return { ...state, plan: { ...state.plan, blocks }, items, provenance, updatedAt: ts };
    }

    case 'apply_plan': {
      return applyPlan(state, cmd.plan, cmd.items, cmd.provenance, ts);
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

    case 'add_hint_note': {
      const note = cmd.note.trim();
      if (note === '' || state.compositionHints.notes.includes(note)) return state;
      let notes = [...state.compositionHints.notes, note];
      if (notes.length > MAX_NOTES) notes = notes.slice(notes.length - MAX_NOTES);
      return {
        ...state,
        compositionHints: { ...state.compositionHints, notes },
        updatedAt: ts
      };
    }

    case 'remove_hint_note': {
      const notes = state.compositionHints.notes.filter((n) => n !== cmd.note);
      if (notes.length === state.compositionHints.notes.length) return state;
      return {
        ...state,
        compositionHints: { ...state.compositionHints, notes },
        updatedAt: ts
      };
    }

    default:
      return state;
  }
}

const PLAYER_TYPE = 'video_player';
const BRIEF_TYPE = 'synthesis_brief';

/**
 * A page can legitimately carry videos without a player (the composer drops the
 * anchor when the user asked for fewer videos), so playing has to be able to
 * create one. Built from the catalog entry, never hand-tuned, or the block
 * fails the renderer's own validation.
 */
function newPlayerBlock(itemId: string): ComponentBlock | null {
  const entry = getCatalogEntry(PLAYER_TYPE);
  if (!entry) return null;
  return {
    id: newId('blk'),
    componentType: PLAYER_TYPE,
    componentVersion: entry.version,
    sourceItemRefs: [itemId],
    props: { ...entry.defaultProps },
    layout: { span: entry.defaultSpan },
    locked: false,
    docked: false,
    rationale: '재생 요청에 따라 만든 플레이어',
    state: { activeItemId: itemId }
  };
}

/**
 * Send a video to a player block. Any block can hold videos (queue, topic
 * cluster, the player's own strip) but only `video_player` can play one, so
 * the item is adopted into the player's refs and made active. When the page has
 * no player at all one is created at the top (below a leading synthesis brief,
 * which stays the page's opening). Invalid input (no plan, unknown item,
 * non-video item) returns the SAME state reference, as does re-playing what is
 * already playing — otherwise a repeat click schedules a write for nothing.
 */
function playItem(
  state: SessionState,
  itemId: string,
  playerBlockId: string | undefined,
  ts: string
): SessionState {
  if (!state.plan) return state;
  const blocks = state.plan.blocks;

  const item = state.items[itemId];
  if (!item || item.kind !== 'video') return state;

  let idx = -1;
  if (playerBlockId !== undefined) {
    idx = blocks.findIndex((b) => b.id === playerBlockId && b.componentType === PLAYER_TYPE);
  }
  if (idx < 0) idx = blocks.findIndex((b) => b.componentType === PLAYER_TYPE);
  if (idx < 0) {
    const created = newPlayerBlock(itemId);
    if (!created) return state;
    const at = blocks.length > 0 && blocks[0].componentType === BRIEF_TYPE ? 1 : 0;
    const next = blocks.slice();
    next.splice(at, 0, created);
    return withBlocks(state, next, ts);
  }

  const block = blocks[idx];
  if (block.state?.activeItemId === itemId && block.sourceItemRefs.includes(itemId)) return state;

  let refs = block.sourceItemRefs;
  if (!refs.includes(itemId)) {
    refs = [...refs, itemId];
    const cap = getCatalogEntry(PLAYER_TYPE)?.maxItems;
    if (typeof cap === 'number' && cap > 0 && refs.length > cap) {
      // The player shows `activeItemId`, falling back to its first ref — never
      // evict either that or the item the user just asked for.
      const playing =
        typeof block.state?.activeItemId === 'string' ? block.state.activeItemId : refs[0];
      while (refs.length > cap) {
        const dropAt = refs.findIndex((ref) => ref !== itemId && ref !== playing);
        if (dropAt < 0) break;
        refs.splice(dropAt, 1);
      }
    }
  }

  const nextBlock: ComponentBlock = {
    ...block,
    sourceItemRefs: refs,
    state: { ...block.state, activeItemId: itemId }
  };
  return withBlocks(state, replaceBlockAt(blocks, idx, nextBlock), ts);
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

function mergeProvenance(
  pool: Record<string, Provenance>,
  incoming: Provenance[] | undefined
): Record<string, Provenance> {
  if (!incoming || incoming.length === 0) return pool;
  const merged = { ...pool };
  for (const record of incoming) merged[record.id] = record;
  return merged;
}

/** Keep only the evidence records the surviving items still point at. */
function pruneProvenance(
  pool: Record<string, Provenance>,
  items: Record<string, SourceItem>
): Record<string, Provenance> {
  const kept: Record<string, Provenance> = {};
  for (const item of Object.values(items)) {
    const record = pool[item.provenanceRef];
    if (record) kept[record.id] = record;
  }
  return kept;
}

function applyPlan(
  state: SessionState,
  plan: LayoutPlan,
  newItems: SourceItem[] | undefined,
  newProvenance: Provenance[] | undefined,
  ts: string
): SessionState {
  let blocks = plan.blocks.slice();
  const preservedBlocks: ComponentBlock[] = [];

  // Re-insert preserved blocks the new plan dropped, near their old position.
  // Planners are told not to re-emit them, so both dock (survive regeneration)
  // and lock (content pinned) must be honored here or the block vanishes.
  // Preserved blocks must never trail source_list.
  if (state.plan) {
    const newIds = new Set(plan.blocks.map((b) => b.id));
    state.plan.blocks.forEach((block, oldIndex) => {
      if ((block.docked || block.locked) && !newIds.has(block.id)) {
        preservedBlocks.push(block);
        const sourceListIdx = blocks.findIndex((b) => b.componentType === 'source_list');
        const limit = sourceListIdx >= 0 ? sourceListIdx : blocks.length;
        blocks.splice(Math.min(oldIndex, limit), 0, block);
      }
    });
  }

  // Guarantee source_list remains strictly terminal (parity with mixInvariants)
  const sourceLists = blocks.filter((b) => b.componentType === 'source_list');
  if (sourceLists.length > 0) {
    blocks = [...blocks.filter((b) => b.componentType !== 'source_list'), ...sourceLists];
  }

  // Update source_list.sourceItemRefs to include refs from preserved blocks (deduplicated, order-preserving)
  if (preservedBlocks.length > 0 && sourceLists.length > 0) {
    blocks = blocks.map((block) => {
      if (block.componentType !== 'source_list') return block;
      const seen = new Set(block.sourceItemRefs);
      const updatedRefs = [...block.sourceItemRefs];
      for (const pb of preservedBlocks) {
        for (const ref of pb.sourceItemRefs) {
          if (!seen.has(ref)) {
            seen.add(ref);
            updatedRefs.push(ref);
          }
        }
      }
      return { ...block, sourceItemRefs: updatedRefs };
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
    provenance: pruneProvenance(mergeProvenance(state.provenance, newProvenance), items),
    status: 'ready',
    statusDetail: undefined,
    updatedAt: ts
  };
}
