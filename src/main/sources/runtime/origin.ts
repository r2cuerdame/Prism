import { createHash } from 'node:crypto';

/**
 * Normalizes an arbitrary URL string to a canonical origin.
 * Strips path, query, hash, credentials, and default ports (80 for http, 443 for https).
 * Throws on invalid or unsupported protocols (only http: and https: are allowed).
 */
export function normalizeOrigin(rawUrl: string): string {
  if (!rawUrl || typeof rawUrl !== 'string') {
    throw new Error('Invalid origin: URL string is required');
  }

  let parsed: URL;
  try {
    parsed = new URL(rawUrl.trim());
  } catch {
    throw new Error(`Invalid origin URL: "${rawUrl}"`);
  }

  const protocol = parsed.protocol.toLowerCase();
  if (protocol !== 'http:' && protocol !== 'https:') {
    throw new Error(`Unsupported origin protocol: "${protocol}" (only http: and https: supported)`);
  }

  const hostname = parsed.hostname.toLowerCase();
  if (!hostname) {
    throw new Error(`Invalid origin hostname in: "${rawUrl}"`);
  }

  let port = parsed.port;
  if ((protocol === 'http:' && port === '80') || (protocol === 'https:' && port === '443')) {
    port = '';
  }

  return `${protocol}//${hostname}${port ? `:${port}` : ''}`;
}

/**
 * Deterministic Electron session partition for a web origin: one persistent
 * cookie jar / cache / storage per origin, so sources never see each other.
 * Format: `persist:prism-source-${sanitizedHost}-${hash16}`
 */
export function getPartitionIdForOrigin(rawUrl: string): string {
  const canonical = normalizeOrigin(rawUrl);
  const parsed = new URL(canonical);

  const sanitizedHost = parsed.hostname
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');

  const portSuffix = parsed.port ? `-p${parsed.port}` : '';
  const hash = createHash('sha256').update(canonical).digest('hex').slice(0, 16);

  return `persist:prism-source-${sanitizedHost}${portSuffix}-${hash}`;
}

/** A readable source name from an origin: `https://news.ycombinator.com` → `news.ycombinator.com`. */
export function sourceNameForOrigin(origin: string): string {
  try {
    return new URL(origin).host;
  } catch {
    return origin;
  }
}
