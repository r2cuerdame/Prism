# GPTBrowser MVP Implementation Plan

> **For agentic workers:** You will be given ONE task from this plan. Read the
> "Global Constraints" and "Frozen Contracts" sections plus your task. The
> contract source files under `src/shared/` are authoritative — read them before
> writing code. Write ONLY the files listed in your task. Do not commit.

**Goal:** Implement the GOAL.md MVP — an Electron desktop app where a vague
intent becomes a generated, directly-manipulable one-page experience composed
from real sources, with Recipes, Regenerate, provenance, session history — plus
auto-update via GitHub releases.

**Architecture:** Strict boundary between hidden source execution (main
process: adapters → normalize → SourceItems) and generated UI (renderer:
validated LayoutPlan → trusted component registry). One shared command language
(`SessionCommand`) drives BOTH direct manipulation and natural-language edits.
LLM planner (claude-opus-5, structured outputs) with a deterministic heuristic
fallback so the app always works offline/keyless.

**Tech Stack:** Electron, electron-vite, React 18+, TypeScript (strict), zod 4,
@anthropic-ai/sdk (messages.parse + zodOutputFormat), fast-xml-parser,
@dnd-kit/core + @dnd-kit/sortable, electron-builder + electron-updater, vitest.

**Spec:** `GOAL.md` (repo root). MVP checklist = GOAL.md § "Intentionally
narrow MVP" items 1–11 + auto-update (user request).

## Global Constraints

- TypeScript `strict: true`. No `any` unless interfacing with untyped payloads
  (then narrow immediately).
- All cross-boundary data validated with zod at the boundary
  (planner output, IPC payloads from renderer, adapter payloads).
- Renderer: `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`.
  Source HTML/CSS/JS must NEVER reach the Generated View — only normalized
  `SourceItem` fields (plain text/urls). The only embed exception is the
  YouTube iframe player (youtube-nocookie.com) inside `video_player`.
- Every SourceItem carries provenance (`originalUrl`, `sourceName`,
  `retrievedAt`, `adapterId`). Every rendered block exposes it.
- UI copy: Korean-first (세션, 레시피, 재생성, 원본, 의도 등). Grammar words from
  GOAL.md must appear in the UI: Intent(의도), Session(세션), Generated View,
  Recipe(레시피), Regenerate(재생성), Original(원본).
- No network calls from the renderer except images/YouTube embeds. All source
  fetching happens in main.
- Pure domain logic lives in `src/shared/` and must not import from
  `electron`, `react`, or `src/main`/`src/renderer`.
- Import alias: `@shared/*` → `src/shared/*` (configured in tsconfigs, vite,
  and vitest).
- Tests: vitest, colocated `*.test.ts` next to sources. Fixtures under
  `__fixtures__/` directories as `.ts` modules exporting raw payload strings.
- Adapters must not throw on malformed payloads: return `{items: [], errors}`.
- Korean + English input both supported by rule-based interpreters.

## File Map (ownership per task)

```
src/shared/domain/       ids, intent, sourceItem, layoutPlan, session, recipe,
                         preference, provenance, commands        [SCAFFOLD - frozen]
src/shared/catalog/catalog.ts                                    [SCAFFOLD - frozen]
src/shared/ipc.ts                                                [SCAFFOLD - frozen]
src/shared/planner/plannerTypes.ts                               [SCAFFOLD - frozen]
src/shared/planner/heuristicIntent.ts + heuristicPlanner.ts      [Task P1]
src/shared/planner/validatePlan.ts                               [Task P2]
src/shared/planner/nlRules.ts                                    [Task P2]
src/shared/sessionEngine/reducer.ts, history.ts, preferenceInfer.ts [Task S1]
src/main/sources/http.ts, adapters/hackernews.ts, adapters/lobsters.ts [Task A1]
src/main/sources/adapters/rssNews.ts, youtube.ts, reddit.ts      [Task A2]
src/main/sources/orchestrator.ts                                 [Task A3]
src/main/store/jsonStore.ts, recipeStore.ts, preferenceStore.ts,
              sessionStore.ts, settingsStore.ts                  [Task ST1]
src/renderer/src/components/blocks/*(video/headline group)       [Task C1]
src/renderer/src/components/blocks/*(article/community/primitives)[Task C2]
src/main/llm/*  (anthropicClient, llmIntent, llmPlanner, llmEditor) [INLINE]
src/main/updater.ts, originalViewer.ts, ipcHandlers.ts, index.ts [INLINE]
src/preload/index.ts                                             [INLINE]
src/renderer/src/App.tsx, GeneratedView, IntentBar, panels, CSS  [INLINE]
```

