import { useSyncExternalStore } from 'react';
import { newId, nowIso } from '@shared/domain/ids';
import { createSessionState, type GeneratedSnapshot, type SessionState } from '@shared/domain/session';
import type { SessionCommand } from '@shared/domain/commands';
import type { InterpretedIntent } from '@shared/domain/intent';
import type { ComponentBlock } from '@shared/domain/layoutPlan';
import type { SourceItem } from '@shared/domain/sourceItem';
import type { Recipe } from '@shared/domain/recipe';
import type { PreferenceSignal } from '@shared/domain/preference';
import {
  createHistory,
  pushHistory,
  undoHistory,
  redoHistory,
  canUndo,
  canRedo,
  type SessionHistory
} from '@shared/sessionEngine/history';
import { inferPreferenceSignals } from '@shared/sessionEngine/preferenceInfer';
import { parseEditRules } from '@shared/planner/nlRules';
import { getCatalogEntry } from '@shared/catalog/catalog';
import type {
  AdapterReport,
  GenerateProgress,
  SessionArchiveEntry,
  SessionDigest,
  SettingsView,
  UpdaterStatus
} from '@shared/ipc';

export type PanelKind = 'inspect' | 'history' | 'prefs' | 'settings' | null;

export interface SessionEntry {
  history: SessionHistory;
  progress: GenerateProgress['phase'] | null;
  reports: AdapterReport[];
  issues: string[];
}

export interface AppState {
  order: string[];
  activeId: string | null;
  sessions: Record<string, SessionEntry>;
  recipes: Recipe[];
  prefSignals: PreferenceSignal[];
  archive: SessionArchiveEntry[];
  settings: SettingsView | null;
  updater: UpdaterStatus;
  panel: PanelKind;
  inspectBlockId: string | null;
  intentMode: 'generate' | 'edit';
  toast: string | null;
}

type Listener = () => void;

const initialState: AppState = {
  order: [],
  activeId: null,
  sessions: {},
  recipes: [],
  prefSignals: [],
  archive: [],
  settings: null,
  updater: { state: 'idle' },
  panel: null,
  inspectBlockId: null,
  intentMode: 'generate',
  toast: null
};

class AppStore {
  private state: AppState = initialState;
  private listeners = new Set<Listener>();
  private toastTimer: ReturnType<typeof setTimeout> | null = null;
  private initialized = false;

  get = (): AppState => this.state;

  subscribe = (l: Listener): (() => void) => {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  };

  private set(patch: Partial<AppState>): void {
    this.state = { ...this.state, ...patch };
    for (const l of this.listeners) l();
  }

  private patchEntry(id: string, patch: Partial<SessionEntry>): void {
    const entry = this.state.sessions[id];
    if (!entry) return;
    this.set({
      sessions: { ...this.state.sessions, [id]: { ...entry, ...patch } }
    });
  }

  toast(text: string): void {
    if (this.toastTimer) clearTimeout(this.toastTimer);
    this.set({ toast: text });
    this.toastTimer = setTimeout(() => this.set({ toast: null }), 4200);
  }

  /** Bootstrap: settings, recipes, archive, event subscriptions. */
  async init(): Promise<void> {
    if (this.initialized) return;
    this.initialized = true;
    window.gptb.onGenerateProgress((p) => {
      this.patchEntry(p.sessionId, { progress: p.phase === 'done' ? null : p.phase });
    });
    window.gptb.onUpdaterStatus((s) => this.set({ updater: s }));
    const [settings, recipes, archive] = await Promise.all([
      window.gptb.settingsGet(),
      window.gptb.recipesList(),
      window.gptb.sessionsList()
    ]);
    this.set({ settings, recipes, archive });
    if (this.state.order.length === 0) this.newSession();
  }

  // ── Sessions ─────────────────────────────────────────────────────────

  newSession(): string {
    const id = newId('ses');
    const entry: SessionEntry = {
      history: createHistory(createSessionState(id, nowIso())),
      progress: null,
      reports: [],
      issues: []
    };
    this.set({
      sessions: { ...this.state.sessions, [id]: entry },
      order: [...this.state.order, id],
      activeId: id
    });
    return id;
  }

