# Prism

> **Intent to One Page.**
> Chrome renders websites. Prism renders user intent.

Prism는 LLM 시대의 브라우저 문법을 다시 묻는 오픈소스 실험입니다. URL 대신 **의도(Intent)**, 탭 대신 **세션(Session)**, 페이지 대신 **생성된 뷰(Generated View)**, 북마크 대신 **레시피(Recipe)**, 새로고침 대신 **재생성(Regenerate)**.

전체 제품 논지는 [GOAL.md](./GOAL.md)를 보세요. 이 저장소는 그 논지를 반증 가능한 소프트웨어로 만드는 MVP입니다.

## 무엇이 되나요

- **Intent Bar** — "심심해", "AI 뉴스와 영상 보여줘" 같은 모호한 입력이 유효한 제품 입력입니다. 한국어/영어 모두 지원. 새 의도든 "뉴스 줄여줘" 같은 편집이든 **입력창은 하나**이고, 앱이 알아서 구분합니다.
- **Generated View — 주제로 재구성된 한 페이지** — YouTube·뉴스 피드·Hacker News·Lobsters·Reddit에서 모은 콘텐츠를 **소스별로도, 종류별로도 나누지 않고** 주제 단위로 다시 짭니다. 페이지는 여러 소스가 함께 말하는 바를 요약한 **합성 브리핑**(문장마다 인용 근거)으로 열고, 볼 것이 있으면 작은 **영상 앵커** 하나를 둔 뒤, 본문 전체가 **주제 묶음**입니다 — 한 카드 안에 같은 이야기의 기사·커뮤니티 글·영상이 함께 놓입니다. 어디에도 속하지 않는 것들은 "그 밖에 눈에 띈 것들"로 종류를 섞어 모읍니다. "기사 목록 / 커뮤니티 / 헤드라인" 같은 종류별 섹션은 주제가 전혀 형성되지 않을 때의 폴백일 뿐입니다. LLM 플래너(AGY, 구조화 출력)가 **큐레이션된 컴포넌트 카탈로그**로만 구성하고, 렌더러가 최종 검증·수리를 소유합니다. `agy`가 없어도 오프라인 휴리스틱 플래너가 같은 규칙으로 동작합니다.
- **직접 조작 = 언어 편집** — 드래그·리사이즈·삭제·고정(📌)과 "뉴스 줄여줘" 같은 말은 **같은 SessionCommand 버스**를 통과합니다. 채팅용 페이지와 UI용 페이지가 따로 없습니다.
- **세션 튜닝(✎)** — 페이지 위 튜닝 버튼에 한 줄 적으면 **바로 지금 페이지에 적용**되고, 그 지시는 세션에 남아 이후 재생성에도 계속 반영됩니다. 적용된 튜닝은 칩으로 보이고 언제든 해제할 수 있어요.
- **섹션 제목에서 바로 고치기** — 각 블록 제목을 클릭하면 그 자리에서 이름을 바꾸고, 제목 옆 ✎로 그 섹션만 말로 조정합니다("더 짧게", "크게", "고정").
- **끌면 영역이 쪼개져요** — 블록을 다른 블록 위로 끌면 순서만 바뀌는 게 아니라 그 영역이 나뉩니다. 좌/우에 놓으면 한 줄을 나눠 쓰고, 위/아래에 놓으면 두 단으로 쌓입니다. 놓기 전에 어느 가장자리가 갈릴지 표시돼요.
- **어디서든 재생** — "다음 영상"이나 주제 묶음 안의 영상을 누르면 위쪽 플레이어에서 바로 재생됩니다.
- **Regenerate** — 전체 페이지 또는 블록 하나만. 고정/잠금한 블록과 의도는 유지됩니다.
- **Recipe** — 마음에 든 경험(의도+소스 선호+구성+모양)을 저장하고, 열 때마다 **새 콘텐츠로 재생성**합니다.
- **출처는 항상 살아 있음** — 모든 아이템이 원본 링크·수집 시각·어댑터를 유지하고, ⓘ 패널과 Original 뷰어(격리된 창)로 확인합니다. 원본은 **명시적으로 '원본'을 눌렀을 때만** 열립니다 — 카드나 제목을 눌렀다고 앱 밖으로 튕겨나가지 않아요.
- **숨은 소스 세션** — 소스 출처(origin)마다 숨겨진 영속 Chromium 세션(쿠키·localStorage·JS·내비게이션 격리)이 하나씩 있고, 렌더러와 LLM에는 타입이 있는 의미 데이터(projection)만 전달돼요. 인증 정보는 Chromium 세션만 소유해요.
- **로그인 레일** — 로그인이 필요한 소스는 오른쪽 가장자리에 임시 레일로 열려요. 숨은 소스 세션과 같은 파티션을 쓰기 때문에 거기서 로그인하면 레일이 닫히고 페이지가 새 데이터로 갱신돼요. 비밀번호·쿠키는 절대 앱 UI로 나오지 않아요.
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

