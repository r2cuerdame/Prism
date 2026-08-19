# GPTBrowser: A New Browser Grammar for the LLM Era

> **Chrome renders websites. GPTBrowser renders user intent.**

GPTBrowser is an open-source experiment in redefining the browser for the LLM era. It is not “Chrome with AI,” an assistant sidebar, or an agent that clicks through existing websites on the user's behalf. It starts from a more fundamental question:

> If browsers were invented after capable language models, would URLs, tabs, pages, bookmarks, and refresh still be the primary user interface?

GPTBrowser proposes a different grammar:

| Traditional browser | GPTBrowser |
| --- | --- |
| URL | Intent |
| Tab | Session |
| Website page | Generated View |
| Bookmark | Recipe |
| Refresh | Regenerate |
| Site navigation | Source composition |
| Browser history | Generated-state history |

The project is intentionally narrow, opinionated, and experimental. Its first audience is people consuming content across the web: watching, reading, browsing, comparing, discovering, and relaxing. It does not aim to replace every browser workflow.

## Core hypothesis

The first hypothesis to test is:

> **Can users consume the web more comfortably without navigating URLs, tabs, or site-specific interfaces, by expressing intent and receiving a generated, personalized, one-page experience?**

A user should be able to type:

- “I'm bored.”
- “Show me AI news and videos.”
- “What happened in gaming today?”
- “Compare these products and include real owner opinions.”
- “Give me something calm to watch while I eat.”
- “Continue the topic I was exploring last night, but with less news.”

GPTBrowser should decide which sources are useful, gather and normalize their content, plan a coherent experience, and render it as one directly manipulable page. A result may combine YouTube, news publications, communities, product and review sites, music services, or other sources without forcing the user to visit and operate each source separately.

Original websites remain essential, but their role changes. They are sources, content providers, evidence, and action surfaces—not necessarily the final user experience.

## Product principles

### 1. Intent is the entry point

The top of the application contains a familiar address-like input, but it is an **Intent Bar**, not a URL bar. It accepts goals, moods, questions, constraints, and follow-up instructions. It may recognize a pasted URL as source material, but navigating to that URL is not its default meaning.

The Intent Bar should feel lightweight enough for vague input. The user should not need to write a perfect prompt. “I'm bored” is valid product input, not an error to be clarified away.

### 2. The output is a Generated View

GPTBrowser produces one coherent, scrollable experience assembled from multiple sources. It should feel designed for the current intent rather than like search results, embedded website fragments, or a pile of cards from unrelated services.

The visible canvas is owned by GPTBrowser. It should be rendered in a WebView/WebView2/WKWebView-like shell from GPTBrowser's own component system. Browser-engine choice must remain behind an internal boundary; maintaining a Chromium fork is not a prerequisite for the product thesis.

### 3. The LLM is architectural

The LLM is not an optional assistant panel attached to a conventional browser. It interprets intent, evaluates available source material, proposes information hierarchy, selects components, and composes the Generated View.

The LLM does **not** receive unlimited freedom to emit arbitrary HTML for every page. It should produce a constrained, inspectable layout plan using a curated component registry. This makes generated experiences more consistent, accessible, secure, testable, and visually coherent.

The target is not infinite visual novelty. The target is consistently good web consumption across heterogeneous sources.

### 4. Direct manipulation and language share one state

Every generated block should be physically manipulable where appropriate. Users can:

- drag and reorder blocks;
- resize them;
- split or merge regions;
- remove unwanted content;
- dock or pin useful blocks;
- move blocks between Sessions;
- request more or less of a content type;
- say “I don't like this, show something else”;
- save the resulting shape as a Recipe.

Chat, Intent Bar follow-ups, and direct manipulation must update the same underlying Session and layout state. There must not be a “chat version” of the page and a separate “UI version.” Moving a video above the news, deleting three shopping cards, and saying “fewer reviews” are all edits to the same model.

These actions are also preference signals. A drag, resize, removal, dock, regeneration, or natural-language correction can be more informative than a generic like/dislike button. The system should learn from them cautiously and transparently.

### 5. Sources stay inspectable

Generated UI must not erase provenance. Every claim or content item should retain a link to its source. Users should be able to inspect why a block appeared, see relevant source metadata, and open an **Original** view when fidelity, trust, login, or an unsupported interaction requires it.

