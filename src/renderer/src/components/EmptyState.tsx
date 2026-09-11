import type { ReactElement } from 'react';
import { appStore, useAppState } from '@renderer/state/appStore';

const EXAMPLES = [
  '심심해',
  'AI 뉴스와 영상 보여줘',
  '오늘 게임 소식 뭐 있어?',
  '밥 먹으면서 볼만한 잔잔한 거',
  '개발자들이 요즘 토론하는 주제',
  'world news briefing'
];

export default function EmptyState(): ReactElement {
  const { settings } = useAppState();
  const offline = settings !== null && settings.authMethod === 'none';
  return (
    <div className="empty-state" data-testid="empty-state">
      {offline && (
        <div className="empty-auth">
          <span>
            지금은 <strong>오프라인 구성</strong>으로 동작해요. AGY CLI(<code>agy</code>)가 있으면
            여러 소스를 <strong>하나의 페이지로 합성</strong>하는 플래너가 켜져요. API 키는 필요
            없어요.
          </span>
          <button onClick={() => appStore.openPanel('settings')}>설정에서 확인</button>
        </div>
      )}
      <div className="empty-brand">
        <h1>Prism</h1>
        <p className="empty-tagline">Intent to One Page</p>
        <p className="empty-sub">
          주소를 입력하는 대신, <strong>원하는 웹을 설명하세요.</strong> 여러 소스를 가로질러
          <strong> 하나의 새 페이지로 합성</strong>해 드려요 — 그리고 그 페이지는 직접 만질 수
          있어요.
        </p>
      </div>
      <div className="empty-examples">
        {EXAMPLES.map((ex) => (
          <button key={ex} onClick={() => void appStore.generate(ex)}>
            {ex}
          </button>
        ))}
      </div>
      <ul className="empty-hints">
        <li>
          사이트별로 나열하지 않아요 — 여러 소스를 <strong>가로질러 합성한 한 페이지</strong>를
          만들고, 문장마다 어디서 왔는지 표시해요.
        </li>
        <li>블록을 <strong>드래그</strong>해 순서를 바꾸고, 가장자리를 끌어 <strong>크기</strong>를 조절해요.</li>
        <li>📌 <strong>고정</strong>한 블록은 재생성해도 유지돼요.</li>
        <li>말로도 편집돼요 — “뉴스 줄여줘”, “영상을 맨 위로”.</li>
        <li>마음에 든 페이지는 <strong>레시피</strong>로 저장하고, 열 때마다 새 콘텐츠로 다시 만들어요.</li>
      </ul>
    </div>
  );
}
