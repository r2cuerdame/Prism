import OpenAI from 'openai';

/**
 * The LLM is architectural (GOAL.md §3) but the app must stay usable without
 * credentials — callers fall back to the heuristic planner when this
 * returns null.
 */
export function createOpenAIClient(apiKey: string | undefined): OpenAI | null {
  const key = apiKey ?? process.env.OPENAI_API_KEY;
  if (!key) return null;
  try {
    return new OpenAI({ apiKey: key, maxRetries: 1, timeout: 90_000 });
  } catch {
    return null;
  }
}

export const DEFAULT_PLANNER_MODEL = 'gpt-5.5';

export const PLANNER_MODELS = [
  'gpt-5.5',
  'gpt-5.4',
  'gpt-5.4-mini',
  'gpt-5.1',
  'gpt-5',
  'gpt-5-mini'
];