URLs may exist internally and be exposed as provenance. They are simply no longer the primary navigation model.

## Product primitives

### Intent

The user's current expression of what they want, including mood, topic, task, constraints, and follow-up refinements. An Intent can be vague, precise, or derived from an existing Recipe.

### Session

A generated, temporary web app or space built around an Intent. A Session owns its source results, layout plan, Generated View, provenance, interaction history, and local preference context. It evolves rather than merely navigating forward and backward through pages.

### Generated View

The visible one-page experience rendered from a constrained layout plan and trusted components. It is a projection of Session state, not a snapshot of an original website.

### Source

An original website, feed, API, document, media service, or other provider of content or interactions. Source-specific complexity is isolated behind adapters and a source-runner boundary.

### Recipe

A reusable definition of a satisfying browsing experience. A Recipe saves intent, source preferences, composition constraints, layout shape, and relevant personal preferences—not a frozen URL.

Opening a Recipe regenerates the experience with current content. Examples might include `Morning`, `Bored`, `News`, `Watch`, `Development`, `Shopping`, and `Evening Mix`.

### Regenerate

The successor to Refresh. Regeneration preserves the user's intent and explicit edits while selectively refreshing sources, content, or layout. It may regenerate one block, one region, or the whole Session. The user should be able to understand what will be kept and what will change.

### Original

An optional source-site viewer for provenance, full-fidelity reading, login, unsupported interactions, or verification. Original is an escape hatch and trust mechanism, not the primary canvas.

## Deliberate sacrifices

GPTBrowser is a content-consumption browser, not a work or enterprise browser. To preserve the concept, the project is willing to sacrifice compatibility with:

- complex work SaaS applications;
- fixed enterprise workflows;
- exact reproduction of site-specific UI;
- developer tools and extension ecosystems;
- arbitrary legacy web interactions;
- pixel-perfect site behavior;
- traditional tab-heavy browsing;
- becoming a drop-in replacement for Chrome.

This is not neglect; it is scope discipline. If supporting every existing browser assumption turns GPTBrowser back into a conventional browser with an AI feature, the experiment has failed before it has been tested.

## Generated component system

Generated Views should be composed from a versioned catalog of high-quality components. An initial catalog may include:

- video player and video queue;
- article preview and focused reader;
- headline or news strip;
- image gallery;
- product card and comparison table;
- review-summary block with source distribution;
- timeline;
- map and place collection;
- community post and discussion cluster;
- music or playlist block;
- source/evidence list;
- action or form block;
- small, constrained mini-app;
- text, heading, divider, tabs-within-a-block, and layout primitives.

Each component should declare:

- accepted data shape;
- supported user actions;
- size and layout constraints;
- accessibility behavior;
- provenance display rules;
- trust and permission requirements;
- fallback behavior when data is incomplete;
- serialization rules for Session history and Recipes.

The LLM composes these components through a structured plan. It may choose content, hierarchy, grouping, ordering, density, and emphasis, but the renderer owns final validation and presentation. Unknown components, invalid properties, unsafe actions, and impossible layouts must be rejected or repaired before rendering.

## Architecture proposal

The architecture must strictly separate **source execution** from **generated UI**.

```text
┌────────────────────────── Visible application ──────────────────────────┐
│ App Shell → Intent/Session Controller → Generated-View Renderer         │
│                  ↑              │               ↑                       │
│       Recipe & Preference Store │      Validated LayoutPlan             │
│                  ↑              ↓               ↑                       │
│       Interaction/Preference Learner ← LLM Planner/Composer             │
└──────────────────────────────────┬───────────────────────────────────────┘
                                   │ normalized SourceItems + provenance
┌──────────────────────────────────┴── Hidden source boundary ─────────────┐
│ Source Orchestrator → Source Adapters → Source Runner                    │
│                           ↓               ↓                              │
│                   Extract/Normalize   APIs, feeds, DOM, JS, sessions     │
│                                           ↓                              │
│                                      Original websites                  │
└──────────────────────────────────────────────────────────────────────────┘
```

### App shell

Owns the desktop/mobile window, Intent Bar, Session switching, Recipe access, permissions, and the generated WebView. It should stay small and engine-agnostic.

