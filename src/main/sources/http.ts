import type { HttpClient, HttpGetOptions } from './types';

const DEFAULT_TIMEOUT_MS = 8000;
const CACHE_TTL_MS = 5 * 60 * 1000;
const CACHE_MAX_ENTRIES = 200;
const USER_AGENT = 'GPTBrowser/0.1 (+https://github.com/r2cuerdame/GPTBrowser)';

interface CacheEntry {
  expires: number;
  value: string;
}

export function createHttpClient(): HttpClient {
  const cache = new Map<string, CacheEntry>();

  function readCache(url: string): string | null {
    const entry = cache.get(url);
    if (!entry) return null;
    if (entry.expires <= Date.now()) {
      cache.delete(url);
      return null;
    }
    return entry.value;
  }

  function writeCache(url: string, value: string): void {
    if (cache.size >= CACHE_MAX_ENTRIES) {
      const oldest = cache.keys().next();
      if (!oldest.done) cache.delete(oldest.value);
    }
    cache.set(url, { expires: Date.now() + CACHE_TTL_MS, value });
  }

  async function getText(url: string, opts?: HttpGetOptions, accept = 'text/*, */*'): Promise<string> {
    const cached = readCache(url);
    if (cached !== null) return cached;

    const timeoutMs = opts?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const headers: Record<string, string> = {
      'User-Agent': USER_AGENT,
      Accept: accept,
      ...(opts?.headers ?? {})
    };
    const res = await fetch(url, {
      headers,
      signal: AbortSignal.timeout(timeoutMs)
    });
    if (!res.ok) {
      let host = url;
      try {
        host = new URL(url).host;
      } catch {
        // keep raw url
      }
      throw new Error(`HTTP ${res.status} ${host}`);
    }
    const text = await res.text();
    writeCache(url, text);
    return text;
  }

  return {
    getText: (url, opts) => getText(url, opts),
    getJson: async <T = unknown>(url: string, opts?: HttpGetOptions): Promise<T> => {
      const text = await getText(url, opts, 'application/json, */*');
      return JSON.parse(text) as T;
    }
  };
}
