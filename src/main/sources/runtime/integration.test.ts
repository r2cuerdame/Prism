import { describe, expect, it } from 'vitest';
import type { InterpretedIntent } from '@shared/domain/intent';
import type { LayoutPlan } from '@shared/domain/layoutPlan';
import { LayoutPlanSchema } from '@shared/domain/layoutPlan';
import type { SourceItem } from '@shared/domain/sourceItem';
import { heuristicPlan } from '@shared/planner/heuristicPlanner';
import { detectSiloViolations } from '@shared/planner/mixInvariants';
import { validateAndRepairPlan } from '@shared/planner/validatePlan';
import { createSourceRuntime } from './electronSourceRuntime';
import { MemorySourcePage } from './sourcePage';
import { communitySite, HN_ORIGIN, PAPER_ORIGIN, paperSite } from './__fixtures__/memorySites';

const BODY_TYPES = new Set(['topic_cluster', 'article_list', 'community_posts', 'headline_strip', 'reader']);

function sourcesOf(block: LayoutPlan['blocks'][number], items: SourceItem[]): Set<string> {
  const byId = new Map(items.map((i) => [i.id, i]));
  return new Set(block.sourceItemRefs.map((r) => byId.get(r)?.sourceName).filter((s): s is string => !!s));
}

const interpretation: InterpretedIntent = {
  goal: 'AI 칩과 반도체 소식',
  topics: ['ai', 'tech'],
  moods: ['browse'],
  contentBalance: { article: 0.5, post: 0.5, video: 0.2, headline: 0.3 },
  sourceHints: { include: [], exclude: [] },
  locale: 'ko',
  followUp: false
};

/**
 * End to end through the hidden source boundary: two independent source
 * contexts each mutate their own page state through typed actions, and the
 * semantic items they yield are composed into ONE topic-oriented page — not
 * a "community section" followed by a "newspaper section".
 */
