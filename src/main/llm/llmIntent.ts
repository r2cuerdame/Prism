import type OpenAI from 'openai';
import { z } from 'zod';
import { zodResponseFormat } from 'openai/helpers/zod';
import { InterpretedIntentSchema, type InterpretedIntent } from '@shared/domain/intent';

/**
 * Flat output schema. Structured outputs are strict: every property must be
 * required, so optional fields are modelled as nullable instead.
 */
const LlmIntentSchema = z.object({
  goal: z.string(),
  topics: z.array(z.string()),
  moods: z.array(z.string()),
  contentBalance: z.object({
    video: z.number(),
    article: z.number(),
    post: z.number(),
    headline: z.number()
  }),
  query: z.string().nullable(),
  includeSources: z.array(z.string()),
  excludeSources: z.array(z.string()),
  locale: z.enum(['ko', 'en']),
  followUp: z.boolean()
});

const SYSTEM = `You interpret what a person wants to consume on the web right now, for GPTBrowser (an intent-driven browser). Input can be vague ("심심해"), moody, or precise, in Korean or English. Vague input is VALID — infer a relaxed browsing interpretation, never ask for clarification.
- topics: short english slugs (ai, gaming, news, dev, tech, science, world, music, ...).
- moods: short slugs (browse, calm, focus, fun ...).
- contentBalance: 0..1 desire weight per content kind (video/article/post/headline). Use 0.4 when you have no signal.
- query: a concrete search phrase when one would help source adapters, else null.
- includeSources/excludeSources: adapter ids or classes (youtube, rss-news, hackernews, lobsters, reddit, video, news, community) ONLY if the user implied them, else empty arrays.
- followUp: true when the input refines the prior interpretation (provided in context).`;

const clamp01 = (n: number): number => Math.min(1, Math.max(0, n));

export async function interpretIntentLlm(
  client: OpenAI,
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

    const completion = await client.chat.completions.parse({
      model,
      messages: [
        { role: 'system', content: SYSTEM },
        { role: 'user', content: `${context ? context + '\n\n' : ''}User input: ${rawInput}` }
      ],
      response_format: zodResponseFormat(LlmIntentSchema, 'interpreted_intent')
    });

    const out = completion.choices[0]?.message.parsed;
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
      query: out.query ?? undefined,
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
