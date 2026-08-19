import type { ReactElement } from 'react';
import { appStore, useAppState } from '@renderer/state/appStore';

const KIND_LABEL: Record<string, string> = {
  drag: '이동',
  resize: '크기 조절',
  remove: '제거',
  dock: '고정',
  undock: '고정 해제',
  lock: '잠금',
  regenerate: '재생성',
  accept: '수락',
  reject: '거절',
  language_edit: '언어 편집',
  adjust_mix: '비율 조절'
};

/**
 * Learned preferences are inspectable, editable and deletable —
 * durable inference must be reversible (GOAL.md § privacy).
 */
export default function PreferencesPanel(): ReactElement {
  const state = useAppState();
  const signals = [...state.prefSignals].reverse();

  return (
    <div className="prefs-panel">
      <p className="panel-note">
        드래그·삭제·고정 같은 직접 조작과 말로 한 수정에서 조심스럽게 배운 신호들이에요. 다음
        생성에 참고되며, 언제든 삭제할 수 있어요.
      </p>
      {signals.length > 0 && (
        <button className="prefs-clear-all" onClick={() => void appStore.clearPref()}>
          전체 삭제
        </button>
      )}
      {signals.length === 0 ? (
        <p className="panel-note">아직 학습된 신호가 없어요.</p>
      ) : (
        <ul className="prefs-list">
          {signals.map((s) => (
            <li key={s.id} className={s.explicit ? 'explicit' : ''}>
              <div className="prefs-line">
                <span className="prefs-kind">{KIND_LABEL[s.kind] ?? s.kind}</span>
                <span className="prefs-target">
                  {s.target.type}:{s.target.value}
                </span>
                <span className="prefs-conf">
                  {s.explicit ? '명시적' : `추정 ${Math.round(s.confidence * 100)}%`}
                </span>
                <button
                  className="prefs-del"
                  aria-label="신호 삭제"
                  onClick={() => void appStore.clearPref(s.id)}
                >
                  ×
                </button>
              </div>
              <div className="prefs-interp">{s.interpretation}</div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
