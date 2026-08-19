import type { SessionCommand } from '@shared/domain/commands';
import type { SessionState } from '@shared/domain/session';
import type { SourceItemKind } from '@shared/domain/sourceItem';
import type { ComponentBlock } from '@shared/domain/layoutPlan';
import { getCatalogEntry } from '@shared/catalog/catalog';

interface KindEntry {
  regex: RegExp;
  types: string[];
  mixKind: SourceItemKind | null;
}

const KIND_TABLE: KindEntry[] = [
  {
    regex: /뉴스|기사|article|news/,
    types: ['article_list', 'headline_strip', 'reader'],
    mixKind: 'article'
  },
  { regex: /영상|비디오|video/, types: ['video_player', 'video_queue'], mixKind: 'video' },
  {
    regex: /커뮤니티|게시글|community|posts|discussion/,
    types: ['community_posts'],
    mixKind: 'post'
  },
  { regex: /헤드라인|headline/, types: ['headline_strip'], mixKind: 'headline' },
  { regex: /출처|source/, types: ['source_list'], mixKind: null }
];

const FEWER_RE = /줄여|적게|덜|fewer|less/;
const MORE_RE = /더|늘려|많이|more/;
const REMOVE_RE = /빼|없애|지워|삭제|치워|숨겨|remove|delete|hide/;
const TOP_ABS_RE = /맨\s*위|to the top/;
const TOP_REL_RE = /위로|올려|move up/;
const BOTTOM_ABS_RE = /맨\s*아래|to the bottom/;
const BOTTOM_REL_RE = /아래로|내려|down/;
const BIGGER_RE = /크게|키워|넓혀|bigger|larger|wider/;
const SMALLER_RE = /작게|smaller|narrower/;
const UNDOCK_RE = /고정\s*해제|풀어|unpin|undock/;
const DOCK_RE = /고정|dock|pin/;

function parseOrdinal(u: string): number | null {
  if (/첫\s*번째|first/.test(u)) return 0;
  if (/두\s*번째|second/.test(u)) return 1;
  if (/세\s*번째|third/.test(u)) return 2;
  let m = u.match(/(\d+)\s*번째/);
  if (m && m[1]) return parseInt(m[1], 10) - 1;
  m = u.match(/block\s*(\d+)/);
  if (m && m[1]) return parseInt(m[1], 10) - 1;
  return null;
}

function halvedMaxItems(block: ComponentBlock): number {
  const cur = typeof block.props.maxItems === 'number' ? block.props.maxItems : 6;
  return Math.max(1, Math.floor(cur / 2));
}

function grownMaxItems(block: ComponentBlock): number {
  const cur = typeof block.props.maxItems === 'number' ? block.props.maxItems : 6;
  const cap = getCatalogEntry(block.componentType)?.maxItems ?? 12;
  return Math.min(cap, Math.max(cur + 2, cur * 2));
}

function spanBounds(componentType: string): { min: number; max: number } {
  const entry = getCatalogEntry(componentType);
  return { min: entry?.minSpan ?? 1, max: entry?.maxSpan ?? 12 };
}

/* ── Block-scoped tuning (the ✎ on a section title) ──────────────────── */

/** Components whose length the user can shorten/lengthen via maxItems. */
const LENGTH_TUNABLE = new Set([
  'article_list',
  'community_posts',
  'topic_cluster',
  'video_queue',
  'headline_strip',
  'source_list'
]);

const B_FEWER_RE = /줄여|줄이|짧게|적게|간단|\bfewer\b|\bless\b|\bshorter\b/;
const B_MORE_RE = /더|늘려|늘리|많이|\bmore\b|\blonger\b/;
const B_BIGGER_RE = /크게|키워|넓혀|넓게|\bbigger\b|\bwider\b/;
const B_SMALLER_RE = /작게|좁혀|좁게|\bsmaller\b|\bnarrower\b/;
const B_COMPACT_RE = /\bcompact\b|간단히|촘촘/;
const B_COMFY_RE = /\bcomfortable\b|여유/;
const B_REMOVE_RE = /빼|없애|지워|삭제|치워|\bremove\b|\bdelete\b|\bhide\b/;
const B_UNDOCK_RE = /고정\s*해제|풀어|\bunpin\b|\bundock\b/;
const B_DOCK_RE = /고정|\bdock\b|\bpin(?:ned)?\b/;

