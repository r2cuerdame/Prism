import { describe, expect, it, vi, beforeEach } from 'vitest';

const {
  mockLoadURL,
  mockClose,
  mockExecuteJavaScript,
  mockOnce,
  mockRemoveListener,
  mockCanGoBack,
  mockCanGoForward,
  mockGoBack,
  mockGoForward,
  mockReload
} = vi.hoisted(() => ({
  mockLoadURL: vi.fn(),
  mockClose: vi.fn(),
  mockExecuteJavaScript: vi.fn(),
  mockOnce: vi.fn(),
  mockRemoveListener: vi.fn(),
  mockCanGoBack: vi.fn(() => false),
  mockCanGoForward: vi.fn(() => false),
  mockGoBack: vi.fn(),
  mockGoForward: vi.fn(),
  mockReload: vi.fn()
}));

vi.mock('electron', () => {
  class FakeWebContentsView {
    webContents = {
      setAudioMuted: vi.fn(),
      setWindowOpenHandler: vi.fn(),
      on: vi.fn(),
      once: mockOnce,
      removeListener: mockRemoveListener,
      loadURL: mockLoadURL,
      getURL: vi.fn(() => 'https://example.com/page'),
      navigationHistory: {
        canGoBack: mockCanGoBack,
        canGoForward: mockCanGoForward,
        goBack: mockGoBack,
        goForward: mockGoForward
      },
      executeJavaScript: mockExecuteJavaScript,
      reload: mockReload,
      close: mockClose
    };
    constructor(_options: unknown) {}
  }

  return {
    WebContentsView: FakeWebContentsView,
    shell: { openExternal: vi.fn() }
  };
});

import { ElectronSourcePage } from './electronSourcePage';

describe('ElectronSourcePage navigation and lifecycle', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockLoadURL.mockResolvedValue(undefined);
    mockOnce.mockImplementation((_event, fn) => {
      if (typeof fn === 'function') setTimeout(fn, 0);
    });
    mockExecuteJavaScript.mockResolvedValue({
      url: 'https://example.com/page',
      title: 'Example Page',
      elements: [],
      hasPasswordField: false
    });
  });

  it('resolves cleanly when loadURL succeeds', async () => {
    const page = new ElectronSourcePage('persist:test-partition', 'https://example.com');
    await expect(page.loadURL('https://example.com/page')).resolves.toBeUndefined();
    expect(mockLoadURL).toHaveBeenCalledWith('https://example.com/page');
  });

  it('rejects when given an unsafe or non-http url', async () => {
    const page = new ElectronSourcePage('persist:test-partition', 'https://example.com');
    await expect(page.loadURL('javascript:alert(1)')).rejects.toThrow(
      'refused to load non-http url: javascript:alert(1)'
    );
    await expect(page.loadURL('ftp://files.example.com')).rejects.toThrow(
      'refused to load non-http url: ftp://files.example.com'
    );
  });

  it('resolves cleanly on navigation timeout rather than hanging indefinitely', async () => {
    const page = new ElectronSourcePage('persist:test-partition', 'https://example.com');

    // Simulate stalled navigation: no load events fire and loadURL promise never settles
    mockOnce.mockImplementation(() => {});
    mockLoadURL.mockImplementation(() => new Promise(() => {}));

    const start = Date.now();
    // Pass a 50ms timeout to prove it bounds stalled navigation
    await page.loadURL('https://example.com/stalled', 50);
    const elapsed = Date.now() - start;

    expect(elapsed).toBeGreaterThanOrEqual(40);
    expect(elapsed).toBeLessThan(200);
  });

  it('resolves cleanly when webContents.loadURL rejects with did-fail-load', async () => {
    const page = new ElectronSourcePage('persist:test-partition', 'https://example.com');
    mockLoadURL.mockRejectedValue(new Error('ERR_CONNECTION_REFUSED'));

    await expect(page.loadURL('https://example.com/failed')).resolves.toBeUndefined();
  });

  it('destroys page cleanly and closes webContents', async () => {
    const page = new ElectronSourcePage('persist:test-partition', 'https://example.com');
    await page.destroy();

    expect(mockClose).toHaveBeenCalledTimes(1);
    expect(page.url).toBe('');
    expect(page.canGoBack()).toBe(false);
    expect(page.canGoForward()).toBe(false);

    // Subsequent actions throw assertion error
    await expect(page.loadURL('https://example.com')).rejects.toThrow(
      'source page for https://example.com was destroyed'
    );
  });

  it('delegates navigation actions to webContents history', async () => {
    const page = new ElectronSourcePage('persist:test-partition', 'https://example.com');
    mockCanGoBack.mockReturnValue(true);
    mockCanGoForward.mockReturnValue(true);

    expect(page.canGoBack()).toBe(true);
    expect(page.canGoForward()).toBe(true);

    await page.goBack();
    expect(mockGoBack).toHaveBeenCalledTimes(1);

    await page.goForward();
    expect(mockGoForward).toHaveBeenCalledTimes(1);

    await page.reload();
    expect(mockReload).toHaveBeenCalledTimes(1);
  });
});