### Intent and Session model

Turns initial and follow-up input into durable Session state. It coordinates source requests, composition, regeneration, direct edits, undo/history, and Recipe creation.

### Source runner

A hidden execution environment that can load original sites, retain user-approved login sessions, execute required JavaScript, extract content, and perform actions when necessary. It may use a system WebView, browser automation, APIs, or feeds behind a stable interface.

The source runner must never be allowed to inject arbitrary source DOM, CSS, or JavaScript into the Generated View.

### Source adapters

Source-specific modules that express discovery, retrieval, pagination, authentication, extraction, actions, rate limits, and provenance. The MVP should prefer a small number of reliable adapters over brittle universal support.

### Extractor and normalizer

Converts APIs, feeds, DOM, HTML, embedded metadata, and other source material into typed `SourceItem` objects. HTML/DOM/CSS/JS are evidence and interaction surfaces here, not automatically presentation.

### LLM planner/composer

Interprets the Intent and current Session, requests useful source categories, selects normalized items, and emits a constrained `LayoutPlan`. It should receive component capabilities and layout constraints, not an empty canvas and permission to invent a new application runtime.

### Component registry and Generated-View renderer

Validate and render `LayoutPlan` objects using trusted GPTBrowser components. The renderer owns component code, accessibility, responsive behavior, interaction dispatch, sanitization, and failure states.

### Recipe and personalization store

Stores saved Recipes, explicit preferences, learned preferences, and Recipe evolution. Prefer local-first storage. Sync, if added later, must be optional and understandable.

### Provenance layer

Maintains item-level links among rendered content, extracted facts, source records, timestamps, and Original URLs. Provenance should survive composition, summarization, regeneration, history, and Recipe saves.

### Interaction and preference learner

Translates direct edits and language corrections into immediate Session updates and cautious longer-term preference signals. It must distinguish a one-time edit (“hide this story”) from a durable preference (“I generally want fewer political stories”). Durable inference should be reversible and inspectable.

### Optional Original-site viewer

Displays the original site when required without collapsing the main product back into conventional browsing. It may share authentication state with the source runner under explicit permission and isolation rules.

## Proposed data model

The exact implementation language is intentionally undecided. These conceptual records define the boundaries that matter.

### `Intent`

| Field | Meaning |
| --- | --- |
| `id` | Stable identifier |
| `rawInput` | User's original words or action |
| `interpretedGoal` | Structured working interpretation |
| `topics`, `moods`, `constraints` | Optional intent facets |
| `sourceHints` | Requested, preferred, or excluded source classes |
| `createdAt`, `updatedAt` | Lifecycle timestamps |
| `derivedFrom` | Recipe, Session, URL, block, or prior Intent |

### `Session`

| Field | Meaning |
| --- | --- |
| `id` | Stable identifier |
| `intentHistory` | Initial Intent and refinements |
| `layoutPlan` | Current validated composition |
| `sourceItemRefs` | Items available to the Session |
| `dockedBlockRefs` | Blocks protected across regeneration |
| `interactionHistory` | Reversible user edits and commands |
| `provenanceRefs` | Evidence graph for visible and historical content |
| `status` | Planning, loading, ready, partial, failed, archived |
| `createdAt`, `updatedAt` | Lifecycle timestamps |

### `SourceItem`

| Field | Meaning |
| --- | --- |
| `id` | Normalized item identifier |
| `adapterId`, `sourceId` | Origin and adapter identity |
| `kind` | Video, article, product, review, post, track, place, etc. |
| `title`, `summary`, `media` | Display-ready normalized fields |
| `payload` | Kind-specific structured data |
| `originalUrl` | Original source location |
| `publishedAt`, `retrievedAt` | Freshness metadata |
| `provenanceRef` | Link to extraction/evidence record |
| `permissions` | Login, region, age, or action constraints |

### `ComponentBlock`

| Field | Meaning |
| --- | --- |
| `id` | Stable block identifier across edits |
| `componentType`, `componentVersion` | Registry entry to render |
| `sourceItemRefs` | Content used by the block |
| `props` | Validated component configuration |
| `layout` | Position, size, grouping, and responsive constraints |
| `state` | User-visible interactive state |
| `locked`, `docked` | Regeneration behavior |
| `rationale` | Optional inspectable reason for inclusion |

