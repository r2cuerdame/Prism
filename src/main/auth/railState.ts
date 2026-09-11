/**
 * The Login Rail's state machine, pure so its transitions can be tested
 * without Electron. The rail is a temporary right-edge surface that shares a
 * hidden source context's persistent partition: the user signs in there, the
 * rail closes, the source re-projects.
 */
export type RailStatus = 'closed' | 'open' | 'authenticating' | 'completing' | 'failed';
export type RailSurfaceKind = 'none' | 'embedded' | 'window';

export interface RailState {
  status: RailStatus;
  sourceId: string;
  origin: string;
  partitionId: string;
  loginUrl: string;
  title: string;
  surface: RailSurfaceKind;
  message?: string;
}

export type RailEvent =
  | {
      type: 'open';
      sourceId: string;
      origin: string;
      partitionId: string;
      loginUrl: string;
      title: string;
    }
  | { type: 'surface'; surface: Exclude<RailSurfaceKind, 'none'> }
  | { type: 'surface-unavailable'; message: string }
  /** The surface navigated; `loginLikely` = the new page still looks like a sign-in. */
  | { type: 'navigated'; url: string; loginLikely: boolean }
  | { type: 'complete' }
  | { type: 'dismiss' }
  | { type: 'fail'; message: string };

export const CLOSED_RAIL: RailState = {
  status: 'closed',
  sourceId: '',
  origin: '',
  partitionId: '',
  loginUrl: '',
  title: '',
  surface: 'none'
};

const sameOrigin = (url: string, origin: string): boolean => {
  try {
    return new URL(url).origin === origin;
  } catch {
    return false;
  }
};

export function railReducer(state: RailState, event: RailEvent): RailState {
  switch (event.type) {
    case 'open':
      // Opening for another source replaces the current rail outright.
      return {
        status: 'open',
        sourceId: event.sourceId,
        origin: event.origin,
        partitionId: event.partitionId,
        loginUrl: event.loginUrl,
        title: event.title,
        surface: 'none'
      };
    case 'surface':
      if (state.status !== 'open' && state.status !== 'failed') return state;
      return { ...state, status: 'authenticating', surface: event.surface, message: undefined };
    case 'surface-unavailable':
      if (state.status === 'closed') return state;
      return { ...state, status: 'failed', surface: 'none', message: event.message };
    case 'navigated': {
      if (state.status !== 'authenticating') return state;
      // Success is inferred, never assumed: the surface must have left the
      // sign-in flow and be back on the source's own origin.
      if (!event.loginLikely && sameOrigin(event.url, state.origin)) {
        return { ...state, status: 'completing' };
      }
      return state;
    }
    case 'complete':
      if (state.status === 'closed') return state;
      return CLOSED_RAIL;
    case 'dismiss':
      return CLOSED_RAIL;
    case 'fail':
      if (state.status === 'closed') return state;
      return { ...state, status: 'failed', message: event.message };
  }
}

export const isRailActive = (state: RailState): boolean => state.status !== 'closed';
