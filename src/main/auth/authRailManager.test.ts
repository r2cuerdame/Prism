import { describe, expect, it, vi } from 'vitest';
import { createAuthRailManager } from './authRailManager';
import { createSourceRuntime } from '../sources/runtime/electronSourceRuntime';
import * as originalViewer from '../originalViewer';

vi.mock('../originalViewer', () => ({
  openOriginalWindow: vi.fn(),
  isSafeHttpUrl: vi.fn(() => true)
}));

describe('AuthRailManager', () => {
  it('opens login rail and emits safe auth state without secret tokens', async () => {
    const runtime = createSourceRuntime();
    await runtime.createContext('https://news.ycombinator.com', { sourceId: 'hn' });

    const sentEvents: Array<{ channel: string; payload: unknown }> = [];
    const manager = createAuthRailManager({
      sourceRuntime: runtime,
      sendToRenderer: (channel, payload) => sentEvents.push({ channel, payload })
    });

    const state = manager.openRail({
      sourceId: 'hn',
      loginUrl: 'https://news.ycombinator.com/login',
      title: 'Hacker News 로그인'
    });

    expect(state.active).toBe(true);
    expect(state.sourceId).toBe('hn');
    expect(state.origin).toBe('https://news.ycombinator.com');
    expect(state.partitionId).toMatch(/^persist:prism-source-news-ycombinator-com-/);
    expect(state.loginUrl).toBe('https://news.ycombinator.com/login');
    expect(state.title).toBe('Hacker News 로그인');
    expect(state.status).toBe('required');

    expect(sentEvents).toHaveLength(1);
    expect(sentEvents[0].channel).toBe('prism:ev-auth-rail-state');
    expect(sentEvents[0].payload).toEqual(state);
  });

  it('triggers login rail automatically when source context reports auth required', async () => {
    const runtime = createSourceRuntime();
    const ctx = await runtime.createContext('https://reddit.com', { sourceId: 'reddit' });

    const sentEvents: Array<{ channel: string; payload: unknown }> = [];
    const manager = createAuthRailManager({
      sourceRuntime: runtime,
      sendToRenderer: (channel, payload) => sentEvents.push({ channel, payload })
    });

    ctx.reportAuthRequired('https://reddit.com/login', 'Reddit 로그인');

    const state = manager.getState();
    expect(state).not.toBeNull();
    expect(state?.sourceId).toBe('reddit');
    expect(state?.origin).toBe('https://reddit.com');
    expect(state?.partitionId).toMatch(/^persist:prism-source-reddit-com-/);
    expect(state?.status).toBe('required');

    expect(sentEvents).toHaveLength(1);
  });

  it('launches login surface in original window using the SAME persistent partition', async () => {
    const runtime = createSourceRuntime();
    await runtime.createContext('https://youtube.com', { sourceId: 'youtube' });

    const manager = createAuthRailManager({
      sourceRuntime: runtime,
      sendToRenderer: vi.fn()
    });

    const state = manager.openRail({
      sourceId: 'youtube',
      loginUrl: 'https://accounts.google.com',
      title: 'YouTube 로그인'
    });

    manager.launchLoginSurface('youtube');

    expect(originalViewer.openOriginalWindow).toHaveBeenCalledWith(
      'https://accounts.google.com',
      undefined,
      {
        partition: state.partitionId,
        title: 'YouTube 로그인 — Prism'
      }
    );
  });

  it('completes auth, collapses rail, and triggers re-projection', async () => {
    const runtime = createSourceRuntime();
    await runtime.createContext('https://lobste.rs', { sourceId: 'lobsters' });

    let projectCount = 0;
    await runtime.projectSemantic('lobsters', async (c) => {
      projectCount++;
      return {
        projectionId: `proj-${projectCount}`,
        sourceId: c.id,
        origin: c.origin,
        partitionId: c.partitionId,
        timestamp: Date.now(),
        items: [],
        availableActions: []
      };
    });

    const sentEvents: Array<{ channel: string; payload: unknown }> = [];
    const manager = createAuthRailManager({
      sourceRuntime: runtime,
      sendToRenderer: (channel, payload) => sentEvents.push({ channel, payload })
    });

    manager.openRail({ sourceId: 'lobsters' });
    expect(manager.getState()?.active).toBe(true);

    const result = await manager.completeAuth('lobsters');
    expect(result.ok).toBe(true);
    expect(result.status).toBe('authenticated');
    expect(manager.getState()).toBeNull();

    // Re-project was triggered
    expect(projectCount).toBe(2);

    // Collapsed rail state was sent to renderer
    const lastEvent = sentEvents[sentEvents.length - 1];
    expect(lastEvent.payload).toBeNull();
  });

  it('collapses rail when user explicitly closes it', async () => {
    const runtime = createSourceRuntime();
    await runtime.createContext('https://news.ycombinator.com', { sourceId: 'hn' });

    const sentEvents: Array<{ channel: string; payload: unknown }> = [];
    const manager = createAuthRailManager({
      sourceRuntime: runtime,
      sendToRenderer: (channel, payload) => sentEvents.push({ channel, payload })
    });

    manager.openRail({ sourceId: 'hn' });
    expect(manager.getState()).not.toBeNull();

    manager.closeRail('hn');
    expect(manager.getState()).toBeNull();
    expect(sentEvents[sentEvents.length - 1].payload).toBeNull();
  });
});
