import { describe, expect, it, vi } from 'vitest';
import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';
import { FIXTURE_ADAPTERS } from './fixtureAdapters';
import { gatherSources } from '../sources/orchestrator';
import { interpretIntentRules } from '@shared/planner/heuristicIntent';
import { heuristicPlan } from '@shared/planner/heuristicPlanner';
import { detectSiloViolations } from '@shared/planner/mixInvariants';
import { createSourceRuntime } from '../sources/runtime/electronSourceRuntime';
import { MemorySourcePage } from '../sources/runtime/sourcePage';
import { communitySite, HN_ORIGIN, PAPER_ORIGIN } from '../sources/runtime/__fixtures__/memorySites';
import { createAuthRailManager } from '../auth/authRailManager';
import { createPreferenceStore } from '../store/preferenceStore';
import { createSessionState } from '@shared/domain/session';
import { inferPreferenceSignals } from '@shared/sessionEngine/preferenceInfer';
import { createHistory, pushHistory, undoHistory } from '@shared/sessionEngine/history';
import type { SourceItem } from '@shared/domain/sourceItem';

vi.mock('../originalViewer', () => ({
  openOriginalWindow: vi.fn(),
  isSafeHttpUrl: vi.fn(() => true)
}));

async function tmpDir(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), 'prism-e2e-'));
}

const mockCtx = {
  http: {
    getText: async () => {
      throw new Error('offline smoke');
    },
    getJson: async () => {
      throw new Error('offline smoke');
    }
  },
  now: () => new Date('2026-09-10T00:00:00.000Z')
};

