import type { InterpretedIntent } from '@shared/domain/intent';
import type { Provenance } from '@shared/domain/provenance';
import type { SourceItem, SourceItemKind } from '@shared/domain/sourceItem';
import type { AdapterReport } from '@shared/ipc';
import type {
  AdapterContext,
  AdapterResult,
  SourceAdapter,
  SourceClass,
  SourceRequest
} from './types';

export interface GatherOptions {
  perAdapterTimeoutMs?: number;
  totalLimit?: number;
}

export interface GatherResult {
  items: SourceItem[];
  provenance: Provenance[];
  reports: AdapterReport[];
}

const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_TOTAL_LIMIT = 60;
const DEFAULT_WEIGHT = 0.4;
const MAX_ADAPTERS = 5;

const CLASS_TO_KIND: Record<SourceClass, SourceItemKind> = {
  video: 'video',
  news: 'article',
  community: 'post'
};

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

function limitForAdapter(adapter: SourceAdapter, interpretation: InterpretedIntent): number {
  let weight = -1;
  for (const cls of adapter.classes) {
    const kind = CLASS_TO_KIND[cls];
    const w = interpretation.contentBalance[kind];
    weight = Math.max(weight, typeof w === 'number' ? w : DEFAULT_WEIGHT);
  }
  if (weight < 0) weight = DEFAULT_WEIGHT;
  return clamp(Math.round(6 + 12 * weight), 4, 18);
}

function buildRequest(adapter: SourceAdapter, interpretation: InterpretedIntent): SourceRequest {
  return {
    topics: interpretation.topics,
    moods: interpretation.moods,
    query: interpretation.query,
    locale: interpretation.locale,
    limit: limitForAdapter(adapter, interpretation)
  };
}

function hintMatches(adapter: SourceAdapter, hints: Set<string>): boolean {
  if (hints.has(adapter.id.toLowerCase())) return true;
  return adapter.classes.some((c) => hints.has(c.toLowerCase()));
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timeout after ${ms}ms`)), ms);
    promise.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      }
    );
  });
}

interface Selected {
  adapter: SourceAdapter;
  req: SourceRequest;
  score: number;
}

function selectAdapters(
  interpretation: InterpretedIntent,
  adapters: SourceAdapter[]
): Selected[] {
  const exclude = new Set(interpretation.sourceHints.exclude.map((s) => s.toLowerCase()));
  const include = new Set(interpretation.sourceHints.include.map((s) => s.toLowerCase()));

  const candidates: Selected[] = [];
  for (const adapter of adapters) {
    const req = buildRequest(adapter, interpretation);
    let score: number;
    try {
      score = adapter.matches(req);
    } catch {
      score = 0;
    }
    if (score <= 0) continue;
    if (exclude.size > 0 && hintMatches(adapter, exclude)) continue;
    if (include.size > 0 && !hintMatches(adapter, include) && score < 0.8) continue;
    candidates.push({ adapter, req, score });
  }
  candidates.sort((a, b) => b.score - a.score);
  return candidates.slice(0, MAX_ADAPTERS);
}

export async function gatherSources(
  interpretation: InterpretedIntent,
  adapters: SourceAdapter[],
  ctx: AdapterContext,
  opts?: GatherOptions
): Promise<GatherResult> {
  const timeoutMs = opts?.perAdapterTimeoutMs ?? DEFAULT_TIMEOUT_MS;
  const totalLimit = opts?.totalLimit ?? DEFAULT_TOTAL_LIMIT;

  const selected = selectAdapters(interpretation, adapters);

  const settled = await Promise.allSettled(
    selected.map((s) => withTimeout(s.adapter.fetchItems(s.req, ctx), timeoutMs))
  );

  // Dedupe by originalUrl across adapters in selection order (keep first).
  const seenUrls = new Set<string>();
  const perAdapterItems: SourceItem[][] = [];
  const provenancePool = new Map<string, Provenance>();
  const failures = new Map<number, string>();
  const adapterErrors = new Map<number, string>();

  settled.forEach((res, i) => {
    if (res.status === 'rejected') {
      const reason = res.reason;
      failures.set(i, reason instanceof Error ? reason.message : String(reason));
      perAdapterItems.push([]);
      return;
    }
    const result: AdapterResult = res.value;
    const deduped: SourceItem[] = [];
    for (const item of result.items) {
      if (seenUrls.has(item.originalUrl)) continue;
      seenUrls.add(item.originalUrl);
      deduped.push(item);
    }
    perAdapterItems.push(deduped);
    for (const prov of result.provenance) {
      if (!provenancePool.has(prov.id)) provenancePool.set(prov.id, prov);
    }
    if (result.errors.length > 0) adapterErrors.set(i, result.errors.join('; '));
  });

  // Round-robin merge so one adapter cannot flood the page.
  const kept: SourceItem[] = [];
  const keptCounts = new Array<number>(selected.length).fill(0);
  const cursors = new Array<number>(selected.length).fill(0);
  let progressed = true;
  while (kept.length < totalLimit && progressed) {
    progressed = false;
    for (let i = 0; i < perAdapterItems.length && kept.length < totalLimit; i++) {
      const list = perAdapterItems[i];
      const cursor = cursors[i];
      if (cursor >= list.length) continue;
      kept.push(list[cursor]);
      keptCounts[i] += 1;
      cursors[i] = cursor + 1;
      progressed = true;
    }
  }

  const usedRefs = new Set(kept.map((it) => it.provenanceRef));
  const provenance = [...provenancePool.values()].filter((p) => usedRefs.has(p.id));

  const reports: AdapterReport[] = selected.map((s, i) => {
    const failure = failures.get(i);
    if (failure !== undefined) {
      return { adapterId: s.adapter.id, name: s.adapter.name, ok: false, count: 0, error: failure };
    }
    const report: AdapterReport = {
      adapterId: s.adapter.id,
      name: s.adapter.name,
      ok: true,
      count: keptCounts[i]
    };
    const softError = adapterErrors.get(i);
    if (softError !== undefined) report.error = softError;
    return report;
  });

  return { items: kept, provenance, reports };
}
