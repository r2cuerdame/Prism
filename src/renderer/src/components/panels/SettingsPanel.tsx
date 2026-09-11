import type { ReactElement } from 'react';
import { appStore, useAppState } from '@renderer/state/appStore';

const AUTH_LABEL: Record<string, string> = {
  agy: 'AGY CLI 사용 가능 — 합성 플래너 켜짐',
  'api-key': '로그인됨 (API 키)',
  'env-key': '로그인됨 (환경 변수)',
  oauth: 'Codex 계정으로 로그인됨',
  none: '오프라인 구성으로 동작 중'
};

/**
 * Settings: which planner runs (AGY by default, Codex as the optional legacy
 * path), updates and language. There is no API key field anywhere — the app
 * borrows a CLI's own account and never holds a credential itself.
 */
export default function SettingsPanel(): ReactElement {
  const state = useAppState();
  const s = state.settings;

  if (!s) return <p className="panel-note">설정을 불러오는 중…</p>;

  const provider = s.llmProvider ?? 'agy';
  const modelShown = s.plannerModel !== '' ? s.plannerModel : provider === 'agy' ? 'gemini-3.8-flash-medium' : '(Codex 기본값)';

  return (
    <div className="settings-panel">
      <h4>플래너</h4>
      <p className={`auth-status auth-status--${s.authMethod}`} data-testid="planner-status">
        {s.authMethod === 'none' ? '○' : '●'} {AUTH_LABEL[s.authMethod] ?? s.authMethod}
      </p>
      {s.authDetail !== '' && <p className="panel-note">{s.authDetail}</p>}
      <div className="settings-row">
        <label>
          공급자{' '}
          <select
            value={provider}
            aria-label="LLM 공급자"
            onChange={(e) =>
              void appStore.saveSettings({ llmProvider: e.target.value === 'codex' ? 'codex' : 'agy' })
            }
          >
            <option value="agy">AGY (Gemini) — 기본</option>
            <option value="codex">Codex — 레거시</option>
          </select>
        </label>
        <span className="panel-note">모델: {modelShown}</span>
      </div>
      <p className="panel-note">
        {provider === 'agy'
          ? 'AGY CLI(agy)가 설치돼 있으면 gemini-3.8-flash-medium으로 페이지를 구성해요. 없으면 같은 규칙의 오프라인 휴리스틱 플래너가 대신해요.'
          : 'Codex CLI의 ChatGPT 계정 로그인을 그대로 써요. 선택적 레거시 경로예요.'}
      </p>
      <div className="settings-row">
        {provider === 'codex' && (
          <button className="auth-login-btn" onClick={() => void appStore.loginOauth()}>
            {s.authMethod === 'oauth' ? '다시 로그인' : 'Codex로 로그인'}
          </button>
        )}
        <button title="플래너 상태 다시 확인" onClick={() => void appStore.refreshAuth()}>
          상태 새로고침
        </button>
      </div>
      {state.authUrl !== null && (
        <div className="settings-row">
          <button className="auth-url-btn" onClick={() => appStore.openAuthUrl()}>
            로그인 페이지 다시 열기
          </button>
          <span className="panel-note auth-url">{state.authUrl}</span>
        </div>
      )}
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
