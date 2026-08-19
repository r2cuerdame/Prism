import type { ReactElement } from 'react';
import { appStore, useAppState } from '@renderer/state/appStore';

const AUTH_LABEL: Record<string, string> = {
  'api-key': '로그인됨 (API 키)',
  'env-key': '로그인됨 (환경 변수)',
  oauth: 'Codex 계정으로 로그인됨',
  none: '로그인 안 됨 — 오프라인 구성으로 동작 중'
};

export default function SettingsPanel(): ReactElement {
  const state = useAppState();
  const s = state.settings;

  if (!s) return <p className="panel-note">설정을 불러오는 중…</p>;

  return (
    <div className="settings-panel">
      <h4>계정</h4>
      <p className={`auth-status auth-status--${s.authMethod}`}>
        {s.authMethod === 'none' ? '○' : '●'} {AUTH_LABEL[s.authMethod]}
      </p>
      {s.authDetail !== '' && <p className="panel-note">{s.authDetail}</p>}
      <p className="panel-note">
        {s.authMethod === 'none'
          ? 'Codex 계정으로 로그인하면 여러 소스를 가로질러 합성한 페이지를 만들어요. API 키는 필요 없어요.'
          : '여러 소스를 가로질러 합성한 페이지를 만들고 있어요.'}
      </p>
      <div className="settings-row">
        <button className="auth-login-btn" onClick={() => void appStore.loginOauth()}>
          {s.authMethod === 'none' ? 'Codex로 로그인' : '다시 로그인'}
        </button>
        <button title="로그인 상태 다시 확인" onClick={() => void appStore.refreshAuth()}>
          상태 새로고침
        </button>
      </div>
      <h4>업데이트</h4>
      <div className="settings-row">
        <label>
          <input
            type="checkbox"
            checked={s.autoUpdate}
            onChange={(e) => void appStore.saveSettings({ autoUpdate: e.target.checked })}
          />{' '}
          자동 업데이트 (GitHub 릴리스에서 자동으로 받아요)
        </label>
      </div>
      <div className="settings-row">
        <button onClick={() => void appStore.checkUpdates()}>지금 업데이트 확인</button>
        <span className="panel-note">현재 버전 v{s.appVersion}</span>
      </div>
      <h4>언어</h4>
      <div className="settings-row">
        <select
          value={s.locale}
          aria-label="기본 언어"
          onChange={(e) =>
            void appStore.saveSettings({ locale: e.target.value === 'en' ? 'en' : 'ko' })
          }
        >
          <option value="ko">한국어 우선</option>
          <option value="en">English first</option>
        </select>
      </div>
    </div>
  );
}
