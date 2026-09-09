import { describe, expect, it } from 'vitest';
import {
  getPartitionIdForOrigin,
  normalizeOrigin
} from './types';
import { createSourceRuntime, ElectronSourceRuntime } from './electronSourceRuntime';

describe('Deterministic Origin Partition IDs', () => {
  it('returns identical partition ID for identical origin string', () => {
    const id1 = getPartitionIdForOrigin('https://news.ycombinator.com');
    const id2 = getPartitionIdForOrigin('https://news.ycombinator.com');
    expect(id1).toBe(id2);
    expect(id1).toMatch(/^persist:prism-source-news-ycombinator-com-[a-f0-9]{16}$/);
  });

  it('normalizes case variations in scheme and host to the same partition ID', () => {
    const lower = getPartitionIdForOrigin('https://lobste.rs');
    const upper = getPartitionIdForOrigin('HTTPS://LOBSTE.RS');
    const mixed = getPartitionIdForOrigin('hTTpS://LobSte.Rs');
    expect(upper).toBe(lower);
    expect(mixed).toBe(lower);
  });

  it('ignores trailing slashes, paths, query strings, and fragments', () => {
    const base = getPartitionIdForOrigin('https://reddit.com');
    const slash = getPartitionIdForOrigin('https://reddit.com/');
    const path = getPartitionIdForOrigin('https://reddit.com/r/technology/hot');
    const query = getPartitionIdForOrigin('https://reddit.com/r/technology?sort=top&t=day');
    const fragment = getPartitionIdForOrigin('https://reddit.com/r/technology#comments');

    expect(slash).toBe(base);
    expect(path).toBe(base);
    expect(query).toBe(base);
    expect(fragment).toBe(base);
  });

  it('normalizes default ports (80 for http, 443 for https)', () => {
    const httpsNoPort = getPartitionIdForOrigin('https://example.com');
    const httpsDefaultPort = getPartitionIdForOrigin('https://example.com:443');
    expect(httpsDefaultPort).toBe(httpsNoPort);

    const httpNoPort = getPartitionIdForOrigin('http://example.com');
    const httpDefaultPort = getPartitionIdForOrigin('http://example.com:80');
    expect(httpDefaultPort).toBe(httpNoPort);
  });

  it('distinguishes custom ports as isolated partitions', () => {
    const port8080 = getPartitionIdForOrigin('https://example.com:8080');
    const port8443 = getPartitionIdForOrigin('https://example.com:8443');
    const standard = getPartitionIdForOrigin('https://example.com');

    expect(port8080).not.toBe(standard);
    expect(port8443).not.toBe(standard);
    expect(port8080).not.toBe(port8443);
    expect(port8080).toContain('-p8080-');
  });

  it('isolates different domains and subdomains', () => {
    const hn = getPartitionIdForOrigin('https://news.ycombinator.com');
    const reddit = getPartitionIdForOrigin('https://reddit.com');
    const lobsters = getPartitionIdForOrigin('https://lobste.rs');
    const sub1 = getPartitionIdForOrigin('https://api.reddit.com');

    expect(hn).not.toBe(reddit);
    expect(reddit).not.toBe(lobsters);
    expect(reddit).not.toBe(sub1);
  });

  it('isolates http and https schemes on the same host', () => {
    const insecure = getPartitionIdForOrigin('http://example.org');
    const secure = getPartitionIdForOrigin('https://example.org');
    expect(insecure).not.toBe(secure);
  });

  it('rejects invalid or unsupported protocols', () => {
    expect(() => getPartitionIdForOrigin('')).toThrow(/Invalid origin/);
    expect(() => getPartitionIdForOrigin('not-a-url')).toThrow(/Invalid origin URL/);
    expect(() => getPartitionIdForOrigin('ftp://files.example.com')).toThrow(
      /Unsupported origin protocol/
    );
    expect(() => getPartitionIdForOrigin('file:///path/to/file')).toThrow(
      /Unsupported origin protocol/
    );
    expect(() => getPartitionIdForOrigin('javascript:alert(1)')).toThrow(
      /Unsupported origin protocol/
    );
  });

  it('normalizes origin directly via normalizeOrigin helper', () => {
    expect(normalizeOrigin('HTTPS://Site.com:443/foo/bar?q=1#top')).toBe('https://site.com');
    expect(normalizeOrigin('http://example.com:80/')).toBe('http://example.com');
    expect(normalizeOrigin('https://api.github.com:9000/')).toBe('https://api.github.com:9000');
  });
});

