import { z } from 'zod';
import type { SourceItemKind } from '../domain/sourceItem';

/**
 * Curated, versioned component catalog. The LLM composes through this — it
 * never emits arbitrary HTML. The renderer owns final validation and
 * presentation (GOAL.md §3, § Generated component system).
 */
export interface CatalogEntry {
  type: string;
  version: 1;
  /** UI title shown in block chrome, Korean-first. */
  title: string;
  /** Compact capability description given to the LLM planner. */
  descriptionForPlanner: string;
  propsSchema: z.ZodTypeAny;
  defaultProps: Record<string, unknown>;
  /** Item kinds this component accepts; null = any kind; [] = no items. */
  acceptsKinds: SourceItemKind[] | null;
  minItems: number;
  maxItems: number;
  defaultSpan: number;
  minSpan: number;
  maxSpan: number;
  /** Supported user actions, for documentation/provenance panels. */
  actions: string[];
  /** Behavior when data is incomplete. */
  fallback: 'hide' | 'placeholder';
}

const titleProp = z.string().max(80).optional();

/**
 * Per-section item cap. Declared here or `validateAndRepairPlan` strips it
 * from props, so a tuning edit would silently vanish on the next validation.
 */
const maxItemsProp = (limit: number): z.ZodTypeAny =>
  z.number().int().min(1).max(limit).optional();

export const COMPONENT_CATALOG: CatalogEntry[] = [
  {
    type: 'video_player',
    version: 1,
    title: '비디오 플레이어',
    descriptionForPlanner:
      'Large trusted YouTube player with an inline queue. First item plays; the rest are the queue. Use as the visual anchor when the intent is watch-oriented.',
    propsSchema: z.object({ title: titleProp, autoplay: z.boolean().optional() }),
    defaultProps: { autoplay: false },
    acceptsKinds: ['video'],
    minItems: 1,
    maxItems: 8,
    defaultSpan: 8,
    minSpan: 6,
    maxSpan: 12,
    actions: ['play', 'queue-select', 'open-original'],
    fallback: 'placeholder'
  },
  {
    type: 'video_queue',
    version: 1,
    title: '비디오 큐',
    descriptionForPlanner:
      'Compact vertical list of watchable videos without a player. Pair next to a video_player or use alone for lighter pages.',
    propsSchema: z.object({ title: titleProp, maxItems: maxItemsProp(12) }),
    defaultProps: {},
    acceptsKinds: ['video'],
    minItems: 1,
    maxItems: 12,
    defaultSpan: 4,
    minSpan: 2,
    maxSpan: 6,
    actions: ['open-original', 'select'],
    fallback: 'hide'
  },
  {
    type: 'headline_strip',
    version: 1,
    title: '헤드라인',
    descriptionForPlanner:
      'Horizontal strip of 3-10 short headlines for fast scanning. Good at the top of news-heavy pages.',
    propsSchema: z.object({ title: titleProp, maxItems: maxItemsProp(10) }),
    defaultProps: {},
    acceptsKinds: ['headline', 'article'],
    minItems: 3,
    maxItems: 10,
    defaultSpan: 12,
    minSpan: 6,
    maxSpan: 12,
    actions: ['open-original'],
    fallback: 'hide'
  },
  {
    type: 'article_list',
    version: 1,
    title: '기사 목록',
    descriptionForPlanner:
      'List of article previews with summary and thumbnail. density: compact|comfortable. maxItems 1-12.',
    propsSchema: z.object({
      title: titleProp,
      density: z.enum(['compact', 'comfortable']).optional(),
      maxItems: z.number().int().min(1).max(12).optional()
    }),
    defaultProps: { density: 'comfortable', maxItems: 6 },
    acceptsKinds: ['article', 'headline'],
    minItems: 1,
    maxItems: 12,
    defaultSpan: 6,
    minSpan: 4,
    maxSpan: 12,
    actions: ['open-original', 'read'],
    fallback: 'placeholder'
  },
  {
    type: 'reader',
    version: 1,
    title: '읽기',
    descriptionForPlanner:
      'Focused reader for exactly ONE article: full summary/excerpt with a link to the original. Use when the intent centers on one story.',
    propsSchema: z.object({ title: titleProp }),
    defaultProps: {},
    acceptsKinds: ['article'],
    minItems: 1,
    maxItems: 1,
    defaultSpan: 8,
    minSpan: 6,
    maxSpan: 12,
    actions: ['open-original'],
    fallback: 'hide'
  },
  {
    type: 'community_posts',
    version: 1,
    title: '커뮤니티',
    descriptionForPlanner:
      'Discussion cluster: community posts with points/comment counts and links to the thread.',
    propsSchema: z.object({
      title: titleProp,
      showMeta: z.boolean().optional(),
      maxItems: maxItemsProp(10)
    }),
    defaultProps: { showMeta: true },
    acceptsKinds: ['post'],
    minItems: 1,
    maxItems: 10,
    defaultSpan: 6,
    minSpan: 4,
    maxSpan: 12,
    actions: ['open-original', 'open-comments'],
    fallback: 'placeholder'
  },
  {
    type: 'synthesis_brief',
    version: 1,
    title: '합성 브리핑',
    descriptionForPlanner:
      "The page's opening synthesis: 2-5 short bullet points YOU write that merge what the sources collectively say about the intent — themes, agreements, contrasts, what is new. NOT a list of links and NOT a per-source summary. Every bullet must cite the items it came from by index into sourceItemRefs (props.points[i].cites = [0,2]). Cite items from DIFFERENT sources in the same bullet wherever the sources overlap. Use once, near the top.",
    propsSchema: z.object({
      title: titleProp,
      points: z
        .array(
          z.object({
            text: z.string().max(400),
            /** Indices into sourceItemRefs backing this claim. */
            cites: z.array(z.number().int().min(0)).default([])
          })
        )
        .min(1)
        .max(6)
    }),
    defaultProps: { points: [] },
    acceptsKinds: null,
    minItems: 2,
    maxItems: 20,
    defaultSpan: 12,
    minSpan: 6,
    maxSpan: 12,
    actions: ['open-original', 'inspect'],
    fallback: 'hide'
  },
  {
    type: 'topic_cluster',
    version: 1,
    title: '주제 묶음',
    descriptionForPlanner:
      'One topic covered by SEVERAL DIFFERENT sources, gathered into a single card: props.topic names the thread, props.angle (optional) says what differs between them, props.title optionally renames the section. sourceItemRefs MUST span at least two distinct sources (and may mix kinds: an article, a video and a community thread about the same thing) and must ALTERNATE between sources item by item — the card renders one continuous mixed list with no per-source grouping. Use 1-3 of these for the main threads of the page. Never use it for items that all come from one source.',
    propsSchema: z.object({
      title: titleProp,
      topic: z.string().max(120),
      angle: z.string().max(300).optional(),
      maxItems: maxItemsProp(8)
    }),
    defaultProps: {},
    acceptsKinds: null,
    minItems: 2,
    maxItems: 8,
    defaultSpan: 6,
    minSpan: 4,
    maxSpan: 12,
    actions: ['open-original', 'inspect'],
    fallback: 'hide'
  },
  {
    type: 'source_list',
    version: 1,
    title: '출처',
    descriptionForPlanner:
      'Evidence list: every source item with its origin link. Place ONCE at the bottom of the page for provenance.',
    propsSchema: z.object({ title: titleProp, maxItems: maxItemsProp(30) }),
    defaultProps: { title: '출처' },
    acceptsKinds: null,
    minItems: 1,
    maxItems: 30,
    defaultSpan: 12,
    minSpan: 6,
    maxSpan: 12,
    actions: ['open-original', 'inspect'],
    fallback: 'hide'
  },
  {
    type: 'heading',
    version: 1,
    title: '제목',
    descriptionForPlanner:
      'Section heading. props: text (required), level 1-3. Takes no items. Use sparingly to group regions.',
    propsSchema: z.object({
      text: z.string().max(120),
      level: z.number().int().min(1).max(3).optional()
    }),
    defaultProps: { level: 2 },
    acceptsKinds: [],
    minItems: 0,
    maxItems: 0,
    defaultSpan: 12,
    minSpan: 4,
    maxSpan: 12,
    actions: [],
    fallback: 'hide'
  },
  {
    type: 'text',
    version: 1,
    title: '텍스트',
    descriptionForPlanner:
      'Short plain-text note from the planner to the user (context, guidance, empty-state explanation). props: text.',
    propsSchema: z.object({ text: z.string().max(2000) }),
    defaultProps: {},
    acceptsKinds: [],
    minItems: 0,
    maxItems: 0,
    defaultSpan: 12,
    minSpan: 4,
    maxSpan: 12,
    actions: [],
    fallback: 'hide'
  },
  {
    type: 'divider',
    version: 1,
    title: '구분선',
    descriptionForPlanner: 'Thin horizontal divider between regions. No props, no items.',
    propsSchema: z.object({}),
    defaultProps: {},
    acceptsKinds: [],
    minItems: 0,
    maxItems: 0,
    defaultSpan: 12,
    minSpan: 12,
    maxSpan: 12,
    actions: [],
    fallback: 'hide'
  }
];

