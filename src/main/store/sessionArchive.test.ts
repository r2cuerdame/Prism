import { describe, expect, it } from 'vitest';
import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';
import { createSessionState, type GeneratedSnapshot } from '@shared/domain/session';
import { createSessionArchive } from './sessionArchive';

async function tmpDir(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), 'gptb-'));
}

function makeSnapshot(sessionId: string, at: string, title = '테스트 세션'): GeneratedSnapshot {
  const state = createSessionState(sessionId, at);
  return { planId: `plan_${at}`, at, label: '재생성', state: { ...state, title } };
}

describe('sessionArchive', () => {
  it('list returns [] when directory is missing', async () => {
    const archive = createSessionArchive(await tmpDir());
    expect(await archive.list()).toEqual([]);
  });

  it('saves snapshots per session and loads them back', async () => {
    const archive = createSessionArchive(await tmpDir());
    await archive.saveSnapshot(makeSnapshot('s1', '2026-01-01T00:00:00.000Z'));
    await archive.saveSnapshot(makeSnapshot('s1', '2026-01-02T00:00:00.000Z'));
    const snapshots = await archive.load('s1');
    expect(snapshots).toHaveLength(2);
    expect(snapshots[1].at).toBe('2026-01-02T00:00:00.000Z');
    expect(await archive.load('missing')).toEqual([]);
  });

  it('caps snapshots at 20 keeping newest', async () => {
    const archive = createSessionArchive(await tmpDir());
    for (let i = 0; i < 25; i++) {
      const at = `2026-01-01T00:00:${String(i).padStart(2, '0')}.000Z`;
      await archive.saveSnapshot(makeSnapshot('s1', at));
    }
    const snapshots = await archive.load('s1');
    expect(snapshots).toHaveLength(20);
    expect(snapshots[0].at).toBe('2026-01-01T00:00:05.000Z');
    expect(snapshots[19].at).toBe('2026-01-01T00:00:24.000Z');
  });

  it('list builds entries from latest snapshot, sorted updatedAt desc', async () => {
    const archive = createSessionArchive(await tmpDir());
    await archive.saveSnapshot(makeSnapshot('old', '2026-01-01T00:00:00.000Z', '오래된 세션'));
    await archive.saveSnapshot(makeSnapshot('new', '2026-02-01T00:00:00.000Z', '새 세션 A'));
    await archive.saveSnapshot(makeSnapshot('new', '2026-02-02T00:00:00.000Z', '새 세션 B'));
    const entries = await archive.list();
    expect(entries.map((e) => e.sessionId)).toEqual(['new', 'old']);
    expect(entries[0]).toEqual({
      sessionId: 'new',
      title: '새 세션 B',
      updatedAt: '2026-02-02T00:00:00.000Z',
      snapshotCount: 2
    });
  });

  it('skips corrupt session files in list', async () => {
    const dir = await tmpDir();
    const archive = createSessionArchive(dir);
    await archive.saveSnapshot(makeSnapshot('good', '2026-01-01T00:00:00.000Z'));
    await fs.writeFile(path.join(dir, 'sessions', 'bad.json'), '{corrupt', 'utf8');
    const entries = await archive.list();
    expect(entries.map((e) => e.sessionId)).toEqual(['good']);
  });

  it('load rejects a path-traversal sessionId and reads nothing', async () => {
    const dir = await tmpDir();
    const archive = createSessionArchive(dir);
    await archive.saveSnapshot(makeSnapshot('ses_valid', '2026-01-01T00:00:00.000Z'));
    // A sibling file outside sessionsDir that a traversal id would target.
    const escapedTarget = path.join(dir, 'etc-passwd.json');
    await fs.writeFile(escapedTarget, JSON.stringify(['not-empty']), 'utf8');
    expect(await archive.load('../etc-passwd')).toEqual([]);
    expect(await archive.load('../../../../etc/passwd')).toEqual([]);
    // The escaped file must be untouched (still there, unread/unmodified).
    expect(await fs.readFile(escapedTarget, 'utf8')).toBe(JSON.stringify(['not-empty']));
  });

  it('saveSnapshot rejects a path-traversal sessionId and writes no file outside sessionsDir', async () => {
    const dir = await tmpDir();
    const archive = createSessionArchive(dir);
    // '../escape' from <dir>/sessions resolves to <dir>/escape.json — the target
    // a successful traversal write would land at.
    const escapedTarget = path.join(dir, 'escape.json');
    const snapshot = makeSnapshot('../escape', '2026-01-01T00:00:00.000Z');
    await expect(archive.saveSnapshot(snapshot)).resolves.toBeUndefined();
    // Nothing landed at the escaped location.
    await expect(fs.access(escapedTarget)).rejects.toThrow();
    // No sessions dir (or any file) was created at all — the write was skipped entirely.
    const sessionFiles = await fs.readdir(path.join(dir, 'sessions')).catch(() => null);
    expect(sessionFiles === null || sessionFiles.length === 0).toBe(true);
  });

  it('normal ids still round-trip', async () => {
    const archive = createSessionArchive(await tmpDir());
    const id = 'ses_abc123-DEF_456';
    await archive.saveSnapshot(makeSnapshot(id, '2026-01-01T00:00:00.000Z'));
    const snapshots = await archive.load(id);
    expect(snapshots).toHaveLength(1);
    expect(snapshots[0].state.id).toBe(id);
  });
});
