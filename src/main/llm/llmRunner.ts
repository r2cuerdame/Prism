import type { z } from 'zod';

export type LlmEffort = 'none' | 'low' | 'medium' | 'high';

/**
 * Which CLI carries a model call. `agy` is the default; `codex` is the
 * optional legacy path; `none` is the always-available offline runner that
 * answers null so callers fall back to the heuristic planner.
 */
export type LlmProviderType = 'agy' | 'codex' | 'none';

/**
 * The one interface llmIntent / llmPlanner / llmEditor / llmSynthesis talk to.
 * A runner turns (schema, prompt) into a schema-valid object or null. Callers
 * never learn which CLI produced the answer — only `provider` / `model` for
 * diagnostics and plan metadata.
 */
export interface LlmRunner {
  readonly ready: boolean;
  readonly provider: LlmProviderType;
  /** Model name for metadata; empty when the CLI decides. */
  readonly model: string;
  run<T>(
    schema: z.ZodType<T>,
    prompt: string,
    opts?: { timeoutMs?: number; effort?: LlmEffort }
  ): Promise<T | null>;
}

/** Always-null runner: the planner's offline heuristic path takes over. */
export function createOfflineRunner(): LlmRunner {
  return {
    ready: false,
    provider: 'none',
    model: '',
    async run() {
      return null;
    }
  };
}
