import type { Intent, InterpretedIntent } from './domain/intent';
import type { ComponentBlock, LayoutPlan } from './domain/layoutPlan';
import type { SourceItem } from './domain/sourceItem';
import type { CompositionHints, GeneratedSnapshot } from './domain/session';
import type { SessionCommand } from './domain/commands';
import type { Recipe } from './domain/recipe';
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
  updaterCheck: 'gptb:updater-check',
  updaterInstall: 'gptb:updater-install',
  openOriginal: 'gptb:open-original',
  openExternal: 'gptb:open-external',
  // main -> renderer events
  evGenerateProgress: 'gptb:ev-generate-progress',
  evUpdaterStatus: 'gptb:ev-updater-status'
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
  recipeContext: { recipeId: string; name: string } | null;
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
  /** Item ids already on the page, to avoid repeats. */
  excludeItemIds: string[];
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

export interface SettingsView {
  hasApiKey: boolean;
  plannerModel: string;
  autoUpdate: boolean;
  locale: 'ko' | 'en';
  appVersion: string;
}

export interface SettingsPatch {
  anthropicApiKey?: string | null;
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

/** The typed bridge exposed by preload as `window.gptb`. */
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
  updaterCheck(): Promise<UpdaterStatus>;
  updaterInstall(): Promise<void>;
  openOriginal(url: string): Promise<void>;
  openExternal(url: string): Promise<void>;
  onGenerateProgress(cb: (p: GenerateProgress) => void): () => void;
  onUpdaterStatus(cb: (s: UpdaterStatus) => void): () => void;
}
