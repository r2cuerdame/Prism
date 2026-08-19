import { z } from 'zod';
import { ContentBalanceSchema } from './intent';
import { CompositionHintsSchema } from './session';

/**
 * One saved slot of a Recipe's page: which component stood there, how wide,
 * and the shaping the user gave it — a renamed section title, dock/lock pins,
 * and the catalog props they tuned (maxItems, density, showMeta…).
 * Content-bearing props (a brief's bullets, a cluster's topic) are deliberately
 * NOT saved: a Recipe is shape, never frozen content.
 * Every field beyond componentType/span is optional so a recipes.json written
 * before this shape existed still parses.
 */
export const RecipeLayoutSlotSchema = z.object({
  componentType: z.string(),
  span: z.number().int().min(1).max(12),
  title: z.string().max(200).optional(),
  docked: z.boolean().optional(),
  locked: z.boolean().optional(),
  props: z.record(z.string(), z.unknown()).optional()
});
export type RecipeLayoutSlot = z.infer<typeof RecipeLayoutSlotSchema>;

/**
 * A Recipe is a reusable definition of a satisfying browsing experience —
 * intent + preferences + layout shape, never a frozen URL. Opening a Recipe
 * regenerates the experience with current content (GOAL.md § Recipe).
 */
export const RecipeSchema = z.object({
  id: z.string(),
  name: z.string(),
  /** Reusable intent text, e.g. "저녁에 볼만한 조용한 영상과 뉴스". */
  intentTemplate: z.string(),
  sourcePreferences: z
    .object({
      include: z.array(z.string()).default([]),
      exclude: z.array(z.string()).default([])
    })
    .default({ include: [], exclude: [] }),
  compositionPreferences: z
    .object({
      balance: ContentBalanceSchema.default({}),
      density: z.enum(['compact', 'comfortable']).default('comfortable')
    })
    .default({ balance: {}, density: 'comfortable' }),
  /** Saved shape, not frozen content: the ordered, user-shaped slots. */
  layoutTemplate: z.array(RecipeLayoutSlotSchema).default([]),
  /**
   * The originating Session's tuning memory. Without it every "영상 줄여" /
   * "더 짧게" would be lost the moment the Recipe is reopened in a new Session.
   */
  compositionHints: CompositionHintsSchema.default({ mix: {}, notes: [] }),
  preferenceScope: z.enum(['recipe', 'global']).default('recipe'),
  createdFromSessionId: z.string().optional(),
  createdAt: z.string(),
  updatedAt: z.string()
});

export type Recipe = z.infer<typeof RecipeSchema>;
