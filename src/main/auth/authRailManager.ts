import type { BrowserWindow } from 'electron';
import type { SourceRuntime } from '../sources/runtime/types';
import { openOriginalWindow } from '../originalViewer';
import {
  IPC,
  type AuthRailOpenRequest,
  type AuthRailResult,
  type SafeAuthRailState
} from '@shared/ipc';

export interface AuthRailManager {
  getState(): SafeAuthRailState | null;
  openRail(req: AuthRailOpenRequest): SafeAuthRailState;
  closeRail(sourceId: string): void;
  launchLoginSurface(sourceId: string): void;
  completeAuth(sourceId: string): Promise<AuthRailResult>;
}

export function createAuthRailManager(opts: {
  sourceRuntime: SourceRuntime;
  sendToRenderer: (channel: string, payload: unknown) => void;
  getParentWindow?: () => BrowserWindow | null;
}): AuthRailManager {
  const { sourceRuntime, sendToRenderer, getParentWindow } = opts;
  let currentState: SafeAuthRailState | null = null;

  // Listen to runtime auth events from source contexts
  sourceRuntime.onAuthRequired((event) => {
    currentState = {
      active: true,
      sourceId: event.sourceId,
      origin: event.origin,
      partitionId: event.partitionId,
      loginUrl: event.loginUrl || event.origin,
      title: event.title || `${event.origin} 로그인`,
      status: 'required'
    };
    sendToRenderer(IPC.evAuthRailState, currentState);
  });

  const openRail = (req: AuthRailOpenRequest): SafeAuthRailState => {
    let ctx = sourceRuntime.getContext(req.sourceId);
    let origin = req.origin;
    if (ctx) {
      origin = ctx.origin;
    } else if (origin) {
      try {
        const canonical = new URL(origin).origin;
        origin = canonical;
      } catch {
        origin = 'https://' + req.sourceId;
      }
    } else {
      origin = 'https://' + req.sourceId;
    }

    const partitionId = sourceRuntime.getPartitionId(origin);
    const loginUrl = req.loginUrl || ctx?.loginUrl || origin;
    const title = req.title || `${origin} 로그인`;

    currentState = {
      active: true,
      sourceId: req.sourceId,
      origin,
      partitionId,
      loginUrl,
      title,
      status: 'required'
    };

    sendToRenderer(IPC.evAuthRailState, currentState);
    return currentState;
  };

  const closeRail = (sourceId: string): void => {
    if (currentState && currentState.sourceId === sourceId) {
      currentState = null;
      sendToRenderer(IPC.evAuthRailState, null);
    }
  };

  const launchLoginSurface = (sourceId: string): void => {
    if (!currentState || currentState.sourceId !== sourceId) return;

    currentState = {
      ...currentState,
      status: 'authenticating'
    };
    sendToRenderer(IPC.evAuthRailState, currentState);

    const parent = getParentWindow ? getParentWindow() : null;
    openOriginalWindow(currentState.loginUrl, parent ?? undefined, {
      partition: currentState.partitionId,
      title: `${currentState.title} — Prism`
    });
  };

  const completeAuth = async (sourceId: string): Promise<AuthRailResult> => {
    if (!currentState || currentState.sourceId !== sourceId) {
      return { ok: false, sourceId, status: 'failed', error: 'No active login rail for source' };
    }

    // Collapse the rail and re-project source
    currentState = null;
    sendToRenderer(IPC.evAuthRailState, null);

    try {
      await sourceRuntime.reportAuthSuccess(sourceId);
      return { ok: true, sourceId, status: 'authenticated' };
    } catch (err) {
      return {
        ok: false,
        sourceId,
        status: 'failed',
        error: err instanceof Error ? err.message : String(err)
      };
    }
  };

  return {
    getState: () => currentState,
    openRail,
    closeRail,
    launchLoginSurface,
    completeAuth
  };
}
