import { describe, expect, it, vi } from 'vitest';
import { SemanticProjectionSchema } from '@shared/domain/projection';
import { createSourceRuntime } from './electronSourceRuntime';
import { MemorySourcePage } from './sourcePage';
import { communitySite, HN_ORIGIN, PAPER_ORIGIN, paperSite } from './__fixtures__/memorySites';
import { handleSourceAction } from '../../ipcHandlers';
import type { SourceActionRpcRequest, SourceActionRpcResult } from '@shared/ipc';

vi.mock('electron-updater', () => ({
  default: {
    autoUpdater: {
      on: vi.fn(),
      checkForUpdates: vi.fn(),
      quitAndInstall: vi.fn()
    }
  }
}));

async function communityContext(sourceId = 'community') {
  const runtime = createSourceRuntime();
  const page = new MemorySourcePage(communitySite());
  const ctx = await runtime.createContext(HN_ORIGIN, {
    sourceId,
    sourceName: 'Community',
    page,
    initialUrl: `${HN_ORIGIN}/`
  });
  return { runtime, page, ctx };
}

describe('page-backed projection', () => {
  it('exposes typed items and elements, every actionable one with sourceId + actionId', async () => {
    const { runtime } = await communityContext();
    const projection = await runtime.projectSemantic('community');

    expect(SemanticProjectionSchema.safeParse(projection).success).toBe(true);
    expect(projection.url).toBe(`${HN_ORIGIN}/`);
    expect(projection.items.length).toBeGreaterThanOrEqual(3);
    for (const item of projection.items) {
      expect(item.sourceId).toBe('community');
      expect(item.sourceName).toBe('Community');
      expect(item.originalUrl.startsWith(HN_ORIGIN)).toBe(true);
    }
    expect(projection.elements!.length).toBeGreaterThan(0);
    for (const el of projection.elements!) {
      expect(el.sourceId).toBe('community');
      expect(el.actionId).toMatch(/^(click|input|submit):\d+$|^(back|forward|reload)$/);
    }
    const more = projection.elements!.find((e) => e.label === 'More');
    expect(more?.kind).toBe('button');
    expect(projection.availableActions.map((a) => a.actionId)).toEqual(
      expect.arrayContaining(['navigate', 'back', 'forward', 'reload'])
    );
  });

  it('never serializes cookies, storage or scripts — only semantic fields', async () => {
    const { runtime, page } = await communityContext();
    // Sign in so the private jar actually holds a secret.
    await page.loadURL(`${HN_ORIGIN}/login/done`);
    expect(page.hasCookie('session')).toBe(true);
    await page.loadURL(`${HN_ORIGIN}/threads`);

    const projection = await runtime.projectSemantic('community');
    const wire = JSON.stringify(projection);
    expect(wire).not.toContain('secret-session-cookie-value');
    expect(wire).not.toMatch(/cookie/i);
    expect(wire).not.toContain('<');
    expect(Object.keys(projection)).not.toContain('page');
  });

  it('projects a password field without its value and flags authRequired', async () => {
    const { runtime, page } = await communityContext();
    await page.loadURL(`${HN_ORIGIN}/login`);
    const first = await runtime.projectSemantic('community');
    const pw = first.elements!.find((e) => e.inputType === 'password')!;
    await runtime.routeAction({ sourceId: 'community', actionId: pw.actionId, payload: { value: 'hunter2' } });

    const projection = await runtime.projectSemantic('community');
    expect(projection.authRequired).toBe(true);
    expect(projection.loginUrl).toBe(`${HN_ORIGIN}/login`);
    const again = projection.elements!.find((e) => e.inputType === 'password')!;
    expect(again.value).toBeUndefined();
    expect(JSON.stringify(projection)).not.toContain('hunter2');
  });
});