describe('Action Routing in SourceRuntime', () => {
  it('dispatches action to registered handler and receives result', async () => {
    const runtime = createSourceRuntime();
    await runtime.createContext('https://news.ycombinator.com', {
      sourceId: 'hn-source'
    });

    runtime.registerActionHandler('hn-source', 'upvote', async (req, context) => {
      expect(context.id).toBe('hn-source');
      expect(context.origin).toBe('https://news.ycombinator.com');
      return {
        ok: true,
        sourceId: req.sourceId,
        actionId: req.actionId,
        data: { itemId: req.payload?.itemId, voted: true }
      };
    });

    const result = await runtime.routeAction({
      sourceId: 'hn-source',
      actionId: 'upvote',
      payload: { itemId: '12345' }
    });

    expect(result.ok).toBe(true);
    expect(result.sourceId).toBe('hn-source');
    expect(result.actionId).toBe('upvote');
    expect(result.data).toEqual({ itemId: '12345', voted: true });
    expect(result.error).toBeUndefined();
  });

  it('returns an error when routing to an unknown sourceId', async () => {
    const runtime = createSourceRuntime();
    const result = await runtime.routeAction({
      sourceId: 'non-existent-source',
      actionId: 'fetch',
      payload: {}
    });

    expect(result.ok).toBe(false);
    expect(result.sourceId).toBe('non-existent-source');
    expect(result.actionId).toBe('fetch');
    expect(result.error).toMatch(/Source context "non-existent-source" not found/);
  });

  it('returns an error when routing an unregistered actionId on a valid source', async () => {
    const runtime = createSourceRuntime();
    await runtime.createContext('https://reddit.com', { sourceId: 'reddit-source' });

    runtime.registerActionHandler('reddit-source', 'save', async () => ({
      ok: true,
      sourceId: 'reddit-source',
      actionId: 'save'
    }));

    const result = await runtime.routeAction({
      sourceId: 'reddit-source',
      actionId: 'delete',
      payload: {}
    });

    expect(result.ok).toBe(false);
    expect(result.sourceId).toBe('reddit-source');
    expect(result.actionId).toBe('delete');
    expect(result.error).toMatch(/Action "delete" not found for source "reddit-source"/);
  });

  it('safely catches exceptions thrown inside action handlers without crashing runtime', async () => {
    const runtime = createSourceRuntime();
    await runtime.createContext('https://youtube.com', { sourceId: 'yt-source' });

    runtime.registerActionHandler('yt-source', 'playVideo', async () => {
      throw new Error('Video unavailable in region');
    });

    const result = await runtime.routeAction({
      sourceId: 'yt-source',
      actionId: 'playVideo'
    });

    expect(result.ok).toBe(false);
    expect(result.sourceId).toBe('yt-source');
    expect(result.actionId).toBe('playVideo');
    expect(result.error).toBe('Video unavailable in region');
  });

  it('unregisters specific action handlers and all handlers for a source', async () => {
    const runtime = createSourceRuntime();
    await runtime.createContext('https://lobste.rs', { sourceId: 'lobsters-source' });

    runtime.registerActionHandler('lobsters-source', 'act1', async () => ({
      ok: true,
      sourceId: 'lobsters-source',
      actionId: 'act1'
    }));
    runtime.registerActionHandler('lobsters-source', 'act2', async () => ({
      ok: true,
      sourceId: 'lobsters-source',
      actionId: 'act2'
    }));

    // Unregister single action
    runtime.unregisterActionHandler('lobsters-source', 'act1');
    const r1 = await runtime.routeAction({ sourceId: 'lobsters-source', actionId: 'act1' });
    expect(r1.ok).toBe(false);

    const r2 = await runtime.routeAction({ sourceId: 'lobsters-source', actionId: 'act2' });
    expect(r2.ok).toBe(true);

    // Unregister all for source
    runtime.unregisterActionHandler('lobsters-source');
    const r3 = await runtime.routeAction({ sourceId: 'lobsters-source', actionId: 'act2' });
    expect(r3.ok).toBe(false);
  });

  it('routes identical action names independently across multiple source contexts', async () => {
    const runtime = createSourceRuntime();
    await runtime.createContext('https://source-a.com', { sourceId: 'source-a' });
    await runtime.createContext('https://source-b.com', { sourceId: 'source-b' });

    runtime.registerActionHandler('source-a', 'refresh', async () => ({
      ok: true,
      sourceId: 'source-a',
      actionId: 'refresh',
      data: { from: 'a' }
    }));
    runtime.registerActionHandler('source-b', 'refresh', async () => ({
      ok: true,
      sourceId: 'source-b',
      actionId: 'refresh',
      data: { from: 'b' }
    }));

    const resA = await runtime.routeAction({ sourceId: 'source-a', actionId: 'refresh' });
    const resB = await runtime.routeAction({ sourceId: 'source-b', actionId: 'refresh' });

    expect(resA.data).toEqual({ from: 'a' });
    expect(resB.data).toEqual({ from: 'b' });
  });
});

