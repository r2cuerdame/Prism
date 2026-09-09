import { useSyncExternalStore } from 'react';
import type { SafeAuthRailState } from '@shared/ipc';

/**
 * The Login Rail's renderer-side mirror. Main owns the truth (the hidden source
 * session knows whether it is signed in); the renderer only ever sees the
 * SafeAuthRailState it is sent — origin, partition id, login URL, status —
 * never a cookie, token or password (GOAL.md § Optional Original-site viewer).
 *
 * Kept apart from the session store on purpose: the rail is transient chrome
 * over the page, not part of any Session's state or history.
 */
export interface AuthRailView {
  state: SafeAuthRailState | null;
  /** Renderer-only: the user pressed "완료" and main is re-projecting. */
  completing: boolean;
  /** Last error from a rail action, shown inside the rail. */
  error: string | null;
}

type Listener = () => void;

const bridge = (): typeof window.prism => window.prism ?? window.gptb;

class AuthRailStore {
  private view: AuthRailView = { state: null, completing: false, error: null };
  private listeners = new Set<Listener>();
  private unsubscribe: (() => void) | null = null;

  get = (): AuthRailView => this.view;

  subscribe = (l: Listener): (() => void) => {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  };

  private set(patch: Partial<AuthRailView>): void {
    this.view = { ...this.view, ...patch };
    for (const l of this.listeners) l();
  }

  /** Idempotent: subscribes once to main's rail-state events. */
  init(): void {
    if (this.unsubscribe) return;
    const api = bridge();
    if (!api || typeof api.onAuthRailState !== 'function') return;
    this.unsubscribe = api.onAuthRailState((state) => {
      // A fresh state from main supersedes any renderer-side transient flags.
      this.set({ state, completing: false, error: null });
    });
  }

  /** Test seam and manual open (e.g. a projection said the source wants a login). */
  async open(req: { sourceId: string; origin?: string; loginUrl?: string; title?: string }): Promise<void> {
    const res = await bridge().authRailOpen(req);
    if (!res.ok) this.set({ error: res.error ?? '로그인 레일을 열지 못했어요.' });
  }

  /** Opens the real login surface: same partition as the hidden source tab. */
  async launch(): Promise<void> {
    const s = this.view.state;
    if (!s) return;
    this.set({ error: null });
    await bridge().authRailLaunchSurface(s.sourceId);
  }

  /** The user says they finished signing in: main re-projects and collapses the rail. */
  async complete(): Promise<void> {
    const s = this.view.state;
    if (!s) return;
    this.set({ completing: true, error: null });
    const res = await bridge().authRailComplete(s.sourceId);
    if (!res.ok) this.set({ completing: false, error: res.error ?? '로그인 확인에 실패했어요.' });
  }

  async dismiss(): Promise<void> {
    const s = this.view.state;
    if (!s) return;
    await bridge().authRailClose(s.sourceId);
    // Main echoes null; clear eagerly so the rail never lingers on a slow IPC.
    this.set({ state: null, completing: false, error: null });
  }
}

export const authRailStore = new AuthRailStore();

export function useAuthRail(): AuthRailView {
  return useSyncExternalStore(authRailStore.subscribe, authRailStore.get);
}