const RENAME_KO_RE =
  /(?:제목|이름)\s*(?:을|를)?\s*['"“”‘’]?(.+?)['"“”‘’]?\s*(?:으로|로)\s*(?:바꿔|바꾸|변경해|변경|고쳐|수정해|수정|정해|해)?\s*(?:줘|주세요|줄래|요)?\s*[.!~]*$/;
const RENAME_EN_RE = /(?:rename\s+(?:it\s+|this\s+)?to|title\s+to)\s+['"]?(.+?)['"]?\s*[.!]?$/i;

function parseRenameTarget(raw: string): string | null {
  for (const re of [RENAME_KO_RE, RENAME_EN_RE]) {
    const m = raw.match(re);
    const captured = m?.[1]?.trim();
    if (captured !== undefined && captured !== '') return captured;
  }
  return null;
}

/** True when the component's catalog propsSchema really carries `density`. */
function acceptsDensity(componentType: string): boolean {
  const entry = getCatalogEntry(componentType);
  if (!entry) return false;
  const res = entry.propsSchema.safeParse({ density: 'compact' });
  if (!res.success) return false;
  const data = res.data as { density?: unknown };
  return typeof data.density === 'string';
}

/**
 * Rule-based tuning scoped to ONE block — what the ✎ on a section title feeds.
 * Deliberately small and offline: returns null whenever it is not sure, so the
 * caller can hand the sentence to the LLM editor instead. Never throws.
 */
export function parseBlockTuning(text: string, block: ComponentBlock): SessionCommand[] | null {
  try {
    if (typeof text !== 'string') return null;
    const raw = text.trim();
    if (raw === '') return null;
    // Defensive: this runs on whatever the UI hands us.
    const safe = block as ComponentBlock | null | undefined;
    if (!safe || typeof safe.id !== 'string') return null;
    const u = raw.toLowerCase();

    // Rename first: the new title may itself contain tuning words.
    const renamed = parseRenameTarget(raw);
    if (renamed !== null) {
      return [{ type: 'set_block_props', blockId: block.id, props: { title: renamed } }];
    }

    if (B_REMOVE_RE.test(u)) {
      return [{ type: 'remove_block', blockId: block.id, reason: raw }];
    }
    if (B_UNDOCK_RE.test(u)) {
      return [{ type: 'dock_block', blockId: block.id, docked: false }];
    }
    if (B_DOCK_RE.test(u)) {
      return [{ type: 'dock_block', blockId: block.id, docked: true }];
    }

    const bigger = B_BIGGER_RE.test(u);
    const smaller = !bigger && B_SMALLER_RE.test(u);
    if (bigger || smaller) {
      const { min, max } = spanBounds(block.componentType);
      const cur = typeof block.layout?.span === 'number' ? block.layout.span : 6;
      const span = bigger ? Math.min(max, cur + 4) : Math.max(min, cur - 4);
      return [{ type: 'resize_block', blockId: block.id, span }];
    }

    if (acceptsDensity(block.componentType)) {
      if (B_COMPACT_RE.test(u)) {
        return [{ type: 'set_block_props', blockId: block.id, props: { density: 'compact' } }];
      }
      if (B_COMFY_RE.test(u)) {
        return [{ type: 'set_block_props', blockId: block.id, props: { density: 'comfortable' } }];
      }
    }

    if (LENGTH_TUNABLE.has(block.componentType)) {
      if (B_FEWER_RE.test(u)) {
        return [
          { type: 'set_block_props', blockId: block.id, props: { maxItems: halvedMaxItems(block) } }
        ];
      }
      if (B_MORE_RE.test(u)) {
        return [
          { type: 'set_block_props', blockId: block.id, props: { maxItems: grownMaxItems(block) } }
        ];
      }
    }

    return null;
  } catch {
    return null;
  }
}

/**
 * Rule-based fast path for natural-language edits (ko + en).
 * Returns null when unsure so the caller can fall back to the LLM editor.
 */
export function parseEditRules(utterance: string, state: SessionState): SessionCommand[] | null {
  const u = utterance.toLowerCase();
  const blocks: ComponentBlock[] = state.plan?.blocks ?? [];

  const kind = KIND_TABLE.find((k) => k.regex.test(u)) ?? null;
  const ordinal = parseOrdinal(u);

  let targets: ComponentBlock[] = [];
  if (ordinal !== null) {
    const b = blocks[ordinal];
    targets = b ? [b] : [];
  } else if (kind) {
    targets = blocks.filter((b) => kind.types.includes(b.componentType));
  }

  // Mix adjustments require a kind word; '줄여' with a kind word means FEWER.
  if (kind && kind.mixKind && FEWER_RE.test(u)) {
    const cmds: SessionCommand[] = [{ type: 'adjust_mix', kind: kind.mixKind, direction: 'less' }];
    for (const b of targets) {
      if (b.componentType === 'article_list' || b.componentType === 'community_posts') {
        cmds.push({ type: 'set_block_props', blockId: b.id, props: { maxItems: halvedMaxItems(b) } });
      }
    }
    return cmds;
  }
  if (kind && kind.mixKind && MORE_RE.test(u)) {
    // adjust_mix alone only shapes the NEXT generation, which reads as "nothing
    // happened". Grow the matching list blocks now so the change is visible.
    const cmds: SessionCommand[] = [
      { type: 'adjust_mix', kind: kind.mixKind, direction: 'more' }
    ];
    for (const b of targets) {
      if (b.componentType === 'article_list' || b.componentType === 'community_posts') {
        cmds.push({ type: 'set_block_props', blockId: b.id, props: { maxItems: grownMaxItems(b) } });
      }
    }
    return cmds;
  }

  if (REMOVE_RE.test(u)) {
    if (targets.length === 0) return null;
    return targets.map((b) => ({ type: 'remove_block', blockId: b.id, reason: utterance }));
  }

  const topAbs = TOP_ABS_RE.test(u);
  const botAbs = BOTTOM_ABS_RE.test(u);
  const topRel = !topAbs && !botAbs && TOP_REL_RE.test(u);
  const botRel = !topAbs && !botAbs && !topRel && BOTTOM_REL_RE.test(u);
  if (topAbs || botAbs || topRel || botRel) {
    if (targets.length === 0) return null;
    return targets.map((b) => {
      const idx = blocks.indexOf(b);
      let toIndex: number;
      if (topAbs) toIndex = 0;
      else if (botAbs) toIndex = Math.max(0, blocks.length - 1);
      else if (topRel) toIndex = Math.max(0, idx - 1);
      else toIndex = Math.min(blocks.length - 1, idx + 1);
      return { type: 'move_block', blockId: b.id, toIndex };
    });
  }

  const bigger = BIGGER_RE.test(u);
  // '줄여' without a kind word but with an ordinal target reads as resize.
  const smaller = !bigger && (SMALLER_RE.test(u) || (!kind && ordinal !== null && /줄여/.test(u)));
  if (bigger || smaller) {
    if (targets.length === 0) return null;
    return targets.map((b) => {
      const { min, max } = spanBounds(b.componentType);
      const span = bigger
        ? Math.min(max, b.layout.span + 4)
        : Math.max(min, b.layout.span - 4);
      return { type: 'resize_block', blockId: b.id, span };
    });
  }

  if (UNDOCK_RE.test(u)) {
    if (targets.length === 0) return null;
    return targets.map((b) => ({ type: 'dock_block', blockId: b.id, docked: false }));
  }
  if (DOCK_RE.test(u)) {
    if (targets.length === 0) return null;
    return targets.map((b) => ({ type: 'dock_block', blockId: b.id, docked: true }));
  }

  return null;
}
