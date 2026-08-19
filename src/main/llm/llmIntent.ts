import type Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import {
  InterpretedIntentSchema,
  type InterpretedIntent
} from '@shared/domain/intent';

/** Flat output schema kept simple for constrained generation. */
const LlmIntentSchema = z.object({
  goal: z.string(),
  topics: z.array(z.string()),
  moods: z.array(z.string()),
  contentBalance: z.object({
    video: z.number().optional(),
    article: z.number().optional(),
    post: z.number().optional(),
    headline: z.number().optional()
  }),
  query: z.string().optional(),
  includeSources: z.array(z.string()),
  excludeSources: z.array(z.string()),
  locale: z.enum(['ko', 'en']),
  followUp: z.boolean()
});

const SYSTEM = `You interpret what a person wants to consume on the web right now, for GPTBrowser (an intent-driven browser). Input can be vague ("심심해"), moody, or precise, in Korean or English. Vague input is VALID — infer a relaxed browsing interpretation, never ask for clarification.
- topics: short english slugs (ai, gaming, news, dev, tech, science, world, music, ...).
- moods: short slugs (browse, calm, focus, fun ...).
- contentBalance: 0..1 desire weight per content kind (video/article/post/headline). Omit kinds you have no signal for.
- query: only when a concrete search phrase would help source adapters.
- includeSources/excludeSources: adapter ids or classes (youtube, rss-news, hackernews, lobsters, reddit, video, news, community) ONLY if the user implied them.
- followUp: true when the input refines the prior interpretation (provided in context).`;

const clamp01 = (n: number | undefined): number | undefined =>
  n === undefined ? undefined : Math.min(1, Math.max(0, n));

export async function interpretIntentLlm(
  client: Anthropic,
  model: string,
  rawInput: string,
  prior: InterpretedIntent | null,
  prefSummary?: string
): Promise<InterpretedIntent | null> {
  try {
    const context = [
      prior ? `Prior interpretation: ${JSON.stringify(prior)}` : null,
      prefSummary ? `Learned preferences (cautious):\n${prefSummary}` : null
    ]
      .filter(Boolean)
      .join('\n\n');
    const response = await client.messages.parse({
      model,
      max_tokens: 2048,
      output_config: { format: zodOutputFormat(LlmIntentSchema), effort: 'low' },
      system: SYSTEM,
      messages: [
        {
          role: 'user',
          content: `${context ? context + '\n\n' : ''}User input: ${rawInput}`
        }
      ]
    });
    if (response.stop_reason === 'refusal') return null;
    const out = response.parsed_output;
    if (!out) return null;
    const mapped = InterpretedIntentSchema.safeParse({
      goal: out.goal || rawInput,
      topics: out.topics.slice(0, 8),
      moods: out.moods.slice(0, 4),
      contentBalance: {
        video: clamp01(out.contentBalance.video),
        article: clamp01(out.contentBalance.article),
        post: clamp01(out.contentBalance.post),
        headline: clamp01(out.contentBalance.headline)
      },
      query: out.query || undefined,
      sourceHints: {
        include: out.includeSources.slice(0, 6),
        exclude: out.excludeSources.slice(0, 6)
      },
      locale: out.locale,
      followUp: out.followUp
    });
    return mapped.success ? mapped.data : null;
  } catch {
    return null;
  }
}