## Frozen Contracts (summary — source files are authoritative)

### SourceItem (`src/shared/domain/sourceItem.ts`)
`kind: 'video' | 'article' | 'post' | 'headline'`. Fields: `id, adapterId,
sourceId, sourceName, kind, title, summary?, media? {thumbnailUrl?, embedId?},
payload (kind-specific), originalUrl, publishedAt?, retrievedAt, provenanceRef,
lang?`. `video.payload = {videoId, channel, durationText?}` (videoId = YouTube
id). `post.payload = {points?, commentCount?, commentsUrl?, community}`.
`article.payload = {source, excerpt?}`.

### ComponentBlock / LayoutPlan (`src/shared/domain/layoutPlan.ts`)
Block: `{id, componentType, componentVersion, sourceItemRefs: string[],
props: Record<string, unknown>, layout: {span: 1..12, heightPx?: number},
locked?: boolean, docked?: boolean, rationale?: string,
state?: Record<string, unknown>}`.
Plan: `{id, version: 1, sessionId, blocks: Block[], generationScope:
'full' | 'region', preservedEdits: {dockedBlockIds: string[]},
plannerMetadata: {planner: 'llm' | 'heuristic', model?, promptVersion?,
generatedAt, diagnostics?: string[]}}`.

### SessionCommand (`src/shared/domain/commands.ts`)
Discriminated union on `type`:
`move_block {blockId, toIndex}` · `resize_block {blockId, span?, heightPx?}` ·
`remove_block {blockId, reason?}` · `dock_block {blockId, docked}` ·
`lock_block {blockId, locked}` · `set_block_props {blockId, props(partial)}` ·
`set_block_state {blockId, state(partial)}` ·
`insert_block {block, atIndex?}` ·
`adjust_mix {kind: SourceItemKind | 'all', direction: 'more'|'less'|'none'}` ·
`apply_plan {plan, items?: SourceItem[]}` (regeneration/initial result; must
preserve docked blocks not present in new plan by re-inserting them at their
previous relative position; merges new items into the session item pool) ·
`add_intent {intent: Intent}` · `set_status {status}`.
All commands validated by `SessionCommandSchema` (zod).

### SessionState (`src/shared/domain/session.ts`)
`{id, intentHistory: Intent[], plan: LayoutPlan | null, items:
Record<itemId, SourceItem>, compositionHints: {mix:
Partial<Record<SourceItemKind, 'more'|'less'>>, notes: string[]},
status: 'idle'|'planning'|'loading'|'ready'|'partial'|'failed',
statusDetail?: string, createdAt, updatedAt}`.

### Reducer/History (Task S1 produces)
`applySessionCommand(state: SessionState, cmd: SessionCommand): SessionState`
(pure, never throws on unknown ids — returns state unchanged with no-op).
`createHistory(initial: SessionState)` → `{present, past, future,
snapshots: GeneratedSnapshot[]}` with `push(next, cmd)`, `undo()`, `redo()`
helpers (pure functions in `history.ts`:
`pushHistory(h, next, cmd)`, `undoHistory(h)`, `redoHistory(h)`, cap 100).
`apply_plan` pushes a snapshot `{planId, at, label, state}` (cap 30).
`inferPreferenceSignals(state, cmd): PreferenceSignal[]` in
`preferenceInfer.ts` — remove_block → negative signal for the block's item
kinds + source; dock_block(docked) → positive; adjust_mix → explicit signal;
resize larger → positive weak; scope: 'session', confidence 0.3–0.9,
explicit=true only for adjust_mix.

### Catalog (`src/shared/catalog/catalog.ts` — frozen)
Component types: `video_player, video_queue, headline_strip, article_list,
reader, community_posts, source_list, heading, text, divider`.
Entry: `{type, version: 1, title, descriptionForPlanner, propsSchema (zod),
defaultProps, acceptsKinds: SourceItemKind[] | null, minItems, maxItems,
defaultSpan, minSpan, maxSpan, actions: string[], fallback:
'hide' | 'placeholder'}`. Helper `catalogForPlanner()` returns a compact JSON
description used in LLM prompts.

