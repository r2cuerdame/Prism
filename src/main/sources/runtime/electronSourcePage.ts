import { WebContentsView, shell, type WebContents } from 'electron';
import { isSafeHttpUrl } from '../../originalViewer';
import type { PageSnapshot, RawPageElement, SourcePage } from './sourcePage';

/**
 * Runs INSIDE the hidden source page and returns only typed structure. It is a
 * fixed constant — never composed from LLM or renderer input — and it tags
 * each element with a stable index so a later click/input can find it again.
 * Password values are never read.
 */
const SNAPSHOT_SCRIPT = `(() => {
  const MAX = 200;
  const out = [];
  const text = (el) => {
    const t = (el.getAttribute('aria-label') || el.innerText || el.textContent || el.getAttribute('placeholder') || el.getAttribute('name') || el.getAttribute('value') || '').replace(/\\s+/g, ' ').trim();
    return t.slice(0, 200);
  };
  const nodes = document.querySelectorAll('a[href], button, input, textarea, select, form, [role="button"]');
  let hasPassword = false;
  let i = 0;
  for (const el of nodes) {
    if (i >= MAX) break;
    const tag = el.tagName.toLowerCase();
    let entry = null;
    if (tag === 'a') {
      let href = '';
      try { href = new URL(el.getAttribute('href'), location.href).href; } catch { href = ''; }
      if (!/^https?:/.test(href)) continue;
      entry = { kind: 'link', label: text(el), href };
    } else if (tag === 'button' || el.getAttribute('role') === 'button') {
      entry = { kind: 'button', label: text(el), disabled: !!el.disabled };
    } else if (tag === 'input' || tag === 'textarea' || tag === 'select') {
      const type = tag === 'input' ? (el.getAttribute('type') || 'text').toLowerCase() : tag;
      if (type === 'hidden') continue;
      if (type === 'password') hasPassword = true;
      if (type === 'submit' || type === 'button') {
        entry = { kind: 'button', label: text(el) || el.value || type, disabled: !!el.disabled };
      } else {
        entry = { kind: 'input', label: text(el), inputType: type, disabled: !!el.disabled };
        if (type !== 'password') entry.value = String(el.value || '').slice(0, 2000);
      }
    } else if (tag === 'form') {
      entry = { kind: 'form', label: text(el).slice(0, 120) || (el.getAttribute('action') || 'form') };
    }
    if (!entry) continue;
    el.setAttribute('data-prism-ix', String(i));
    out.push(entry);
    i += 1;
  }
  return { url: location.href, title: document.title, elements: out, hasPasswordField: hasPassword };
})()`;

const byIndex = (index: number): string => `document.querySelector('[data-prism-ix="${Math.trunc(index)}"]')`;

function waitForLoad(wc: WebContents, timeoutMs: number): Promise<void> {
  return new Promise((resolve) => {
    let done = false;
    const finish = (): void => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      wc.removeListener('did-finish-load', finish);
      wc.removeListener('did-fail-load', finish);
      wc.removeListener('did-stop-loading', finish);
      resolve();
    };
    const timer = setTimeout(finish, timeoutMs);
    wc.once('did-finish-load', finish);
    wc.once('did-fail-load', finish);
    wc.once('did-stop-loading', finish);
  });
}

/**
 * A hidden page inside the context's persistent partition. It is never
 * attached to a window; the same partition string is what the Login Rail
 * opens visibly, so a sign-in there is a sign-in here.
 */
export class ElectronSourcePage implements SourcePage {
  private readonly view: WebContentsView;
  private destroyed = false;

  constructor(
    partitionId: string,
    private readonly origin: string
  ) {
    this.view = new WebContentsView({
      webPreferences: {
        partition: partitionId,
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        webSecurity: true,
        // The hidden page is never shown, so nothing needs to play or animate.
        backgroundThrottling: true
      }
    });
    const wc = this.view.webContents;
    wc.setAudioMuted(true);
    wc.setWindowOpenHandler(({ url }) => {
      if (isSafeHttpUrl(url)) void shell.openExternal(url);
      return { action: 'deny' };
    });
    wc.on('will-navigate', (event, url) => {
      if (!isSafeHttpUrl(url)) event.preventDefault();
    });
  }

  get webContents(): WebContents {
    return this.view.webContents;
  }

  get url(): string {
    return this.destroyed ? '' : this.view.webContents.getURL();
  }

  private assertAlive(): void {
    if (this.destroyed) throw new Error(`source page for ${this.origin} was destroyed`);
  }

  async loadURL(url: string): Promise<void> {
    this.assertAlive();
    if (!isSafeHttpUrl(url)) throw new Error(`refused to load non-http url: ${url}`);
    try {
      await this.view.webContents.loadURL(url);
    } catch {
      /* did-fail-load: the snapshot will show what actually rendered */
    }
  }

