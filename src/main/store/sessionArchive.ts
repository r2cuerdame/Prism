import { promises as fs } from 'fs';
import * as path from 'path';
import { z } from 'zod';
import { GeneratedSnapshotSchema, type GeneratedSnapshot } from '@shared/domain/session';
import type { SessionArchiveEntry } from '@shared/ipc';
import { JsonStore } from './jsonStore';

const SnapshotsFileSchema = z.array(GeneratedSnapshotSchema);

const MAX_SNAPSHOTS_PER_SESSION = 20;

export interface SessionArchive {
  saveSnapshot(snapshot: GeneratedSnapshot): Promise<void>;
  list(): Promise<SessionArchiveEntry[]>;
  load(sessionId: string): Promise<GeneratedSnapshot[]>;
}

export function createSessionArchive(dir: string): SessionArchive {
  const sessionsDir = path.join(dir, 'sessions');

  function storeFor(sessionId: string): JsonStore<GeneratedSnapshot[]> {
    return new JsonStore<GeneratedSnapshot[]>(
      path.join(sessionsDir, `${sessionId}.json`),
      SnapshotsFileSchema,
      () => []
    );
  }

  return {
    async saveSnapshot(snapshot) {
      const sessionId = snapshot.state.id;
      const store = storeFor(sessionId);
      let snapshots = await store.load();
      snapshots.push(snapshot);
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
      return storeFor(sessionId).load();
    }
  };
}
