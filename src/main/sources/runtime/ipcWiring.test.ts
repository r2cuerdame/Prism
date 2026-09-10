import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';

const { loadURL, executeJavaScript } = vi.hoisted(() => ({
  loadURL: vi.fn(async () => undefined),
  executeJavaScript: vi.fn(async () => ({
    url: 'https://news.fixture.local/article/1-1',
    title: '픽스처 뉴스',
    elements: [
      { kind: 'link', label: 'More Articles', href: 'https://news.fixture.local/article/1-2' },
      { kind: 'button', label: 'Refresh', actionId: 'refresh' }
    ],
    hasPasswordField: false
  }))
}));

const handlers = new Map<string, (event: unknown, ...args: unknown[]) => Promise<unknown> | unknown>();

vi.mock('electron', () => {
  class FakeWebContentsView {
    webContents = {
      setAudioMuted: vi.fn(),
      setWindowOpenHandler: vi.fn(),
      on: vi.fn(),
      once: vi.fn(),
      removeListener: vi.fn(),
      loadURL,
      getURL: vi.fn(() => 'https://news.fixture.local/article/1-1'),
      navigationHistory: {
        canGoBack: () => false,
        canGoForward: () => false,
        goBack: vi.fn(),
        goForward: vi.fn()
      },
      executeJavaScript,
      reload: vi.fn(),
      close: vi.fn()
    };
    constructor(_options: unknown) {}
  }

  return {
    WebContentsView: FakeWebContentsView,
    shell: { openExternal: vi.fn() },
    session: {
      fromPartition: vi.fn(() => ({
        setPermissionRequestHandler: vi.fn(),
        setPermissionCheckHandler: vi.fn()
      }))
    },
    app: {
      getPath: vi.fn(() => os.tmpdir()),
      getVersion: vi.fn(() => '0.1.0')
    },
    ipcMain: {
      handle: vi.fn((channel: string, handler: (event: unknown, ...args: unknown[]) => Promise<unknown> | unknown) => {
        handlers.set(channel, handler);
      }),
      on: vi.fn()
    },
    BrowserWindow: class FakeBrowserWindow {}
  };
});

vi.mock('electron-updater', () => ({
  default: {
    autoUpdater: {
      on: vi.fn(),
      checkForUpdates: vi.fn(),
      quitAndInstall: vi.fn()
    }
  }
}));

vi.mock('../../llm/gptAuth', () => ({
  detectAuth: vi.fn(async () => ({ method: 'none' as const, detail: 'offline test' })),
  runOauthLogin: vi.fn()
}));

vi.mock('../../llm/agyStatus', () => ({
  detectAgy: vi.fn(async () => ({ ready: false, detail: 'offline test' }))
}));

import { registerIpcHandlers } from '../../ipcHandlers';
import { FIXTURE_ADAPTERS } from '../../e2e/fixtureAdapters';
import { IPC, type GenerateResponse, type RegenerateBlockResponse, type SafeAuthRailState } from '@shared/ipc';
import type { SemanticProjection, SourceActionResult } from '@shared/domain/projection';
import { getCatalogEntry } from '@shared/catalog/catalog';

