import { z } from 'zod';

/**
 * A cautious, inspectable preference inference derived from a user action —
 * or an explicit correction the user gave on purpose (right-click "추천 안 함",
 * a composer line like "이 출처 별로야"). Durable inference must be reversible
 * and inspectable (GOAL.md § learner): every signal shows up in the
 * preferences panel and can be deleted there.
 *
 * Privacy rule: a signal names a source, a kind, a component, a topic phrase
 * or an item's public URL/title terms. It never carries cookies, tokens or
 * private page text.
 */
export const PreferenceSignalKindSchema = z.enum([
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
]);
export type PreferenceSignalKind = z.infer<typeof PreferenceSignalKindSchema>;

export const PreferenceTargetTypeSchema = z.enum([
  'block',
  'item',
  'source',
  'component',
  'kind',
  'topic'
]);
export type PreferenceTargetType = z.infer<typeof PreferenceTargetTypeSchema>;

export const PreferenceScopeSchema = z.enum(['one_time', 'session', 'recipe', 'global']);
export type PreferenceScope = z.infer<typeof PreferenceScopeSchema>;

/** Where the signal came from: a menu click, a composer sentence, or inference. */
export const PreferenceOriginSchema = z.enum(['context_menu', 'composer', 'inferred']);
export type PreferenceOrigin = z.infer<typeof PreferenceOriginSchema>;

export const PreferenceSignalSchema = z.object({
  id: z.string(),
  kind: PreferenceSignalKindSchema,
  target: z.object({
    type: PreferenceTargetTypeSchema,
    /** source name, kind, component type, topic phrase, or an item's original URL. */
    value: z.string()
  }),
  context: z.object({
    sessionId: z.string(),
    intentGoal: z.string().optional(),
    recipeId: z.string().optional()
  }),
  /** Candidate preference inferred from the action, human-readable. */
  interpretation: z.string(),
  scope: PreferenceScopeSchema,
  confidence: z.number().min(0).max(1),
  /** True only when the user stated the preference directly. */
  explicit: z.boolean(),
  /**
   * Direction of the preference. Absent on signals written before this field
   * existed; those are read through the legacy kind-based rule.
   */
  polarity: z.enum(['negative', 'positive']).optional(),
  origin: PreferenceOriginSchema.optional(),
  /**
   * Public fingerprint terms (title tokens of an item, words of a topic) so a
   * rejected item or topic still matches when it comes back under a new id or
   * a slightly different headline. Never full text.
   */
  terms: z.array(z.string().max(60)).max(20).optional(),
  createdAt: z.string(),
  expiresAt: z.string().optional()
});

export type PreferenceSignal = z.infer<typeof PreferenceSignalSchema>;

/** Direction of a signal, honouring the legacy kind-only rule for old records. */
export function signalPolarity(signal: PreferenceSignal): 'negative' | 'positive' {
  if (signal.polarity) return signal.polarity;
  if (signal.kind === 'remove' || signal.kind === 'reject') return 'negative';
  if (signal.kind === 'adjust_mix') {
    const t = signal.interpretation.toLowerCase();
    return t.includes('줄') || t.includes('less') || t.includes('덜') ? 'negative' : 'positive';
  }
  if (signal.kind === 'resize' && /줄였|smaller|덜/.test(signal.interpretation)) return 'negative';
  return 'positive';
}
