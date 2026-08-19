import Anthropic from '@anthropic-ai/sdk';

/**
 * The LLM is architectural (GOAL.md §3) but the app must stay usable without
 * a key — callers fall back to the heuristic planner when this returns null.
 */
export function createAnthropicClient(apiKey: string | undefined): Anthropic | null {
  const key = apiKey ?? process.env.ANTHROPIC_API_KEY;
  if (!key) return null;
  return new Anthropic({
    apiKey: key,
    maxRetries: 1,
    timeout: 90_000
  });
}

export const DEFAULT_PLANNER_MODEL = 'claude-opus-5';
