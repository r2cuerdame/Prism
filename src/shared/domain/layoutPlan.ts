import { z } from 'zod';

export const BlockLayoutSchema = z.object({
  /** 12-column grid span. */
  span: z.number().int().min(1).max(12),
  /** Fixed pixel height for resizable blocks; omitted = natural height. */
  heightPx: z.number().int().min(120).max(2000).optional()
});
export type BlockLayout = z.infer<typeof BlockLayoutSchema>;

export const ComponentBlockSchema = z.object({
  /** Stable across edits — regeneration reuses ids for preserved blocks. */
  id: z.string(),
  componentType: z.string(),
  componentVersion: z.number().int().default(1),
  sourceItemRefs: z.array(z.string()).default([]),
  props: z.record(z.string(), z.unknown()).default({}),
  layout: BlockLayoutSchema,
  /** Locked: content pinned across regeneration. */
  locked: z.boolean().default(false),
  /** Docked: block survives whole-page regeneration. */
  docked: z.boolean().default(false),
  /** Inspectable reason for inclusion (shown in provenance panel). */
  rationale: z.string().optional(),
  /** User-visible interactive state (e.g. active video id). */
  state: z.record(z.string(), z.unknown()).default({})
});
export type ComponentBlock = z.infer<typeof ComponentBlockSchema>;

export const PlannerMetadataSchema = z.object({
  planner: z.enum(['llm', 'heuristic']),
  model: z.string().optional(),
  promptVersion: z.string().optional(),
  generatedAt: z.string(),
  diagnostics: z.array(z.string()).default([])
});
export type PlannerMetadata = z.infer<typeof PlannerMetadataSchema>;

export const LayoutPlanSchema = z.object({
  id: z.string(),
  version: z.literal(1),
  sessionId: z.string(),
  blocks: z.array(ComponentBlockSchema),
  generationScope: z.enum(['full', 'region']).default('full'),
  preservedEdits: z
    .object({ dockedBlockIds: z.array(z.string()).default([]) })
    .default({ dockedBlockIds: [] }),
  plannerMetadata: PlannerMetadataSchema
});
export type LayoutPlan = z.infer<typeof LayoutPlanSchema>;