describe('typed built-in action routing', () => {
  it('click on a projected button navigates and returns the refreshed projection', async () => {
    const { runtime, page } = await communityContext();
    const before = await runtime.projectSemantic('community');
    const more = before.elements!.find((e) => e.label === 'More')!;

    const result = await runtime.routeAction({ sourceId: 'community', actionId: more.actionId });

    expect(result.ok).toBe(true);
    expect(result.projection?.url).toBe(`${HN_ORIGIN}/news?p=2`);
    expect(result.projection?.projectionId).not.toBe(before.projectionId);
    expect(result.projection?.items.map((i) => i.title)).toContain(
      'Electric vehicle battery exports surge, engineers weigh in'
    );
    expect(page.loads.at(-1)).toBe(`${HN_ORIGIN}/news?p=2`);
    // The runtime's notion of "current projection" moved with the page.
    expect(runtime.getContext('community')!.lastProjection?.projectionId).toBe(
      result.projection?.projectionId
    );
  });

  it('back / forward / reload walk the context history and re-project', async () => {
    const { runtime } = await communityContext();
    const home = await runtime.projectSemantic('community');
    const more = home.elements!.find((e) => e.label === 'More')!;
    await runtime.routeAction({ sourceId: 'community', actionId: more.actionId });

    const back = await runtime.routeAction({ sourceId: 'community', actionId: 'back' });
    expect(back.ok).toBe(true);
    expect(back.projection?.url).toBe(`${HN_ORIGIN}/`);
    expect(back.projection?.canGoForward).toBe(true);

    const fwd = await runtime.routeAction({ sourceId: 'community', actionId: 'forward' });
    expect(fwd.ok).toBe(true);
    expect(fwd.projection?.url).toBe(`${HN_ORIGIN}/news?p=2`);

    const reload = await runtime.routeAction({ sourceId: 'community', actionId: 'reload' });
    expect(reload.ok).toBe(true);
    expect(reload.projection?.url).toBe(`${HN_ORIGIN}/news?p=2`);

    const noForward = await runtime.routeAction({ sourceId: 'community', actionId: 'forward' });
    expect(noForward.ok).toBe(false);
  });

  it('input then submit: submit is destructive and needs the confirmation flag', async () => {
    const { runtime, page } = await communityContext();
    await page.loadURL(`${HN_ORIGIN}/login`);
    const projection = await runtime.projectSemantic('community');
    const user = projection.elements!.find((e) => e.label === 'username')!;
    const form = projection.elements!.find((e) => e.kind === 'form')!;
    expect(form.destructive).toBe(true);
    expect(form.requiresConfirmation).toBe(true);

    const typed = await runtime.routeAction({
      sourceId: 'community',
      actionId: user.actionId,
      payload: { value: 'alice' }
    });
    expect(typed.ok).toBe(true);
    expect(typed.projection?.elements!.find((e) => e.label === 'username')?.value).toBe('alice');

    const refused = await runtime.routeAction({ sourceId: 'community', actionId: form.actionId });
    expect(refused.ok).toBe(false);
    expect(refused.requiresConfirmation).toBe(true);
    expect(page.url).toBe(`${HN_ORIGIN}/login`);

    const done = await runtime.routeAction({
      sourceId: 'community',
      actionId: form.actionId,
      confirmed: true
    });
    expect(done.ok).toBe(true);
    expect(done.projection?.url).toBe(`${HN_ORIGIN}/login/done`);
    expect(JSON.stringify(done)).not.toContain('secret-session-cookie-value');
  });

  it('a click whose label reads as destructive also needs confirmation', async () => {
    const { runtime, page } = await communityContext();
    page.simulateLoginCookie('session', 'x');
    await page.loadURL(`${HN_ORIGIN}/threads`);
    const projection = await runtime.projectSemantic('community');
    const del = projection.elements!.find((e) => e.label === 'delete comment')!;
    expect(del.destructive).toBe(true);
    const refused = await runtime.routeAction({ sourceId: 'community', actionId: del.actionId });
    expect(refused.ok).toBe(false);
    expect(refused.requiresConfirmation).toBe(true);
    const ok = await runtime.routeAction({ sourceId: 'community', actionId: del.actionId, confirmed: true });
    expect(ok.ok).toBe(true);
  });

  it('navigate stays inside the context origin and only over http(s)', async () => {
    const { runtime } = await communityContext();
    const ok = await runtime.routeAction({
      sourceId: 'community',
      actionId: 'navigate',
      payload: { url: `${HN_ORIGIN}/news?p=2` }
    });
    expect(ok.ok).toBe(true);
    expect(ok.projection?.url).toBe(`${HN_ORIGIN}/news?p=2`);

    const cross = await runtime.routeAction({
      sourceId: 'community',
      actionId: 'navigate',
      payload: { url: `${PAPER_ORIGIN}/` }
    });
    expect(cross.ok).toBe(false);
    expect(cross.invalidation?.reason).toBe('refused');

    const scheme = await runtime.routeAction({
      sourceId: 'community',
      actionId: 'navigate',
      payload: { url: 'javascript:alert(1)' }
    });
    expect(scheme.ok).toBe(false);
    expect(scheme.invalidation?.reason).toBe('refused');

    const missing = await runtime.routeAction({ sourceId: 'community', actionId: 'navigate' });
    expect(missing.ok).toBe(false);
  });

  it('rejects unknown and invalid actions with invalidation info instead of throwing', async () => {
    const { runtime } = await communityContext();
    await runtime.projectSemantic('community');

    const unknown = await runtime.routeAction({ sourceId: 'community', actionId: 'teleport' });
    expect(unknown.ok).toBe(false);
    expect(unknown.invalidation?.reason).toBe('unknown-action');

    const ghost = await runtime.routeAction({ sourceId: 'community', actionId: 'click:999' });
    expect(ghost.ok).toBe(false);
    expect(ghost.invalidation?.reason).toBe('unknown-action');

    const wrongKind = await runtime.routeAction({ sourceId: 'community', actionId: 'input:0' });
    expect(wrongKind.ok).toBe(false);

    const malformed = await runtime.routeAction({ sourceId: '', actionId: '' });
    expect(malformed.ok).toBe(false);

    const gone = await runtime.routeAction({ sourceId: 'nobody', actionId: 'reload' });
    expect(gone.ok).toBe(false);
    expect(gone.invalidation?.reason).toBe('context-destroyed');
  });

  it('refuses an action made against a projection the page has left behind', async () => {
    const { runtime } = await communityContext();
    const first = await runtime.projectSemantic('community');
    const more = first.elements!.find((e) => e.label === 'More')!;
    await runtime.routeAction({ sourceId: 'community', actionId: more.actionId });

    const stale = await runtime.routeAction({
      sourceId: 'community',
      actionId: more.actionId,
      expectedProjectionId: first.projectionId
    });
    expect(stale.ok).toBe(false);
    expect(stale.invalidation?.reason).toBe('stale-projection');
    expect(stale.invalidation?.projectionId).toBe(first.projectionId);
  });

  it('a page-backed context has no built-in action a custom handler did not override', async () => {
    const { runtime } = await communityContext();
    runtime.registerActionHandler('community', 'reload', async (req) => ({
      ok: true,
      sourceId: req.sourceId,
      actionId: req.actionId,
      data: { custom: true }
    }));
    const result = await runtime.routeAction({ sourceId: 'community', actionId: 'reload' });
    expect(result.data).toEqual({ custom: true });
  });
});

