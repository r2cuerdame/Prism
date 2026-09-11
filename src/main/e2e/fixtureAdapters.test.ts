import { describe, expect, it } from 'vitest';
import { SourceItemSchema } from '@shared/domain/sourceItem';
import { interpretIntentRules } from '@shared/planner/heuristicIntent';
import { heuristicPlan } from '@shared/planner/heuristicPlanner';
import { detectSiloViolations } from '@shared/planner/mixInvariants';
import { gatherSources } from '../sources/orchestrator';
import { FIXTURE_ADAPTERS, isFixtureMode } from './fixtureAdapters';

const ctx = {
  http: {
    getText: async () => {
      throw new Error('fixture adapters never touch the network');
    },
    getJson: async () => {
      throw new Error('fixture adapters never touch the network');
    }
  },
  now: () => new Date('2026-09-10T00:00:00.000Z')
};

describe('fixture adapters', () => {
  it('is only on when PRISM_E2E_FIXTURES is set', () => {
    expect(isFixtureMode({})).toBe(false);
    expect(isFixtureMode({ PRISM_E2E_FIXTURES: '0' })).toBe(false);
    expect(isFixtureMode({ PRISM_E2E_FIXTURES: '1' })).toBe(true);
    expect(isFixtureMode({ PRISM_E2E_FIXTURES: 'true' })).toBe(true);
  });

  it('gathers three sources that all cover the same topics, offline', async () => {
    const interpretation = interpretIntentRules('반도체 소식', null);
    const gathered = await gatherSources(interpretation, FIXTURE_ADAPTERS, ctx);
    expect(gathered.reports.every((r) => r.ok)).toBe(true);
    const sources = new Set(gathered.items.map((i) => i.sourceName));
    expect(sources.size).toBe(3);
    for (const it of gathered.items) expect(SourceItemSchema.safeParse(it).success).toBe(true);
    // Same topic from every source: the material a mixed page needs.
    const semis = gathered.items.filter((i) => i.title.startsWith('반도체'));
    expect(new Set(semis.map((i) => i.sourceName)).size).toBe(3);
  });

  it('yields the same titles in the same order on every gather', async () => {
    const interpretation = interpretIntentRules('심심해', null);
    const a = await gatherSources(interpretation, FIXTURE_ADAPTERS, ctx);
    const b = await gatherSources(interpretation, FIXTURE_ADAPTERS, ctx);
    expect(a.items.map((i) => `${i.sourceName}|${i.title}`)).toEqual(
      b.items.map((i) => `${i.sourceName}|${i.title}`)
    );
  });

  it('composes into a one-page plan with no site or kind silos', async () => {
    const interpretation = interpretIntentRules('반도체 소식', null);
    const gathered = await gatherSources(interpretation, FIXTURE_ADAPTERS, ctx);
    const { plan } = heuristicPlan({
      interpretation,
      items: gathered.items,
      sessionId: 'ses_fixture',
      preserved: { dockedBlocks: [] },
      hints: { mix: {}, notes: [] }
    });
    expect(detectSiloViolations(plan, gathered.items)).toEqual([]);
    const byId = new Map(gathered.items.map((i) => [i.id, i]));
    const clusters = plan.blocks.filter((b) => b.componentType === 'topic_cluster');
    expect(clusters.length).toBeGreaterThan(0);
    for (const c of clusters) {
      const names = new Set(c.sourceItemRefs.map((r) => byId.get(r)?.sourceName));
      expect(names.size).toBeGreaterThanOrEqual(2);
    }
  });
});
