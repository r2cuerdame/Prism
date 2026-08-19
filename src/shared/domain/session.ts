import { z } from 'zod';
import { IntentSchema } from './intent';
import { LayoutPlanSchema } from './layoutPlan';
import { SourceItemSchema } from './sourceItem';

export const SessionStatusSchema = z.enum([
  'idle',
  'planning',
  'loading',
  'ready',
  'partial',
  'failed'
]);
export type SessionStatus = z.infer<typeof SessionStatusSchema>;

export const CompositionHintsSchema = z.object({
  mix: z.object({
    video: z.enum(['more', 'less']).optional(),
    article: z.enum(['more', 'less']).optional(),
    post: z.enum(['more', 'less']).optional(),
    headline: z.enum(['more', 'less']).optional()
  }),
  notes: z.array(z.string())
});
export type CompositionHints = z.infer<typeof CompositionHintsSchema>;

export const emptyCompositionHints = (): CompositionHints => ({ mix: {}, notes: [] });

/**
 * A Session is a generated, temporary space built around an Intent.
 * It evolves rather than navigating forward/backward through pages.
 */
export const SessionStateSchema = z.object({
  id: z.string(),
  title: z.string(),
  intentHistory: z.array(IntentSchema),
  plan: LayoutPlanSchema.nullable(),
  /** Item pool available to the Session, keyed by item id. */
  items: z.record(z.string(), SourceItemSchema),
  compositionHints: CompositionHintsSchema,
  status: SessionStatusSchema,
  statusDetail: z.string().optional(),
  createdAt: z.string(),
  updatedAt: z.string()
});
export type SessionState = z.infer<typeof SessionStateSchema>;

export const GeneratedSnapshotSchema = z.object({
  planId: z.string(),
  at: z.string(),
  label: z.string(),
  state: SessionStateSchema
});
export type GeneratedSnapshot = z.infer<typeof GeneratedSnapshotSchema>;

export function createSessionState(id: string, now: string): SessionState {
  return {
    id,
    title: '새 세션',
    intentHistory: [],
    plan: null,
    items: {},
    compositionHints: emptyCompositionHints(),
    status: 'idle',
    createdAt: now,
    updatedAt: now
  };
}
