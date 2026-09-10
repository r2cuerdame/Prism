import { describe, expect, it, vi, beforeEach } from 'vitest';
import { ElectronSourceRuntime } from './electronSourceRuntime';
import type { SourcePage } from './sourcePage';

describe('ElectronSourceRuntime lifecycle and LRU context management', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const createMockPage = (url = 'https://example.com'): SourcePage => {
    return {
      url,
      loadURL: vi.fn(async () => undefined),
      goBack: vi.fn(async () => undefined),
      goForward: vi.fn(async () => undefined),
      reload: vi.fn(async () => undefined),
      canGoBack: vi.fn(() => false),
      canGoForward: vi.fn(() => false),
      snapshot: vi.fn(async () => ({
        url,
        title: 'Mock Page',
        elements: [],
        hasPasswordField: false
      })),
      click: vi.fn(async () => undefined),
      setInput: vi.fn(async () => undefined),
      submit: vi.fn(async () => undefined),
      destroy: vi.fn(async () => undefined)
    };
  };

  it('evicts least-recently-used contexts when maxContexts cap is exceeded', async () => {
    const pages: SourcePage[] = [];
    const runtime = new ElectronSourceRuntime({
      maxContexts: 3,
      pageFactory: (_part, origin) => {
        const page = createMockPage(origin);
        pages.push(page);
        return page;
      }
    });

    // Create 3 contexts (at capacity)
    const ctx1 = await runtime.createContext('https://source-1.com', { sourceId: 'src-1' });
    const ctx2 = await runtime.createContext('https://source-2.com', { sourceId: 'src-2' });
    const ctx3 = await runtime.createContext('https://source-3.com', { sourceId: 'src-3' });

    expect(runtime.listContexts().length).toBe(3);
    expect(pages.length).toBe(3);

    // Explicitly age src-1 so it is the oldest
    ctx1.lastActiveAt = 1000;
    ctx2.lastActiveAt = 2000;
    ctx3.lastActiveAt = 3000;

    // Access src-1 so it becomes newer than src-2
    ctx1.lastActiveAt = 4000;

    // Create 4th context: should evict src-2 (the oldest)
    const ctx4 = await runtime.createContext('https://source-4.com', { sourceId: 'src-4' });

    expect(ctx4.id).toBe('src-4');
    expect(runtime.listContexts().length).toBe(3);
    expect(runtime.getContext('src-2')).toBeUndefined();
    expect(runtime.getContext('src-1')).toBeDefined();
    expect(runtime.getContext('src-3')).toBeDefined();
    expect(runtime.getContext('src-4')).toBeDefined();

    // The evicted page must have been destroyed (closing its WebContentsView)
    expect(pages[1].destroy).toHaveBeenCalledTimes(1);
    expect(ctx2.isDestroyed).toBe(true);
    expect(pages[0].destroy).not.toHaveBeenCalled();
    expect(pages[2].destroy).not.toHaveBeenCalled();
    expect(pages[3].destroy).not.toHaveBeenCalled();
  });

  it('cleanly destroys all contexts and closes all WebContentsViews on dispose (app quit)', async () => {
    const pages: SourcePage[] = [];
    const runtime = new ElectronSourceRuntime({
      maxContexts: 10,
      pageFactory: (_part, origin) => {
        const page = createMockPage(origin);
        pages.push(page);
        return page;
      }
    });

    const ctxA = await runtime.createContext('https://alpha.com', { sourceId: 'alpha' });
    const ctxB = await runtime.createContext('https://beta.com', { sourceId: 'beta' });
    const ctxC = await runtime.createContext('https://gamma.com', { sourceId: 'gamma' });

    expect(runtime.listContexts().length).toBe(3);

    // App before-quit triggers runtime dispose
    await runtime.dispose();

    expect(runtime.listContexts().length).toBe(0);
    expect(ctxA.isDestroyed).toBe(true);
    expect(ctxB.isDestroyed).toBe(true);
    expect(ctxC.isDestroyed).toBe(true);

    for (const page of pages) {
      expect(page.destroy).toHaveBeenCalledTimes(1);
    }
  });

  it('re-uses non-destroyed context for same origin and sourceId rather than creating duplicate views', async () => {
    let createdCount = 0;
    const runtime = new ElectronSourceRuntime({
      maxContexts: 5,
      pageFactory: (_part, origin) => {
        createdCount++;
        return createMockPage(origin);
      }
    });

    const first = await runtime.createContext('https://reuse.com', { sourceId: 'shared-id' });
    const second = await runtime.createContext('https://reuse.com', { sourceId: 'shared-id' });

    expect(first).toBe(second);
    expect(createdCount).toBe(1);
    expect(runtime.listContexts().length).toBe(1);
  });

  it('destroys single context and unregisters its resources via destroyContext', async () => {
    let pageDestroyed = false;
    const runtime = new ElectronSourceRuntime({
      pageFactory: () => ({
        ...createMockPage(),
        destroy: vi.fn(async () => {
          pageDestroyed = true;
        })
      })
    });

    const ctx = await runtime.createContext('https://solo.com', { sourceId: 'solo' });
    expect(runtime.getContext('solo')).toBeDefined();

    const destroyed = await runtime.destroyContext('solo');
    expect(destroyed).toBe(true);
    expect(ctx.isDestroyed).toBe(true);
    expect(pageDestroyed).toBe(true);
    expect(runtime.getContext('solo')).toBeUndefined();
  });
});
