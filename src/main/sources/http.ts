import type { HttpClient, HttpGetOptions } from './types';

const DEFAULT_TIMEOUT_MS = 8000;
const CACHE_TTL_MS = 5 * 60 * 1000;
const CACHE_MAX_ENTRIES = 200;
const MAX_BYTES = 4 * 1024 * 1024;
const USER_AGENT = 'Prism/0.1 (+https://github.com/r2cuerdame/Prism)';
const ALLOWED_PROTOCOLS = new Set(['http:', 'https:']);

interface CacheEntry {
  expires: number;
  value: string;
}

/** Throws for anything but http(s); otherwise returns the host for error messages. */
function assertHttpUrl(url: string): string {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`Invalid URL ${url}`);
  }
  if (!ALLOWED_PROTOCOLS.has(parsed.protocol)) {
    throw new Error(`Unsupported URL protocol ${parsed.protocol} ${parsed.host}`);
  }
  return parsed.host;
}

/** Streams the body with a hard size cap, cancelling the reader once exceeded. */
async function readBodyCapped(res: Response, host: string): Promise<string> {
  const body = res.body;
  if (!body) return res.text();

  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    total += value.byteLength;
    if (total > MAX_BYTES) {
      await reader.cancel();
      throw new Error(`HTTP body too large ${host}`);
    }
    chunks.push(value);
  }

  const decoder = new TextDecoder();
  let text = '';
  for (const chunk of chunks) text += decoder.decode(chunk, { stream: true });
  text += decoder.decode();
  return text;
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
    const host = assertHttpUrl(url);

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
      throw new Error(`HTTP ${res.status} ${host}`);
    }
    const text = await readBodyCapped(res, host);
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
