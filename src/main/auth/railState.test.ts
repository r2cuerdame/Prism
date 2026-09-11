import { describe, expect, it } from 'vitest';
import { CLOSED_RAIL, isRailActive, railReducer, type RailState } from './railState';

const OPEN = {
  type: 'open' as const,
  sourceId: 'hn',
  origin: 'https://news.ycombinator.com',
  partitionId: 'persist:prism-source-news-ycombinator-com-abc',
  loginUrl: 'https://news.ycombinator.com/login',
  title: 'Hacker News 로그인'
};

function opened(): RailState {
  return railReducer(CLOSED_RAIL, OPEN);
}

describe('railReducer', () => {
  it('starts closed and opens for a source without a surface yet', () => {
    expect(isRailActive(CLOSED_RAIL)).toBe(false);
    const s = opened();
    expect(s.status).toBe('open');
    expect(s.surface).toBe('none');
    expect(s.partitionId).toBe(OPEN.partitionId);
    expect(isRailActive(s)).toBe(true);
  });

  it('open → authenticating once a surface (embedded or window) is attached', () => {
    const embedded = railReducer(opened(), { type: 'surface', surface: 'embedded' });
    expect(embedded.status).toBe('authenticating');
    expect(embedded.surface).toBe('embedded');
    const window = railReducer(opened(), { type: 'surface', surface: 'window' });
    expect(window.surface).toBe('window');
  });

  it('cannot attach a surface to a closed rail', () => {
    expect(railReducer(CLOSED_RAIL, { type: 'surface', surface: 'embedded' })).toBe(CLOSED_RAIL);
  });

  it('completes only when the surface leaves the sign-in flow on the source origin', () => {
    const auth = railReducer(opened(), { type: 'surface', surface: 'embedded' });

    const stillLogin = railReducer(auth, {
      type: 'navigated',
      url: 'https://news.ycombinator.com/login?bad=1',
      loginLikely: true
    });
    expect(stillLogin.status).toBe('authenticating');

    const elsewhere = railReducer(auth, {
      type: 'navigated',
      url: 'https://accounts.google.com/o/oauth2',
      loginLikely: false
    });
    expect(elsewhere.status).toBe('authenticating');

    const done = railReducer(auth, {
      type: 'navigated',
      url: 'https://news.ycombinator.com/news',
      loginLikely: false
    });
    expect(done.status).toBe('completing');

    expect(railReducer(done, { type: 'complete' })).toEqual(CLOSED_RAIL);
  });

  it('navigation before a surface exists is ignored', () => {
    const s = railReducer(opened(), {
      type: 'navigated',
      url: 'https://news.ycombinator.com/news',
      loginLikely: false
    });
    expect(s.status).toBe('open');
  });

  it('dismiss closes from any state; complete on a closed rail is a no-op', () => {
    const auth = railReducer(opened(), { type: 'surface', surface: 'window' });
    expect(railReducer(auth, { type: 'dismiss' })).toEqual(CLOSED_RAIL);
    expect(railReducer(opened(), { type: 'dismiss' })).toEqual(CLOSED_RAIL);
    expect(railReducer(CLOSED_RAIL, { type: 'complete' })).toBe(CLOSED_RAIL);
  });

  it('keeps the rail visible with a message on failure, and lets a surface retry', () => {
    const failed = railReducer(opened(), { type: 'surface-unavailable', message: '표시할 수 없어요' });
    expect(failed.status).toBe('failed');
    expect(failed.message).toBe('표시할 수 없어요');
    expect(isRailActive(failed)).toBe(true);
    const retried = railReducer(failed, { type: 'surface', surface: 'window' });
    expect(retried.status).toBe('authenticating');
    expect(retried.message).toBeUndefined();
    expect(railReducer(CLOSED_RAIL, { type: 'fail', message: 'x' })).toBe(CLOSED_RAIL);
  });

  it('opening for another source replaces the active rail', () => {
    const auth = railReducer(opened(), { type: 'surface', surface: 'embedded' });
    const other = railReducer(auth, {
      ...OPEN,
      sourceId: 'reddit',
      origin: 'https://www.reddit.com',
      partitionId: 'persist:prism-source-www-reddit-com-def',
      loginUrl: 'https://www.reddit.com/login'
    });
    expect(other.status).toBe('open');
    expect(other.sourceId).toBe('reddit');
    expect(other.surface).toBe('none');
  });
});