### `LayoutPlan`

| Field | Meaning |
| --- | --- |
| `id`, `version` | Plan identity and schema version |
| `sessionId` | Owning Session |
| `blocks` | Ordered/nested `ComponentBlock` collection |
| `layoutRules` | Grid, regions, responsive constraints, density |
| `generationScope` | Whole page or selected region/block |
| `preservedEdits` | User choices that regeneration must respect |
| `plannerMetadata` | Model, prompt/schema version, timestamps, diagnostics |

### `Recipe`

| Field | Meaning |
| --- | --- |
| `id`, `name` | User-facing identity |
| `intentTemplate` | Reusable intent with optional variables |
| `sourcePreferences` | Preferred, excluded, or weighted source classes |
| `compositionPreferences` | Content ratios, density, hierarchy, and constraints |
| `layoutTemplate` | Saved shape rather than frozen content |
| `preferenceScope` | Recipe-local versus inherited personal settings |
| `createdFromSessionId` | Origin for inspection and evolution |
| `createdAt`, `updatedAt` | Lifecycle timestamps |

### `PreferenceSignal`

| Field | Meaning |
| --- | --- |
| `id` | Stable identifier |
| `kind` | Drag, resize, remove, dock, regenerate, accept, reject, language edit |
| `target` | Block, item, source, component, layout feature, or topic |
| `context` | Session, Recipe, time, intent, and neighboring content |
| `interpretation` | Candidate preference inferred from the action |
| `scope` | One-time, Session, Recipe, or global |
| `confidence` | Strength of the inference |
| `explicit` | Whether the user stated the preference directly |
| `createdAt`, `expiresAt` | Lifecycle and optional decay |

### `Provenance`

| Field | Meaning |
| --- | --- |
| `id` | Stable identifier |
| `sourceUrl`, `sourceName` | Human-inspectable origin |
| `adapterId` | Retrieval/extraction path |
| `retrievedAt` | Evidence freshness |
| `contentFingerprint` | Change and deduplication support |
| `extractionRefs` | Source fragments supporting normalized fields |
| `transformations` | Summaries, groupings, or derivations applied |
| `rightsAndPolicy` | Attribution, display, retention, and action constraints |

## Onboarding and habit migration

Initial setup may optionally learn from existing browser history and bookmarks where technically and legally feasible. This is not a conventional bookmark importer.

The onboarding experience can say “Learning your browsing habits…” while it derives a small, useful starting profile from signals such as:

- frequently visited sources;
- bookmark folders and recurring topics;
- time-of-day patterns;
- repeated combinations of sites;
- content-type balance across video, news, communities, and shopping;
- likely information-density preferences;
- recurring modes such as morning catch-up or evening entertainment.

The output should be source preferences and a handful of editable starter Recipes, not hundreds of copied URLs. For example, repeated nighttime use of YouTube, news, and a community might become an `Evening Mix` Recipe with an inferred content balance.

> **We did not import your bookmarks. We imported your browsing habits.**

Existing history and bookmarks are cold-start learning data. Future drag, delete, resize, dock, regenerate, and language actions become continuing preference data.

Migration must be optional, permissioned, local-first where possible, and designed to minimize raw-history retention. Users must be able to inspect, correct, and delete both imported data and the preferences inferred from it.

## Privacy, trust, and control

The product's personalization is only valuable if users can understand and control it.

- Ask explicit permission before reading browser history, bookmarks, login state, or source content that requires authentication.
- Prefer a local-first preference profile and local processing where practical.
- Retain derived preferences instead of raw browsing history when the raw data is no longer needed.
- Make learned preferences inspectable, editable, exportable, and deletable.
- Distinguish explicit preferences from uncertain inference.
- Provide clear item-level provenance and Original links.
- Isolate source execution from the generated renderer.
- Never allow source HTML, scripts, or styling to silently gain authority over generated UI.
- Make actions that affect an external account, purchase, post, subscription, or form submission explicit and confirmable.
- Respect source terms, robots/access constraints, copyright, rate limits, authentication boundaries, and user-region requirements.

