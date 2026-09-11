import type { ReactElement } from 'react';
import { authRailStore, useAuthRail } from '@renderer/state/authRailStore';

const STATUS_LABEL: Record<string, string> = {
  required: '로그인이 필요해요',
  authenticating: '로그인 창이 열려 있어요',
  authenticated: '로그인됐어요',
  dismissed: '나중에 하기',
  failed: '로그인을 확인하지 못했어요',
  idle: ''
};

/**
 * The Login Rail: a temporary strip at the right edge that appears when a
 * hidden source session needs the user to sign in. The actual login form is
 * the site's own page, opened in a window that shares the SAME persistent
 * partition as the hidden source tab — so signing in there signs the source
 * in. The rail itself only shows safe state (origin, status); it never holds
 * or displays a credential. It collapses as soon as main re-projects.
 */
export default function AuthRail(): ReactElement | null {
  const { state, completing, error } = useAuthRail();
  if (!state || !state.active) return null;

  const host = (() => {
    try {
      return new URL(state.origin).host;
    } catch {
      return state.origin;
    }
  })();

  return (
    <aside className={`auth-rail auth-rail--${state.status}`} role="complementary" aria-label="로그인 레일" data-testid="auth-rail">
      <div className="auth-rail-head">
        <span className="auth-rail-dot" aria-hidden="true" />
        <h2 className="auth-rail-title">{state.title}</h2>
        <button
          className="auth-rail-close"
          aria-label="로그인 레일 닫기"
          title="나중에 (이 소스는 로그인 없이 보여요)"
          onClick={() => void authRailStore.dismiss()}
        >
          ×
        </button>
      </div>
      <p className="auth-rail-status" data-testid="auth-rail-status">
        {STATUS_LABEL[state.status] ?? state.status}
      </p>
      <p className="auth-rail-origin" title={state.origin}>
        {host}
      </p>
      <p className="auth-rail-note">
        이 소스는 로그인해야 실제 내용을 보여줘요. 로그인 창은 숨은 소스 세션과{' '}
        <strong>같은 파티션</strong>을 쓰기 때문에 거기서 로그인하면 이 페이지가 곧바로 갱신돼요.
        비밀번호와 쿠키는 그 세션 안에만 남고 Prism 화면으로는 절대 나오지 않아요.
      </p>
      {state.message ? <p className="auth-rail-message">{state.message}</p> : null}
      {error ? (
        <p className="auth-rail-error" role="alert">
          {error}
        </p>
      ) : null}
      <div className="auth-rail-actions">
        <button
          className="auth-rail-launch"
          data-testid="auth-rail-launch"
          onClick={() => void authRailStore.launch()}
          disabled={completing}
        >
          {state.status === 'authenticating' ? '로그인 창 다시 열기' : '로그인 창 열기'}
        </button>
        <button
          className="auth-rail-done"
          data-testid="auth-rail-complete"
          onClick={() => void authRailStore.complete()}
          disabled={completing}
          title="로그인을 마쳤으면 눌러 주세요 — 소스를 다시 읽어 페이지를 갱신해요"
        >
          {completing ? '확인 중…' : '로그인 완료'}
        </button>
      </div>
    </aside>
  );
}
