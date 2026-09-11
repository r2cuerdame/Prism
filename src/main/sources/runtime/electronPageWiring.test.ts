import { describe, expect, it, vi } from 'vitest';

const HN_URL = 'https://news.ycombinator.com/';

// vi.mock factories are hoisted above the imports, so anything they close over
// has to be hoisted with them or it is still in its temporal dead zone.
const { loadURL } = vi.hoisted(() => ({ loadURL: vi.fn(async () => undefined) }));

// Scoped to this file on purpose: every other runtime test injects a
// MemorySourcePage and relies on `electron` resolving to a plain string under
// Node. This is the one test that needs the real Electron page class to be
// constructible, so it is the only file that mocks the module.
vi.mock('electron', () => {
  class FakeWebContentsView {
    webContents = {
      setAudioMuted: vi.fn(),
      setWindowOpenHandler: vi.fn(),
      on: vi.fn(),
      once: vi.fn(),
      removeListener: vi.fn(),
      loadURL,
      getURL: () => HN_URL,
      navigationHistory: {
        canGoBack: () => false,
        canGoForward: () => false,
        goBack: vi.fn(),
        goForward: vi.fn()
      },
      executeJavaScript: vi.fn(async () => ({
        url: HN_URL,
        title: 'Hacker News',
        elements: [],
        hasPasswordField: false
      })),
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
    app: { getPath: vi.fn(() => '/tmp/prism-test') },
    ipcMain: { handle: vi.fn(), on: vi.fn() },
    BrowserWindow: class {}
  };
});

// ipcHandlers pulls in the updater; mirror sourceActions.test.ts.
vi.mock('electron-updater', () => ({
  default: {
    autoUpdater: {
      on: vi.fn(),
      checkForUpdates: vi.fn(),
      quitAndInstall: vi.fn()
    }
  }
}));

import { createMainSourceRuntime } from '../../ipcHandlers';
import { ElectronSourcePage } from './electronSourcePage';

describe('production source runtime wiring', () => {
  it('backs a context with an ElectronSourcePage and loads the initial url', async () => {
    const runtime = createMainSourceRuntime();
    const ctx = await runtime.createContext('https://news.ycombinator.com', {
      sourceId: 'wired-page',
      initialUrl: HN_URL
    });

    expect(ctx.page).toBeInstanceOf(ElectronSourcePage);
    expect(loadURL).toHaveBeenCalledWith(HN_URL);
  });

  it('offers the navigation actions, which exist only when a page is wired', async () => {
    const runtime = createMainSourceRuntime();
    await runtime.createContext('https://news.ycombinator.com', {
      sourceId: 'wired-actions',
      initialUrl: HN_URL
    });

    const projection = await runtime.projectSemantic('wired-actions');

    expect(projection.availableActions.map((a) => a.actionId)).toEqual(
      expect.arrayContaining(['navigate', 'back', 'forward', 'reload'])
    );
  });
});