describe('Integrated IPC wiring for SourceRuntime and Login Rail (#16)', () => {
  let tmpDataDir: string;
  const sentToRenderer: Array<{ channel: string; payload: unknown }> = [];

  const mockWindow = {
    isDestroyed: () => false,
    webContents: {
      send: (channel: string, payload: unknown) => {
        sentToRenderer.push({ channel, payload });
      }
    }
  };

  let mainServices: ReturnType<typeof registerIpcHandlers>;

  beforeEach(async () => {
    handlers.clear();
    sentToRenderer.length = 0;
    tmpDataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'prism-ipc-wiring-'));

    mainServices = registerIpcHandlers(() => mockWindow as unknown as import('electron').BrowserWindow, {
      dataDir: tmpDataDir,
      adapters: FIXTURE_ADAPTERS,
      adapterContext: {
        http: {
          getText: async () => {
            throw new Error('offline test');
          },
          getJson: async () => {
            throw new Error('offline test');
          }
        },
        now: () => new Date('2026-09-10T00:00:00.000Z')
      }
    });
  });

  afterEach(async () => {
    await fs.rm(tmpDataDir, { recursive: true, force: true });
    vi.clearAllMocks();
  });

  it('lazily creates source contexts on-demand and completes IPC.generate without awaiting hidden page loads', async () => {
    const generateHandler = handlers.get(IPC.generate);
    expect(generateHandler).toBeDefined();

    // Stub a delayed loadURL to prove IPC.generate does not await page loads
    loadURL.mockImplementationOnce(() => new Promise<undefined>((resolve) => setTimeout(() => resolve(undefined), 300)));

    const start = Date.now();
    // 1. Run generation via the real IPC handler
    const rawGenRes = await generateHandler!(
      {},
      {
        sessionId: 'ses_wiring_test',
        rawInput: 'AI 반도체 트렌드',
        priorInterpretation: null,
        preserved: { dockedBlocks: [] },
        hints: { mix: {}, notes: [] },
        keepItems: [],
        recipeContext: null,
        refillShape: null
      }
    );
    const elapsed = Date.now() - start;
    // Delayed loadURL (300ms) was not awaited on the critical path of generate
    expect(elapsed).toBeLessThan(150);

    const genRes = rawGenRes as GenerateResponse;
    expect(genRes.ok).toBe(true);
    expect(genRes.items.length).toBeGreaterThan(0);

    // Contexts are NOT eagerly created during generate, and loadURL was not called
    expect(mainServices.sourceRuntime?.listContexts().length).toBe(0);
    expect(loadURL).not.toHaveBeenCalled();

    const firstItem = genRes.items[0];
    expect(firstItem.sourceId).toBeTruthy();
    expect(firstItem.originalUrl).toBeTruthy();

    // 2. Drive IPC.sourceProject using the gathered item's sourceId -> lazily creates context
    const projectHandler = handlers.get(IPC.sourceProject);
    expect(projectHandler).toBeDefined();

    const projection = (await projectHandler!({}, firstItem.sourceId)) as SemanticProjection;
    expect(projection).toBeDefined();
    expect(projection.sourceId).toBe(firstItem.sourceId);
    expect(projection.projectionId).toBeTruthy();
    expect(projection.origin).toBeDefined();

    // Context now exists in runtime
    expect(mainServices.sourceRuntime?.getContext(firstItem.sourceId)).toBeDefined();

    // 3. Drive IPC.sourceProject using the gathered item's original URL
    const projectionByUrl = (await projectHandler!({}, firstItem.originalUrl)) as SemanticProjection;
    expect(projectionByUrl).toBeDefined();
    expect(projectionByUrl.origin).toBe(projection.origin);
    // Does not duplicate context
    expect(mainServices.sourceRuntime?.listContexts().length).toBe(1);

    // 4. Drive IPC.sourceAction on the gathered source
    const actionHandler = handlers.get(IPC.sourceAction);
    expect(actionHandler).toBeDefined();

    const actionRes = (await actionHandler!(
      {},
      {
        sourceId: firstItem.sourceId,
        actionId: 'navigate',
        payload: { url: 'https://news.fixture.local/article/1-2' }
      }
    )) as SourceActionResult;

    expect(actionRes.ok).toBe(true);
    expect(actionRes.sourceId).toBe(firstItem.sourceId);
    expect(actionRes.invalidation?.reason).not.toBe('context-destroyed');
  });

  it('lazily resolves and creates context when IPC.sourceProject is invoked directly with a valid origin', async () => {
    const projectHandler = handlers.get(IPC.sourceProject);
    expect(projectHandler).toBeDefined();

    const directOrigin = 'https://lazy-source.example.com';
    const projection = (await projectHandler!({}, directOrigin)) as SemanticProjection;
    expect(projection).toBeDefined();
    expect(projection.origin).toBe(directOrigin);

    // Completely unknown/invalid id with no origin characteristics throws standard error
    await expect(projectHandler!({}, 'unknown_non_existent_source')).rejects.toThrow(
      'Cannot project semantic data: source context "unknown_non_existent_source" not found'
    );
  });

  it('drives evAuthRailState to the renderer when source reports authRequired', async () => {
    executeJavaScript.mockResolvedValueOnce({
      url: 'https://auth-needed.example.com/login',
      title: 'Login Required Page',
      elements: [],
      hasPasswordField: true
    });

    const projectHandler = handlers.get(IPC.sourceProject);
    expect(projectHandler).toBeDefined();

    const projection = (await projectHandler!(
      {},
      'https://auth-needed.example.com/login'
    )) as SemanticProjection;
    expect(projection.authRequired).toBe(true);

    // Verify IPC event was emitted to renderer window with correct safe auth state
    const authEvent = sentToRenderer.find((e) => e.channel === IPC.evAuthRailState);
    expect(authEvent).toBeDefined();
    const state = authEvent!.payload as SafeAuthRailState;
    expect(state.active).toBe(true);
    expect(state.status).toBe('required');
    expect(state.origin).toBe('https://auth-needed.example.com');
    expect(state.partitionId).toMatch(/^persist:prism-source-auth-needed-example-com-/);
    expect(state.loginUrl).toBe('https://auth-needed.example.com/login');
  });

  it('ensures source contexts during IPC.regenerateBlock as well', async () => {
    const generateHandler = handlers.get(IPC.generate);
    const regenHandler = handlers.get(IPC.regenerateBlock);
    const projectHandler = handlers.get(IPC.sourceProject);

    const rawGen = await generateHandler!(
      {},
      {
        sessionId: 'ses_regen_test',
        rawInput: '전기차 보조금',
        priorInterpretation: null,
        preserved: { dockedBlocks: [] },
        hints: { mix: {}, notes: [] },
        keepItems: [],
        recipeContext: null,
        refillShape: null
      }
    );
    const genRes = rawGen as GenerateResponse;
    expect(genRes.ok).toBe(true);

    const block = genRes.plan!.blocks.find((b) => {
      const entry = getCatalogEntry(b.componentType);
      return entry && (entry.acceptsKinds === null || entry.acceptsKinds.length > 0);
    })!;
    expect(block).toBeDefined();

    const rawRegen = await regenHandler!(
      {},
      {
        sessionId: 'ses_regen_test',
        interpretation: genRes.interpretation!,
        block,
        excludeUrls: []
      }
    );
    const regenRes = rawRegen as RegenerateBlockResponse;
    expect(regenRes.ok).toBe(true);
    expect(regenRes.items.length).toBeGreaterThan(0);

    const regenItem = regenRes.items[0];
    const projection = (await projectHandler!({}, regenItem.sourceId)) as SemanticProjection;
    expect(projection).toBeDefined();
    expect(projection.sourceId).toBe(regenItem.sourceId);
  });

  it('does not collapse distinct sources or channels sharing an origin onto an arbitrary context', async () => {
    const projectHandler = handlers.get(IPC.sourceProject);
    const actionHandler = handlers.get(IPC.sourceAction);

    // Directly create two distinct channel contexts sharing an origin
    const origin = 'https://news.fixture.local';
    await mainServices.sourceRuntime?.createContext(origin, {
      sourceId: 'channel-alpha',
      sourceName: 'Channel Alpha'
    });
    await mainServices.sourceRuntime?.createContext(origin, {
      sourceId: 'channel-beta',
      sourceName: 'Channel Beta'
    });

    const projAlpha = (await projectHandler!({}, 'channel-alpha')) as SemanticProjection;
    const projBeta = (await projectHandler!({}, 'channel-beta')) as SemanticProjection;

    expect(projAlpha.sourceId).toBe('channel-alpha');
    expect(projBeta.sourceId).toBe('channel-beta');

    // handleSourceAction preserves requested sourceId
    const actionRes = (await actionHandler!(
      {},
      {
        sourceId: 'channel-beta',
        actionId: 'navigate',
        payload: { url: 'https://news.fixture.local/article/1-2' }
      }
    )) as SourceActionResult;

    expect(actionRes.ok).toBe(true);
    expect(actionRes.sourceId).toBe('channel-beta');
  });
});

