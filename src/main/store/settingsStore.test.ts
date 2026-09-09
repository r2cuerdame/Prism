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
      plannerModel: '',
      autoUpdate: true,
      locale: 'ko',
      llmProvider: 'agy'
    });
  });

  it('merges patches and persists', async () => {
    const dir = await tmpDir();
    const store = createSettingsStore(dir);
    const after = await store.set({ plannerModel: 'gpt-5-codex', locale: 'en' });
    expect(after.plannerModel).toBe('gpt-5-codex');
    expect(after.locale).toBe('en');
    expect(after.autoUpdate).toBe(true);
    // new instance reads persisted state
    const reread = await createSettingsStore(dir).get();
    expect(reread).toEqual(after);
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
    expect((await store.get()).plannerModel).toBe('');
    expect(await fs.readFile(`${file}.bak`, 'utf8')).toBe('not-json');
  });
});