  closeSession(id: string): void {
    const { [id]: _closed, ...rest } = this.state.sessions;
    const order = this.state.order.filter((s) => s !== id);
    const activeId =
      this.state.activeId === id ? (order[order.length - 1] ?? null) : this.state.activeId;
    this.set({ sessions: rest, order, activeId });
    if (order.length === 0) this.newSession();
  }

  setActive(id: string): void {
    if (this.state.sessions[id]) this.set({ activeId: id });
  }

  active(): { id: string; entry: SessionEntry } | null {
    const id = this.state.activeId;
    if (!id) return null;
    const entry = this.state.sessions[id];
    return entry ? { id, entry } : null;
  }

  // ── The single command bus ───────────────────────────────────────────

  dispatch(cmd: SessionCommand, opts?: { silent?: boolean }): void {
    const act = this.active();
    if (!act) return;
    const prev = act.entry.history.present;
    const at = nowIso();
    const nextHistory = pushHistory(act.entry.history, cmd, at);
    if (nextHistory === act.entry.history) return;
    this.patchEntry(act.id, { history: nextHistory });
    if (!opts?.silent) {
      const signals = inferPreferenceSignals(prev, cmd, at);
      if (signals.length > 0) {
        void window.gptb.prefsRecord(signals).catch(() => undefined);
      }
    }
    if (cmd.type === 'apply_plan') {
      const snap = nextHistory.snapshots[nextHistory.snapshots.length - 1];
      if (snap) void window.gptb.sessionsSaveSnapshot(snap).catch(() => undefined);
      void this.refreshArchive();
    }
  }

  undo(): void {
    const act = this.active();
    if (!act) return;
    this.patchEntry(act.id, { history: undoHistory(act.entry.history) });
  }

  redo(): void {
    const act = this.active();
    if (!act) return;
    this.patchEntry(act.id, { history: redoHistory(act.entry.history) });
  }

  canUndo(): boolean {
    const act = this.active();
    return act ? canUndo(act.entry.history) : false;
  }

  canRedo(): boolean {
    const act = this.active();
    return act ? canRedo(act.entry.history) : false;
  }

  // ── Generation / regeneration ────────────────────────────────────────

  private lastInterpretation(state: SessionState): InterpretedIntent | null {
    for (let i = state.intentHistory.length - 1; i >= 0; i--) {
      const it = state.intentHistory[i];
      if (it.interpreted) return it.interpreted;
    }
    return null;
  }

  private dockedBlocks(state: SessionState): ComponentBlock[] {
    return state.plan?.blocks.filter((b) => b.docked || b.locked) ?? [];
  }

  private keepItems(state: SessionState): SourceItem[] {
    const ids = new Set(this.dockedBlocks(state).flatMap((b) => b.sourceItemRefs));
    return Object.values(state.items).filter((i) => ids.has(i.id));
  }

  async generate(rawInput: string | null, recipe?: Recipe): Promise<void> {
    const act = this.active();
    if (!act) return;
    const state = act.entry.history.present;
    const prior: InterpretedIntent | null = recipe
      ? {
          goal: recipe.intentTemplate,
          topics: [],
          moods: [],
          contentBalance: recipe.compositionPreferences.balance,
          sourceHints: recipe.sourcePreferences,
          locale: this.state.settings?.locale ?? 'ko',
          followUp: false
        }
      : this.lastInterpretation(state);
    if (rawInput === null && !prior) {
      this.toast('재생성할 의도가 아직 없어요. 먼저 의도를 입력해 주세요.');
      return;
    }
    this.dispatch({ type: 'set_status', status: 'planning' }, { silent: true });
    this.patchEntry(act.id, { progress: 'interpreting' });
    const res = await window.gptb.generate({
      sessionId: act.id,
      rawInput,
      priorInterpretation: prior,
      preserved: { dockedBlocks: this.dockedBlocks(state) },
      hints: state.compositionHints,
      keepItems: this.keepItems(state),
      recipeContext: recipe ? { recipeId: recipe.id, name: recipe.name } : null
    });
    this.patchEntry(act.id, { progress: null, reports: res.reports, issues: res.issues });
    if (!res.ok || !res.plan) {
      this.dispatch(
        { type: 'set_status', status: 'failed', detail: res.error ?? '생성에 실패했어요.' },
        { silent: true }
      );
      this.toast(res.error ?? '생성에 실패했어요.');
      return;
    }
    if (res.intent) this.dispatch({ type: 'add_intent', intent: res.intent }, { silent: true });
    this.dispatch({ type: 'apply_plan', plan: res.plan, items: res.items }, { silent: true });
    const failedReports = res.reports.filter((r) => !r.ok);
    if (failedReports.length > 0) {
      this.dispatch(
        {
          type: 'set_status',
          status: 'partial',
          detail: `일부 소스를 가져오지 못했어요: ${failedReports.map((r) => r.name).join(', ')}`
        },
        { silent: true }
      );
    }
  }

