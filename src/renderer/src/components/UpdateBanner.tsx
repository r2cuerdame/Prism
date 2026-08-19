import type { ReactElement } from 'react';
import { appStore, useAppState } from '@renderer/state/appStore';

/** Auto-update surface: GitHub 릴리스에서 받아 재시작으로 설치. */
export default function UpdateBanner(): ReactElement | null {
  const { updater } = useAppState();
  if (updater.state === 'idle' || updater.state === 'not-available') return null;

  let body: ReactElement;
  switch (updater.state) {
    case 'checking':
      body = <span>업데이트 확인 중…</span>;
      break;
    case 'available':
      body = <span>새 버전 {updater.version} 발견 — 백그라운드에서 내려받는 중이에요.</span>;
      break;
    case 'downloading':
      body = (
        <span>
          업데이트 다운로드 중… {updater.percent ?? 0}%
          <span className="update-progress">
            <span style={{ width: `${updater.percent ?? 0}%` }} />
          </span>
        </span>
      );
      break;
    case 'downloaded':
      body = (
        <span>
          버전 {updater.version} 준비 완료.{' '}
          <button className="update-install" onClick={() => appStore.installUpdate()}>
            재시작하고 업데이트
          </button>
        </span>
      );
      break;
    case 'dev-simulated':
      body = <span>업데이트 흐름 시뮬레이션 완료 (개발 모드) — 배포 빌드에서는 실제로 설치돼요.</span>;
      break;
    case 'error':
      body = <span>업데이트 확인 실패: {updater.message ?? '알 수 없는 오류'}</span>;
      break;
    default:
      return null;
  }

  return (
    <div className={`update-banner update-banner--${updater.state}`} role="status">
      <span className="update-icon">⬆</span>
      {body}
    </div>
  );
}