describe('SourceRuntime Context Lifecycle and Semantic Projections', () => {
  it('creates, retrieves, and lists contexts', async () => {
    const runtime = new ElectronSourceRuntime();
    const ctx1 = await runtime.createContext('https://news.ycombinator.com', { sourceId: 'src-hn' });
    const ctx2 = await runtime.createContext('https://reddit.com', { sourceId: 'src-reddit' });

    expect(runtime.getContext('src-hn')).toBe(ctx1);
    expect(runtime.getContext('src-reddit')).toBe(ctx2);
    expect(runtime.getContext('unknown')).toBeUndefined();

    const list = runtime.listContexts();
    expect(list).toHaveLength(2);
    expect(list.map((c) => c.id)).toEqual(['src-hn', 'src-reddit']);
  });

  it('destroys context and cleans up registered handlers', async () => {
    const runtime = createSourceRuntime();
    await runtime.createContext('https://example.com', { sourceId: 'temp-src' });
    runtime.registerActionHandler('temp-src', 'ping', async () => ({
      ok: true,
      sourceId: 'temp-src',
      actionId: 'ping'
    }));

    const destroyed = await runtime.destroyContext('temp-src');
    expect(destroyed).toBe(true);
    expect(runtime.getContext('temp-src')).toBeUndefined();
    expect(runtime.listContexts()).toHaveLength(0);

    const routeResult = await runtime.routeAction({ sourceId: 'temp-src', actionId: 'ping' });
    expect(routeResult.ok).toBe(false);
  });

  it('generates semantic projection with metadata and available actions', async () => {
    const runtime = createSourceRuntime();
    await runtime.createContext('https://news.ycombinator.com', { sourceId: 'hn-proj' });

    runtime.registerActionHandler(
      'hn-proj',
      'vote',
      async () => ({ ok: true, sourceId: 'hn-proj', actionId: 'vote' }),
      { actionId: 'vote', name: 'Upvote Story', description: 'Upvotes the current submission' }
    );

    const projection = await runtime.projectSemantic('hn-proj');
    expect(projection.sourceId).toBe('hn-proj');
    expect(projection.origin).toBe('https://news.ycombinator.com');
    expect(projection.partitionId).toMatch(/^persist:prism-source-/);
    expect(projection.availableActions).toHaveLength(1);
    expect(projection.availableActions[0].actionId).toBe('vote');
    expect(projection.availableActions[0].name).toBe('Upvote Story');
  });

  it('supports custom semantic projection extractor', async () => {
    const runtime = createSourceRuntime();
    await runtime.createContext('https://news.ycombinator.com', { sourceId: 'hn-custom' });

    const customProjection = await runtime.projectSemantic('hn-custom', async (ctx) => ({
      projectionId: 'custom-proj-1',
      sourceId: ctx.id,
      origin: ctx.origin,
      partitionId: ctx.partitionId,
      timestamp: Date.now(),
      items: [
        {
          id: 'item-1',
          adapterId: 'hackernews',
          sourceId: 'hn',
          sourceName: 'Hacker News',
          kind: 'article',
          title: 'Custom item',
          originalUrl: 'https://news.ycombinator.com/item?id=1',
          retrievedAt: new Date().toISOString(),
          provenanceRef: 'prov-1',
          payload: {}
        }
      ],
      availableActions: [],
      data: { customField: 'hello' }
    }));

    expect(customProjection.projectionId).toBe('custom-proj-1');
    expect(customProjection.items).toHaveLength(1);
    expect(customProjection.data).toEqual({ customField: 'hello' });
  });

  it('reports auth required and dispatches safe auth event', async () => {
    const runtime = createSourceRuntime();
    const ctx = await runtime.createContext('https://news.ycombinator.com', { sourceId: 'hn-auth' });

    let receivedEvent: unknown = null;
    const unsub = runtime.onAuthRequired((ev) => {
      receivedEvent = ev;
    });

    ctx.reportAuthRequired('https://news.ycombinator.com/login', 'Hacker News 로그인');

    expect(receivedEvent).not.toBeNull();
    const ev = receivedEvent as {
      sourceId: string;
      origin: string;
      partitionId: string;
      loginUrl: string;
      title: string;
      status: string;
    };
    expect(ev.sourceId).toBe('hn-auth');
    expect(ev.origin).toBe('https://news.ycombinator.com');
    expect(ev.partitionId).toMatch(/^persist:prism-source-/);
    expect(ev.loginUrl).toBe('https://news.ycombinator.com/login');
    expect(ev.title).toBe('Hacker News 로그인');
    expect(ev.status).toBe('required');

    unsub();
  });

  it('reports auth success and triggers re-projection', async () => {
    const runtime = createSourceRuntime();
    const ctx = await runtime.createContext('https://news.ycombinator.com', { sourceId: 'hn-auth-reproject' });

    let projectCount = 0;
    await runtime.projectSemantic('hn-auth-reproject', async (c) => {
      projectCount++;
      return {
        projectionId: `proj-${projectCount}`,
        sourceId: c.id,
        origin: c.origin,
        partitionId: c.partitionId,
        timestamp: Date.now(),
        items: [],
        availableActions: []
      };
    });

    expect(projectCount).toBe(1);

    // Call reportAuthSuccess on the context
    await ctx.reportAuthSuccess();
    expect(projectCount).toBe(2);
    expect(ctx.authStatus).toBe('authenticated');
  });

  it('disposes all contexts cleanly on runtime dispose', async () => {
    const runtime = createSourceRuntime();
    await runtime.createContext('https://a.com', { sourceId: 'a' });
    await runtime.createContext('https://b.com', { sourceId: 'b' });

    expect(runtime.listContexts()).toHaveLength(2);
    await runtime.dispose();
    expect(runtime.listContexts()).toHaveLength(0);
  });
});
