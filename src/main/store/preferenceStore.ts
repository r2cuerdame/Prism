import * as path from 'path';
import { z } from 'zod';
import { PreferenceSignalSchema, type PreferenceSignal } from '@shared/domain/preference';
import { JsonStore } from './jsonStore';

const PreferencesFileSchema = z.array(PreferenceSignalSchema);

const MAX_SIGNALS = 500;

export interface PreferenceStore {
  list(): Promise<PreferenceSignal[]>;
  record(signals: PreferenceSignal[]): Promise<void>;
  clear(id?: string): Promise<PreferenceSignal[]>;
  summarizeForPlanner(): Promise<string>;
}

function isExpired(signal: PreferenceSignal, now: string): boolean {
  return signal.expiresAt !== undefined && signal.expiresAt < now;
}

function signalSign(signal: PreferenceSignal): 1 | -1 {
  if (signal.kind === 'remove' || signal.kind === 'reject') return -1;
  if (signal.kind === 'adjust_mix') {
    const t = signal.interpretation.toLowerCase();
    return t.includes('줄') || t.includes('less') ? -1 : 1;
  }
  return 1;
}

const KIND_LABEL: Record<PreferenceSignal['kind'], string> = {
  drag: '이동',
  resize: '크기 조절',
  remove: '제거',
  dock: '고정',
  undock: '고정 해제',
  lock: '잠금',
  regenerate: '재생성',
  accept: '수락',
  reject: '거부',
  language_edit: '언어 편집',
  adjust_mix: '비율 조정'
};

export function createPreferenceStore(dir: string): PreferenceStore {
  const store = new JsonStore<PreferenceSignal[]>(
    path.join(dir, 'preferences.json'),
    PreferencesFileSchema,
    () => []
  );

  async function loadActive(): Promise<PreferenceSignal[]> {
    const now = new Date().toISOString();
    return (await store.load()).filter((s) => !isExpired(s, now));
  }

  return {
    async list() {
      return loadActive();
    },
    async record(signals) {
      const now = new Date().toISOString();
      let all = (await store.load()).filter((s) => !isExpired(s, now));
      all = all.concat(signals);
      if (all.length > MAX_SIGNALS) all = all.slice(all.length - MAX_SIGNALS);
      await store.save(all);
    },
    async clear(id) {
      const all = await store.load();
      const next = id === undefined ? [] : all.filter((s) => s.id !== id);
      await store.save(next);
      return next;
    },
    async summarizeForPlanner() {
      const active = await loadActive();
      if (active.length === 0) return '';

      interface Agg {
        type: PreferenceSignal['target']['type'];
        value: string;
        net: number;
        count: number;
        dominantKind: PreferenceSignal['kind'];
        kindCounts: Map<PreferenceSignal['kind'], number>;
      }
      const groups = new Map<string, Agg>();
      for (const s of active) {
        const key = `${s.target.type}:${s.target.value}`;
        let agg = groups.get(key);
        if (!agg) {
          agg = {
            type: s.target.type,
            value: s.target.value,
            net: 0,
            count: 0,
            dominantKind: s.kind,
            kindCounts: new Map()
          };
          groups.set(key, agg);
        }
        const weight = s.explicit ? 1 : s.confidence;
        agg.net += signalSign(s) * weight;
        agg.count += 1;
        agg.kindCounts.set(s.kind, (agg.kindCounts.get(s.kind) ?? 0) + 1);
      }

      const lines = [...groups.values()]
        .filter((g) => g.net !== 0)
        .sort((a, b) => Math.abs(b.net) - Math.abs(a.net))
        .slice(0, 8)
        .map((g) => {
          let topKind: PreferenceSignal['kind'] = g.dominantKind;
          let topCount = 0;
          for (const [kind, count] of g.kindCounts) {
            if (count > topCount) {
              topKind = kind;
              topCount = count;
            }
          }
          const direction = g.net < 0 ? '낮음' : '높음';
          return `- ${g.value}(${g.type}) 콘텐츠 선호 ${direction} (${KIND_LABEL[topKind]} ${topCount}회)`;
        });

      return lines.join('\n');
    }
  };
}