  async regenerate(): Promise<void> {
    await this.generate(null);
  }

  async regenerateBlock(blockId: string): Promise<void> {
    const act = this.active();
    if (!act) return;
    const state = act.entry.history.present;
    const block = state.plan?.blocks.find((b) => b.id === blockId);
    const interpretation = this.lastInterpretation(state);
    if (!block || !interpretation) return;
    this.toast('블록을 재생성하는 중…');
    const res = await window.gptb.regenerateBlock({
      sessionId: act.id,
      block,
      interpretation,
      excludeItemIds: Object.keys(state.items)
    });
    if (!res.ok || !res.block) {
      this.toast(res.error ?? '블록 재생성에 실패했어요.');
      return;
    }
    this.dispatch({ type: 'replace_block', blockId, block: res.block, items: res.items });
    this.toast('블록을 새로운 콘텐츠로 재생성했어요.');
  }

  // ── Natural-language edits (same bus as direct manipulation) ─────────

  private digest(state: SessionState): SessionDigest {
    return {
      sessionId: state.id,
      goal: this.lastInterpretation(state)?.goal ?? '',
      blocks: (state.plan?.blocks ?? []).map((b, index) => {
        const entry = getCatalogEntry(b.componentType);
        return {
          id: b.id,
          index,
          componentType: b.componentType,
          title:
            typeof b.props.title === 'string' ? b.props.title : (entry?.title ?? b.componentType),
          kinds: (entry?.acceptsKinds ?? []).map(String),
          span: b.layout.span,
          docked: b.docked,
          locked: b.locked,
          itemTitles: b.sourceItemRefs
            .map((id) => state.items[id]?.title ?? '')
            .filter(Boolean)
            .slice(0, 3)
        };
      })
    };
  }

  async editWithLanguage(utterance: string): Promise<void> {
    const act = this.active();
    if (!act) return;
    const state = act.entry.history.present;
    if (!state.plan || state.plan.blocks.length === 0) {
      this.toast('편집할 페이지가 아직 없어요. 먼저 의도를 실행해 보세요.');
      return;
    }
    const ruleCommands = parseEditRules(utterance, state);
    if (ruleCommands && ruleCommands.length > 0) {
      for (const cmd of ruleCommands) this.dispatch(cmd);
      this.toast('페이지를 편집했어요.');
      return;
    }
    const res = await window.gptb.interpretEdit({ utterance, digest: this.digest(state) });
    if (res.ok && res.commands.length > 0) {
      for (const cmd of res.commands) this.dispatch(cmd);
      this.toast(res.explanation || '페이지를 편집했어요.');
      return;
    }
    this.toast(res.explanation || '편집 요청을 이해하지 못했어요.');
  }

  setIntentMode(mode: 'generate' | 'edit'): void {
    this.set({ intentMode: mode });
  }

  // ── Recipes ──────────────────────────────────────────────────────────

