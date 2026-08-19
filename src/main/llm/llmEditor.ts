import type Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { SessionCommandSchema, type SessionCommand } from '@shared/domain/commands';
import type { SessionDigest } from '@shared/ipc';

const LlmEditCommandSchema = z.object({
  action: z.enum([
    'move_block',
    'resize_block',
    'remove_block',
    'dock_block',
    'lock_block',
    'set_block_props',
    'adjust_mix',
    'rename_session'
  ]),
  blockId: z.string().optional(),
  toIndex: z.number().optional(),
  span: z.number().optional(),
  docked: z.boolean().optional(),
  locked: z.boolean().optional(),
  maxItems: z.number().optional(),
  density: z.enum(['compact', 'comfortable']).optional(),
  title: z.string().optional(),
  kind: z.enum(['video', 'article', 'post', 'headline', 'all']).optional(),
  direction: z.enum(['more', 'less', 'none']).optional()
});

const LlmEditSchema = z.object({
  commands: z.array(LlmEditCommandSchema),
  explanation: z.string()
});

const SYSTEM = `You translate a natural-language edit request into structural commands for GPTBrowser's generated page. The user's words and direct manipulation share ONE state — your commands are the same ones drag/resize/remove use.
- Only reference blockIds that exist in the digest.
- "뉴스 줄여줘" style requests = adjust_mix (direction less) AND optionally set_block_props with smaller maxItems on matching blocks.
- Removing a content type = remove_block for each matching block.
- Keep commands minimal and safe; if the request is not a page edit (a new topic/intent instead), return zero commands and explain (in Korean) that it looks like a new intent.
- explanation: one short Korean sentence describing what you changed.`;

const clampSpan = (n: number): number => Math.min(12, Math.max(1, Math.round(n)));

function mapCommand(
  c: z.infer<typeof LlmEditCommandSchema>,
  digest: SessionDigest
): SessionCommand | null {
  const known = (id?: string): string | null =>
    id && digest.blocks.some((b) => b.id === id) ? id : null;
  let candidate: unknown = null;
  switch (c.action) {
    case 'move_block': {
      const id = known(c.blockId);
      if (id === null || c.toIndex === undefined) return null;
      candidate = { type: 'move_block', blockId: id, toIndex: Math.max(0, Math.round(c.toIndex)) };
      break;
    }
    case 'resize_block': {
      const id = known(c.blockId);
      if (id === null || c.span === undefined) return null;
      candidate = { type: 'resize_block', blockId: id, span: clampSpan(c.span) };
      break;
    }
    case 'remove_block': {
      const id = known(c.blockId);
      if (id === null) return null;
      candidate = { type: 'remove_block', blockId: id };
      break;
    }
    case 'dock_block': {
      const id = known(c.blockId);
      if (id === null) return null;
      candidate = { type: 'dock_block', blockId: id, docked: c.docked ?? true };
      break;
    }
    case 'lock_block': {
      const id = known(c.blockId);
      if (id === null) return null;
      candidate = { type: 'lock_block', blockId: id, locked: c.locked ?? true };
      break;
    }
    case 'set_block_props': {
      const id = known(c.blockId);
      if (id === null) return null;
      const props: Record<string, unknown> = {};
      if (c.maxItems !== undefined) props.maxItems = Math.min(12, Math.max(1, Math.round(c.maxItems)));
      if (c.density !== undefined) props.density = c.density;
      if (c.title !== undefined) props.title = c.title;
      if (Object.keys(props).length === 0) return null;
      candidate = { type: 'set_block_props', blockId: id, props };
      break;
    }
    case 'adjust_mix': {
      if (!c.kind || !c.direction) return null;
      candidate = { type: 'adjust_mix', kind: c.kind, direction: c.direction };
      break;
    }
    case 'rename_session': {
      if (!c.title) return null;
      candidate = { type: 'rename_session', title: c.title.slice(0, 40) };
      break;
    }
  }
  const parsed = SessionCommandSchema.safeParse(candidate);
  return parsed.success ? parsed.data : null;
}

export async function interpretEditLlm(
  client: Anthropic,
  model: string,
  utterance: string,
  digest: SessionDigest
): Promise<{ commands: SessionCommand[]; explanation: string } | null> {
  try {
    const response = await client.messages.parse({
      model,
      max_tokens: 2048,
      output_config: { format: zodOutputFormat(LlmEditSchema), effort: 'low' },
      system: SYSTEM,
      messages: [
        {
          role: 'user',
          content: `Page digest: ${JSON.stringify(digest)}\n\nEdit request: ${utterance}`
        }
      ]
    });
    if (response.stop_reason === 'refusal') return null;
    const out = response.parsed_output;
    if (!out) return null;
    const commands = out.commands
      .map((c) => mapCommand(c, digest))
      .filter((c): c is SessionCommand => c !== null);
    return { commands, explanation: out.explanation };
  } catch {
    return null;
  }
}
