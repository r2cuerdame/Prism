import { z } from 'zod';

/**
 * Item-level evidence record. Survives composition, regeneration, history and
 * Recipe saves. Generated UI must never erase provenance (GOAL.md §5).
 */
export const ProvenanceSchema = z.object({
  id: z.string(),
  sourceUrl: z.url(),
  sourceName: z.string(),
  adapterId: z.string(),
  retrievedAt: z.string(),
  contentFingerprint: z.string().optional(),
  /** Human-readable notes: summaries, groupings or derivations applied. */
  transformations: z.array(z.string()).default([]),
  rightsAndPolicy: z.string().optional()
});

export type Provenance = z.infer<typeof ProvenanceSchema>;
