import { app } from 'electron';
import electronUpdater from 'electron-updater';
import type { UpdaterStatus } from '@shared/ipc';

const { autoUpdater } = electronUpdater;

export interface UpdaterHandle {
  check(): Promise<UpdaterStatus>;
  install(): Promise<void>;
  startPeriodic(): void;
  dispose(): void;
}

const CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000;

/**
 * Auto-update via GitHub releases (electron-builder publish config).
 * In dev (unpackaged) the flow is simulated so the UI stays demonstrable.
 */
export function createUpdater(opts: {
  send: (s: UpdaterStatus) => void;
  autoUpdateEnabled: () => Promise<boolean>;
}): UpdaterHandle {
  let last: UpdaterStatus = { state: 'idle' };
  let timer: NodeJS.Timeout | null = null;
  const simTimers: NodeJS.Timeout[] = [];
  const emit = (s: UpdaterStatus): void => {
    last = s;
    opts.send(s);
  };

  const packaged = app.isPackaged;

  if (packaged) {
    // Both are re-decided from the user's setting on every check — leaving
    // them true here would keep downloading and installing after the user
    // turned the toggle off, which is what the checkbox promises not to do.
    autoUpdater.autoDownload = false;
    autoUpdater.autoInstallOnAppQuit = false;
    autoUpdater.on('checking-for-update', () => emit({ state: 'checking' }));
    autoUpdater.on('update-available', (info) =>
      emit({ state: 'available', version: info.version })
    );
    autoUpdater.on('update-not-available', () => emit({ state: 'not-available' }));
    autoUpdater.on('download-progress', (p) =>
      emit({ state: 'downloading', percent: Math.round(p.percent) })
    );
    autoUpdater.on('update-downloaded', (info) =>
      emit({ state: 'downloaded', version: info.version })
    );
    autoUpdater.on('error', (err) =>
      emit({ state: 'error', message: err.message.slice(0, 200) })
    );
  }

  const simulate = (): void => {
    for (const t of simTimers) clearTimeout(t);
    simTimers.length = 0;
    const version = `${app.getVersion()}-dev.next`;
    emit({ state: 'checking', message: '개발 모드 시뮬레이션' });
    const steps: [number, UpdaterStatus][] = [
      [600, { state: 'available', version, message: '개발 모드 시뮬레이션' }],
      [1200, { state: 'downloading', percent: 34, version, message: '개발 모드 시뮬레이션' }],
      [1900, { state: 'downloading', percent: 78, version, message: '개발 모드 시뮬레이션' }],
      [2600, { state: 'dev-simulated', version, message: '개발 모드: 다운로드 완료로 시뮬레이션됨' }]
    ];
    for (const [delay, status] of steps) {
      simTimers.push(setTimeout(() => emit(status), delay));
    }
  };

  return {
    async check(): Promise<UpdaterStatus> {
      if (!packaged) {
        simulate();
        return last;
      }
      // With the toggle off a check still reports what is available, but
      // nothing is fetched or staged until the user asks for it.
      const auto = await opts.autoUpdateEnabled();
      autoUpdater.autoDownload = auto;
      autoUpdater.autoInstallOnAppQuit = auto;
      try {
        await autoUpdater.checkForUpdates();
      } catch (err) {
        emit({
          state: 'error',
          message: err instanceof Error ? err.message.slice(0, 200) : '업데이트 확인 실패'
        });
      }
      return last;
    },
    async install(): Promise<void> {
      if (!packaged) {
        emit({ state: 'idle', message: '개발 모드에서는 설치를 건너뜁니다' });
        return;
      }
      if (last.state === 'downloaded') {
        autoUpdater.quitAndInstall();
        return;
      }
      // Pressing install with auto-download off means "yes, get it now".
      if (last.state === 'available') {
        try {
          await autoUpdater.downloadUpdate();
          // `last` was reassigned by the update-downloaded event during the
          // await; widen it so the narrowing from the check above is dropped.
          const after: UpdaterStatus = last;
          if (after.state === 'downloaded') autoUpdater.quitAndInstall();
        } catch (err) {
          emit({
            state: 'error',
            message: err instanceof Error ? err.message.slice(0, 200) : '업데이트 내려받기 실패'
          });
        }
      }
    },
    startPeriodic(): void {
      const run = async (): Promise<void> => {
        if (await opts.autoUpdateEnabled()) await this.check();
      };
      setTimeout(run, 10_000);
      timer = setInterval(run, CHECK_INTERVAL_MS);
    },
    dispose(): void {
      if (timer) clearInterval(timer);
      for (const t of simTimers) clearTimeout(t);
    }
  };
}