describe('two source contexts → actions → one mixed page', () => {
  it('mutates each context independently and composes their items by topic', async () => {
    const runtime = createSourceRuntime();
    const communityPage = new MemorySourcePage(communitySite());
    const paperPage = new MemorySourcePage(paperSite());
    await runtime.createContext(HN_ORIGIN, {
      sourceId: 'community',
      sourceName: 'Community',
      page: communityPage,
      initialUrl: `${HN_ORIGIN}/`
    });
    await runtime.createContext(PAPER_ORIGIN, {
      sourceId: 'paper',
      sourceName: 'Example Daily',
      page: paperPage,
      initialUrl: `${PAPER_ORIGIN}/`
    });

    // Page 1 of each source.
    const community1 = await runtime.projectSemantic('community');
    const paper1 = await runtime.projectSemantic('paper');

    // Each context pages forward through ITS OWN action surface.
    const more = community1.elements!.find((e) => e.label === 'More')!;
    const communityNext = await runtime.routeAction({
      sourceId: more.sourceId,
      actionId: more.actionId,
      expectedProjectionId: community1.projectionId
    });
    const next = paper1.elements!.find((e) => e.label === '더 보기')!;
    const paperNext = await runtime.routeAction({
      sourceId: next.sourceId,
      actionId: next.actionId,
      expectedProjectionId: paper1.projectionId
    });

    expect(communityNext.ok).toBe(true);
    expect(paperNext.ok).toBe(true);
    expect(communityPage.url).toBe(`${HN_ORIGIN}/news?p=2`);
    expect(paperPage.url).toBe(`${PAPER_ORIGIN}/tech?page=2`);
    // Each mutation stayed inside its own context.
    expect(communityNext.projection?.sourceId).toBe('community');
    expect(paperNext.projection?.sourceId).toBe('paper');
    expect(communityNext.projection?.items.every((i) => i.sourceName === 'Community')).toBe(true);
    expect(paperNext.projection?.items.every((i) => i.sourceName === 'Example Daily')).toBe(true);

    // Pool = everything both sources have shown so far.
    const items: SourceItem[] = [
      ...community1.items,
      ...paper1.items,
      ...communityNext.projection!.items,
      ...paperNext.projection!.items
    ];
    expect(new Set(items.map((i) => i.sourceName)).size).toBe(2);

    const { plan } = heuristicPlan({
      interpretation,
      items,
      sessionId: 'ses_integration',
      preserved: { dockedBlocks: [] },
      hints: { mix: {}, notes: [] }
    });
    const { plan: validated } = validateAndRepairPlan(plan, items, 'ses_integration');
    expect(LayoutPlanSchema.safeParse(validated).success).toBe(true);

    // The page is topic-oriented: no per-site or per-kind sections.
    expect(detectSiloViolations(validated, items)).toEqual([]);

    const body = validated.blocks.filter((b) => BODY_TYPES.has(b.componentType));
    expect(body.length).toBeGreaterThan(0);
    // Every multi-item body block draws on BOTH sources...
    for (const block of body) {
      if (block.sourceItemRefs.length >= 2) {
        expect(sourcesOf(block, items).size).toBe(2);
      }
    }
    // ...and at least one is a genuine cross-source topic thread (the AI chip
    // race / Samsung yields / EV battery stories exist on both sites).
    const threads = validated.blocks.filter(
      (b) => b.componentType === 'topic_cluster' && sourcesOf(b, items).size === 2
    );
    expect(threads.length).toBeGreaterThanOrEqual(1);

    // Items that only exist after the actions (page 2) made it onto the page.
    const refs = new Set(validated.blocks.flatMap((b) => b.sourceItemRefs));
    const pageTwo = [...communityNext.projection!.items, ...paperNext.projection!.items];
    expect(pageTwo.some((i) => refs.has(i.id))).toBe(true);

    // Provenance survives composition: every block ref resolves to an item
    // that still names its origin.
    for (const ref of refs) {
      const item = items.find((i) => i.id === ref)!;
      expect(item.originalUrl.startsWith(HN_ORIGIN) || item.originalUrl.startsWith(PAPER_ORIGIN)).toBe(true);
    }
  });

  it('a hand-built per-site page is what the invariant rejects', () => {
    // Guard against the test above passing vacuously: the same pool arranged as
    // "community list, then newspaper list" must be flagged.
    const mk = (id: string, sourceName: string, kind: 'post' | 'article'): SourceItem => ({
      id,
      adapterId: 'source-runtime',
      sourceId: sourceName,
      sourceName,
      kind,
      title: `${id} title`,
      payload: kind === 'post' ? { community: sourceName } : {},
      originalUrl: `https://${sourceName}.example/${id}`,
      retrievedAt: '2026-09-10T00:00:00.000Z',
      provenanceRef: 'prov_x'
    });
    const items = [
      mk('c1', 'community', 'post'),
      mk('c2', 'community', 'post'),
      mk('p1', 'paper', 'article'),
      mk('p2', 'paper', 'article')
    ];
    const block = (id: string, type: string, refs: string[]): LayoutPlan['blocks'][number] => ({
      id,
      componentType: type,
      componentVersion: 1,
      sourceItemRefs: refs,
      props: {},
      layout: { span: 6 },
      locked: false,
      docked: false,
      state: {}
    });
    const silo: LayoutPlan = {
      id: 'plan_silo',
      version: 1,
      sessionId: 's',
      blocks: [block('b1', 'community_posts', ['c1', 'c2']), block('b2', 'article_list', ['p1', 'p2'])],
      generationScope: 'full',
      preservedEdits: { dockedBlockIds: [] },
      plannerMetadata: { planner: 'heuristic', generatedAt: '2026-09-10T00:00:00.000Z', diagnostics: [] }
    };
    expect(detectSiloViolations(silo, items).length).toBeGreaterThan(0);
  });
});
