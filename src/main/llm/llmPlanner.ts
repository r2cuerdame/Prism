import type Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { newId, nowIso } from '@shared/domain/ids';
import { catalogForPlanner } from '@shared/catalog/catalog';
import type { PlanRequest, PlanResult } from '@shared/planner/plannerTypes';
import { validateAndRepairPlan } from '@shared/planner/validatePlan';

const COMPONENT_TYPES = [
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

/** Flat block shape for constrained generation; mapped + repaired afterwards. */
const LlmBlockSchema = z.object({
  componentType: z.enum(COMPONENT_TYPES),
  sourceItemIds: z.array(z.string()),
  span: z.number(),
  title: z.string().optional(),
  density: z.enum(['compact', 'comfortable']).optional(),
  maxItems: z.number().optional(),
  autoplay: z.boolean().optional(),
  text: z.string().optional(),
  level: z.number().optional(),
  showMeta: z.boolean().optional(),
  rationale: z.string().optional()
});

const LlmPlanSchema = z.object({
  pageTitle: z.string(),
  blocks: z.array(LlmBlockSchema)
});

const SYSTEM = `You are the layout planner of GPTBrowser. You compose ONE coherent, scrollable generated page from normalized source items, for the user's current intent. You are not a search results page: build something that feels designed for this intent — clear hierarchy, one visual anchor, no clutter.
Rules:
- Use ONLY the provided component catalog and ONLY the provided source item ids. Never invent ids.
- 12-column grid: each block has span (respect catalog min/max). Blocks flow in order; two consecutive blocks with spans summing to 12 sit side by side.
- Respect the content balance and composition hints (a kind marked 'less' should shrink or disappear; 'more' should grow).
- Do NOT create blocks for the preserved (docked) blocks listed in context — they will be re-inserted automatically. Avoid reusing their item ids.
- Always end with ONE source_list block containing every used item id (provenance is mandatory).
- Prefer quality over quantity: it is fine to use only the best items. Write short Korean rationale per block and a short Korean pageTitle.
- If items are sparse, compose a smaller good page; if empty, one 'text' block explaining that in Korean.`;

function itemDigest(req: PlanRequest): unknown[] {
  return req.items.map((i) => ({
    id: i.id,
    kind: i.kind,
    title: i.title.slice(0, 120),
    source: i.sourceName,
    publishedAt: i.publishedAt,
    summary: i.summary?.slice(0, 140)
  }));
}

function propsFor(b: z.infer<typeof LlmBlockSchema>): Record<string, unknown> {
  switch (b.componentType) {
    case 'video_player':
      return { title: b.title, autoplay: b.autoplay };
    case 'article_list':
      return { title: b.title, density: b.density, maxItems: b.maxItems };
    case 'community_posts':
      return { title: b.title, showMeta: b.showMeta };
    case 'heading':
      return { text: b.text ?? b.title ?? '', level: b.level };
    case 'text':
      return { text: b.text ?? '' };
    case 'divider':
      return {};
    default:
      return { title: b.title };
  }
}

const strip = (o: Record<string, unknown>): Record<string, unknown> =>
  Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined));

export async function planLayoutLlm(
  client: Anthropic,
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
      learnedPreferences: req.prefSummary || undefined
    };
    const response = await client.messages.parse({
      model,
      max_tokens: 8192,
      output_config: { format: zodOutputFormat(LlmPlanSchema), effort: 'medium' },
      system: SYSTEM,
      messages: [{ role: 'user', content: JSON.stringify(context) }]
    });
    if (response.stop_reason === 'refusal') return null;
    const out = response.parsed_output;
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
        rationale: b.rationale,
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
