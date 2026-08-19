import { writeFileSync } from 'fs';
import { describe, expect, it } from 'vitest';
import { createHttpClient } from './http';
import { gatherSources } from './orchestrator';
import { hackerNewsAdapter } from './adapters/hackernews';
import { lobstersAdapter } from './adapters/lobsters';
import { rssNewsAdapter } from './adapters/rssNews';
import { youtubeAdapter } from './adapters/youtube';
import { redditAdapter } from './adapters/reddit';
import { interpretIntentRules } from '@shared/planner/heuristicIntent';
import { heuristicPlan } from '@shared/planner/heuristicPlanner';

/**
 * Manual smoke check against the live web. Not part of the normal suite —
 * run explicitly: npx vitest run src/main/sources/liveSmoke.test.ts
 */
describe('live composition smoke', () => {
  // Hits the real web — opt in with GPTB_LIVE=1 so the normal suite stays offline.
  it.skipIf(!process.env.GPTB_LIVE)('composes a cross-source page from real feeds', async () => {
    const lines: string[] = [];
    const say = (s: string): void => {
      lines.push(s);
    };

    const ctx = { http: createHttpClient(), now: () => new Date() };
    const interpretation = interpretIntentRules('AI 뉴스와 영상 보여줘');
    const gathered = await gatherSources(
      interpretation,
      [youtubeAdapter, rssNewsAdapter, hackerNewsAdapter, lobstersAdapter, redditAdapter],
      ctx
    );

    say('=== adapters ===');
    for (const r of gathered.reports) {
      say(`${r.ok ? 'OK  ' : 'FAIL'} ${r.name}: ${r.count} items ${r.error ?? ''}`);
    }
    const sources = [...new Set(gathered.items.map((i) => i.sourceName))];
    say(`items=${gathered.items.length} distinct sources=${sources.length}`);
    say(`sources: ${sources.join(' | ')}`);

    const { plan, issues } = heuristicPlan({
      interpretation,
      items: gathered.items,
      sessionId: 'smoke',
      preserved: { dockedBlocks: [] },
      hints: { mix: {}, notes: [] }
    });

    say('');
    say('=== generated page ===');
    const byId = new Map(gathered.items.map((i) => [i.id, i]));
    for (const b of plan.blocks) {
      const srcs = [...new Set(b.sourceItemRefs.map((r) => byId.get(r)?.sourceName ?? '?'))];
      say(
        `- ${b.componentType} (span ${b.layout.span}, items ${b.sourceItemRefs.length}) sources: ${srcs.join(' + ') || '-'}`
      );
      if (b.componentType === 'synthesis_brief') {
        const points = (b.props.points ?? []) as { text: string; cites: number[] }[];
        for (const p of points) say(`    * ${p.text}  [cites ${p.cites.join(',')}]`);
      }
      if (b.componentType === 'topic_cluster') {
        say(`    topic: ${String(b.props.topic)} / angle: ${String(b.props.angle ?? '')}`);
      }
    }
    if (issues.length > 0) say(`issues: ${issues.join(' | ')}`);

    writeFileSync(process.env.SMOKE_OUT ?? 'smoke-report.txt', lines.join('\n'), 'utf8');
    expect(plan.blocks.length).toBeGreaterThan(0);
  }, 90_000);
});
