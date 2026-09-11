import type { Provenance } from '@shared/domain/provenance';
import type { SourceItem } from '@shared/domain/sourceItem';
import type { AdapterResult } from '../types';

/**
 * Fetch every target concurrently, then merge their batches round-robin
 * (target order, each batch keeping its own order) before capping at `limit`.
 *
 * Adapters that query several channels/feeds/subs per request used to await
 * each one in turn and then `slice(0, limit)` the concatenation — the first
 * target's batch alone filled the cap, so the later fetches were pure waste
 * and every item came from one outlet. Interleaving first guarantees the
 * secondary targets are represented; a rejected target only contributes an
 * error string, never a thrown promise.
 */
export async function fetchTargetsInterleaved<T>(
  targets: readonly T[],
  fetchOne: (target: T) => Promise<AdapterResult>,
  describeFailure: (target: T, error: unknown) => string,
  limit: number
): Promise<AdapterResult> {
  const settled = await Promise.allSettled(
    // The async wrapper turns a synchronous throw into a rejection.
    targets.map(async (target) => fetchOne(target))
  );

  const batches: SourceItem[][] = [];
  const provenance: Provenance[] = [];
  const errors: string[] = [];
  settled.forEach((res, i) => {
    if (res.status === 'rejected') {
      errors.push(describeFailure(targets[i]!, res.reason));
      return;
    }
    batches.push(res.value.items);
    provenance.push(...res.value.provenance);
    errors.push(...res.value.errors);
  });

  const kept: SourceItem[] = [];
  const total = batches.reduce((n, b) => n + b.length, 0);
  for (let round = 0; kept.length < Math.min(limit, total); round++) {
    for (const batch of batches) {
      if (kept.length >= limit) break;
      if (round < batch.length) kept.push(batch[round]!);
    }
  }

  const refs = new Set(kept.map((i) => i.provenanceRef));
  return {
    items: kept,
    provenance: provenance.filter((p) => refs.has(p.id)),
    errors
  };
}
