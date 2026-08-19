import { afterEach, describe, expect, it, vi } from 'vitest';
import { createHttpClient } from './http';

function textChunks(text: string, chunkSize = 1024): Uint8Array[] {
  const bytes = new TextEncoder().encode(text);
  if (bytes.length === 0) return [bytes];
  const chunks: Uint8Array[] = [];
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    chunks.push(bytes.slice(offset, offset + chunkSize));
  }
  return chunks;
}

function streamOf(chunks: Uint8Array[]): ReadableStream<Uint8Array> {
  let i = 0;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (i < chunks.length) {
        controller.enqueue(chunks[i]);
        i += 1;
      } else {
        controller.close();
      }
    }
  });
}

function fakeResponse(opts: { text: string; status?: number; chunkSize?: number }): Response {
  const { text, status = 200, chunkSize } = opts;
  return {
    ok: status >= 200 && status < 300,
    status,
    body: streamOf(textChunks(text, chunkSize)),
    text: () => Promise.resolve(text)
  } as unknown as Response;
}

describe('http client', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns a normal small text response and caches it (second call skips fetch)', async () => {
    const fetchMock = vi.fn().mockResolvedValue(fakeResponse({ text: 'hello world' }));
    vi.stubGlobal('fetch', fetchMock);
    const client = createHttpClient();

    const first = await client.getText('https://example.com/a');
    const second = await client.getText('https://example.com/a');

    expect(first).toBe('hello world');
    expect(second).toBe('hello world');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('rejects a body exceeding the cap and does not cache the failed read', async () => {
    const big = 'x'.repeat(4 * 1024 * 1024 + 10);
    // A fresh Response (and fresh stream) per call — a Response body can only be read once.
    const fetchMock = vi.fn(() => Promise.resolve(fakeResponse({ text: big, chunkSize: 64 * 1024 })));
    vi.stubGlobal('fetch', fetchMock);
    const client = createHttpClient();

    await expect(client.getText('https://example.com/big')).rejects.toThrow(
      /HTTP body too large example\.com/
    );
    // Not cached: a second attempt hits fetch again rather than returning a cached value.
    await expect(client.getText('https://example.com/big')).rejects.toThrow(
      /HTTP body too large/
    );
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('throws `HTTP <status> <host>` for a non-2xx response', async () => {
    const fetchMock = vi.fn().mockResolvedValue(fakeResponse({ text: 'nope', status: 500 }));
    vi.stubGlobal('fetch', fetchMock);
    const client = createHttpClient();

    await expect(client.getText('https://example.com/fail')).rejects.toThrow(
      'HTTP 500 example.com'
    );
  });

  it('throws for a non-http(s) url and never calls fetch', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const client = createHttpClient();

    await expect(client.getText('ftp://example.com/file')).rejects.toThrow();
    await expect(client.getText('not a url')).rejects.toThrow();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
