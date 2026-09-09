import { randomUUID } from 'node:crypto';
import type { SemanticProjection, SourceActionDescriptor } from '@shared/domain/projection';
import { SourceActionRequestSchema, type SourceActionRequest, type SourceActionResult } from '@shared/domain/projection';
import { performBuiltinAction } from './actions';
import { getPartitionIdForOrigin, normalizeOrigin, sourceNameForOrigin } from './origin';
import { projectSnapshot } from './projection';
import type { SourcePage } from './sourcePage';
import type {
  CreateContextOptions,
  SourceActionHandler,
  SourceAuthRequiredEvent,
  SourceAuthStatus,
  SourceContext,
  SourceRuntime
} from './types';

export interface ElectronSessionLike {
  setPermissionRequestHandler?: (
    handler: (
      webContents: unknown,
      permission: string,
      callback: (permissionGranted: boolean) => void
    ) => void
  ) => void;
  setPermissionCheckHandler?: (handler: () => boolean) => void;
}

export interface SessionProvider {
  fromPartition(partitionId: string, options?: { cache?: boolean }): ElectronSessionLike;
}

/**
 * Fallback session provider for tests and environments where Electron
 * native APIs are unavailable. Each partition still gets its own object so
 * "same partition" can be asserted by identity.
 */
class DefaultSessionProvider implements SessionProvider {
  private sessions = new Map<string, ElectronSessionLike>();

  fromPartition(partitionId: string): ElectronSessionLike {
    let ses = this.sessions.get(partitionId);
    if (!ses) {
      ses = {
        setPermissionRequestHandler: () => undefined,
        setPermissionCheckHandler: () => undefined
      };
      this.sessions.set(partitionId, ses);
    }
    return ses;
  }
}

export interface ElectronSourceRuntimeOptions {
  sessionProvider?: SessionProvider;
  /** Builds the hidden page for a new context (Electron: a WebContentsView). */
  pageFactory?: (partitionId: string, origin: string) => SourcePage;
}

const NAV_ACTIONS: SourceActionDescriptor[] = [
  { actionId: 'navigate', name: '이동', description: '같은 출처 안의 다른 주소로 이동해요' },
  { actionId: 'back', name: '뒤로' },
  { actionId: 'forward', name: '앞으로' },
  { actionId: 'reload', name: '새로고침' }
];

export class ElectronSourceRuntime implements SourceRuntime {
  private contexts = new Map<string, SourceContext>();
  private actionHandlers = new Map<string, Map<string, SourceActionHandler>>();
  private actionDescriptors = new Map<string, Map<string, SourceActionDescriptor>>();
  private extractors = new Map<string, (ctx: SourceContext) => Promise<SemanticProjection<unknown>>>();
  private authListeners = new Set<(event: SourceAuthRequiredEvent) => void>();
  private projectionListeners = new Set<(projection: SemanticProjection) => void>();
  private sessionProvider: SessionProvider;
  private pageFactory?: (partitionId: string, origin: string) => SourcePage;