## Intentionally narrow MVP

The MVP should be extreme enough to test the thesis, not broad enough to hide it.

It includes:

1. One Intent Bar.
2. One generated WebView page.
3. A small set of reliable source adapters spanning a few content types.
4. An LLM planner/composer that emits constrained layout plans.
5. A curated component catalog.
6. Whole-page and block-level Regenerate.
7. Drag, resize, reorder, remove, and dock/pin.
8. Natural-language edits that operate on the same state as direct manipulation.
9. Recipe save and load.
10. Source provenance and an Original/source inspection path.
11. Local Session history with generated states and user edits.

A useful first vertical slice could support video, articles/news, and community posts. It should demonstrate that one vague Intent can become a coherent page, that the user can reshape it quickly, and that the reshaped experience can be saved as a Recipe and regenerated later with fresh content.

The MVP does not need universal extraction, enterprise authentication, cross-device sync, autonomous purchasing, a plugin marketplace, a Chromium fork, sophisticated monetization, or large-scale backend infrastructure.

## Validation and success criteria

Early success is primarily qualitative. The experiment is working when:

- users feel they no longer need to know or navigate website addresses for content consumption;
- the generated experience feels like one usable page, not aggregated search results;
- layouts remain consistently readable and operable across different intents and source mixtures;
- provenance is easy to reach without dominating the interface;
- “I don't like this” produces an immediate, sensible change;
- drag, resize, remove, and dock actions quickly reshape both the current page and later generations;
- Regenerate changes what should change while respecting what the user deliberately kept;
- saved Recipes feel more useful and alive than traditional bookmarks;
- users return to Recipes as modes of browsing rather than reopening collections of sites;
- the Original viewer is available for trust and edge cases but is not the center of normal use.

Useful research measures may include time to first satisfying view, number of corrective actions before satisfaction, regeneration acceptance, Recipe reuse, frequency of Original-site fallback, provenance inspection, and whether preference corrections remain stable. These measures should illuminate the hypothesis, not optimize engagement at the expense of user agency.

## Non-goals

GPTBrowser is not currently trying to:

- reproduce every website accurately;
- run every web application inside the generated canvas;
- replace complex office, engineering, finance, or enterprise SaaS workflows;
- provide full browser developer tools;
- preserve a traditional tabs-and-address-bar power-user model;
- make arbitrary autonomous agents the primary interface;
- generate unconstrained applications from raw HTML on every request;
- obscure sources or present generated synthesis as source truth;
- build a universal backend before proving the interaction model;
- define monetization before proving user value;
- maximize time spent, clicks, or content consumption.

## Open-source philosophy

GPTBrowser should be developed in public as both working software and a falsifiable product argument. The repository should make the new grammar legible: Intent, Session, Generated View, Recipe, and Regenerate should appear in architecture, schemas, UI language, and code—not only in marketing.

Open development is important because a browser mediates identity, attention, history, and access to information. The community should be able to inspect how sources are selected, how layouts are planned, how provenance is preserved, and how preferences are inferred. Source adapters, component schemas, evaluation fixtures, and privacy boundaries should be documented well enough to challenge and improve.

The project should prefer replaceable interfaces over premature infrastructure commitments. Source runners, model providers, extractors, storage, and renderers may evolve independently as long as the conceptual boundary remains intact.

## Decision filter

When evaluating a feature, ask:

1. Does this help the user express intent or shape a generated experience?
2. Does it strengthen the Generated View as the primary UI?
3. Does it preserve the separation between source execution and generated presentation?
4. Can the behavior be represented in Session, Recipe, provenance, and preference state?
5. Does it make quality, trust, or user control more consistent?
6. Are we adding it to test the thesis, or because conventional browsers already have it?

If a feature mainly restores URLs, tabs, site UI, or compatibility as the center of the product, it should face a high bar.

## The statement

GPTBrowser is an attempt to invent a possible new browser grammar, not to decorate the old one.

The web remains the world's source layer. GPTBrowser adds an intent layer above it: one that can gather, normalize, compose, explain, regenerate, and learn from direct human shaping. The project succeeds if browsing content begins to feel less like operating websites and more like forming a living view of what the user wants now.

> **Do not navigate the web. Describe the web you want, then shape it.**