export const CATALOG_BY_TYPE: ReadonlyMap<string, CatalogEntry> = new Map(
  COMPONENT_CATALOG.map((e) => [e.type, e])
);

export function getCatalogEntry(type: string): CatalogEntry | undefined {
  return CATALOG_BY_TYPE.get(type);
}

/**
 * How many of `available` items a block may render for a props.maxItems that
 * came from the planner or a tuning edit (unknown shape at runtime).
 * Never returns fewer than the entry's minItems: slicing must not push a
 * healthy block into its 'hide'/placeholder fallback.
 */
export function visibleItemCount(
  type: string,
  rawMaxItems: unknown,
  available: number
): number {
  if (typeof rawMaxItems !== 'number' || !Number.isFinite(rawMaxItems)) return available;
  const entry = getCatalogEntry(type);
  const upper = entry?.maxItems ?? available;
  const lower = entry?.minItems ?? 1;
  const requested = Math.min(Math.max(1, Math.floor(rawMaxItems)), upper);
  return Math.min(available, Math.max(requested, lower));
}

/** Compact JSON catalog document embedded into LLM planner prompts. */
export function catalogForPlanner(): unknown[] {
  return COMPONENT_CATALOG.map((e) => ({
    type: e.type,
    description: e.descriptionForPlanner,
    props: z.toJSONSchema(e.propsSchema),
    acceptsKinds: e.acceptsKinds,
    items: { min: e.minItems, max: e.maxItems },
    span: { default: e.defaultSpan, min: e.minSpan, max: e.maxSpan }
  }));
}