describe('isolation between source contexts', () => {
  it('two origins get distinct partitions, pages, histories and cookie jars', async () => {
    const runtime = createSourceRuntime();
    const communityPage = new MemorySourcePage(communitySite());
    const paperPage = new MemorySourcePage(paperSite());
    await runtime.createContext(HN_ORIGIN, { sourceId: 'community', page: communityPage, initialUrl: `${HN_ORIGIN}/` });
    await runtime.createContext(PAPER_ORIGIN, { sourceId: 'paper', page: paperPage, initialUrl: `${PAPER_ORIGIN}/` });

    const a = runtime.getContext('community')!;
    const b = runtime.getContext('paper')!;
    expect(a.partitionId).not.toBe(b.partitionId);
    expect(a.page).not.toBe(b.page);

    // Sign in on one; the other must know nothing about it.
    communityPage.simulateLoginCookie('session', 'only-here');
    expect(communityPage.hasCookie('session')).toBe(true);
    expect(paperPage.hasCookie('session')).toBe(false);

    // Navigate one; the other's history is untouched.
    const home = await runtime.projectSemantic('paper');
    const more = home.elements!.find((e) => e.label === '더 보기')!;
    const moved = await runtime.routeAction({ sourceId: 'paper', actionId: more.actionId });
    expect(moved.ok).toBe(true);
    expect(paperPage.url).toBe(`${PAPER_ORIGIN}/tech?page=2`);
    expect(communityPage.url).toBe(`${HN_ORIGIN}/`);
    expect(communityPage.canGoBack()).toBe(false);

    // An actionId from one context means nothing to the other.
    const cross = await runtime.routeAction({ sourceId: 'community', actionId: more.actionId });
    expect(cross.ok).toBe(false);
  });

  it('destroying one context leaves the other fully usable', async () => {
    const runtime = createSourceRuntime();
    await runtime.createContext(HN_ORIGIN, { sourceId: 'community', page: new MemorySourcePage(communitySite()), initialUrl: `${HN_ORIGIN}/` });
    await runtime.createContext(PAPER_ORIGIN, { sourceId: 'paper', page: new MemorySourcePage(paperSite()), initialUrl: `${PAPER_ORIGIN}/` });
    await runtime.destroyContext('community');
    expect(runtime.getContext('community')).toBeUndefined();
    const res = await runtime.routeAction({ sourceId: 'community', actionId: 'reload' });
    expect(res.ok).toBe(false);
    expect(res.invalidation?.reason).toBe('context-destroyed');
    const paper = await runtime.projectSemantic('paper');
    expect(paper.items.length).toBeGreaterThan(0);
  });
});

