import { app, ipcMain, shell, type BrowserWindow } from 'electron';
import { join } from 'path';
import { z } from 'zod';
import {
  IPC,
  type GenerateProgress,
  type GenerateRequest,
  type GenerateResponse,
  type InterpretEditRequest,
  type InterpretEditResponse,
  type RegenerateBlockRequest,
  type RegenerateBlockResponse,
  type SettingsPatch,
  type SettingsView,
  type UpdaterStatus
} from '@shared/ipc';
import { newId, nowIso } from '@shared/domain/ids';
import { InterpretedIntentSchema } from '@shared/domain/intent';
import { ComponentBlockSchema } from '@shared/domain/layoutPlan';
import { SourceItemSchema } from '@shared/domain/sourceItem';
import { interleaveBySource } from '@shared/planner/crossSource';
import { RecipeSchema } from '@shared/domain/recipe';
import { PreferenceSignalSchema } from '@shared/domain/preference';
import { GeneratedSnapshotSchema } from '@shared/domain/session';
import { getCatalogEntry } from '@shared/catalog/catalog';
import type { InterpretedIntent } from '@shared/domain/intent';
import type { PlanRequest } from '@shared/planner/plannerTypes';
import { interpretIntentRules } from '@shared/planner/heuristicIntent';
import { heuristicPlan } from '@shared/planner/heuristicPlanner';
import { createHttpClient } from './sources/http';
import { gatherSources } from './sources/orchestrator';
import { hackerNewsAdapter } from './sources/adapters/hackernews';
import { lobstersAdapter } from './sources/adapters/lobsters';
import { rssNewsAdapter } from './sources/adapters/rssNews';
import { youtubeAdapter } from './sources/adapters/youtube';
import { redditAdapter } from './sources/adapters/reddit';
import type { AdapterContext, SourceAdapter } from './sources/types';
import { createRecipeStore } from './store/recipeStore';
import { createPreferenceStore } from './store/preferenceStore';
import { createSessionArchive } from './store/sessionArchive';
import { createSettingsStore } from './store/settingsStore';
import { createCodexRunner, type CodexRunner } from './llm/codexRunner';
import { detectAuth, runOauthLogin } from './llm/gptAuth';
import { interpretIntentLlm } from './llm/llmIntent';
import { planLayoutLlm } from './llm/llmPlanner';
import { interpretEditLlm } from './llm/llmEditor';
import { openOriginalWindow, isSafeHttpUrl } from './originalViewer';
import { createUpdater, type UpdaterHandle } from './updater';

/**
 * Renderer payload schemas. The renderer is a trust boundary like any other —
 * everything crossing it is parsed before the planner/adapter layer sees it.
 */
const CompositionHintsShape = z.object({
  mix: z.object({
    video: z.enum(['more', 'less']).optional(),
    article: z.enum(['more', 'less']).optional(),
    post: z.enum(['more', 'less']).optional(),
    headline: z.enum(['more', 'less']).optional()
  }),
  notes: z.array(z.string())
});

const GenerateRequestSchema = z.object({
  sessionId: z.string().min(1).max(200),
  rawInput: z.string().max(4000).nullable(),
  priorInterpretation: InterpretedIntentSchema.nullable(),
  preserved: z.object({ dockedBlocks: z.array(ComponentBlockSchema).max(50) }),
  hints: CompositionHintsShape,
  keepItems: z.array(SourceItemSchema).max(300),
  recipeContext: z
    .object({
      recipeId: z.string(),
      name: z.string(),
      layoutTemplate: z
        .array(
          z.object({
            componentType: z.string(),
            span: z.number().int().min(1).max(12),
            title: z.string().max(200).optional(),
            docked: z.boolean().optional(),
            locked: z.boolean().optional(),
            props: z.record(z.string(), z.unknown()).optional()
          })
        )
        .max(30),
      density: z.enum(['compact', 'comfortable'])
    })
    .nullable()
});

const RegenerateBlockRequestSchema = z.object({
  sessionId: z.string().min(1).max(200),
  block: ComponentBlockSchema,
  interpretation: InterpretedIntentSchema,
  excludeUrls: z.array(z.string()).max(500)
});