describe('Prism MVP Comprehensive End-to-End Integration Smoke', () => {
  it('verifies >=3 fixture sources, offline determinism, and mixed-source composition', async () => {
    const interpretation = interpretIntentRules('AI 반도체 기술 트렌드', null);
    const gathered = await gatherSources(interpretation, FIXTURE_ADAPTERS, mockCtx);

    // >=3 sources
    const sourceNames = [...new Set(gathered.items.map((i) => i.sourceName))];
    expect(sourceNames.length).toBeGreaterThanOrEqual(3);
    expect(gathered.reports.every((r) => r.ok)).toBe(true);

    // Heuristic plan with mixed composition
    const { plan } = heuristicPlan({
      interpretation,
      items: gathered.items,
      sessionId: 'ses_smoke',
      preserved: { dockedBlocks: [] },
      hints: { mix: {}, notes: [] }
    });

    // Invariants: no single-source silos
    expect(detectSiloViolations(plan, gathered.items)).toEqual([]);
    const clusters = plan.blocks.filter((b) => b.componentType === 'topic_cluster');
    expect(clusters.length).toBeGreaterThanOrEqual(1);

    const byId = new Map(gathered.items.map((i) => [i.id, i]));
    for (const c of clusters) {
      const clusterSources = new Set(c.sourceItemRefs.map((r) => byId.get(r)?.sourceName));
      expect(clusterSources.size).toBeGreaterThanOrEqual(2);
    }
  });

  it('verifies source runtime partition isolation and zero credential leaks', async () => {
    const runtime = createSourceRuntime();
    const p1 = runtime.getPartitionId('https://news.ycombinator.com');
    const p2 = runtime.getPartitionId('https://reddit.com');
    expect(p1).not.toBe(p2);
    expect(p1).toMatch(/^persist:prism-source-/);
    expect(p2).toMatch(/^persist:prism-source-/);

    const communityPage = new MemorySourcePage(communitySite());
    await runtime.createContext(HN_ORIGIN, {
      sourceId: 'hn',
      sourceName: 'HackerNews',
      page: communityPage,
      initialUrl: `${HN_ORIGIN}/`
    });

    // Login simulation
    communityPage.simulateLoginCookie('session_token', 'super_secret_cookie_value');
    const projection = await runtime.projectSemantic('hn');

    // Wire output must not expose credentials
    const wire = JSON.stringify(projection);
    expect(wire).not.toContain('super_secret_cookie_value');
    expect(wire).not.toMatch(/cookie/i);
  });

  it('verifies action round-trip, reprojection, and stale action rejection', async () => {
    const runtime = createSourceRuntime();
    const communityPage = new MemorySourcePage(communitySite());
    await runtime.createContext(HN_ORIGIN, {
      sourceId: 'hn',
      sourceName: 'HackerNews',
      page: communityPage,
      initialUrl: `${HN_ORIGIN}/`
    });

    const pInitial = await runtime.projectSemantic('hn');
    const moreBtn = pInitial.elements!.find((e) => e.label === 'More')!;

    // Action round-trip
    const actionResult = await runtime.routeAction({
      sourceId: 'hn',
      actionId: moreBtn.actionId,
      expectedProjectionId: pInitial.projectionId
    });

    expect(actionResult.ok).toBe(true);
    expect(actionResult.projection?.url).toBe(`${HN_ORIGIN}/news?p=2`);
    expect(actionResult.projection?.projectionId).not.toBe(pInitial.projectionId);

    // Stale action rejection: replay old action with obsolete expectedProjectionId
    const staleResult = await runtime.routeAction({
      sourceId: 'hn',
      actionId: moreBtn.actionId,
      expectedProjectionId: pInitial.projectionId // Already moved to page 2
    });

    expect(staleResult.ok).toBe(false);
    expect(staleResult.invalidation?.reason).toBe('stale-projection');
  });

  it('verifies auth rail state transitions (idle -> required -> authenticating -> authenticated)', async () => {
    const runtime = createSourceRuntime();
    await runtime.createContext(PAPER_ORIGIN, { sourceId: 'paper', sourceName: 'Example Daily' });

    const sentEvents: Array<{ channel: string; payload: unknown }> = [];
    const manager = createAuthRailManager({
      sourceRuntime: runtime,
      sendToRenderer: (channel, payload) => sentEvents.push({ channel, payload })
    });

    expect(manager.getState()).toBeNull();

    // Trigger auth required
    const openState = manager.openRail({
      sourceId: 'paper',
      origin: PAPER_ORIGIN,
      loginUrl: `${PAPER_ORIGIN}/login`,
      title: 'Daily Paper 로그인'
    });

    expect(openState.status).toBe('required');
    expect(openState.active).toBe(true);

    // Launch login surface
    manager.launchLoginSurface('paper');
    expect(manager.getState()?.status).toBe('authenticating');

    // Complete auth
    const result = await manager.completeAuth('paper');
    expect(result.ok).toBe(true);
    expect(result.status).toBe('authenticated');
    expect(manager.getState()).toBeNull(); // Collapsed
  });

  it('verifies preference persistence, diversity floor enforcement, and immediate reject + undo', async () => {
    const dir = await tmpDir();
    const prefStore = createPreferenceStore(dir);

    // Initial session with 2 items from different sources
    const i1: SourceItem = {
      id: 'i1',
      adapterId: 'ad1',
      sourceId: 's1',
      sourceName: 'Source One',
      kind: 'article',
      title: 'AI Revolution and Ethics',
      payload: {},
      originalUrl: 'https://source1.example/ai',
      retrievedAt: '2026-09-10T00:00:00.000Z',
      provenanceRef: 'p1'
    };
    const i2: SourceItem = {
      id: 'i2',
      adapterId: 'ad2',
      sourceId: 's2',
      sourceName: 'Source Two',
      kind: 'post',
      title: 'Crypto Market Trends',
      payload: {},
      originalUrl: 'https://source2.example/crypto',
      retrievedAt: '2026-09-10T00:00:00.000Z',
      provenanceRef: 'p2'
    };
    const i0: SourceItem = {
      id: 'i0',
      adapterId: 'ad1',
      sourceId: 's1',
      sourceName: 'Source One',
      kind: 'article',
      title: 'Future of Silicon',
      payload: {},
      originalUrl: 'https://source1.example/silicon',
      retrievedAt: '2026-09-10T00:00:00.000Z',
      provenanceRef: 'p0'
    };

    let sessionState = createSessionState('ses_pref_test', '2026-09-10T00:00:00.000Z');
    sessionState = {
      ...sessionState,
      items: { i1, i2, i0 },
      plan: {
        id: 'plan1',
        version: 1,
        sessionId: 'ses_pref_test',
        blocks: [
          {
            id: 'b1',
            componentType: 'topic_cluster',
            componentVersion: 1,
            sourceItemRefs: ['i1', 'i2', 'i0'],
            props: { topic: 'Mixed' },
            layout: { span: 12 },
            locked: false,
            docked: false,
            state: {}
          }
        ],
        generationScope: 'full',
        preservedEdits: { dockedBlockIds: [] },
        plannerMetadata: { planner: 'heuristic', generatedAt: '2026-09-10T00:00:00.000Z', diagnostics: [] }
      }
    };

    let history = createHistory(sessionState);

    // User rejects item i2 (Crypto)
    const rejectCmd = { type: 'remove_item' as const, itemId: 'i2' };
    const signals = inferPreferenceSignals(sessionState, rejectCmd, '2026-09-10T00:01:00.000Z');
    await prefStore.record(signals);

    // History push: state immediately drops i2
    history = pushHistory(history, rejectCmd, '2026-09-10T00:01:00.000Z');
    expect(history.present.plan?.blocks[0]?.sourceItemRefs.includes('i2')).toBe(false);

    // Immediate Undo: Ctrl+Z restores i2
    history = undoHistory(history);
    expect(history.present.plan?.blocks[0]?.sourceItemRefs.includes('i2')).toBe(true);

    // Profile inspection
    const profile = await prefStore.getProfile();
    expect(profile.negative.items.some((it) => it.value === i2.originalUrl && it.hard)).toBe(true);

    // Gather with profile excludes the hard-rejected item
    const mockAdapters = [
      {
        id: 'ad2',
        name: 'Source Two',
        classes: ['community' as const],
        matches: () => 0.8,
        fetchItems: async () => ({
          items: [i2, { ...i2, id: 'i3', originalUrl: 'https://source2.example/clean', title: 'Clean Tech' }],
          provenance: [],
          errors: []
        })
      },
      {
        id: 'ad1',
        name: 'Source One',
        classes: ['news' as const],
        matches: () => 0.8,
        fetchItems: async () => ({
          items: [i1],
          provenance: [],
          errors: []
        })
      }
    ];

    const gathered = await gatherSources(
      interpretIntentRules('기술 소식', null),
      mockAdapters,
      mockCtx,
      { profile }
    );

    // The hard rejected crypto url was excluded!
    expect(gathered.items.some((it) => it.originalUrl === i2.originalUrl)).toBe(false);
    // But Clean Tech and Source One are retained, preserving diversity floor (2 sources)
    const gatheredSources = new Set(gathered.items.map((it) => it.sourceName));
    expect(gatheredSources.size).toBe(2);
  });

  it('verifies shell layout structure: left sidebar, center canvas, bottom intent composer, auth rail, and zero primary address bar/tab strip', async () => {
    const appTsx = await fs.readFile(
      path.join(__dirname, '../../renderer/src/App.tsx'),
      'utf8'
    );
    expect(appTsx).toContain('Sidebar');
    expect(appTsx).toContain('canvas');
    expect(appTsx).toContain('IntentBar');
    expect(appTsx).toContain('AuthRail');
    // Ensure no primary URL bar or browser tab strip
    expect(appTsx).not.toContain('url-bar');
    expect(appTsx).not.toContain('tab-strip');
    expect(appTsx).not.toContain('address-bar');
  });
});

