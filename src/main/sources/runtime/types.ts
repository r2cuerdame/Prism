import type {
  SemanticProjection,
  SourceActionDescriptor,
  SourceActionRequest,
  SourceActionResult
} from '@shared/domain/projection';
import type { SourcePage } from './sourcePage';

export { getPartitionIdForOrigin, normalizeOrigin, sourceNameForOrigin } from './origin';
export type {
  ProjectedElement,
  SemanticProjection,
  SourceActionDescriptor,
  SourceActionRequest,
  SourceActionResult
} from '@shared/domain/projection';

export type SourceAuthStatus =
  | 'idle'
  | 'required'
  | 'authenticating'
  | 'authenticated'
  | 'dismissed'
  | 'failed';

export interface SourceAuthRequiredEvent {
  sourceId: string;
  origin: string;
  partitionId: string;
  loginUrl?: string;
  title?: string;
  status: SourceAuthStatus;
}

export type SourceActionHandler = (
  req: SourceActionRequest,
  context: SourceContext
) => Promise<SourceActionResult>;

/**
 * One hidden, persistent source session: an origin with its own partition
 * (cookies, localStorage, cache, JS, navigation history). Credentials live
 * in the Chromium session only — nothing on this object can read them, and
 * nothing here is ever serialized to the renderer or an LLM.
 */
export interface SourceContext {
  readonly id: string;
  readonly origin: string;
  readonly partitionId: string;
  /** Human-readable name stamped on projected items. */
  readonly sourceName: string;
  readonly createdAt: number;
  lastActiveAt: number;
  isDestroyed: boolean;
  authStatus: SourceAuthStatus;
  loginUrl?: string;
  /** The page behind this context, when it is page-backed. */
  readonly page?: SourcePage;
  /** Last projection made from this context (main-process side only). */
  lastProjection: SemanticProjection | null;
  reportAuthRequired(loginUrl?: string, title?: string): void;
  reportAuthSuccess(): Promise<void>;
  destroy(): Promise<void>;
}

export interface CreateContextOptions {
  sourceId?: string;
  loginUrl?: string;
  sourceName?: string;
  /** Page to back this context; when omitted the runtime's pageFactory is used. */
  page?: SourcePage;
  /** Load this URL as soon as the page exists. */
  initialUrl?: string;
}

export interface SourceRuntime {
  getPartitionId(origin: string): string;
  createContext(origin: string, opts?: CreateContextOptions): Promise<SourceContext>;
  getContext(sourceId: string): SourceContext | undefined;
  listContexts(): SourceContext[];
  destroyContext(sourceId: string): Promise<boolean>;
  projectSemantic<T = unknown>(
    sourceId: string,
    extractor?: (ctx: SourceContext) => Promise<SemanticProjection<T>>
  ): Promise<SemanticProjection<T>>;
  registerActionHandler(
    sourceId: string,
    actionId: string,
    handler: SourceActionHandler,
    descriptor?: SourceActionDescriptor
  ): void;
  unregisterActionHandler(sourceId: string, actionId?: string): void;
  routeAction(req: SourceActionRequest): Promise<SourceActionResult>;
  onAuthRequired(listener: (event: SourceAuthRequiredEvent) => void): () => void;
  onProjection(listener: (projection: SemanticProjection) => void): () => void;
  reportAuthRequired(sourceId: string, loginUrl?: string, title?: string): void;
  reportAuthSuccess(sourceId: string): Promise<SemanticProjection | null>;
  dispose(): Promise<void>;
}
