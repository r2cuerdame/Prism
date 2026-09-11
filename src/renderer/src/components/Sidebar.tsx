import { useState, type ReactElement } from 'react';
import { appStore, useAppState } from '@renderer/state/appStore';

/**
 * ChatGPT-style left column: a history of topics (Sessions — generated spaces
 * around an intent) and, below, Recipes (living bookmarks). There are no tabs
 * and no address bar anywhere in the shell; this list IS the navigation.
 */
export default function Sidebar(): ReactElement {
  const state = useAppState();
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState('');
  const active = state.activeId ? state.sessions[state.activeId] : undefined;
  const hasPlan = Boolean(active?.history.present.plan);

  const saveRecipe = async (): Promise<void> => {
    const n = name.trim();
    if (n === '') return;
    setNaming(false);
    setName('');
    await appStore.saveCurrentAsRecipe(n);
  };

  return (
    <aside className="sidebar" data-testid="prism-sidebar">
      <div className="brand" title="Prism — Intent to One Page" data-testid="prism-brand">
        <span className="brand-mark">◭</span> Prism
      </div>

      <button className="sidebar-new" data-testid="new-session" onClick={() => appStore.newSession()}>
        ＋ 새 주제
      </button>

      <div className="sidebar-section">
        <div className="sidebar-label">주제 히스토리</div>
        <div className="sidebar-sessions" data-testid="session-list">
          {state.order.map((id) => {
            const entry = state.sessions[id];
            if (!entry) return null;
            const s = entry.history.present;
            const on = id === state.activeId;
            return (
              <div
                key={id}
                role="button"
                tabIndex={0}
                className={`sidebar-session${on ? ' on' : ''}`}
                onClick={() => appStore.setActive(id)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') appStore.setActive(id);
                }}
              >
                <span className={`session-dot session-dot--${s.status}`} />
                <span className="sidebar-session-title">{s.title}</span>
                <button
                  className="sidebar-session-close"
                  aria-label="주제 닫기"
                  onClick={(e) => {
                    e.stopPropagation();
                    appStore.closeSession(id);
                  }}
                >
                  ×
                </button>
              </div>
            );
          })}
        </div>
      </div>

      <div className="sidebar-section">
        <div className="sidebar-label">레시피</div>
        <div className="sidebar-recipes">
          {state.recipes.length === 0 && !naming && (
            <p className="sidebar-empty">
              마음에 든 페이지를 저장하면, 열 때마다 새 콘텐츠로 다시 만들어져요.
            </p>
          )}
          {state.recipes.map((r) => (
            <div key={r.id} className="sidebar-recipe">
              <button
                className="sidebar-recipe-run"
                title={`"${r.intentTemplate}" — 열면 재생성돼요`}
                onClick={() => void appStore.runRecipe(r)}
              >
                ☆ {r.name}
              </button>
              <button
                className="sidebar-session-close"
                aria-label={`레시피 ${r.name} 삭제`}
                onClick={() => void appStore.removeRecipe(r.id)}
              >
                ×
              </button>
            </div>
          ))}
          {naming ? (
            <div className="sidebar-naming">
              <input
                autoFocus
                value={name}
                placeholder="레시피 이름 (예: 저녁 믹스)"
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.nativeEvent.isComposing) void saveRecipe();
                  if (e.key === 'Escape') setNaming(false);
                }}
              />
              <button onClick={() => void saveRecipe()}>저장</button>
            </div>
          ) : (
            <button
              className="sidebar-recipe-add"
              disabled={!hasPlan}
              title="현재 페이지의 의도·구성·모양을 레시피로 저장"
              onClick={() => setNaming(true)}
            >
              ＋ 현재 페이지 저장
            </button>
          )}
        </div>
      </div>

      <div className="sidebar-footer">
        <button
          title="히스토리 (실행 취소 · 생성 스냅샷 · 저장된 세션)"
          className={state.panel === 'history' ? 'on' : ''}
          onClick={() => appStore.openPanel(state.panel === 'history' ? null : 'history')}
        >
          🕘 히스토리
        </button>
        <button
          title="학습된 선호 (열람·삭제 가능)"
          className={state.panel === 'prefs' ? 'on' : ''}
          onClick={() => appStore.openPanel(state.panel === 'prefs' ? null : 'prefs')}
        >
          ♡ 선호
        </button>
        <button
          title="설정"
          className={state.panel === 'settings' ? 'on' : ''}
          onClick={() => appStore.openPanel(state.panel === 'settings' ? null : 'settings')}
        >
          ⚙ 설정
        </button>
      </div>
    </aside>
  );
}