### Planner contracts (`src/shared/planner/plannerTypes.ts` — frozen)
`InterpretedIntent {goal, topics: string[], moods: string[], contentBalance:
Partial<Record<SourceItemKind, number>> (0..1 weights), query?: string,
sourceHints: {include: string[], exclude: string[]}, locale: 'ko'|'en',
followUp: boolean}`.
`PlanRequest {interpretation, items: SourceItem[], sessionId, preserved:
{dockedBlocks: ComponentBlock[]}, hints: SessionState['compositionHints'],
prefSummary?: string}`.
`PlanResult {plan: LayoutPlan, issues: string[]}`.
- Task P1: `interpretIntentRules(rawInput, prior?: InterpretedIntent | null):
  InterpretedIntent` — keyword/regex tables for ko+en moods (심심/bored → mixed
  browse), topics (AI, 게임/gaming, 뉴스/news, 개발/dev, 음악/music, …),
  content-type requests (영상/video, 기사/article, 커뮤니티/community),
  follow-up detection. `heuristicPlan(req: PlanRequest): PlanResult` —
  deterministic: headline_strip if ≥3 headlines/articles, video_player+queue if
  videos, article_list, community_posts, source_list at end; obey
  contentBalance & hints.mix (less → halve maxItems or drop), always ≥1 block
  (fallback text block explaining emptiness), respect preserved docked blocks
  (do NOT emit blocks for them; reducer re-inserts).
- Task P2: `validateAndRepairPlan(raw: unknown, items: SourceItem[],
  sessionId: string): PlanResult` — zod parse; on structural failure attempt
  per-block salvage; drop unknown componentType; strip bad item refs; if block
  below minItems apply fallback (hide/placeholder per catalog); clamp spans;
  dedupe/regen block ids; guarantee ≥1 block. Also `nlRules.ts`:
  `parseEditRules(utterance, state: SessionState): SessionCommand[] | null`
  (null = needs LLM). Handle ko+en: "뉴스 줄여/없애", "영상 더", "X 삭제/치워",
  "위로/아래로/맨 위로", "크게/작게", "고정해/고정 해제", numbered/kind/title
  references. Never throw.

### Adapters (`src/main/sources/types.ts` — frozen)
```ts
interface SourceAdapter {
  id: string; name: string; classes: ('video'|'news'|'community')[];
  matches(req: SourceRequest): number; // 0..1 relevance
  fetchItems(req: SourceRequest, ctx: AdapterContext): Promise<AdapterResult>;
}
type SourceRequest = { topics: string[]; moods: string[]; query?: string;
  locale: 'ko'|'en'; limit: number };
type AdapterContext = { http: HttpClient; now: () => Date };
type AdapterResult = { items: SourceItem[]; provenance: Provenance[];
  errors: string[] };
interface HttpClient { getText(url, opts?): Promise<string>;
  getJson<T=unknown>(url, opts?): Promise<T> } // opts: {timeoutMs, headers}
```
- Task A1: `http.ts` implements HttpClient with global fetch, 8s default
  timeout, UA `GPTBrowser/0.x (+https://github.com/r2cuerdame/GPTBrowser)`,
  in-memory TTL cache (5 min). `hackernews.ts` (Algolia:
  `https://hn.algolia.com/api/v1/search?tags=front_page`, or
  `search?query=…&tags=story`) → kind 'post' + 'headline'. `lobsters.ts`
  (`https://lobste.rs/hottest.json`) → 'post'. Export pure
  `normalizeHackerNews(json, now)` / `normalizeLobsters(json, now)` and test
  those with fixtures.
- Task A2: `rssNews.ts` — curated topic→feed registry (AI/tech/gaming/world/
  general incl. Korean feeds), parse RSS2+Atom via fast-xml-parser
  (isArray for item/entry, CDATA, media:thumbnail/enclosure) → 'article' +
  'headline'. `youtube.ts` — curated topic→channelId registry, feeds from
  `https://www.youtube.com/feeds/videos.xml?channel_id=…` (yt:videoId,
  media:thumbnail) → 'video'. `reddit.ts` — best-effort
  `https://www.reddit.com/r/{sub}/hot.json?limit=…` (raw_json=1) → 'post'.
  Export pure `parseRssFeed(xml, meta, now)`, `parseYoutubeFeed(xml, meta,
  now)`, `normalizeReddit(json, meta, now)`; fixture tests for each.
