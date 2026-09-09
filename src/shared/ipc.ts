import type { Intent, InterpretedIntent } from './domain/intent';
import type { ComponentBlock, LayoutPlan } from './domain/layoutPlan';
import type { SourceItem } from './domain/sourceItem';
import type { CompositionHints, GeneratedSnapshot } from './domain/session';
import type { SessionCommand } from './domain/commands';
import type { Recipe, RecipeLayoutSlot } from './domain/recipe';
import type { PreferenceSignal } from './domain/preference';
import type { Provenance } from './domain/provenance';

/** IPC channel names. Renderer talks only through the typed preload bridge. */
export const IPC = {
  generate: 'gptb:generate',
  regenerateBlock: 'gptb:regenerate-block',
  interpretEdit: 'gptb:interpret-edit',
  recipesList: 'gptb:recipes-list',
  recipesSave: 'gptb:recipes-save',
  recipesRemove: 'gptb:recipes-remove',
  prefsList: 'gptb:prefs-list',
  prefsRecord: 'gptb:prefs-record',
  prefsClear: 'gptb:prefs-clear',
  sessionsSaveSnapshot: 'gptb:sessions-save',
  sessionsList: 'gptb:sessions-list',
  sessionsLoad: 'gptb:sessions-load',
  settingsGet: 'gptb:settings-get',
  settingsSet: 'gptb:settings-set',
  authStatus: 'gptb:auth-status',
  authLogin: 'gptb:auth-login',
  updaterCheck: 'gptb:updater-check',
  updaterInstall: 'gptb:updater-install',
  openOriginal: 'gptb:open-original',
  openExternal: 'gptb:open-external',
  // SourceRuntime and Auth Rail IPC
  sourceAction: 'prism:source-action',
  sourceProject: 'prism:source-project',
  authRailOpen: 'prism:auth-rail-open',
  authRailClose: 'prism:auth-rail-close',
  authRailComplete: 'prism:auth-rail-complete',
  authRailLaunchSurface: 'prism:auth-rail-launch-surface',
  // main -> renderer events
  evGenerateProgress: 'gptb:ev-generate-progress',
  evUpdaterStatus: 'gptb:ev-updater-status',
  evAuthRailState: 'prism:ev-auth-rail-state'
} as const;

export interface AdapterReport {
  adapterId: string;
  name: string;
  ok: boolean;
  count: number;
  error?: string;
}

export interface GenerateRequest {
  sessionId: string;
  /** null = Regenerate: reuse priorInterpretation with fresh content. */
  rawInput: string | null;
  priorInterpretation: InterpretedIntent | null;
  preserved: { dockedBlocks: ComponentBlock[] };
  hints: CompositionHints;
  /** Items referenced by preserved blocks (kept across regeneration). */
  keepItems: SourceItem[];
  recipeContext: RecipeContext | null;
  /**
   * 재생성 with an existing page: its current shape. Main refills these slots
   * with fresh content and rewrites only the synthesis text, instead of
   * re-planning the whole layout from scratch.
   */
  refillShape: { layoutTemplate: RecipeLayoutSlot[]; density: 'compact' | 'comfortable' } | null;
}

/** A Recipe's saved shape — guides composition, never freezes content. */
export interface RecipeContext {
  recipeId: string;
  name: string;
  /** Full slots (title/pins/props), so the user's shaping survives the boundary. */
  layoutTemplate: RecipeLayoutSlot[];
  density: 'compact' | 'comfortable';
}

export interface GenerateResponse {
  ok: boolean;
  intent: Intent | null;
  interpretation: InterpretedIntent | null;
  items: SourceItem[];
  provenance: Provenance[];
  plan: LayoutPlan | null;
  reports: AdapterReport[];
  issues: string[];
  error?: string;
}

export interface RegenerateBlockRequest {
  sessionId: string;
  block: ComponentBlock;
  interpretation: InterpretedIntent;
  /**
   * Original URLs already on the page. URLs are the stable identity across
   * fetches — item ids are minted fresh every time, so they cannot dedupe.
   */
  excludeUrls: string[];
}

export interface RegenerateBlockResponse {
  ok: boolean;
  block: ComponentBlock | null;
  items: SourceItem[];
  provenance: Provenance[];
  error?: string;
}

/** Compact session digest given to the NL edit interpreter. */
export interface SessionDigest {
  sessionId: string;
  goal: string;
  blocks: {
    id: string;
    index: number;
    componentType: string;
    title: string;
    kinds: string[];
    span: number;
    docked: boolean;
    locked: boolean;
    itemTitles: string[];
  }[];
}

export interface InterpretEditRequest {
  utterance: string;
  digest: SessionDigest;
}

export interface InterpretEditResponse {
  ok: boolean;
  commands: SessionCommand[];
  explanation: string;
  source: 'rules' | 'llm' | 'none';
  error?: string;
}

