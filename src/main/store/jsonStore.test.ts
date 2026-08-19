import { describe, expect, it } from 'vitest';
import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';
import { z } from 'zod';
import { JsonStore } from './jsonStore';

const TestSchema = z.object({ name: z.string(), count: z.number() });
type TestValue = z.infer<typeof TestSchema>;

const fallback = (): TestValue => ({ name: 'fallback', count: 0 });

async function tmpDir(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), 'gptb-'));
}

describe('JsonStore', () => {
  it('returns fallback when file is missing (no .bak created)', async () => {
    const dir = await tmpDir();
    const file = path.join(dir, 'nested', 'data.json');
    const store = new JsonStore(file, TestSchema, fallback);
    expect(await store.load()).toEqual(fallback());
    await expect(fs.access(`${file}.bak`)).rejects.toThrow();
  });

  it('returns fallback and writes .bak on unparsable JSON', async () => {
    const dir = await tmpDir();
    const file = path.join(dir, 'data.json');
    await fs.writeFile(file, '{not json!!', 'utf8');
    const store = new JsonStore(file, TestSchema, fallback);
    expect(await store.load()).toEqual(fallback());
    expect(await fs.readFile(`${file}.bak`, 'utf8')).toBe('{not json!!');
  });

  it('returns fallback and writes .bak on schema-invalid JSON', async () => {
    const dir = await tmpDir();
    const file = path.join(dir, 'data.json');
    await fs.writeFile(file, JSON.stringify({ name: 5 }), 'utf8');
    const store = new JsonStore(file, TestSchema, fallback);
    expect(await store.load()).toEqual(fallback());
    await expect(fs.access(`${file}.bak`)).resolves.toBeUndefined();
  });

  it('saves atomically and reads back the same value', async () => {
    const dir = await tmpDir();
    const file = path.join(dir, 'deep', 'dir', 'data.json');
    const store = new JsonStore(file, TestSchema, fallback);
    const value: TestValue = { name: 'hello', count: 42 };
    await store.save(value);
    expect(await store.load()).toEqual(value);
    // tmp file must be gone after rename
    await expect(fs.access(`${file}.tmp`)).rejects.toThrow();
    // pretty JSON on disk
    expect(await fs.readFile(file, 'utf8')).toContain('\n');
  });

  it('rejects schema-invalid values on save', async () => {
    const dir = await tmpDir();
    const store = new JsonStore(path.join(dir, 'data.json'), TestSchema, fallback);
    await expect(
      store.save({ name: 'x', count: 'bad' } as unknown as TestValue)
    ).rejects.toThrow(/invalid value/);
  });

  it('serializes concurrent saves; last value wins', async () => {
    const dir = await tmpDir();
    const file = path.join(dir, 'data.json');
    const store = new JsonStore(file, TestSchema, fallback);
    await Promise.all(
      Array.from({ length: 10 }, (_, i) => store.save({ name: 'v', count: i }))
    );
    expect(await store.load()).toEqual({ name: 'v', count: 9 });
  });
});
