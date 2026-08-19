import { z } from 'zod';
import { ContentBalanceSchema } from './intent';

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
  /** Saved shape, not frozen content: ordered component types + spans. */
  layoutTemplate: z
    .array(
      z.object({
        componentType: z.string(),
        span: z.number().int().min(1).max(12)
      })
    )
    .default([]),
  preferenceScope: z.enum(['recipe', 'global']).default('recipe'),
  createdFromSessionId: z.string().optional(),
  createdAt: z.string(),
  updatedAt: z.string()
});

export type Recipe = z.infer<typeof RecipeSchema>;
