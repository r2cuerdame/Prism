import { BrowserWindow, shell } from 'electron';

const ALLOWED_PROTOCOLS = new Set(['http:', 'https:']);

export function isSafeHttpUrl(raw: string): boolean {
  try {
    return ALLOWED_PROTOCOLS.has(new URL(raw).protocol);
  } catch {
    return false;
  }
}

/**
 * Original is an escape hatch and trust mechanism, not the primary canvas
 * (GOAL.md § Original). Isolated session partition, zero preload powers.
 */
export function openOriginalWindow(url: string, parent?: BrowserWindow): void {
  if (!isSafeHttpUrl(url)) return;
  const win = new BrowserWindow({
    width: 1100,
    height: 800,
    title: '원본 보기 — GPTBrowser',
    autoHideMenuBar: true,
    parent: parent ?? undefined,
    webPreferences: {
      partition: 'persist:original-viewer',
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });
  win.webContents.setWindowOpenHandler(({ url: target }) => {
    if (isSafeHttpUrl(target)) void shell.openExternal(target);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (event, target) => {
    if (!isSafeHttpUrl(target)) event.preventDefault();
  });
  void win.loadURL(url);
}
