import type { Provenance } from '@shared/domain/provenance';
import type { SourceItem } from '@shared/domain/sourceItem';

export type SourceClass = 'video' | 'news' | 'community';

export interface SourceRequest {
  topics: string[];
  moods: string[];
  query?: string;
  locale: 'ko' | 'en';
  limit: number;
}

export interface HttpGetOptions {
  timeoutMs?: number;
  headers?: Record<string, string>;
}

export interface HttpClient {
  getText(url: string, opts?: HttpGetOptions): Promise<string>;
  getJson<T = unknown>(url: string, opts?: HttpGetOptions): Promise<T>;
}

export interface AdapterContext {
  http: HttpClient;
  now: () => Date;
}

export interface AdapterResult {
  items: SourceItem[];
  provenance: Provenance[];
  /** Non-fatal problems. Adapters must not throw on bad payloads. */
  errors: string[];
}

/**
 * A source-specific module behind the hidden source boundary. Adapters may
 * fetch and normalize; they can never inject DOM/CSS/JS into the
 * Generated View (GOAL.md § Source runner).
 */
export interface SourceAdapter {
  id: string;
  name: string;
  classes: SourceClass[];
  /** Relevance 0..1 for this request; 0 = do not use. */
  matches(req: SourceRequest): number;
  fetchItems(req: SourceRequest, ctx: AdapterContext): Promise<AdapterResult>;
}
