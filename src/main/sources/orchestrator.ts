import type { InterpretedIntent } from '@shared/domain/intent';
import type { Provenance } from '@shared/domain/provenance';
import type { SourceItem, SourceItemKind } from '@shared/domain/sourceItem';
import type { AdapterReport } from '@shared/ipc';
import type { InterestProfile } from '@shared/preference/interestProfile';
import { tokenize } from '@shared/planner/crossSource';
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
  profile?: InterestProfile;
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

function matchesSourceEntry(adapter: SourceAdapter, value: string): boolean {
  const v = value.toLowerCase();
  return (
    adapter.id.toLowerCase() === v ||
    adapter.name.toLowerCase() === v ||
    adapter.classes.some((c) => c.toLowerCase() === v)
  );
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
  adapters: SourceAdapter[],
  profile?: InterestProfile
): Selected[] {
  const exclude = new Set(interpretation.sourceHints.exclude.map((s) => s.toLowerCase()));
  const include = new Set(interpretation.sourceHints.include.map((s) => s.toLowerCase()));

  let candidates: Selected[] = [];
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

    // Soft modifiers from profile
    if (profile) {
      for (const s of profile.positive.sources) {
        if (matchesSourceEntry(adapter, s.value)) {
          score += Math.min(1.0, s.score * 0.2);
        }
      }
      for (const s of profile.negative.sources) {
        if (!s.hard && matchesSourceEntry(adapter, s.value)) {
          score = Math.max(0.05, score + s.score * 0.2);
        }
      }
    }

    candidates.push({ adapter, req, score });
  }

  // Explicit hard negative exclusion with diversity floor (>= 2 candidates remain)
  if (profile && profile.negative.sources.some((s) => s.hard)) {
    const hardEntries = profile.negative.sources.filter((s) => s.hard);
    const isHardNeg = (c: Selected) => hardEntries.some((e) => matchesSourceEntry(c.adapter, e.value));
    const nonHard = candidates.filter((c) => !isHardNeg(c));
    if (nonHard.length >= 2) {
      candidates = nonHard;
    } else if (candidates.length >= 2) {
      const rejected = candidates.filter(isHardNeg).sort((a, b) => b.score - a.score);
      const needed = 2 - nonHard.length;
      candidates = nonHard.concat(rejected.slice(0, needed));
    }
  }

  candidates.sort((a, b) => b.score - a.score);
  return candidates.slice(0, MAX_ADAPTERS);
}

function matchesTopic(
  title: string,
  titleTokens: Set<string>,
  entry: { value: string; terms: string[] }
): boolean {
  const val = entry.value.toLowerCase();
  if (val.length >= 2 && title.includes(val)) return true;
  if (entry.terms && entry.terms.length > 0) {
    const matched = entry.terms.filter((term) => titleTokens.has(term.toLowerCase())).length;
    if (entry.terms.length <= 2 ? matched === entry.terms.length : matched >= 2) {
      return true;
    }
  }
  return false;
}

function isItemHardRejected(item: SourceItem, profile: InterestProfile): boolean {
  const itemUrl = (item.originalUrl || '').toLowerCase();
  const itemId = item.id.toLowerCase();
  const title = item.title.toLowerCase();
  const titleTokens = tokenize(item.title);

  // 1. Hard negative items
  for (const entry of profile.negative.items) {
    if (!entry.hard) continue;
    const val = entry.value.toLowerCase();
    if (itemUrl === val || itemId === val || (val.length > 5 && itemUrl.includes(val))) return true;
    if (matchesTopic(title, titleTokens, entry)) return true;
  }

  // 2. Hard negative topics
  for (const entry of profile.negative.topics) {
    if (!entry.hard) continue;
    if (matchesTopic(title, titleTokens, entry)) return true;
  }

  return false;
}

function scoreItem(item: SourceItem, profile: InterestProfile): number {
  let score = 0;
  const title = item.title.toLowerCase();
  const titleTokens = tokenize(item.title);
  const src = item.sourceName.toLowerCase();

  for (const t of profile.positive.topics) {
    if (matchesTopic(title, titleTokens, t)) {
      score += t.score * 0.3;
    }
  }
  for (const t of profile.negative.topics) {
    if (matchesTopic(title, titleTokens, t)) {
      score += t.score * 0.3;
    }
  }

  for (const s of profile.positive.sources) {
    if (src === s.value.toLowerCase()) score += s.score * 0.2;
  }
  for (const s of profile.negative.sources) {
    if (src === s.value.toLowerCase()) score += s.score * 0.2;
  }

  for (const k of profile.positive.kinds) {
    if (item.kind === k.value) score += k.score * 0.2;
  }
  for (const k of profile.negative.kinds) {
    if (item.kind === k.value) score += k.score * 0.2;
  }

  return score;
}

export async function gatherSources(
  interpretation: InterpretedIntent,
  adapters: SourceAdapter[],
  ctx: AdapterContext,
  opts?: GatherOptions
): Promise<GatherResult> {
  const timeoutMs = opts?.perAdapterTimeoutMs ?? DEFAULT_TIMEOUT_MS;
  const totalLimit = opts?.totalLimit ?? DEFAULT_TOTAL_LIMIT;
  const profile = opts?.profile;

  const selected = selectAdapters(interpretation, adapters, profile);

  const settled = await Promise.allSettled(
    selected.map((s) => withTimeout(s.adapter.fetchItems(s.req, ctx), timeoutMs))
  );

  // Dedupe by originalUrl across adapters in selection order (keep first).
  const seenUrls = new Set<string>();
  let perAdapterItems: SourceItem[][] = [];
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

  // Apply preference profile: hard negative filtering (with diversity floor) and soft ranking
  if (profile) {
    const initialNonEmptyCount = perAdapterItems.filter((items) => items.length > 0).length;

    perAdapterItems = perAdapterItems.map((items) => {
      if (items.length === 0) return items;
      return items.filter((item) => !isItemHardRejected(item, profile));
    });

    const remainingNonEmpty = perAdapterItems.filter((items) => items.length > 0).length;
    if (initialNonEmptyCount >= 2 && remainingNonEmpty < 2) {
      for (let i = 0; i < perAdapterItems.length; i++) {
        if (perAdapterItems[i].length === 0 && settled[i].status === 'fulfilled') {
          const original = (settled[i] as PromiseFulfilledResult<AdapterResult>).value.items;
          if (original.length > 0) {
            perAdapterItems[i] = [original[0]];
            if (perAdapterItems.filter((items) => items.length > 0).length >= 2) break;
          }
        }
      }
    }

    for (let i = 0; i < perAdapterItems.length; i++) {
      perAdapterItems[i].sort((a, b) => scoreItem(b, profile) - scoreItem(a, profile));
    }
  }

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
