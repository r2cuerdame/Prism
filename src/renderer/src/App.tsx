import { useEffect, type ReactElement } from 'react';
import { appStore, useAppState } from './state/appStore';
import IntentBar from './components/IntentBar';
import SessionTabs from './components/SessionTabs';
import RecipeShelf from './components/RecipeShelf';
import UpdateBanner from './components/UpdateBanner';
import GeneratedView from './components/GeneratedView';
import EmptyState from './components/EmptyState';
import InspectPanel from './components/panels/InspectPanel';
import HistoryPanel from './components/panels/HistoryPanel';
import PreferencesPanel from './components/panels/PreferencesPanel';
import SettingsPanel from './components/panels/SettingsPanel';

const PANEL_TITLE: Record<string, string> = {
  inspect: '출처와 근거',
  history: '히스토리',
  prefs: '학습된 선호',
  settings: '설정'
};

export default function App(): ReactElement {
  const state = useAppState();

  useEffect(() => {
    void appStore.init();
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.ctrlKey && !e.shiftKey && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        appStore.undo();
      } else if (e.ctrlKey && (e.key.toLowerCase() === 'y' || (e.shiftKey && e.key.toLowerCase() === 'z'))) {
        e.preventDefault();
        appStore.redo();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const act = state.activeId ? state.sessions[state.activeId] : undefined;
  const session = act?.history.present;
  const hasPlan = Boolean(session?.plan && session.plan.blocks.length > 0);

  return (
    <div className="app">
      <UpdateBanner />
      <header className="app-header">
        <div className="brand" title="Generated Personal Territory Browser">
          <span className="brand-mark">◍</span> GPTBrowser
        </div>
        <SessionTabs />
        <div className="header-tools">
          <button
            title="히스토리 (실행 취소 · 생성 스냅샷 · 저장된 세션)"
            className={state.panel === 'history' ? 'on' : ''}
            onClick={() => appStore.openPanel(state.panel === 'history' ? null : 'history')}
          >
            🕘
          </button>
          <button
            title="학습된 선호"
            className={state.panel === 'prefs' ? 'on' : ''}
            onClick={() => appStore.openPanel(state.panel === 'prefs' ? null : 'prefs')}
          >
            ♡
          </button>
          <button
            title="설정"
            className={state.panel === 'settings' ? 'on' : ''}
            onClick={() => appStore.openPanel(state.panel === 'settings' ? null : 'settings')}
          >
            ⚙
          </button>
        </div>
      </header>
      <IntentBar />
      <RecipeShelf />
      <div className="app-body">
        <main className="canvas">
          {session && hasPlan ? (
            <>
              {session.status === 'partial' && session.statusDetail && (
                <div className="status-line status-line--partial">{session.statusDetail}</div>
              )}
              {session.status === 'failed' && (
                <div className="status-line status-line--failed">
                  {session.statusDetail ?? '생성에 실패했어요.'}
                </div>
              )}
              <GeneratedView
                state={session}
                dispatch={(cmd) => appStore.dispatch(cmd)}
                onOpenOriginal={(url) => appStore.openOriginal(url)}
                onInspect={(blockId) => appStore.openPanel('inspect', blockId)}
                onRegenerateBlock={(blockId) => void appStore.regenerateBlock(blockId)}
              />
            </>
          ) : (
            <EmptyState />
          )}
        </main>
        {state.panel && (
          <aside className="side-panel">
            <div className="side-panel-head">
              <h2>{PANEL_TITLE[state.panel]}</h2>
              <button aria-label="패널 닫기" onClick={() => appStore.openPanel(null)}>
                ×
              </button>
            </div>
            <div className="side-panel-body">
              {state.panel === 'inspect' && <InspectPanel />}
              {state.panel === 'history' && <HistoryPanel />}
              {state.panel === 'prefs' && <PreferencesPanel />}
              {state.panel === 'settings' && <SettingsPanel />}
            </div>
          </aside>
        )}
      </div>
      {state.toast && (
        <div className="toast" role="status">
          {state.toast}
        </div>
      )}
    </div>
  );
}