  constructor(options?: ElectronSourceRuntimeOptions) {
    this.pageFactory = options?.pageFactory;
    if (options?.sessionProvider) {
      this.sessionProvider = options.sessionProvider;
    } else {
      let electronSession: SessionProvider | undefined;
      try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const electron = require('electron');
        if (electron && electron.session && typeof electron.session.fromPartition === 'function') {
          electronSession = electron.session;
        }
      } catch {
        /* Not running inside Electron (tests) */
      }
      this.sessionProvider = electronSession ?? new DefaultSessionProvider();
    }
  }

  getPartitionId(origin: string): string {
    return getPartitionIdForOrigin(origin);
  }

  async createContext(origin: string, opts?: CreateContextOptions): Promise<SourceContext> {
    const canonicalOrigin = normalizeOrigin(origin);
    const partitionId = this.getPartitionId(canonicalOrigin);
    const sourceId = opts?.sourceId?.trim() || `source-${randomUUID().slice(0, 8)}`;

    const existing = this.contexts.get(sourceId);
    if (existing) {
      if (!existing.isDestroyed && existing.origin === canonicalOrigin) {
        existing.lastActiveAt = Date.now();
        return existing;
      }
      await this.destroyContext(sourceId);
    }

    // Isolate the partition: an untrusted source never gets devices/geo/etc.
    const ses = this.sessionProvider.fromPartition(partitionId, { cache: true });
    if (typeof ses.setPermissionRequestHandler === 'function') {
      ses.setPermissionRequestHandler((_wc, _perm, callback) => callback(false));
    }
    if (typeof ses.setPermissionCheckHandler === 'function') {
      ses.setPermissionCheckHandler(() => false);
    }

    const page = opts?.page ?? this.pageFactory?.(partitionId, canonicalOrigin);
    let isDestroyed = false;
    let authStatus: SourceAuthStatus = 'idle';
    let loginUrl = opts?.loginUrl;

    const context: SourceContext = {
      id: sourceId,
      origin: canonicalOrigin,
      partitionId,
      sourceName: opts?.sourceName?.trim() || sourceNameForOrigin(canonicalOrigin),
      createdAt: Date.now(),
      lastActiveAt: Date.now(),
      page,
      lastProjection: null,
      get isDestroyed() {
        return isDestroyed;
      },
      get authStatus() {
        return authStatus;
      },
      set authStatus(status: SourceAuthStatus) {
        authStatus = status;
      },
      get loginUrl() {
        return loginUrl;
      },
      set loginUrl(url: string | undefined) {
        loginUrl = url;
      },
      reportAuthRequired: (url?: string, title?: string) => {
        authStatus = 'required';
        if (url) loginUrl = url;
        this.reportAuthRequired(sourceId, url ?? loginUrl, title);
      },
      reportAuthSuccess: async () => {
        authStatus = 'authenticated';
        await this.reportAuthSuccess(sourceId);
      },
      destroy: async () => {
        isDestroyed = true;
        await page?.destroy().catch(() => undefined);
      }
    };

    this.contexts.set(sourceId, context);
    if (page && opts?.initialUrl) {
      await page.loadURL(opts.initialUrl);
    }
    return context;
  }

  getContext(sourceId: string): SourceContext | undefined {
    const ctx = this.contexts.get(sourceId);
    if (!ctx || ctx.isDestroyed) return undefined;
    return ctx;
  }

  listContexts(): SourceContext[] {
    return Array.from(this.contexts.values()).filter((c) => !c.isDestroyed);
  }

  async destroyContext(sourceId: string): Promise<boolean> {
    const ctx = this.contexts.get(sourceId);
    if (!ctx) return false;
    await ctx.destroy();
    this.contexts.delete(sourceId);
    this.actionHandlers.delete(sourceId);
    this.actionDescriptors.delete(sourceId);
    this.extractors.delete(sourceId);
    return true;
  }

  registerActionHandler(
    sourceId: string,
    actionId: string,
    handler: SourceActionHandler,
    descriptor?: SourceActionDescriptor
  ): void {
    if (!this.actionHandlers.has(sourceId)) {
      this.actionHandlers.set(sourceId, new Map());
      this.actionDescriptors.set(sourceId, new Map());
    }
    this.actionHandlers.get(sourceId)!.set(actionId, handler);
    this.actionDescriptors.get(sourceId)!.set(actionId, descriptor ?? { actionId, name: actionId });
  }

  unregisterActionHandler(sourceId: string, actionId?: string): void {
    if (!actionId) {
      this.actionHandlers.delete(sourceId);
      this.actionDescriptors.delete(sourceId);
      return;
    }
    this.actionHandlers.get(sourceId)?.delete(actionId);
    this.actionDescriptors.get(sourceId)?.delete(actionId);
  }

  private descriptorsFor(sourceId: string, ctx: SourceContext): SourceActionDescriptor[] {
    const custom = this.actionDescriptors.get(sourceId);
    const list = custom ? Array.from(custom.values()) : [];
    return ctx.page ? [...NAV_ACTIONS, ...list] : list;
  }

  /**
   * Route one action to the context that owns it. Custom handlers registered
   * by adapters win; otherwise the built-in typed actions run against the
   * context's page. Unknown source, unknown action, destructive-without-
   * confirmation and stale projections all come back as typed failures —
   * never as exceptions.
   */
  async routeAction(raw: SourceActionRequest): Promise<SourceActionResult> {
    const parsedReq = SourceActionRequestSchema.safeParse(raw);
    if (!parsedReq.success) {
      const sourceId = typeof raw?.sourceId === 'string' ? raw.sourceId : '';
      const actionId = typeof raw?.actionId === 'string' ? raw.actionId : '';
      return { ok: false, sourceId, actionId, error: '요청 형식이 올바르지 않아요.' };
    }
    const req = parsedReq.data;
    const { sourceId, actionId } = req;
    const ctx = this.getContext(sourceId);
    if (!ctx) {
      return {
        ok: false,
        sourceId,
        actionId,
        error: `Source context "${sourceId}" not found`,
        invalidation: {
          reason: 'context-destroyed',
          message: '이 소스 세션은 더 이상 존재하지 않아요.'
        }
      };
    }

    ctx.lastActiveAt = Date.now();
    const handler = this.actionHandlers.get(sourceId)?.get(actionId);
    if (handler) {
      try {
        return await handler(req, ctx);
      } catch (err) {
        return {
          ok: false,
          sourceId,
          actionId,
          error: err instanceof Error ? err.message : String(err)
        };
      }
    }

    if (ctx.page) {
      const page = ctx.page;
      const result = await performBuiltinAction(
        {
          sourceId,
          origin: ctx.origin,
          page,
          lastProjection: ctx.lastProjection,
          reproject: () => this.projectSemantic(sourceId)
        },
        req
      );
      if (result) return result;
    }

    return {
      ok: false,
      sourceId,
      actionId,
      error: `Action "${actionId}" not found for source "${sourceId}"`,
      invalidation: {
        reason: 'unknown-action',
        projectionId: ctx.lastProjection?.projectionId,
        message: '이 소스가 제공하는 actionId만 사용할 수 있어요.'
      }
    };
  }

  private async projectPage(ctx: SourceContext, page: SourcePage): Promise<SemanticProjection> {
    const snapshot = await page.snapshot();
    const projection = projectSnapshot(snapshot, {
      sourceId: ctx.id,
      sourceName: ctx.sourceName,
      origin: ctx.origin,
      partitionId: ctx.partitionId,
      canGoBack: page.canGoBack(),
      canGoForward: page.canGoForward(),
      availableActions: this.descriptorsFor(ctx.id, ctx)
    });
    if (projection.authRequired && ctx.authStatus !== 'authenticated') {
      if (ctx.authStatus !== 'required') ctx.reportAuthRequired(projection.loginUrl);
    }
    return projection;
  }

  async projectSemantic<T = unknown>(
    sourceId: string,
    extractor?: (ctx: SourceContext) => Promise<SemanticProjection<T>>
  ): Promise<SemanticProjection<T>> {
    const ctx = this.getContext(sourceId);
    if (!ctx) {
      throw new Error(`Cannot project semantic data: source context "${sourceId}" not found`);
    }

    let projection: SemanticProjection<T>;
    if (extractor) {
      this.extractors.set(sourceId, extractor as (ctx: SourceContext) => Promise<SemanticProjection<unknown>>);
      projection = await extractor(ctx);
    } else {
      const saved = this.extractors.get(sourceId);
      if (saved) {
        projection = (await saved(ctx)) as SemanticProjection<T>;
      } else if (ctx.page) {
        projection = (await this.projectPage(ctx, ctx.page)) as SemanticProjection<T>;
      } else {
        projection = {
          projectionId: `proj_${randomUUID()}`,
          sourceId: ctx.id,
          origin: ctx.origin,
          partitionId: ctx.partitionId,
          timestamp: Date.now(),
          authRequired: false,
          items: [],
          elements: [],
          availableActions: this.descriptorsFor(sourceId, ctx),
          canGoBack: false,
          canGoForward: false
        };
      }
    }
    ctx.lastProjection = projection as SemanticProjection;
    for (const listener of this.projectionListeners) {
      try {
        listener(projection as SemanticProjection);
      } catch (err) {
        console.error('[SourceRuntime] projection listener failed:', err);
      }
    }
    return projection;
  }

  onAuthRequired(listener: (event: SourceAuthRequiredEvent) => void): () => void {
    this.authListeners.add(listener);
    return () => {
      this.authListeners.delete(listener);
    };
  }

  onProjection(listener: (projection: SemanticProjection) => void): () => void {
    this.projectionListeners.add(listener);
    return () => {
      this.projectionListeners.delete(listener);
    };
  }

  reportAuthRequired(sourceId: string, loginUrl?: string, title?: string): void {
    const ctx = this.getContext(sourceId);
    if (!ctx) return;
    ctx.authStatus = 'required';
    if (loginUrl) ctx.loginUrl = loginUrl;

    // Only what a login surface needs — no cookies, no storage, no tokens.
    const event: SourceAuthRequiredEvent = {
      sourceId: ctx.id,
      origin: ctx.origin,
      partitionId: ctx.partitionId,
      loginUrl: loginUrl ?? ctx.loginUrl ?? ctx.origin,
      title: title ?? `${ctx.sourceName} 로그인`,
      status: 'required'
    };

    for (const listener of this.authListeners) {
      try {
        listener(event);
      } catch (err) {
        console.error('[SourceRuntime] Error in authListener:', err);
      }
    }
  }

  /**
   * The Login Rail finished: mark the context signed in and re-project so
   * the page reflects the authenticated state. When the page is still on a
   * login screen the reload lets the session's fresh cookies take effect.
   */
  async reportAuthSuccess(sourceId: string): Promise<SemanticProjection | null> {
    const ctx = this.getContext(sourceId);
    if (!ctx) return null;
    ctx.authStatus = 'authenticated';
    try {
      if (ctx.page && ctx.page.url) {
        const wasLoginPage = ctx.lastProjection?.authRequired === true;
        if (wasLoginPage) {
          if (ctx.page.canGoBack()) await ctx.page.goBack();
          else await ctx.page.reload();
        }
      }
      return await this.projectSemantic(sourceId);
    } catch {
      return null;
    }
  }

  async dispose(): Promise<void> {
    for (const ctx of this.contexts.values()) {
      await ctx.destroy();
    }
    this.contexts.clear();
    this.actionHandlers.clear();
    this.actionDescriptors.clear();
    this.extractors.clear();
    this.authListeners.clear();
    this.projectionListeners.clear();
  }
}

export function createSourceRuntime(options?: ElectronSourceRuntimeOptions): SourceRuntime {
  return new ElectronSourceRuntime(options);
}
