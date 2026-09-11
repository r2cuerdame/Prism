import { randomUUID } from 'node:crypto';
import type { SourceItem } from '@shared/domain/sourceItem';
import {
  scrubSecrets,
  type ProjectedElement,
  type SemanticProjection,
  type SourceActionDescriptor
} from '@shared/domain/projection';
import type { PageSnapshot, RawPageElement } from './sourcePage';

const MAX_ELEMENTS = 200;
const MAX_ITEMS = 60;
const LOGIN_PATH_RE = /(^|\/)(login|log-in|signin|sign-in|sessions?\/new|auth|account\/login)(\/|$|\?)/i;

/**
 * Words that mean "this changes the world outside the page". A click on such
 * an element needs an explicit confirmation flag (GOAL.md § Privacy: actions
 * that affect an external account are explicit and confirmable).
 */
const DESTRUCTIVE_RE =
  /\b(delete|remove|unsubscribe|log ?out|sign ?out|purchase|buy|pay|checkout|order|post|publish|submit|send|reply|vote|upvote|downvote|block|report|deactivate|cancel)\b|삭제|제거|탈퇴|로그아웃|구매|결제|주문|게시|등록|전송|답글|추천|비추천|차단|신고|취소|구독 ?취소/i;

export function isDestructiveLabel(label: string): boolean {
  return DESTRUCTIVE_RE.test(label);
}

/** Does this page want the user to sign in before it shows real content? */
export function detectLoginNeeded(snapshot: PageSnapshot): boolean {
  if (snapshot.hasPasswordField) return true;
  try {
    return LOGIN_PATH_RE.test(new URL(snapshot.url).pathname);
  } catch {
    return false;
  }
}

const isHttp = (url: string | undefined): url is string => {
  if (!url) return false;
  try {
    const p = new URL(url).protocol;
    return p === 'http:' || p === 'https:';
  } catch {
    return false;
  }
};

const clip = (s: string, n: number): string => (s.length <= n ? s : `${s.slice(0, n - 1)}…`);

function toElement(sourceId: string, el: RawPageElement, index: number): ProjectedElement | null {
  const label = clip(el.label.trim(), 200);
  switch (el.kind) {
    case 'link': {
      if (!isHttp(el.href)) return null;
      const destructive = isDestructiveLabel(label);
      return {
        sourceId,
        actionId: `click:${index}`,
        kind: 'link',
        label,
        href: el.href,
        destructive,
        requiresConfirmation: destructive,
        enabled: !el.disabled
      };
    }
    case 'button': {
      const destructive = isDestructiveLabel(label);
      return {
        sourceId,
        actionId: `click:${index}`,
        kind: 'button',
        label,
        destructive,
        requiresConfirmation: destructive,
        enabled: !el.disabled
      };
    }
    case 'input': {
      const password = el.inputType === 'password';
      return {
        sourceId,
        actionId: `input:${index}`,
        kind: 'input',
        label,
        inputType: el.inputType ?? 'text',
        // A password field's value is a credential — never projected.
        ...(password || el.value === undefined ? {} : { value: clip(el.value, 2000) }),
        destructive: false,
        requiresConfirmation: false,
        enabled: !el.disabled
      };
    }
    case 'form':
      // Submitting a form is always an external side effect.
      return {
        sourceId,
        actionId: `submit:${index}`,
        kind: 'form',
        label,
        destructive: true,
        requiresConfirmation: true,
        enabled: !el.disabled
      };
  }
}

function toItem(
  el: RawPageElement,
  opts: { adapterId: string; sourceId: string; sourceName: string; retrievedAt: string; provenanceRef: string }
): SourceItem | null {
  if (el.kind !== 'link' || !isHttp(el.href)) return null;
  const title = el.label.trim();
  if (title.length < 3) return null;
  return {
    id: `itm_${randomUUID()}`,
    adapterId: opts.adapterId,
    sourceId: opts.sourceId,
    sourceName: opts.sourceName,
    kind: el.itemKind ?? 'article',
    title: clip(title, 200),
    summary: el.summary ? clip(el.summary, 500) : undefined,
    payload: el.itemKind === 'post' ? { community: opts.sourceName } : {},
    originalUrl: el.href,
    retrievedAt: opts.retrievedAt,
    provenanceRef: opts.provenanceRef
  };
}

export interface ProjectOptions {
  sourceId: string;
  sourceName: string;
  origin: string;
  partitionId: string;
  canGoBack: boolean;
  canGoForward: boolean;
  availableActions: SourceActionDescriptor[];
  now?: () => Date;
}

/**
 * Turn a page snapshot into the typed projection the rest of the app sees.
 * Items come from content links; elements carry sourceId + actionId; the
 * navigation actions are always present so a block can page/back/reload.
 */
export function projectSnapshot(snapshot: PageSnapshot, opts: ProjectOptions): SemanticProjection {
  const now = (opts.now ?? (() => new Date()))();
  const projectionId = `proj_${randomUUID()}`;
  const provenanceRef = `prov_${projectionId}`;
  const retrievedAt = now.toISOString();

  const elements: ProjectedElement[] = [];
  const items: SourceItem[] = [];
  const seenUrls = new Set<string>();
  snapshot.elements.slice(0, MAX_ELEMENTS).forEach((raw, index) => {
    const el = toElement(opts.sourceId, raw, index);
    if (el) elements.push(el);
    if (items.length < MAX_ITEMS) {
      const item = toItem(raw, {
        adapterId: 'source-runtime',
        sourceId: opts.sourceId,
        sourceName: opts.sourceName,
        retrievedAt,
        provenanceRef
      });
      if (item && !seenUrls.has(item.originalUrl)) {
        seenUrls.add(item.originalUrl);
        items.push(item);
      }
    }
  });

  const nav = (actionId: string, label: string, enabled: boolean): ProjectedElement => ({
    sourceId: opts.sourceId,
    actionId,
    kind: 'navigation',
    label,
    destructive: false,
    requiresConfirmation: false,
    enabled
  });
  elements.push(
    nav('back', '뒤로', opts.canGoBack),
    nav('forward', '앞으로', opts.canGoForward),
    nav('reload', '새로고침', true)
  );

  const authRequired = detectLoginNeeded(snapshot);
  const projection: SemanticProjection = {
    projectionId,
    sourceId: opts.sourceId,
    origin: opts.origin,
    partitionId: opts.partitionId,
    timestamp: now.getTime(),
    url: snapshot.url,
    title: clip(snapshot.title, 200),
    authRequired,
    ...(authRequired ? { loginUrl: snapshot.url } : {}),
    items,
    elements,
    availableActions: opts.availableActions,
    canGoBack: opts.canGoBack,
    canGoForward: opts.canGoForward
  };
  return scrubSecrets(projection);
}
