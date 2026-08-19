import type { ReactElement } from 'react';
import { appStore, useAppState } from '@renderer/state/appStore';

/** Sessions, not tabs: each is a generated space around an intent. */
export default function SessionTabs(): ReactElement {
  const state = useAppState();
  return (
    <div className="session-tabs" role="tablist" aria-label="세션">
      {state.order.map((id) => {
        const entry = state.sessions[id];
        if (!entry) return null;
        const s = entry.history.present;
        const active = id === state.activeId;
        return (
          <div
            key={id}
            role="tab"
            aria-selected={active}
            className={`session-tab${active ? ' on' : ''}`}
            onClick={() => appStore.setActive(id)}
          >
            <span className={`session-dot session-dot--${s.status}`} />
            <span className="session-title">{s.title}</span>
            <button
              className="session-close"
              aria-label="세션 닫기"
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
      <button
        className="session-new"
        title="새 세션"
        aria-label="새 세션"
        onClick={() => appStore.newSession()}
      >
        ＋
      </button>
    </div>
  );
}