/** How the app is authenticated for planning. 'agy' = Google Antigravity (Gemini), 'oauth' = a Codex sign-in. */
export type AuthMethod = 'agy' | 'api-key' | 'env-key' | 'oauth' | 'none';

export type SourceAuthStatus =
  | 'idle'
  | 'required'
  | 'authenticating'
  | 'authenticated'
  | 'dismissed'
  | 'failed';

export interface SafeAuthRailState {
  active: boolean;
  sourceId: string;
  origin: string;
  partitionId: string;
  loginUrl: string;
  title: string;
  status: SourceAuthStatus;
  message?: string;
}

export interface AuthRailOpenRequest {
  sourceId: string;
  origin?: string;
  loginUrl?: string;
  title?: string;
}

export interface AuthRailResult {
  ok: boolean;
  sourceId: string;
  status: SourceAuthStatus;
  error?: string;
}

export interface SourceActionRpcRequest {
  sourceId: string;
  actionId: string;
  payload?: Record<string, unknown>;
}

export interface SourceActionRpcResult {
  ok: boolean;
  sourceId: string;
  actionId: string;
  data?: unknown;
  error?: string;
}

export interface SettingsView {
  /** Active credential source. */
  authMethod: AuthMethod;
  authDetail: string;
  llmProvider: 'agy' | 'codex';
  plannerModel: string;
  autoUpdate: boolean;
  locale: 'ko' | 'en';
  appVersion: string;
}

export interface AuthLoginResult {
  ok: boolean;
  message: string;
  /** Sign-in URL when the flow needs the user to finish it in a browser. */
  url?: string;
  settings: SettingsView;
}

export interface SettingsPatch {
  llmProvider?: 'agy' | 'codex';
  plannerModel?: string;
  autoUpdate?: boolean;
  locale?: 'ko' | 'en';
}

export type UpdaterState =
  | 'idle'
  | 'checking'
  | 'available'
  | 'not-available'
  | 'downloading'
  | 'downloaded'
  | 'error'
  | 'dev-simulated';

export interface UpdaterStatus {
  state: UpdaterState;
  version?: string;
  percent?: number;
  message?: string;
}

export interface GenerateProgress {
  sessionId: string;
  phase: 'interpreting' | 'gathering' | 'planning' | 'done' | 'error';
  detail?: string;
}

export interface SessionArchiveEntry {
  sessionId: string;
  title: string;
  updatedAt: string;
  snapshotCount: number;
}

/** The typed bridge exposed by preload as `window.prism` (and alias `window.gptb`). */
export interface GptbApi {
  generate(req: GenerateRequest): Promise<GenerateResponse>;
  regenerateBlock(req: RegenerateBlockRequest): Promise<RegenerateBlockResponse>;
  interpretEdit(req: InterpretEditRequest): Promise<InterpretEditResponse>;
  recipesList(): Promise<Recipe[]>;
  recipesSave(recipe: Recipe): Promise<Recipe[]>;
  recipesRemove(id: string): Promise<Recipe[]>;
  prefsList(): Promise<PreferenceSignal[]>;
  prefsRecord(signals: PreferenceSignal[]): Promise<void>;
  prefsClear(id?: string): Promise<PreferenceSignal[]>;
  sessionsSaveSnapshot(snapshot: GeneratedSnapshot): Promise<void>;
  sessionsList(): Promise<SessionArchiveEntry[]>;
  sessionsLoad(sessionId: string): Promise<GeneratedSnapshot[]>;
  settingsGet(): Promise<SettingsView>;
  settingsSet(patch: SettingsPatch): Promise<SettingsView>;
  /** Re-detect the active credential source. */
  authStatus(): Promise<SettingsView>;
  /** Run the ChatGPT-account sign-in (opens the system browser). */
  authLogin(): Promise<AuthLoginResult>;
  updaterCheck(): Promise<UpdaterStatus>;
  updaterInstall(): Promise<void>;
  openOriginal(url: string): Promise<void>;
  openExternal(url: string): Promise<void>;
  // SourceRuntime & Auth Rail IPC
  sourceAction(req: SourceActionRpcRequest): Promise<SourceActionRpcResult>;
  sourceProject(sourceId: string): Promise<unknown>;
  authRailOpen(req: AuthRailOpenRequest): Promise<AuthRailResult>;
  authRailClose(sourceId: string): Promise<void>;
  authRailComplete(sourceId: string): Promise<AuthRailResult>;
  authRailLaunchSurface(sourceId: string): Promise<void>;
  onAuthRailState(cb: (state: SafeAuthRailState | null) => void): () => void;
  // Events
  onGenerateProgress(cb: (p: GenerateProgress) => void): () => void;
  onUpdaterStatus(cb: (s: UpdaterStatus) => void): () => void;
}

export type PrismApi = GptbApi;