  async saveCurrentAsRecipe(name: string): Promise<void> {
    const act = this.active();
    if (!act) return;
    const state = act.entry.history.present;
    const interpretation = this.lastInterpretation(state);
    if (!interpretation || !state.plan) {
      this.toast('레시피로 저장할 페이지가 아직 없어요.');
      return;
    }
    const lastRealIntent = [...state.intentHistory]
      .reverse()
      .find((i) => i.rawInput !== '[재생성]');
    const now = nowIso();
    const recipe: Recipe = {
      id: newId('rcp'),
      name,
      intentTemplate: lastRealIntent?.rawInput ?? interpretation.goal,
      sourcePreferences: interpretation.sourceHints,
      compositionPreferences: {
        balance: interpretation.contentBalance,
        density: 'comfortable'
      },
      layoutTemplate: state.plan.blocks.map((b) => ({
        componentType: b.componentType,
        span: b.layout.span
      })),
      preferenceScope: 'recipe',
      createdFromSessionId: state.id,
      createdAt: now,
      updatedAt: now
    };
    const recipes = await window.gptb.recipesSave(recipe);
    this.set({ recipes });
    this.toast(`레시피 "${name}" 저장 완료. 열 때마다 새 콘텐츠로 재생성돼요.`);
  }

  async runRecipe(recipe: Recipe): Promise<void> {
    this.newSession();
    this.dispatch({ type: 'rename_session', title: recipe.name }, { silent: true });
    await this.generate(recipe.intentTemplate, recipe);
  }

  async removeRecipe(id: string): Promise<void> {
    const recipes = await window.gptb.recipesRemove(id);
    this.set({ recipes });
  }

  // ── Panels / preferences / archive / settings / updater ──────────────

  openPanel(panel: PanelKind, inspectBlockId?: string): void {
    this.set({ panel, inspectBlockId: inspectBlockId ?? null });
    if (panel === 'prefs') void this.refreshPrefs();
    if (panel === 'history') void this.refreshArchive();
  }

  async refreshPrefs(): Promise<void> {
    const prefSignals = await window.gptb.prefsList();
    this.set({ prefSignals });
  }

  async clearPref(id?: string): Promise<void> {
    const prefSignals = await window.gptb.prefsClear(id);
    this.set({ prefSignals });
    this.toast(id ? '해당 학습 신호를 삭제했어요.' : '학습된 선호를 모두 삭제했어요.');
  }

  async refreshArchive(): Promise<void> {
    const archive = await window.gptb.sessionsList();
    this.set({ archive });
  }

  restoreSnapshot(snapshot: GeneratedSnapshot): void {
    const act = this.active();
    if (!act) return;
    const h = act.entry.history;
    const restored: SessionHistory = {
      past: [...h.past, h.present].slice(-100),
      present: snapshot.state,
      future: [],
      snapshots: h.snapshots
    };
    this.patchEntry(act.id, { history: restored });
    this.toast(`"${snapshot.label}" 상태로 되돌렸어요.`);
  }

  async openArchivedSession(sessionId: string): Promise<void> {
    const snapshots = await window.gptb.sessionsLoad(sessionId);
    const latest = snapshots[snapshots.length - 1];
    if (!latest) {
      this.toast('저장된 상태가 없어요.');
      return;
    }
    const entry: SessionEntry = {
      history: { ...createHistory(latest.state), snapshots },
      progress: null,
      reports: [],
      issues: []
    };
    this.set({
      sessions: { ...this.state.sessions, [sessionId]: entry },
      order: this.state.order.includes(sessionId)
        ? this.state.order
        : [...this.state.order, sessionId],
      activeId: sessionId,
      panel: null
    });
  }

  async saveSettings(patch: Parameters<typeof window.gptb.settingsSet>[0]): Promise<void> {
    const settings = await window.gptb.settingsSet(patch);
    this.set({ settings });
    this.toast('설정을 저장했어요.');
  }

  async checkUpdates(): Promise<void> {
    const updater = await window.gptb.updaterCheck();
    this.set({ updater });
  }

  installUpdate(): void {
    void window.gptb.updaterInstall();
  }

  openOriginal(url: string): void {
    void window.gptb.openOriginal(url);
  }
}

export const appStore = new AppStore();

export function useAppState(): AppState {
  return useSyncExternalStore(appStore.subscribe, appStore.get);
}