- Task A3: `orchestrator.ts` — `gatherSources(interpretation, adapters, ctx):
  Promise<{items, provenance, reports: AdapterReport[]}>`; builds
  SourceRequest from InterpretedIntent (limit by contentBalance), selects
  adapters by `matches() > 0` honoring include/exclude hints, runs in
  parallel with `Promise.allSettled` + per-adapter timeout, dedupes items by
  originalUrl, caps totals, returns partial results with reports
  `{adapterId, ok, count, error?}`. Unit tests with fake adapters.

### Stores (Task ST1) `src/main/store/`
`jsonStore.ts`: `class JsonStore<T>` with `load(): T`, `save(T)` (atomic:
tmp+rename, mkdir -p), constructor `(filePath, schema: ZodType<T>, fallback)`.
Domain stores take a base dir (not electron app) for testability:
`createRecipeStore(dir)` → CRUD `list/get/save/remove` of `Recipe`;
`createPreferenceStore(dir)` → `record(signals[])/list()/clear(id?)`, cap 500,
prune expired; `summarizeForPlanner(signals): string`;
`createSessionArchive(dir)` → `saveSnapshot(sessionId, snapshot)/list(sessionId)/
load(sessionId)`, cap 20/session; `createSettingsStore(dir)` → `{get, set}` of
`{anthropicApiKey?: string, plannerModel: string ('claude-opus-5' default),
autoUpdate: boolean, locale: 'ko'|'en'}`. All zod-validated, corrupted file →
fallback + `.bak`.

### Block components (Tasks C1/C2) `src/renderer/src/components/blocks/`
Every block component: `export default function XBlock(props: BlockRenderProps)`
where (frozen in `blockContract.ts` [SCAFFOLD]):
```ts
type BlockRenderProps = {
  block: ComponentBlock; items: SourceItem[]; // resolved, ordered
  dispatch: (cmd: SessionCommand) => void;    // same command bus as DnD/NL
  onOpenOriginal: (url: string) => void;
  onInspect: (blockId: string) => void;       // open provenance panel
};
```
Rules: render nothing dangerous (plain text only — no dangerouslySetInnerHTML),
每 item shows source name chip → onInspect; missing/empty data → use catalog
fallback (placeholder = `.block-empty` div with message). CSS classes only
(BEM-ish `gv-*` prefix), styles go in each block's small CSS file imported by
the component. C1: video_player (iframe youtube-nocookie embed, queue click →
`set_block_state {activeItemId}`), video_queue, headline_strip. C2:
article_list (density prop), reader (summary/excerpt + '원본에서 읽기'),
community_posts (points/comments meta), source_list, heading/text/divider.

### IPC (`src/shared/ipc.ts` — frozen)
Channel names + payload types; preload exposes `window.gptb` implementing
`GptbApi` (defined there). Renderer NEVER imports electron.

## Integration tasks (INLINE — done by the coordinating session)

LLM modules, main bootstrap, ipcHandlers, updater (electron-updater +
dev simulation), originalViewer, preload bridge, App shell (IntentBar,
SessionTabs, RecipeShelf, GeneratedView + dnd-kit + resize, BlockChrome,
ProvenancePanel, HistoryPanel, PreferencesPanel, UpdateBanner), global CSS,
electron-builder.yml (nsis + GitHub publish), README, final verification.

## Verification checklist (maps to GOAL.md MVP §)

1. Intent Bar exists, accepts vague ko/en input ✅ manual + unit
2. One generated WebView page (Electron renderer = Generated View) ✅
3. ≥3 reliable adapters spanning video/news/community ✅ fixture tests
4. LLM planner emits constrained LayoutPlan (validated, repairable) ✅ unit
5. Curated component catalog with declared schemas/constraints ✅ unit
6. Whole-page + block-level Regenerate preserving docked/locked ✅ unit+manual
7. Drag reorder, resize, remove, dock/pin ✅ manual (reducer unit-tested)
8. NL edits → same SessionCommand bus ✅ unit (rules) + LLM path
9. Recipe save/load (regenerates with fresh content) ✅ unit+manual
10. Provenance per item + Original viewer ✅ manual
11. Local session history (undo/redo + generated snapshots) ✅ unit
12. Auto-update: electron-updater wired to GitHub releases, UI banner,
    dev simulation ✅ manual + typecheck
Quality gates: `npm run typecheck`, `npm test`, `npm run build` all pass.