describe('auth-required from a page and refresh after login', () => {
  it('lands on a login page → auth-required event → login in the same session → fresh projection', async () => {
    const { runtime, page } = await communityContext();
    const events: { sourceId: string; loginUrl?: string; partitionId: string }[] = [];
    runtime.onAuthRequired((e) => events.push(e));

    const home = await runtime.projectSemantic('community');
    const threads = home.elements!.find((e) => e.label === 'threads')!;
    const gated = await runtime.routeAction({ sourceId: 'community', actionId: threads.actionId });

    expect(gated.ok).toBe(true);
    expect(gated.projection?.authRequired).toBe(true);
    expect(gated.projection?.url).toBe(`${HN_ORIGIN}/login`);
    expect(events).toHaveLength(1);
    expect(events[0]!.loginUrl).toBe(`${HN_ORIGIN}/login`);
    expect(events[0]!.partitionId).toBe(runtime.getContext('community')!.partitionId);
    expect(runtime.getContext('community')!.authStatus).toBe('required');
    expect(JSON.stringify(events)).not.toMatch(/cookie|password/i);

    // The Login Rail shares the partition: signing in there sets the cookie
    // this page will send on its next load.
    page.simulateLoginCookie('session', 'rail-issued');
    const after = await runtime.reportAuthSuccess('community');

    expect(runtime.getContext('community')!.authStatus).toBe('authenticated');
    expect(after).not.toBeNull();
    expect(after!.authRequired).toBe(false);
    // Back at the front page, the gated link now works.
    const again = await runtime.routeAction({
      sourceId: 'community',
      actionId: after!.elements!.find((e) => e.label === 'threads')!.actionId
    });
    expect(again.ok).toBe(true);
    expect(again.projection?.url).toBe(`${HN_ORIGIN}/threads`);
    expect(again.projection?.items.map((i) => i.title)).toContain('Your reply on the AI chip thread');
  });
});

