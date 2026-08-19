import { z } from 'zod';

/**
 * A cautious, inspectable preference inference derived from a user action.
 * Durable inference must be reversible and inspectable (GOAL.md § learner).
 */
export const PreferenceSignalSchema = z.object({
  id: z.string(),
  kind: z.enum([
    'drag',
    'resize',
    'remove',
    'dock',
    'undock',
    'lock',
    'regenerate',
    'accept',
    'reject',
    'language_edit',
    'adjust_mix'
  ]),
  target: z.object({
    type: z.enum(['block', 'item', 'source', 'component', 'kind', 'topic']),
    value: z.string()
  }),
  context: z.object({
    sessionId: z.string(),
    intentGoal: z.string().optional()
  }),
  /** Candidate preference inferred from the action, human-readable. */
  interpretation: z.string(),
  scope: z.enum(['one_time', 'session', 'recipe', 'global']),
  confidence: z.number().min(0).max(1),
  /** True only when the user stated the preference directly. */
  explicit: z.boolean(),
  createdAt: z.string(),
  expiresAt: z.string().optional()
});

export type PreferenceSignal = z.infer<typeof PreferenceSignalSchema>;
