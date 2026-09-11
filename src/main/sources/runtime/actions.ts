import {
  InputPayloadSchema,
  NavigatePayloadSchema,
  parseBuiltinActionId,
  type ProjectedElement,
  type SemanticProjection,
  type SourceActionRequest,
  type SourceActionResult
} from '@shared/domain/projection';
import { normalizeOrigin } from './origin';
import type { SourcePage } from './sourcePage';

export interface BuiltinActionEnv {
  sourceId: string;
  origin: string;
  page: SourcePage;
  /** The projection the caller is acting against, if one was made. */
  lastProjection: SemanticProjection | null;
  /** Re-project the page after the action. */
  reproject: () => Promise<SemanticProjection>;
}

const fail = (
  req: SourceActionRequest,
  error: string,
  invalidation?: SourceActionResult['invalidation']
): SourceActionResult => ({
  ok: false,
  sourceId: req.sourceId,
  actionId: req.actionId,
  error,
  ...(invalidation ? { invalidation } : {})
});

/**
 * Perform one of the built-in typed actions on a page-backed source context
 * and return the refreshed projection. Safety rules live here:
 *  - navigate: http(s) only and same origin as the context (a context IS an
 *    origin; sending it elsewhere would mix sessions);
 *  - click/input/submit: only elements the LAST projection listed, so an id
 *    made up by an LLM cannot reach the page;
 *  - destructive elements and every form submit need `confirmed: true`;
 *  - `expectedProjectionId` guards against acting on a page that moved on.
 */
export async function performBuiltinAction(
  env: BuiltinActionEnv,
  req: SourceActionRequest
): Promise<SourceActionResult | null> {
  const parsed = parseBuiltinActionId(req.actionId);
  if (!parsed) return null;

  if (req.expectedProjectionId !== undefined) {
    const current = env.lastProjection?.projectionId;
    if (current !== req.expectedProjectionId) {
      return fail(req, '페이지가 바뀌어 이전 상태에 대한 동작을 수행할 수 없어요.', {
        reason: 'stale-projection',
        projectionId: req.expectedProjectionId,
        message: current
          ? `현재 projection은 ${current}이에요.`
          : '아직 projection이 만들어지지 않았어요.'
      });
    }
  }

  const element = (index: number, kind: ProjectedElement['kind'][]): ProjectedElement | SourceActionResult => {
    const el = env.lastProjection?.elements?.find((e) => e.actionId === req.actionId);
    if (!el || !kind.includes(el.kind)) {
      return fail(req, `요소 "${req.actionId}"는 현재 projection에 없어요.`, {
        reason: 'unknown-action',
        projectionId: env.lastProjection?.projectionId,
        message: '먼저 projection을 새로 만든 뒤 그 안의 actionId로 요청해 주세요.'
      });
    }
    if (!el.enabled) return fail(req, `요소 "${el.label}"는 지금 사용할 수 없어요.`);
    if (el.requiresConfirmation && req.confirmed !== true) {
      return {
        ok: false,
        sourceId: req.sourceId,
        actionId: req.actionId,
        requiresConfirmation: true,
        error: `"${el.label}"은(는) 외부 상태를 바꾸는 동작이라 확인이 필요해요.`
      };
    }
    void index;
    return el;
  };

  try {
    switch (parsed.kind) {
      case 'navigate': {
        const payload = NavigatePayloadSchema.safeParse(req.payload);
        if (!payload.success) return fail(req, 'navigate에는 payload.url이 필요해요.');
        let target: string;
        try {
          target = normalizeOrigin(payload.data.url);
        } catch {
          return fail(req, 'http(s) 주소만 열 수 있어요.', {
            reason: 'refused',
            message: `허용되지 않는 주소: ${payload.data.url}`
          });
        }
        if (target !== env.origin) {
          return fail(req, '이 소스 세션은 자기 출처(origin) 안에서만 이동할 수 있어요.', {
            reason: 'refused',
            message: `${env.origin} 밖으로는 이동하지 않아요: ${payload.data.url}`
          });
        }
        await env.page.loadURL(payload.data.url);
        break;
      }
      case 'back':
        if (!env.page.canGoBack()) return fail(req, '뒤로 갈 페이지가 없어요.');
        await env.page.goBack();
        break;
      case 'forward':
        if (!env.page.canGoForward()) return fail(req, '앞으로 갈 페이지가 없어요.');
        await env.page.goForward();
        break;
      case 'reload':
        await env.page.reload();
        break;
      case 'click': {
        const el = element(parsed.index!, ['link', 'button']);
        if ('ok' in el) return el;
        await env.page.click(parsed.index!);
        break;
      }
      case 'input': {
        const el = element(parsed.index!, ['input']);
        if ('ok' in el) return el;
        const payload = InputPayloadSchema.safeParse(req.payload);
        if (!payload.success) return fail(req, 'input에는 payload.value(문자열)가 필요해요.');
        await env.page.setInput(parsed.index!, payload.data.value);
        break;
      }
      case 'submit': {
        const el = element(parsed.index!, ['form']);
        if ('ok' in el) return el;
        await env.page.submit(parsed.index!);
        break;
      }
    }
  } catch (err) {
    return fail(req, err instanceof Error ? err.message : String(err), {
      reason: 'navigation-failed',
      projectionId: env.lastProjection?.projectionId,
      message: '동작 중 페이지가 실패해 이전 projection을 신뢰할 수 없어요.'
    });
  }

  const projection = await env.reproject();
  return { ok: true, sourceId: req.sourceId, actionId: req.actionId, projection };
}
