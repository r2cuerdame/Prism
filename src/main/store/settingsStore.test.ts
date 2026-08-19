import { describe, expect, it } from 'vitest';
import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';
import { createSettingsStore } from './settingsStore';

async function tmpDir(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), 'gptb-'));
}

describe('settingsStore', () => {
  it('returns defaults when no file exists', async () => {
    const store = createSettingsStore(await tmpDir());
    expect(await store.get()).toEqual({
      plannerModel: 'gpt-5.5',
      autoUpdate: true,
      locale: 'ko'
    });
  });

  it('merges patches and persists', async () => {
    const dir = await tmpDir();
    const store = createSettingsStore(dir);
    const after = await store.set({ openaiApiKey: 'sk-test', locale: 'en' });
    expect(after.openaiApiKey).toBe('sk-test');
    expect(after.locale).toBe('en');
    expect(after.plannerModel).toBe('gpt-5.5');
    // new instance reads persisted state
    const reread = await createSettingsStore(dir).get();
    expect(reread).toEqual(after);
  });

  it('openaiApiKey: null deletes the key', async () => {
    const store = createSettingsStore(await tmpDir());
    await store.set({ openaiApiKey: 'sk-test' });
    const after = await store.set({ openaiApiKey: null });
    expect('openaiApiKey' in after).toBe(false);
    expect((await store.get()).openaiApiKey).toBeUndefined();
  });

  it('undefined patch values do not clobber existing settings', async () => {
    const store = createSettingsStore(await tmpDir());
    await store.set({ autoUpdate: false });
    const after = await store.set({ autoUpdate: undefined, locale: 'en' });
    expect(after.autoUpdate).toBe(false);
    expect(after.locale).toBe('en');
  });

  it('recovers from a corrupt settings file with defaults and .bak', async () => {
    const dir = await tmpDir();
    const file = path.join(dir, 'settings.json');
    await fs.writeFile(file, 'not-json', 'utf8');
    const store = createSettingsStore(dir);
    expect((await store.get()).plannerModel).toBe('gpt-5.5');
    expect(await fs.readFile(`${file}.bak`, 'utf8')).toBe('not-json');
  });
});