  async goBack(): Promise<void> {
    this.assertAlive();
    const nav = this.view.webContents.navigationHistory;
    if (!nav.canGoBack()) return;
    const done = waitForLoad(this.view.webContents, 15_000);
    nav.goBack();
    await done;
  }

  async goForward(): Promise<void> {
    this.assertAlive();
    const nav = this.view.webContents.navigationHistory;
    if (!nav.canGoForward()) return;
    const done = waitForLoad(this.view.webContents, 15_000);
    nav.goForward();
    await done;
  }

  async reload(): Promise<void> {
    this.assertAlive();
    const done = waitForLoad(this.view.webContents, 15_000);
    this.view.webContents.reload();
    await done;
  }

  canGoBack(): boolean {
    return !this.destroyed && this.view.webContents.navigationHistory.canGoBack();
  }

  canGoForward(): boolean {
    return !this.destroyed && this.view.webContents.navigationHistory.canGoForward();
  }

  async snapshot(): Promise<PageSnapshot> {
    this.assertAlive();
    const raw = (await this.view.webContents.executeJavaScript(SNAPSHOT_SCRIPT, true)) as unknown;
    return sanitizeSnapshot(raw, this.url);
  }

  async click(index: number): Promise<void> {
    this.assertAlive();
    const wc = this.view.webContents;
    const done = waitForLoad(wc, 15_000);
    const clicked = (await wc.executeJavaScript(
      `(() => { const el = ${byIndex(index)}; if (!el) return false; el.click(); return true; })()`,
      true
    )) as boolean;
    if (!clicked) throw new Error(`element #${index} is no longer on the page`);
    // Clicks that do not navigate settle on the timeout; that is fine.
    await Promise.race([done, new Promise((r) => setTimeout(r, 1_500))]);
  }

  async setInput(index: number, value: string): Promise<void> {
    this.assertAlive();
    const ok = (await this.view.webContents.executeJavaScript(
      `(() => { const el = ${byIndex(index)}; if (!el) return false;
        const proto = Object.getPrototypeOf(el);
        const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
        if (setter) setter.call(el, ${JSON.stringify(value)}); else el.value = ${JSON.stringify(value)};
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
        return true; })()`,
      true
    )) as boolean;
    if (!ok) throw new Error(`input #${index} is no longer on the page`);
  }

  async submit(index: number): Promise<void> {
    this.assertAlive();
    const wc = this.view.webContents;
    const done = waitForLoad(wc, 15_000);
    const ok = (await wc.executeJavaScript(
      `(() => { const el = ${byIndex(index)}; if (!el || el.tagName !== 'FORM') return false;
        if (typeof el.requestSubmit === 'function') el.requestSubmit(); else el.submit();
        return true; })()`,
      true
    )) as boolean;
    if (!ok) throw new Error(`form #${index} is no longer on the page`);
    await done;
  }

  async destroy(): Promise<void> {
    if (this.destroyed) return;
    this.destroyed = true;
    try {
      this.view.webContents.close();
    } catch {
      /* already closed */
    }
  }
}

/** The page's answer is untrusted: coerce it into the typed snapshot shape. */
export function sanitizeSnapshot(raw: unknown, fallbackUrl: string): PageSnapshot {
  const obj = raw !== null && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const elements: RawPageElement[] = [];
  const list = Array.isArray(obj.elements) ? obj.elements : [];
  for (const e of list.slice(0, 200)) {
    if (e === null || typeof e !== 'object') continue;
    const r = e as Record<string, unknown>;
    const kind = r.kind;
    if (kind !== 'link' && kind !== 'button' && kind !== 'input' && kind !== 'form') continue;
    const el: RawPageElement = {
      kind,
      label: typeof r.label === 'string' ? r.label.slice(0, 200) : ''
    };
    if (typeof r.href === 'string' && isSafeHttpUrl(r.href)) el.href = r.href;
    if (typeof r.inputType === 'string') el.inputType = r.inputType.slice(0, 20);
    if (typeof r.value === 'string' && el.inputType !== 'password') el.value = r.value.slice(0, 2000);
    if (r.disabled === true) el.disabled = true;
    elements.push(el);
  }
  return {
    url: typeof obj.url === 'string' ? obj.url : fallbackUrl,
    title: typeof obj.title === 'string' ? obj.title.slice(0, 200) : '',
    elements,
    hasPasswordField: obj.hasPasswordField === true
  };
}

export function createElectronPageFactory(): (partitionId: string, origin: string) => SourcePage {
  return (partitionId, origin) => new ElectronSourcePage(partitionId, origin);
}
