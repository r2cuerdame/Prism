import * as path from 'path';
import { z } from 'zod';
import { JsonStore } from './jsonStore';

export const SettingsSchema = z.object({
  anthropicApiKey: z.string().optional(),
  plannerModel: z.string().default('claude-opus-5'),
  autoUpdate: z.boolean().default(true),
  locale: z.enum(['ko', 'en']).default('ko')
});

export type Settings = z.infer<typeof SettingsSchema>;

export type SettingsPatchInput = Omit<Partial<Settings>, 'anthropicApiKey'> & {
  anthropicApiKey?: string | null;
};

export interface SettingsStore {
  get(): Promise<Settings>;
  set(patch: SettingsPatchInput): Promise<Settings>;
}

export function createSettingsStore(dir: string): SettingsStore {
  const store = new JsonStore<Settings>(
    path.join(dir, 'settings.json'),
    SettingsSchema,
    () => SettingsSchema.parse({})
  );

  return {
    async get() {
      return store.load();
    },
    async set(patch) {
      const current = await store.load();
      const merged: Record<string, unknown> = { ...current };
      for (const [key, value] of Object.entries(patch)) {
        if (value === undefined) continue;
        merged[key] = value;
      }
      if (patch.anthropicApiKey === null) delete merged.anthropicApiKey;
      const next = SettingsSchema.parse(merged);
      await store.save(next);
      return next;
    }
  };
}
