import type { SourceItemKind } from '@shared/domain/sourceItem';

/**
 * A page inside a hidden source session, seen through the narrowest useful
 * interface: navigate, snapshot the actionable structure, act on an element
 * by index. Electron backs it with a WebContentsView in the context's
 * partition; tests back it with an in-memory document set. Either way the
 * cookies, storage and scripts of the page never cross this interface.
 */
export interface RawPageElement {
  kind: 'link' | 'button' | 'input' | 'form';
  label: string;
  /** Links: absolute href. Buttons/forms in the memory page: where they lead. */
  href?: string;
  inputType?: string;
  /** Current value; NEVER filled for password inputs. */
  value?: string;
  disabled?: boolean;
  /** Memory page only: what kind of item a link represents. */
  itemKind?: SourceItemKind;
  summary?: string;
  /** Memory page only: navigating here on click/submit. */
  target?: string;
}

export interface PageSnapshot {
  url: string;
  title: string;
  elements: RawPageElement[];
  /** A password field is on the page — the strongest "please log in" signal. */
  hasPasswordField: boolean;
}

export interface SourcePage {
  readonly url: string;
  loadURL(url: string): Promise<void>;
  goBack(): Promise<void>;
  goForward(): Promise<void>;
  reload(): Promise<void>;
  canGoBack(): boolean;
  canGoForward(): boolean;
  snapshot(): Promise<PageSnapshot>;
  /** Act on an element by its index in the LAST snapshot. */
  click(index: number): Promise<void>;
  setInput(index: number, value: string): Promise<void>;
  submit(index: number): Promise<void>;
  destroy(): Promise<void>;
}

/** One document of an in-memory site, keyed by absolute URL. */
export interface MemoryDocument {
  title: string;
  elements: RawPageElement[];
  /** Serving this document requires this cookie; otherwise `loginUrl` is served. */
  requiresCookie?: string;
  loginUrl?: string;
  /** Loading this document (e.g. after a login form submit) sets these cookies. */
  setsCookies?: Record<string, string>;
}

export interface MemorySite {
  documents: Record<string, MemoryDocument>;
}

/**
 * Test double for SourcePage with a real (tiny) navigation model: a history
 * stack, cookie-gated documents and forms that set cookies when submitted.
 * The cookie jar is private — it is the thing the tests prove never leaks.
 */
export class MemorySourcePage implements SourcePage {
  private history: string[] = [];
  private cursor = -1;
  private readonly jar = new Map<string, string>();
  private inputs = new Map<number, string>();
  private lastElements: RawPageElement[] = [];
  private destroyed = false;
  /** Every URL that was ever loaded, for tests that assert navigation. */
  readonly loads: string[] = [];

  constructor(private readonly site: MemorySite) {}

  get url(): string {
    return this.cursor >= 0 ? (this.history[this.cursor] ?? '') : '';
  }

  /** Test-only: prove isolation — the jar is never part of any snapshot. */
  hasCookie(name: string): boolean {
    return this.jar.has(name);
  }

  /** Test-only: the Login Rail sharing this partition signs the user in. */
  simulateLoginCookie(name: string, value: string): void {
    this.jar.set(name, value);
  }

  private resolve(url: string): { url: string; doc: MemoryDocument } {
    const doc = this.site.documents[url];
    if (!doc) throw new Error(`memory page: no document at ${url}`);
    if (doc.requiresCookie && !this.jar.has(doc.requiresCookie)) {
      const loginUrl = doc.loginUrl ?? url;
      const login = this.site.documents[loginUrl];
      if (!login) throw new Error(`memory page: no login document at ${loginUrl}`);
      return { url: loginUrl, doc: login };
    }
    return { url, doc };
  }

  private assertAlive(): void {
    if (this.destroyed) throw new Error('memory page: destroyed');
  }

  async loadURL(url: string): Promise<void> {
    this.assertAlive();
    const { url: served, doc } = this.resolve(url);
    if (doc.setsCookies) for (const [k, v] of Object.entries(doc.setsCookies)) this.jar.set(k, v);
    this.history = this.history.slice(0, this.cursor + 1);
    this.history.push(served);
    this.cursor = this.history.length - 1;
    this.inputs.clear();
    this.loads.push(served);
  }

  async goBack(): Promise<void> {
    this.assertAlive();
    if (this.cursor > 0) {
      this.cursor -= 1;
      this.inputs.clear();
      this.loads.push(this.url);
    }
  }

  async goForward(): Promise<void> {
    this.assertAlive();
    if (this.cursor < this.history.length - 1) {
      this.cursor += 1;
      this.inputs.clear();
      this.loads.push(this.url);
    }
  }

  async reload(): Promise<void> {
    this.assertAlive();
    if (this.url) this.loads.push(this.url);
    this.inputs.clear();
  }

  canGoBack(): boolean {
    return this.cursor > 0;
  }

  canGoForward(): boolean {
    return this.cursor < this.history.length - 1;
  }

  async snapshot(): Promise<PageSnapshot> {
    this.assertAlive();
    if (!this.url) return { url: '', title: '', elements: [], hasPasswordField: false };
    const doc = this.site.documents[this.url];
    if (!doc) return { url: this.url, title: '', elements: [], hasPasswordField: false };
    const elements = doc.elements.map((el, i) => {
      const value = this.inputs.get(i);
      return value === undefined ? { ...el } : { ...el, value };
    });
    this.lastElements = elements;
    return {
      url: this.url,
      title: doc.title,
      elements,
      hasPasswordField: elements.some((e) => e.kind === 'input' && e.inputType === 'password')
    };
  }

  private elementAt(index: number, kinds: RawPageElement['kind'][]): RawPageElement {
    const el = this.lastElements[index];
    if (!el) throw new Error(`memory page: no element #${index} in the last snapshot`);
    if (!kinds.includes(el.kind)) throw new Error(`memory page: element #${index} is a ${el.kind}`);
    if (el.disabled) throw new Error(`memory page: element #${index} is disabled`);
    return el;
  }

  async click(index: number): Promise<void> {
    this.assertAlive();
    const el = this.elementAt(index, ['link', 'button']);
    const to = el.kind === 'link' ? el.href : el.target;
    if (to) await this.loadURL(to);
  }

  async setInput(index: number, value: string): Promise<void> {
    this.assertAlive();
    this.elementAt(index, ['input']);
    this.inputs.set(index, value);
  }

  async submit(index: number): Promise<void> {
    this.assertAlive();
    const el = this.elementAt(index, ['form']);
    if (el.target) await this.loadURL(el.target);
  }

  async destroy(): Promise<void> {
    this.destroyed = true;
    this.jar.clear();
    this.inputs.clear();
  }
}
