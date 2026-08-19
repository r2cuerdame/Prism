import { promises as fs } from 'fs';
import * as path from 'path';
import { z } from 'zod';
import { GeneratedSnapshotSchema, type GeneratedSnapshot } from '@shared/domain/session';
import type { SessionArchiveEntry } from '@shared/ipc';
import { JsonStore } from './jsonStore';

const SnapshotsFileSchema = z.array(GeneratedSnapshotSchema);

const MAX_SNAPSHOTS_PER_SESSION = 20;

// Session ids are generated as `ses_<uuid>`; anything else is untrusted
// input (renderer IPC only checks it's a string) and must not reach the fs.
const SAFE_SESSION_ID = /^[A-Za-z0-9_-]{1,128}$/;

export interface SessionArchive {
  saveSnapshot(snapshot: GeneratedSnapshot): Promise<void>;
  list(): Promise<SessionArchiveEntry[]>;
  load(sessionId: string): Promise<GeneratedSnapshot[]>;
}

export function createSessionArchive(dir: string): SessionArchive {
  const sessionsDir = path.join(dir, 'sessions');

  /** Rejects any id that isn't a plain safe token or that escapes sessionsDir. */
  function safeSessionFile(sessionId: string): string | null {
    if (!SAFE_SESSION_ID.test(sessionId)) return null;
    const resolved = path.resolve(sessionsDir, `${sessionId}.json`);
    const base = path.resolve(sessionsDir) + path.sep;
    if (!resolved.startsWith(base)) return null;
    return resolved;
  }

  function storeFor(filePath: string): JsonStore<GeneratedSnapshot[]> {
    return new JsonStore<GeneratedSnapshot[]>(filePath, SnapshotsFileSchema, () => []);
  }

  return {
    async saveSnapshot(snapshot) {
      const sessionId = snapshot.state.id;
      const filePath = safeSessionFile(sessionId);
      if (!filePath) return;
      const store = storeFor(filePath);
      let snapshots = await store.load();
      const last = snapshots[snapshots.length - 1];
      if (last && last.planId === snapshot.planId && last.label === snapshot.label) {
        // Rolling edit saves replace their predecessor, so a long editing
        // session cannot push the generated states out of the archive.
        snapshots[snapshots.length - 1] = snapshot;
      } else {
        snapshots.push(snapshot);
      }
      if (snapshots.length > MAX_SNAPSHOTS_PER_SESSION) {
        snapshots = snapshots.slice(snapshots.length - MAX_SNAPSHOTS_PER_SESSION);
      }
      await store.save(snapshots);
    },

    async list() {
      let files: string[];
      try {
        files = await fs.readdir(sessionsDir);
      } catch {
        return [];
      }
      const entries: SessionArchiveEntry[] = [];
      for (const file of files) {
        if (!file.endsWith('.json')) continue;
        const sessionId = file.slice(0, -'.json'.length);
        if (!SAFE_SESSION_ID.test(sessionId)) continue;
        let raw: string;
        try {
          raw = await fs.readFile(path.join(sessionsDir, file), 'utf8');
        } catch {
          continue;
        }
        let parsed: unknown;
        try {
          parsed = JSON.parse(raw);
        } catch {
          continue;
        }
        const result = SnapshotsFileSchema.safeParse(parsed);
        if (!result.success || result.data.length === 0) continue;
        const latest = result.data[result.data.length - 1];
        entries.push({
          sessionId,
          title: latest.state.title,
          updatedAt: latest.at,
          snapshotCount: result.data.length
        });
      }
      return entries.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    },

    async load(sessionId) {
      const filePath = safeSessionFile(sessionId);
      if (!filePath) return [];
      return storeFor(filePath).load();
    }
  };
}
