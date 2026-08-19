import { useState, type ReactElement } from 'react';
import { appStore, useAppState } from '@renderer/state/appStore';

const PHASE_LABEL: Record<string, string> = {
  interpreting: '의도를 해석하는 중…',
  gathering: '소스에서 콘텐츠를 모으는 중…',
  planning: '페이지를 구성하는 중…'
};

/**
 * ChatGPT-style bottom composer, but it is an Intent Bar: goals, moods,
 * follow-ups AND page edits all land here — the bar decides, and both paths
 * edit the same Session state (GOAL.md §1, §4).
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
    await appStore.submitUtterance(value);
  };

  return (
    <div className="composer">
      {busy && (
        <div className="intent-progress" role="status">
          <span className="spinner" /> {PHASE_LABEL[busy] ?? '작업 중…'}
        </div>
      )}
      <div className="intent-bar">
        <input
          className="intent-input"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.nativeEvent.isComposing) void submit();
          }}
          placeholder={
            hasPlan
              ? '이어서 말하세요 — 새 의도도, "뉴스 줄여줘" 같은 편집도 다 돼요'
              : '무엇을 보고 싶나요? 예: 심심해 · AI 뉴스와 영상 · 오늘 게임 소식'
          }
          aria-label="의도 입력"
          disabled={busy !== null}
        />
        <button
          className="intent-go"
          onClick={() => void submit()}
          disabled={busy !== null || text.trim() === ''}
          title="입력 실행 (Enter)"
        >
          ➤
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
      <p className="composer-hint">
        블록은 드래그·리사이즈·📌고정이 되고, 말로 한 편집과 같은 상태를 공유해요
      </p>
    </div>
  );
}
