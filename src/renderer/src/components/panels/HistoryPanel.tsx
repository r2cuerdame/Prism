import type { ReactElement } from 'react';
import { appStore, useAppState } from '@renderer/state/appStore';

/** Generated-state history: snapshots + undo/redo + archived sessions. */
export default function HistoryPanel(): ReactElement {
  const state = useAppState();
  const act = state.activeId ? state.sessions[state.activeId] : undefined;
  const snapshots = act?.history.snapshots ?? [];

  return (
    <div className="history-panel">
      <div className="history-actions">
        <button disabled={!appStore.canUndo()} onClick={() => appStore.undo()}>
          ⟲ 실행 취소
        </button>
        <button disabled={!appStore.canRedo()} onClick={() => appStore.redo()}>
          ⟳ 다시 실행
        </button>
      </div>
      <h4>이 세션의 생성 스냅샷</h4>
      {snapshots.length === 0 ? (
        <p className="panel-note">아직 생성된 상태가 없어요.</p>
      ) : (
        <ul className="history-snapshots">
          {[...snapshots].reverse().map((s) => (
            <li key={`${s.planId}-${s.at}`}>
              <button onClick={() => appStore.restoreSnapshot(s)} title="이 생성 상태로 되돌리기">
                <span className="history-label">{s.label}</span>
                <span className="history-time">{new Date(s.at).toLocaleString('ko-KR')}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <h4>저장된 세션</h4>
      {state.archive.length === 0 ? (
        <p className="panel-note">저장된 세션이 없어요. 페이지를 생성하면 자동으로 기록돼요.</p>
      ) : (
        <ul className="history-archive">
          {state.archive.map((a) => (
            <li key={a.sessionId}>
              <button onClick={() => void appStore.openArchivedSession(a.sessionId)}>
                <span className="history-label">{a.title}</span>
                <span className="history-time">
                  {new Date(a.updatedAt).toLocaleString('ko-KR')} · 스냅샷 {a.snapshotCount}개
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
