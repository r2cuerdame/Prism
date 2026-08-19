import { useState, type ReactElement } from 'react';
import { appStore, useAppState } from '@renderer/state/appStore';

const PRESETS = ['더 짧게', '영상 위주로', '커뮤니티 줄여줘', '한국 소식 위주로'];

/**
 * Session tuning: drop in a line of text and it lands on THIS session
 * immediately, then keeps applying to its future generations.
 */
export default function TuningBar(): ReactElement {
  const state = useAppState();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const act = state.activeId ? state.sessions[state.activeId] : undefined;
  const notes = act?.history.present.compositionHints.notes ?? [];
  const busy = act?.progress ?? null;

  const apply = async (value: string, regenerate: boolean): Promise<void> => {
    const v = value.trim();
    if (v === '' || busy) return;
    setText('');
    await appStore.tuneSession(v, { regenerate });
  };

  return (
    <div className="tuning">
      <div className="tuning-head">
        <button
          className={`tuning-toggle${open ? ' on' : ''}`}
          onClick={() => setOpen((v) => !v)}
          title="이 세션을 글로 튜닝해요 — 바로 적용되고, 재생성에도 계속 반영돼요"
        >
          ✎ 튜닝
        </button>
        {notes.map((n) => (
          <span key={n} className="tuning-note" title="이 세션에 적용 중인 튜닝">
            {n}
            <button
              aria-label={`튜닝 "${n}" 해제`}
              onClick={() => appStore.removeTuningNote(n)}
            >
              ×
            </button>
          </span>
        ))}
      </div>
      {open && (
        <div className="tuning-body">
          <textarea
            autoFocus
            rows={2}
            value={text}
            placeholder="이 세션을 어떻게 바꿀까요? 예: 뉴스 줄이고 영상 늘려줘 · 한국어 소스 위주로 · 더 짧게"
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                void apply(text, false);
              }
              if (e.key === 'Escape') setOpen(false);
            }}
          />
          <div className="tuning-actions">
            {PRESETS.map((p) => (
              <button key={p} className="tuning-preset" onClick={() => void apply(p, false)}>
                {p}
              </button>
            ))}
            <span className="tuning-spacer" />
            <button
              className="tuning-apply"
              disabled={text.trim() === '' || busy !== null}
              onClick={() => void apply(text, false)}
            >
              바로 적용
            </button>
            <button
              className="tuning-apply-regen"
              disabled={text.trim() === '' || busy !== null}
              title="튜닝을 반영해 콘텐츠까지 새로 가져와 다시 구성해요"
              onClick={() => void apply(text, true)}
            >
              적용 + 재생성
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