기본 LLM 공급자는 **AGY CLI**(`agy`, 모델 `gemini-3.8-flash-medium`, 구조화 JSON 출력)입니다. 설정(⚙)에 AGY 상태와 사용 중인 모델이 표시됩니다. **API 키는 필요 없습니다.** `agy`가 없으면 앱은 오프라인 휴리스틱 플래너로 완전히 동작하며, 설정에 그 상태가 그대로 표시됩니다.

Codex 로그인은 선택적 레거시 옵션입니다 — 설정에서 공급자를 `codex`로 바꾸면 `codex login`(ChatGPT 계정 OAuth) 세션을 그대로 쓰는 Codex CLI(`codex exec --output-schema …`)로 구조화된 결과를 받아옵니다. Codex CLI가 없다면 `npm i -g @openai/codex` 후 `codex login`.

`npm run build` / `npm run typecheck` / `npm test`는 모두 통과해야 합니다.

실제 웹으로 합성 결과를 확인하려면: `PRISM_LIVE=1 npx vitest run src/main/sources/liveSmoke.test.ts`

## 아키텍처 한눈에

```
renderer (Generated View)   ←  validated LayoutPlan  ←  LLM(AGY)/휴리스틱 플래너
  │  SessionCommand 버스(드래그·말 편집·재생성 공용)          ↑
  │  undo/redo · snapshots · preference signals        normalized SourceItems
  ▼                                                        ↑
preload(typed IPC)  ──  main: Source Orchestrator → Adapters(HN/Lobsters/RSS/YouTube/Reddit)
                         + SourceRuntime(origin별 숨은 세션, typed actions) + Login Rail
                         + local-first JSON stores + electron-updater + Original viewer
```

화면은 왼쪽 사이드바 = 주제/질문 세션 히스토리, 오른쪽 = Generated View 하나, 아래 = 컴포저입니다. 주소창·탭은 없습니다. 레시피·튜닝·설정은 보조 기능으로 눈에 덜 띄게 두었습니다.

- `src/shared/` — 도메인 스키마(zod)·커맨드 언어·컴포넌트 카탈로그·플래너·세션 엔진. 순수 TS, 전부 단위 테스트.
- `src/main/` — 숨겨진 소스 경계(어댑터는 Generated View에 DOM/CSS/JS를 절대 주입하지 못함), LLM 연동, 저장소, 업데이터.
- `src/renderer/` — 신뢰된 컴포넌트 레지스트리만이 생성 콘텐츠를 그립니다. `dangerouslySetInnerHTML` 없음.

## 의도된 좁음

이 MVP는 소비(영상·기사·커뮤니티) 수직 슬라이스만 지원합니다. 업무용 SaaS 호환, 픽셀 퍼펙트 사이트 재현, 탭 중심 브라우징은 [GOAL.md의 의도적 희생](./GOAL.md#deliberate-sacrifices)입니다.
