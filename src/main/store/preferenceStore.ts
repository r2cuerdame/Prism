import * as path from 'path';
import { z } from 'zod';
import { PreferenceSignalSchema, type PreferenceSignal } from '@shared/domain/preference';
import {
  buildInterestProfile,
  summarizeProfile,
  type InterestProfile,
  type ProfileOptions
} from '@shared/preference/interestProfile';
import { JsonStore } from './jsonStore';

const PreferencesFileSchema = z.array(PreferenceSignalSchema);

const MAX_SIGNALS = 500;

export interface PreferenceStore {
  list(): Promise<PreferenceSignal[]>;
  record(signals: PreferenceSignal[]): Promise<void>;
  clear(id?: string): Promise<PreferenceSignal[]>;
  getProfile(opts?: ProfileOptions): Promise<InterestProfile>;
  summarizeForPlanner(opts?: ProfileOptions): Promise<string>;
}

function isExpired(signal: PreferenceSignal, now: string): boolean {
  return signal.expiresAt !== undefined && signal.expiresAt < now;
}

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
    async getProfile(opts) {
      const active = await loadActive();
      return buildInterestProfile(active, opts);
    },
    async summarizeForPlanner(opts) {
      const active = await loadActive();
      if (active.length === 0) return '';
      const profile = buildInterestProfile(active, opts);
      return summarizeProfile(profile);
    }
  };
}