const InterpretEditRequestSchema = z.object({
  utterance: z.string().min(1).max(2000),
  digest: z.object({
    sessionId: z.string(),
    goal: z.string(),
    blocks: z
      .array(
        z.object({
          id: z.string(),
          index: z.number().int().min(0),
          componentType: z.string(),
          title: z.string(),
          kinds: z.array(z.string()),
          span: z.number().int(),
          docked: z.boolean(),
          locked: z.boolean(),
          itemTitles: z.array(z.string())
        })
      )
      .max(60)
  })
});

const ADAPTERS: SourceAdapter[] = [
  youtubeAdapter,
  rssNewsAdapter,
  hackerNewsAdapter,
  lobstersAdapter,
  redditAdapter
];

export interface MainServices {
  updater: UpdaterHandle;
}

export function registerIpcHandlers(getWindow: () => BrowserWindow | null): MainServices {
  const dataDir = join(app.getPath('userData'), 'gptbrowser');
  const recipes = createRecipeStore(dataDir);
  const prefs = createPreferenceStore(dataDir);
  const archive = createSessionArchive(dataDir);
  const settings = createSettingsStore(dataDir);
  const ctx: AdapterContext = { http: createHttpClient(), now: () => new Date() };

  const send = (channel: string, payload: unknown): void => {
    const win = getWindow();
    if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
  };
  const progress = (p: GenerateProgress): void => send(IPC.evGenerateProgress, p);

  /** Planning borrows the user's Codex sign-in; the app never holds a key. */
  const llm = async (): Promise<{ runner: CodexRunner }> => {
    const s = await settings.get();
    const view = await settingsView();
    return {
      runner: createCodexRunner({
        ready: view.authMethod !== 'none',
        model: s.plannerModel === '' ? undefined : s.plannerModel
      })
    };
  };

  let authCache: {
    method: SettingsView['authMethod'];
    detail: string;
    at: number;
  } | null = null;
  const settingsView = async (forceAuthProbe = false): Promise<SettingsView> => {
    const s = await settings.get();
    if (forceAuthProbe || !authCache || Date.now() - authCache.at > 60_000) {
      const detected = await detectAuth(undefined);
      authCache = { method: detected.method, detail: detected.detail, at: Date.now() };
    }
    return {
      authMethod: authCache.method,
      authDetail: authCache.detail,
      plannerModel: s.plannerModel,
      autoUpdate: s.autoUpdate,
      locale: s.locale,
      appVersion: app.getVersion()
    };
  };

  ipcMain.handle(IPC.generate, async (_e, raw: unknown): Promise<GenerateResponse> => {
    const fail = (error: string): GenerateResponse => ({
      ok: false,
      intent: null,
      interpretation: null,
      items: [],
      provenance: [],
      plan: null,
      reports: [],
      issues: [],
      error
    });
    const parsedReq = GenerateRequestSchema.safeParse(raw);
    if (!parsedReq.success) return fail('요청 형식이 올바르지 않아요.');
    const req: GenerateRequest = parsedReq.data;
    try {
      const { runner } = await llm();
      const prefSummary = await prefs.summarizeForPlanner();

      progress({ sessionId: req.sessionId, phase: 'interpreting' });
      let interpretation: InterpretedIntent | null = null;
      if (req.rawInput !== null && req.rawInput.trim() !== '') {
        if (runner.ready) {
          interpretation = await interpretIntentLlm(
            runner,
            req.rawInput,
            req.priorInterpretation,
            prefSummary || undefined
          );
        }
        interpretation ??= interpretIntentRules(req.rawInput, req.priorInterpretation);
      } else {
        interpretation = req.priorInterpretation;
      }
      if (!interpretation) return fail('해석할 의도가 없어요. 의도를 입력해 주세요.');

      const intent = {
        id: newId('int'),
        rawInput: req.rawInput ?? '[재생성]',
        interpreted: interpretation,
        createdAt: nowIso(),
        derivedFrom: req.recipeContext
          ? { type: 'recipe' as const, id: req.recipeContext.recipeId }
          : req.rawInput === null
            ? { type: 'session' as const, id: req.sessionId }
            : undefined
      };

      progress({ sessionId: req.sessionId, phase: 'gathering' });
      const gathered = await gatherSources(interpretation, ADAPTERS, ctx);

      progress({ sessionId: req.sessionId, phase: 'planning' });
      const planReq: PlanRequest = {
        interpretation,
        items: gathered.items,
        sessionId: req.sessionId,
        preserved: { dockedBlocks: req.preserved.dockedBlocks },
        hints: req.hints,
        prefSummary: prefSummary || undefined,
        recipeShape: req.recipeContext
          ? {
              name: req.recipeContext.name,
              layoutTemplate: req.recipeContext.layoutTemplate,
              density: req.recipeContext.density
            }
          : undefined
      };
      let planResult = runner.ready ? await planLayoutLlm(runner, planReq) : null;
      const issues: string[] = [];
      if (!planResult) {
        if (runner.ready) {
          issues.push('Codex 플래너를 사용할 수 없어 오프라인 구성으로 만들었어요.');
        }
        planResult = heuristicPlan(planReq);
      }
      issues.push(...planResult.issues);

      progress({ sessionId: req.sessionId, phase: 'done' });
      return {
        ok: true,
        intent,
        interpretation,
        items: gathered.items,
        provenance: gathered.provenance,
        plan: planResult.plan,
        reports: gathered.reports,
        issues
      };
    } catch (err) {
      progress({ sessionId: req.sessionId, phase: 'error', detail: String(err) });
      return fail(err instanceof Error ? err.message : '알 수 없는 오류가 발생했어요.');
    }
  });

  ipcMain.handle(
    IPC.regenerateBlock,
    async (_e, rawReq: unknown): Promise<RegenerateBlockResponse> => {
      const parsed = RegenerateBlockRequestSchema.safeParse(rawReq);
      if (!parsed.success) {
        return { ok: false, block: null, items: [], provenance: [], error: '요청 형식이 올바르지 않아요.' };
      }
      const req: RegenerateBlockRequest = parsed.data;
      try {
        const entry = getCatalogEntry(req.block.componentType);
        if (!entry) return { ok: false, block: null, items: [], provenance: [], error: '알 수 없는 컴포넌트예요.' };
        const kinds = entry.acceptsKinds;
        if (kinds !== null && kinds.length === 0) {
          return { ok: false, block: null, items: [], provenance: [], error: '이 블록은 콘텐츠 블록이 아니라 재생성할 수 없어요.' };
        }
        const classesFor = new Set<string>();
        for (const k of kinds ?? ['video', 'article', 'post', 'headline']) {
          if (k === 'video') classesFor.add('video');
          if (k === 'article' || k === 'headline') classesFor.add('news');
          if (k === 'post') classesFor.add('community');
        }
        const adapters = ADAPTERS.filter((a) => a.classes.some((c) => classesFor.has(c)));
        const gathered = await gatherSources(req.interpretation, adapters, ctx, {
          totalLimit: 30
        });
        // Identity across fetches is the original URL — item ids are minted
        // fresh on every gather, so excluding by id would exclude nothing.
        const exclude = new Set(req.excludeUrls);
        const fresh = gathered.items.filter(
          (i) => !exclude.has(i.originalUrl) && (kinds === null || kinds.includes(i.kind))
        );
        const want = Math.max(entry.minItems, Math.min(entry.maxItems, req.block.sourceItemRefs.length || entry.maxItems));
        const picked = interleaveBySource(fresh).slice(0, want);
        if (picked.length < entry.minItems) {
          return {
            ok: false,
            block: null,
            items: [],
            provenance: [],
            error: '아직 새로운 콘텐츠가 없어요. 잠시 후 다시 시도해 주세요.'
          };
        }
        return {
          ok: true,
          block: { ...req.block, sourceItemRefs: picked.map((i) => i.id), state: {} },
          items: picked,
          provenance: gathered.provenance.filter((p) =>
            picked.some((i) => i.provenanceRef === p.id)
          ),
          error: undefined
        };
      } catch (err) {
        return {
          ok: false,
          block: null,
          items: [],
          provenance: [],
          error: err instanceof Error ? err.message : '블록 재생성에 실패했어요.'
        };
      }
    }
  );

  ipcMain.handle(
    IPC.interpretEdit,
    async (_e, rawReq: unknown): Promise<InterpretEditResponse> => {
      const parsed = InterpretEditRequestSchema.safeParse(rawReq);
      if (!parsed.success) {
        return {
          ok: false,
          commands: [],
          explanation: '요청 형식이 올바르지 않아요.',
          source: 'none'
        };
      }
      const req: InterpretEditRequest = parsed.data;
      const { runner } = await llm();
      if (!runner.ready) {
        return {
          ok: false,
          commands: [],
          explanation:
            '로그인되어 있지 않아 고급 자연어 편집을 사용할 수 없어요. 설정에서 로그인해 주세요.',
          source: 'none'
        };
      }
      const result = await interpretEditLlm(runner, req.utterance, req.digest);
      if (!result) {
        return { ok: false, commands: [], explanation: '요청을 해석하지 못했어요.', source: 'llm' };
      }
      return { ok: true, commands: result.commands, explanation: result.explanation, source: 'llm' };
    }
  );

  ipcMain.handle(IPC.recipesList, () => recipes.list());
  ipcMain.handle(IPC.recipesSave, (_e, raw: unknown) => recipes.save(RecipeSchema.parse(raw)));
  ipcMain.handle(IPC.recipesRemove, (_e, id: unknown) => recipes.remove(z.string().parse(id)));

  ipcMain.handle(IPC.prefsList, () => prefs.list());
  ipcMain.handle(IPC.prefsRecord, async (_e, raw: unknown) => {
    await prefs.record(z.array(PreferenceSignalSchema).parse(raw));
  });
  ipcMain.handle(IPC.prefsClear, (_e, id?: unknown) =>
    prefs.clear(id === undefined ? undefined : z.string().parse(id))
  );

  ipcMain.handle(IPC.sessionsSaveSnapshot, async (_e, raw: unknown) => {
    await archive.saveSnapshot(GeneratedSnapshotSchema.parse(raw));
  });
  ipcMain.handle(IPC.sessionsList, () => archive.list());
  ipcMain.handle(IPC.sessionsLoad, (_e, id: unknown) => archive.load(z.string().parse(id)));

  ipcMain.handle(IPC.settingsGet, () => settingsView());
  ipcMain.handle(IPC.settingsSet, async (_e, patch: SettingsPatch) => {
    await settings.set({
      ...(patch.plannerModel !== undefined ? { plannerModel: patch.plannerModel } : {}),
      ...(patch.autoUpdate !== undefined ? { autoUpdate: patch.autoUpdate } : {}),
      ...(patch.locale !== undefined ? { locale: patch.locale } : {})
    });
    return settingsView(true);
  });

  ipcMain.handle(IPC.authStatus, () => settingsView(true));
  ipcMain.handle(IPC.authLogin, async () => {
    // The CLI's own browser launch is unreliable when spawned from a GUI
    // process, so open the sign-in URL ourselves the moment it appears.
    const result = await runOauthLogin({
      onUrl: (url) => {
        if (isSafeHttpUrl(url)) void shell.openExternal(url);
      }
    });
    const view = await settingsView(true);
    return { ok: result.ok, message: result.message, url: result.url, settings: view };
  });

  const updater = createUpdater({
    send: (s: UpdaterStatus) => send(IPC.evUpdaterStatus, s),
    autoUpdateEnabled: async () => (await settings.get()).autoUpdate
  });
  ipcMain.handle(IPC.updaterCheck, () => updater.check());
  ipcMain.handle(IPC.updaterInstall, () => updater.install());

  ipcMain.handle(IPC.openOriginal, (_e, url: unknown) => {
    const u = z.string().parse(url);
    openOriginalWindow(u, getWindow() ?? undefined);
  });
  ipcMain.handle(IPC.openExternal, async (_e, url: unknown) => {
    const u = z.string().parse(url);
    if (isSafeHttpUrl(u)) await shell.openExternal(u);
  });

  return { updater };
}
