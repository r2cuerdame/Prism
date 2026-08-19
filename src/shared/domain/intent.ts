import { z } from 'zod';

/**
 * Weights 0..1 per content kind. Missing kind = planner's choice.
 * Fixed object (not a record) so zod validation stays exhaustive and simple.
 */
export const ContentBalanceSchema = z.object({
  video: z.number().min(0).max(1).optional(),
  article: z.number().min(0).max(1).optional(),
  post: z.number().min(0).max(1).optional(),
  headline: z.number().min(0).max(1).optional()
});
export type ContentBalance = z.infer<typeof ContentBalanceSchema>;

/** Structured working interpretation of the user's words. */
export const InterpretedIntentSchema = z.object({
  goal: z.string(),
  topics: z.array(z.string()).default([]),
  moods: z.array(z.string()).default([]),
  contentBalance: ContentBalanceSchema.default({}),
  /** Free-text search query for source adapters, if one is useful. */
  query: z.string().optional(),
  sourceHints: z
    .object({
      include: z.array(z.string()).default([]),
      exclude: z.array(z.string()).default([])
    })
    .default({ include: [], exclude: [] }),
  locale: z.enum(['ko', 'en']).default('ko'),
  /** True when this refines an existing Session instead of starting fresh. */
  followUp: z.boolean().default(false)
});
export type InterpretedIntent = z.infer<typeof InterpretedIntentSchema>;

export const IntentSchema = z.object({
  id: z.string(),
  rawInput: z.string(),
  interpreted: InterpretedIntentSchema.nullable(),
  createdAt: z.string(),
  derivedFrom: z
    .object({
      type: z.enum(['recipe', 'session', 'intent', 'url', 'block']),
      id: z.string().optional()
    })
    .optional()
});
export type Intent = z.infer<typeof IntentSchema>;
