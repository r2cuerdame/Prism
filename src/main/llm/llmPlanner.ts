import type OpenAI from 'openai';
import { z } from 'zod';
import { zodResponseFormat } from 'openai/helpers/zod';
import { newId, nowIso } from '@shared/domain/ids';
import { catalogForPlanner } from '@shared/catalog/catalog';
import { getPostPayload } from '@shared/domain/sourceItem';
import type { PlanRequest, PlanResult } from '@shared/planner/plannerTypes';
import { validateAndRepairPlan } from '@shared/planner/validatePlan';

const COMPONENT_TYPES = [
  'synthesis_brief',
  'topic_cluster',
  'video_player',
  'video_queue',
  'headline_strip',
  'article_list',
  'reader',
  'community_posts',
  'source_list',
  'heading',
  'text',
  'divider'
] as const;

/**
 * Flat block shape for constrained generation; mapped + repaired afterwards.
 * Structured outputs are strict — every field is required, so "not applicable"
 * is expressed as null rather than an absent key.
 */
const LlmBlockSchema = z.object({
  componentType: z.enum(COMPONENT_TYPES),
  sourceItemIds: z.array(z.string()),
  span: z.number(),
  title: z.string().nullable(),
  density: z.enum(['compact', 'comfortable']).nullable(),
  maxItems: z.number().nullable(),
  text: z.string().nullable(),
  /** synthesis_brief: the bullets the planner writes, with citations. */
  points: z
    .array(
      z.object({
        text: z.string(),
        /** Indices into this block's sourceItemIds. */
        cites: z.array(z.number())
      })
    )
    .nullable(),
  /** topic_cluster: the shared thread and what differs between sources. */
  topic: z.string().nullable(),
  angle: z.string().nullable(),
  rationale: z.string().nullable()
});

const LlmPlanSchema = z.object({
  pageTitle: z.string(),
  blocks: z.array(LlmBlockSchema)
});

const SYSTEM = `You are the layout planner of GPTBrowser. You compose ONE new page for the user's current intent out of items gathered from many sources. You are NOT building a feed reader and NOT a search results page.

THE ONE RULE THAT MATTERS: the page is organized BY TOPIC, never by section. Two failures to avoid, both fatal even when every block is individually fine:
 (a) one section per website ("here is the Hacker News list, here is the newspaper list"),
 (b) one section per content type ("the video section, then the news section, then the community section").
Compose the whole page as topics that cut across both:
- Open with ONE synthesis_brief: 2-5 bullets that YOU write, saying what the sources collectively show about this intent — the themes, what several sources agree on, what differs, what is new. Each bullet cites the items it came from (cites = indices into that block's sourceItemRefs), and bullets about overlap must cite items from DIFFERENT sources. Never write a bullet that just restates one item's headline. Citing an item does not use it up — it can still appear in the body.
- Then, if there are videos worth watching, ONE video_player (+ optional video_queue) as the watchable anchor. Keep it small; it is an anchor, not a video section.
- The body is topic_cluster blocks. Each is one thread: an article + a community thread + a video about the same thing is the ideal card. Prefer clusters spanning several sources, but a single-source thread is fine when it is genuinely one story. Use as many as the material supports (typically 2-6), two per row at span 6.
- Anything that fits no thread goes into a final mixed topic_cluster (e.g. topic "그 밖에 눈에 띈 것들") that mixes kinds and sources. Reach for article_list / community_posts / headline_strip ONLY when the material truly refuses to form threads — they are a fallback, not the skeleton.
- Whenever a block holds several items, INTERLEAVE the sources: never fill one card with items that all come from the same sourceName if others are available.

Other rules:
- Use ONLY the provided component catalog and ONLY the provided source item ids. Never invent ids or content beyond the synthesis text you write.
- Your synthesis text must be grounded in the item titles/summaries given to you. Do not assert facts they do not support; when unsure, describe the coverage ("여러 소스가 …를 다뤄요") rather than the claim.
- 12-column grid: each block has span (respect catalog min/max). Blocks flow in order; consecutive spans summing to 12 sit side by side.
- Respect content balance and composition hints ('less' shrinks or drops that kind; 'more' grows it).
- Do NOT create blocks for the preserved blocks listed in context — they are re-inserted automatically. Avoid reusing their item ids.
- If a recipeShape is given, follow its component order and spans as the page's skeleton (it is the user's saved shape) while filling it with the fresh items.
- Always end with ONE source_list block containing every used item id (provenance is mandatory).
- Write everything user-visible in Korean (pageTitle, block titles, synthesis points, topic/angle, rationale). Prefer quality over quantity.
- If items are sparse, compose a smaller good page; if empty, one 'text' block explaining that in Korean.`;

