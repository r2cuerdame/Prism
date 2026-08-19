import { useState, type ReactElement } from 'react';
import { appStore, useAppState } from '@renderer/state/appStore';

const MODELS = ['claude-opus-5', 'claude-sonnet-5', 'claude-haiku-4-5'];

export default function SettingsPanel(): ReactElement {
  const state = useAppState();
  const s = state.settings;
  const [keyDraft, setKeyDraft] = useState('');

  if (!s) return <p className="panel-note">설정을 불러오는 중…</p>;

  return (
    <div className="settings-panel">
      <h4>LLM 플래너</h4>
      <p className="panel-note">
        {s.hasApiKey
          ? 'API 키가 설정되어 있어 LLM이 페이지를 계획해요.'
          : 'API 키가 없으면 오프라인 휴리스틱 플래너로 동작해요. 키를 넣으면 의도 해석과 페이지 구성이 훨씬 좋아져요.'}
      </p>
      <div className="settings-row">
        <input
          type="password"
          placeholder={s.hasApiKey ? '새 Anthropic API 키로 교체…' : 'Anthropic API 키 (sk-ant-…)'}
          value={keyDraft}
          onChange={(e) => setKeyDraft(e.target.value)}
        />
        <button
          disabled={keyDraft.trim() === ''}
          onClick={() => {
            void appStore.saveSettings({ anthropicApiKey: keyDraft.trim() });
            setKeyDraft('');
          }}
        >
          저장
        </button>
        {s.hasApiKey && (
          <button onClick={() => void appStore.saveSettings({ anthropicApiKey: null })}>
            키 삭제
          </button>
        )}
      </div>
      <div className="settings-row">
        <label htmlFor="model-select">모델</label>
        <select
          id="model-select"
          value={s.plannerModel}
          onChange={(e) => void appStore.saveSettings({ plannerModel: e.target.value })}
        >
          {MODELS.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
          {!MODELS.includes(s.plannerModel) && (
            <option value={s.plannerModel}>{s.plannerModel}</option>
          )}
        </select>
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
