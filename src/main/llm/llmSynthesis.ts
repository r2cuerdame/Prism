import { z } from 'zod';
import type { LayoutPlan } from '@shared/domain/layoutPlan';
import type { SourceItem } from '@shared/domain/sourceItem';
import type { CodexRunner } from './codexRunner';

/** Strict structured outputs: every field required, "n/a" expressed as null. */
const LlmSynthesisSchema = z.object({
  blocks: z.array(
    z.object({
      /** Index into the plan's blocks array, as given in the input digest. */
      index: z.number(),
      points: z.array(z.object({ text: z.string(), cites: z.array(z.number()) })).nullable(),
      topic: z.string().nullable(),
      angle: z.string().nullable()
    })
  )
});

const SYSTEM = `You refresh ONLY the synthesis text of an already-composed GPTBrowser page whose slots were just refilled with fresh items. The layout is fixed — you rewrite words, never structure. For each input block (identified by its index):
- synthesis_brief: write 2-5 Korean bullets (points) saying what its fresh items collectively show — themes, what several sources agree on, what differs, what is new. Each bullet cites the items it came from: cites = the given "n" values of that block's items. Bullets about overlap must cite items from DIFFERENT sources. Never write a bullet that just restates one item's headline.
- topic_cluster: topic = one short Korean phrase naming the thread its items share; angle = one short Korean line on what differs between the sources.
Ground everything in the given titles/summaries. Do not assert facts they do not support; when unsure, describe the coverage ("여러 소스가 …를 다뤄요") rather than the claim. Return one entry per input block, echoing its index; use null for fields that do not apply to that block type.`;

/**
 * The cheap half of 재생성: the page keeps its own skeleton, so instead of
 * re-planning the whole layout only the synthesis words are rewritten for the
 * fresh items. Resolves null on any failure — the caller keeps the heuristic
 * text, which is always present.
 */
export async function refreshSynthesisLlm(
  runner: CodexRunner,
  plan: LayoutPlan,
  items: SourceItem[],
  goal: string
): Promise<LayoutPlan | null> {
  try {
    const byId = new Map(items.map((i) => [i.id, i]));
    const targets = plan.blocks
      .map((block, index) => ({ block, index }))
      .filter(
        ({ block }) =>
          block.componentType === 'synthesis_brief' || block.componentType === 'topic_cluster'
      );
    if (targets.length === 0) return null;

    const digest = targets.map(({ block, index }) => ({
      index,
      componentType: block.componentType,
      items: block.sourceItemRefs.map((id, n) => {
        const it = byId.get(id);
        return it
          ? {
              n,
              kind: it.kind,
              title: it.title.slice(0, 140),
              source: it.sourceName,
              summary: it.summary?.slice(0, 200)
            }
          : { n, kind: 'unknown', title: '(missing)', source: '' };
      })
    }));

    const prompt = `${SYSTEM}\n\n--- INPUT ---\n${JSON.stringify({ goal, blocks: digest })}`;
    const out = await runner.run(LlmSynthesisSchema, prompt, { timeoutMs: 90_000, effort: 'low' });
    if (!out) return null;

    const byIndex = new Map(out.blocks.map((o) => [Math.trunc(o.index), o]));
    let changed = false;
    const blocks = plan.blocks.map((block, index) => {
      const o = byIndex.get(index);
      if (!o) return block;
      if (block.componentType === 'synthesis_brief' && o.points) {
        const points = o.points
          .filter((p) => p.text.trim() !== '')
          .map((p) => ({
            text: p.text.slice(0, 400),
            cites: p.cites
              .map((c) => Math.trunc(c))
              .filter((c) => c >= 0 && c < block.sourceItemRefs.length)
          }))
          .slice(0, 6);
        if (points.length === 0) return block;
        changed = true;
        return { ...block, props: { ...block.props, points } };
      }
      if (block.componentType === 'topic_cluster') {
        const props = { ...block.props };
        if (o.topic !== null && o.topic.trim() !== '') props.topic = o.topic.slice(0, 120);
        if (o.angle !== null && o.angle.trim() !== '') props.angle = o.angle.slice(0, 300);
        if (props.topic === block.props.topic && props.angle === block.props.angle) return block;
        changed = true;
        return { ...block, props };
      }
      return block;
    });
    return changed ? { ...plan, blocks } : null;
  } catch {
    return null;
  }
}
