import { useState, type ReactElement } from 'react';
import { appStore, useAppState } from '@renderer/state/appStore';

const PHASE_LABEL: Record<string, string> = {
  interpreting: '의도를 해석하는 중…',
  gathering: '소스에서 콘텐츠를 모으는 중…',
  planning: '페이지를 구성하는 중…'
};

/**
 * The Intent Bar: address-bar shaped, but it accepts goals, moods, questions
 * and follow-ups — not URLs (GOAL.md §1). 편집 모드의 문장도 직접 조작과 같은
 * 상태를 편집한다.
 */
export default function IntentBar(): ReactElement {
  const state = useAppState();
  const [text, setText] = useState('');
  const active = state.activeId ? state.sessions[state.activeId] : undefined;
  const busy = active?.progress ?? null;
  const hasPlan = Boolean(active?.history.present.plan);

  const submit = async (): Promise<void> => {
    const value = text.trim();
    if (value === '' || busy) return;
    setText('');
    if (state.intentMode === 'edit') {
      await appStore.editWithLanguage(value);
    } else {
      await appStore.generate(value);
    }
  };

  return (
    <div className="intent-bar-wrap">
      <div className="intent-bar">
        <div className="intent-mode" role="tablist" aria-label="입력 모드">
          <button
            role="tab"
            aria-selected={state.intentMode === 'generate'}
            className={state.intentMode === 'generate' ? 'on' : ''}
            onClick={() => appStore.setIntentMode('generate')}
            title="의도를 실행해 페이지를 생성/갱신"
          >
            의도
          </button>
          <button
            role="tab"
            aria-selected={state.intentMode === 'edit'}
            className={state.intentMode === 'edit' ? 'on' : ''}
            onClick={() => appStore.setIntentMode('edit')}
            title="말로 현재 페이지를 편집 (드래그·삭제와 같은 상태를 수정)"
          >
            편집
          </button>
        </div>
        <input
          className="intent-input"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.nativeEvent.isComposing) void submit();
          }}
          placeholder={
            state.intentMode === 'edit'
              ? '예: 뉴스 줄여줘 · 영상을 맨 위로 · 커뮤니티 빼줘'
              : '무엇을 보고 싶나요? 예: 심심해 · AI 뉴스와 영상 · 오늘 게임 소식'
          }
          aria-label="의도 입력"
          disabled={busy !== null}
        />
        <button
          className="intent-go"
          onClick={() => void submit()}
          disabled={busy !== null || text.trim() === ''}
        >
          {state.intentMode === 'edit' ? '편집' : '생성'}
        </button>
        <button
          className="intent-regen"
          title="재생성: 의도와 고정한 블록은 지키고 콘텐츠를 새로 가져와요"
          onClick={() => void appStore.regenerate()}
          disabled={busy !== null || !hasPlan}
        >
          ↻ 재생성
        </button>
      </div>
      {busy && (
        <div className="intent-progress" role="status">
          <span className="spinner" /> {PHASE_LABEL[busy] ?? '작업 중…'}
        </div>
      )}
    </div>
  );
}
