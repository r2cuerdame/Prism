import type { InterpretedIntent } from '../domain/intent';
import type { ComponentBlock, LayoutPlan } from '../domain/layoutPlan';
import type { SourceItem } from '../domain/sourceItem';
import type { CompositionHints } from '../domain/session';

export type { InterpretedIntent };

export interface PlanRequest {
  interpretation: InterpretedIntent;
  /** Normalized items available for composition. */
  items: SourceItem[];
  sessionId: string;
  /** Docked/locked blocks that regeneration must respect (not re-emitted). */
  preserved: { dockedBlocks: ComponentBlock[] };
  hints: CompositionHints;
  /** Short human-readable summary of learned preferences, if any. */
  prefSummary?: string;
  /** Saved Recipe shape to follow when regenerating from a Recipe. */
  recipeShape?: {
    name: string;
    layoutTemplate: { componentType: string; span: number }[];
    density: 'compact' | 'comfortable';
  };
}

export interface PlanResult {
  plan: LayoutPlan;
  /** Validation/repair diagnostics — inspectable, never silently dropped. */
  issues: string[];
}