describe('IPC serialization boundary for sourceAction', () => {
  it('IPC sourceAction handler returns requiresConfirmation: true when an unconfirmed destructive action is invoked', async () => {
    const { runtime, page } = await communityContext();
    page.simulateLoginCookie('session', 'x');
    await page.loadURL(`${HN_ORIGIN}/threads`);
    const projection = await runtime.projectSemantic('community');
    const del = projection.elements!.find((e) => e.label === 'delete comment')!;
    expect(del.destructive).toBe(true);

    const rpcReq: SourceActionRpcRequest = {
      sourceId: 'community',
      actionId: del.actionId
    };
    // Simulate IPC bridge serialization
    const wireReq = JSON.parse(JSON.stringify(rpcReq));
    const rawResult = await handleSourceAction(runtime, wireReq);
    const result: SourceActionRpcResult = JSON.parse(JSON.stringify(rawResult));

    expect(result.ok).toBe(false);
    expect(result.requiresConfirmation).toBe(true);
    expect(result.sourceId).toBe('community');
    expect(result.actionId).toBe(del.actionId);
    expect(result.error).toContain('확인이 필요해요');

    // Resending with confirmed: true passes through IPC
    const confirmedReq: SourceActionRpcRequest = {
      sourceId: 'community',
      actionId: del.actionId,
      confirmed: true
    };
    const confirmedWire = JSON.parse(JSON.stringify(confirmedReq));
    const confirmedRaw = await handleSourceAction(runtime, confirmedWire);
    const confirmedResult: SourceActionRpcResult = JSON.parse(JSON.stringify(confirmedRaw));
    expect(confirmedResult.ok).toBe(true);
  });

  it('IPC sourceAction handler returns invalidation: { reason: "stale-projection" } when expectedProjectionId mismatches', async () => {
    const { runtime } = await communityContext();
    const first = await runtime.projectSemantic('community');
    const more = first.elements!.find((e) => e.label === 'More')!;
    await runtime.routeAction({ sourceId: 'community', actionId: more.actionId });

    const rpcReq: SourceActionRpcRequest = {
      sourceId: 'community',
      actionId: more.actionId,
      expectedProjectionId: first.projectionId
    };
    // Simulate IPC bridge serialization
    const wireReq = JSON.parse(JSON.stringify(rpcReq));
    const rawResult = await handleSourceAction(runtime, wireReq);
    const result: SourceActionRpcResult = JSON.parse(JSON.stringify(rawResult));

    expect(result.ok).toBe(false);
    expect(result.invalidation).toBeDefined();
    expect(result.invalidation?.reason).toBe('stale-projection');
    expect(result.invalidation?.projectionId).toBe(first.projectionId);
  });

  it('IPC sourceAction handler returns error when request format is invalid', async () => {
    const { runtime } = await communityContext();
    const rawResult = await handleSourceAction(runtime, { invalid: 'payload' });
    const result: SourceActionRpcResult = JSON.parse(JSON.stringify(rawResult));

    expect(result.ok).toBe(false);
    expect(result.error).toBe('잘못된 액션 요청이에요.');
  });

  it('types allow window.prism.sourceAction to accept confirmed and expectedProjectionId and return requiresConfirmation and invalidation', async () => {
    // Type-level compile check for window.prism.sourceAction signature
    type SourceActionFn = (req: SourceActionRpcRequest) => Promise<SourceActionRpcResult>;
    const callSourceAction: SourceActionFn = async (req) => {
      const result: SourceActionRpcResult = {
        ok: false,
        sourceId: req.sourceId,
        actionId: req.actionId,
        requiresConfirmation: req.confirmed !== true,
        invalidation: req.expectedProjectionId
          ? { reason: 'stale-projection', projectionId: req.expectedProjectionId, message: 'stale' }
          : undefined
      };
      return result;
    };

    const res = await callSourceAction({
      sourceId: 'community',
      actionId: 'submit:1',
      confirmed: true,
      expectedProjectionId: 'proj-xyz'
    });

    expect(res.requiresConfirmation).toBe(false);
    expect(res.invalidation?.reason).toBe('stale-projection');
  });
});

