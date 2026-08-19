# GPTBrowser

> **Generated Personal Territory Browser.**
> Chrome renders websites. GPTBrowser renders user intent.

GPTBrowser는 LLM 시대의 브라우저 문법을 다시 묻는 오픈소스 실험입니다. URL 대신 **의도(Intent)**, 탭 대신 **세션(Session)**, 페이지 대신 **생성된 뷰(Generated View)**, 북마크 대신 **레시피(Recipe)**, 새로고침 대신 **재생성(Regenerate)**.

전체 제품 논지는 [GOAL.md](./GOAL.md)를 보세요. 이 저장소는 그 논지를 반증 가능한 소프트웨어로 만드는 MVP입니다.

## 무엇이 되나요

- **Intent Bar** — "심심해", "AI 뉴스와 영상 보여줘" 같은 모호한 입력이 유효한 제품 입력입니다. 한국어/영어 모두 지원.
- **Generated View** — YouTube·뉴스 피드·Hacker News·Lobsters·Reddit에서 모은 콘텐츠를 하나의 일관된 페이지로 구성합니다. LLM 플래너(`claude-opus-5`, 구조화 출력)가 **큐레이션된 컴포넌트 카탈로그**로만 구성하며, 렌더러가 최종 검증·수리를 소유합니다. API 키가 없으면 오프라인 휴리스틱 플래너로 동작합니다.
- **직접 조작 = 언어 편집** — 드래그·리사이즈·삭제·고정(📌)과 "뉴스 줄여줘" 같은 말은 **같은 SessionCommand 버스**를 통과합니다. 채팅용 페이지와 UI용 페이지가 따로 없습니다.
- **Regenerate** — 전체 페이지 또는 블록 하나만. 고정/잠금한 블록과 의도는 유지됩니다.
- **Recipe** — 마음에 든 경험(의도+소스 선호+구성+모양)을 저장하고, 열 때마다 **새 콘텐츠로 재생성**합니다.
- **출처는 항상 살아 있음** — 모든 아이템이 원본 링크·수집 시각·어댑터를 유지하고, ⓘ 패널과 Original 뷰어(격리된 창)로 확인합니다.
- **조심스러운 선호 학습** — 제거/고정/비율 조절 행동이 신뢰도 있는 신호로 기록되고, 언제든 열람·삭제할 수 있습니다.
- **자동 업데이트** — electron-updater가 GitHub Releases에서 자동으로 받아 재시작 시 설치합니다(개발 모드에선 시뮬레이션).

## 실행

```bash
npm install
npm run dev        # 개발 모드
npm test           # 단위 테스트 (vitest)
npm run typecheck  # TS strict 검사
npm run dist       # Windows NSIS 설치본 + 자동업데이트 메타데이터 생성
```

선택: 설정(⚙)에서 Anthropic API 키를 넣으면 LLM 플래너가 활성화됩니다. 키가 없어도 앱은 완전히 동작합니다.

## 아키텍처 한눈에

```
renderer (Generated View)   ←  validated LayoutPlan  ←  LLM/휴리스틱 플래너
  │  SessionCommand 버스(드래그·말 편집·재생성 공용)          ↑
  │  undo/redo · snapshots · preference signals        normalized SourceItems
  ▼                                                        ↑
preload(typed IPC)  ──  main: Source Orchestrator → Adapters(HN/Lobsters/RSS/YouTube/Reddit)
                         + local-first JSON stores + electron-updater + Original viewer
```

- `src/shared/` — 도메인 스키마(zod)·커맨드 언어·컴포넌트 카탈로그·플래너·세션 엔진. 순수 TS, 전부 단위 테스트.
- `src/main/` — 숨겨진 소스 경계(어댑터는 Generated View에 DOM/CSS/JS를 절대 주입하지 못함), LLM 연동, 저장소, 업데이터.
- `src/renderer/` — 신뢰된 컴포넌트 레지스트리만이 생성 콘텐츠를 그립니다. `dangerouslySetInnerHTML` 없음.

## 의도된 좁음

이 MVP는 소비(영상·기사·커뮤니티) 수직 슬라이스만 지원합니다. 업무용 SaaS 호환, 픽셀 퍼펙트 사이트 재현, 탭 중심 브라우징은 [GOAL.md의 의도적 희생](./GOAL.md#deliberate-sacrifices)입니다.
