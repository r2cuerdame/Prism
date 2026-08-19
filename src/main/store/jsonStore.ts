import { promises as fs } from 'fs';
import * as path from 'path';
import type { ZodType } from 'zod';

/**
 * Minimal local-first JSON file store with schema validation and
 * atomic-ish writes (tmp + rename). Electron-free for testability.
 */
export class JsonStore<T> {
  private chain: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly filePath: string,
    private readonly schema: ZodType<T>,
    private readonly fallback: () => T
  ) {}

  async load(): Promise<T> {
    let raw: string;
    try {
      raw = await fs.readFile(this.filePath, 'utf8');
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code !== 'ENOENT') await this.backupCorrupt();
      return this.fallback();
    }
    try {
      const parsed: unknown = JSON.parse(raw);
      const result = this.schema.safeParse(parsed);
      if (result.success) return result.data;
    } catch {
      // fall through to backup + fallback
    }
    await this.backupCorrupt();
    return this.fallback();
  }

  async save(value: T): Promise<void> {
    const result = this.schema.safeParse(value);
    if (!result.success) {
      const detail = result.error.issues
        .map((i) => `${i.path.join('.')}: ${i.message}`)
        .join('; ');
      throw new Error(`JsonStore(${path.basename(this.filePath)}): invalid value — ${detail}`);
    }
    const run = this.chain.then(() => this.writeAtomic(result.data));
    this.chain = run.catch(() => undefined);
    return run;
  }

  private async writeAtomic(value: T): Promise<void> {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    const tmp = `${this.filePath}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(value, null, 2), 'utf8');
    await fs.rename(tmp, this.filePath);
  }

  private async backupCorrupt(): Promise<void> {
    try {
      await fs.copyFile(this.filePath, `${this.filePath}.bak`);
    } catch {
      // best effort
    }
  }
}