function itemDigest(req: PlanRequest): unknown[] {
  return req.items.map((i) => {
    const post = getPostPayload(i);
    return {
      id: i.id,
      kind: i.kind,
      title: i.title.slice(0, 140),
      // Synthesis is written from these two fields, so give the model enough
      // to say something true about the item.
      source: i.sourceName,
      summary: i.summary?.slice(0, 280),
      publishedAt: i.publishedAt,
      ...(post ? { points: post.points, comments: post.commentCount } : {})
    };
  });
}

function propsFor(b: z.infer<typeof LlmBlockSchema>): Record<string, unknown> {
  switch (b.componentType) {
    case 'synthesis_brief':
      return {
        title: b.title,
        points: (b.points ?? [])
          .filter((p) => typeof p.text === 'string' && p.text.trim() !== '')
          .map((p) => ({
            text: p.text.slice(0, 400),
            cites: p.cites
              .map((c) => Math.trunc(c))
              .filter((c) => c >= 0 && c < b.sourceItemIds.length)
          }))
          .slice(0, 6)
      };
    case 'topic_cluster':
      return {
        topic: (b.topic ?? b.title ?? '').slice(0, 120),
        angle: b.angle === null ? undefined : b.angle.slice(0, 300)
      };
    case 'article_list':
      return { title: b.title, density: b.density, maxItems: b.maxItems };
    case 'heading':
      return { text: b.text ?? b.title ?? '' };
    case 'text':
      return { text: b.text ?? '' };
    case 'divider':
      return {};
    default:
      return { title: b.title };
  }
}

/** null/undefined props fall back to the catalog defaults downstream. */
const strip = (o: Record<string, unknown>): Record<string, unknown> =>
  Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== null));

export async function planLayoutLlm(
  client: OpenAI,
  model: string,
  req: PlanRequest
): Promise<(PlanResult & { pageTitle?: string }) | null> {
  try {
    const context = {
      intent: req.interpretation,
      catalog: catalogForPlanner(),
      items: itemDigest(req),
      preservedDockedBlocks: req.preserved.dockedBlocks.map((b) => ({
        id: b.id,
        componentType: b.componentType,
        span: b.layout.span,
        itemIds: b.sourceItemRefs
      })),
      compositionHints: req.hints,
      learnedPreferences: req.prefSummary || undefined,
      recipeShape: req.recipeShape
    };
    const completion = await client.chat.completions.parse({
      model,
      messages: [
        { role: 'system', content: SYSTEM },
        { role: 'user', content: JSON.stringify(context) }
      ],
      response_format: zodResponseFormat(LlmPlanSchema, 'layout_plan')
    });
    const out = completion.choices[0]?.message.parsed;
    if (!out || out.blocks.length === 0) return null;

    const rawPlan = {
      id: newId('plan'),
      version: 1 as const,
      sessionId: req.sessionId,
      blocks: out.blocks.map((b) => ({
        id: newId('blk'),
        componentType: b.componentType,
        componentVersion: 1,
        sourceItemRefs: b.sourceItemIds,
        props: strip(propsFor(b)),
        layout: { span: Math.min(12, Math.max(1, Math.round(b.span) || 12)) },
        locked: false,
        docked: false,
        rationale: b.rationale ?? undefined,
        state: {}
      })),
      generationScope: 'full' as const,
      preservedEdits: {
        dockedBlockIds: req.preserved.dockedBlocks.map((b) => b.id)
      },
      plannerMetadata: {
        planner: 'llm' as const,
        model,
        promptVersion: 'v1',
        generatedAt: nowIso(),
        diagnostics: []
      }
    };
    const result = validateAndRepairPlan(rawPlan, req.items, req.sessionId);
    return { ...result, pageTitle: out.pageTitle };
  } catch {
    return null;
  }
}
