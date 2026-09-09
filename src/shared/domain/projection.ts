import { z } from 'zod';
import { SourceItemSchema, type SourceItem } from './sourceItem';

/**
 * What a hidden source context is allowed to tell the rest of the app.
 *
 * A projection is TYPED SEMANTIC DATA ONLY: normalized items, a list of
 * actionable elements (each addressed by sourceId + actionId), and page-level
 * facts such as "this page wants a login". It never carries HTML, scripts,
 * styles, cookies, tokens or storage — those stay inside the Chromium session
 * that owns the source (GOAL.md § Source runner).
 */
export const ProjectedElementKindSchema = z.enum(['link', 'button', 'input', 'form', 'navigation']);
export type ProjectedElementKind = z.infer<typeof ProjectedElementKindSchema>;

export const ProjectedElementSchema = z.object({
  sourceId: z.string(),
  /** Routable id, e.g. `click:3`, `input:1`, `submit:0`, `back`. */
  actionId: z.string(),
  kind: ProjectedElementKindSchema,
  label: z.string().max(200),
  /** Links only, http(s) only. */
  href: z.string().optional(),
  /** Inputs only; password fields never report a value. */
  inputType: z.string().optional(),
  value: z.string().max(2000).optional(),
  /** Acting on it changes external state (submit, delete, buy, log out...). */
  destructive: z.boolean().default(false),
  /** The runtime refuses this action unless the request carries `confirmed`. */
  requiresConfirmation: z.boolean().default(false),
  enabled: z.boolean().default(true)
});
/** Input shape: fields with schema defaults are optional when hand-built. */
export type ProjectedElement = z.input<typeof ProjectedElementSchema>;

export const SourceActionDescriptorSchema = z.object({
  actionId: z.string(),
  name: z.string(),
  description: z.string().optional(),
  destructive: z.boolean().optional()
});
export type SourceActionDescriptor = z.infer<typeof SourceActionDescriptorSchema>;

export const SemanticProjectionSchema = z.object({
  projectionId: z.string(),
  sourceId: z.string(),
  origin: z.string(),
  partitionId: z.string(),
  timestamp: z.number(),
  url: z.string().optional(),
  title: z.string().optional(),
  /** The page is asking for a sign-in; `loginUrl` is where it asks. */
  authRequired: z.boolean().default(false),
  loginUrl: z.string().optional(),
  items: z.array(SourceItemSchema),
  elements: z.array(ProjectedElementSchema).default([]),
  availableActions: z.array(SourceActionDescriptorSchema),
  canGoBack: z.boolean().default(false),
  canGoForward: z.boolean().default(false),
  metadata: z.record(z.string(), z.unknown()).optional(),
  data: z.unknown().optional()
});
export type SemanticProjection<T = unknown> = Omit<
  z.input<typeof SemanticProjectionSchema>,
  'data' | 'elements' | 'items'
> & { items: SourceItem[]; elements?: ProjectedElement[]; data?: T };

/** Built-in typed actions every page-backed source context understands. */
export const BUILTIN_ACTION_KINDS = [
  'navigate',
  'click',
  'input',
  'submit',
  'back',
  'forward',
  'reload'
] as const;
export type BuiltinActionKind = (typeof BUILTIN_ACTION_KINDS)[number];

export const NavigatePayloadSchema = z.object({ url: z.string().min(1) });
export const InputPayloadSchema = z.object({ value: z.string().max(2000) });

export const SourceActionRequestSchema = z.object({
  sourceId: z.string().min(1),
  actionId: z.string().min(1),
  payload: z.record(z.string(), z.unknown()).optional(),
  /** Required for destructive actions; absent means "ask first". */
  confirmed: z.boolean().optional(),
  /** When set, the action is refused if the page has moved on since. */
  expectedProjectionId: z.string().optional(),
  contextId: z.string().optional()
});
export type SourceActionRequest = z.infer<typeof SourceActionRequestSchema>;

export const InvalidationReasonSchema = z.enum([
  'stale-projection',
  'context-destroyed',
  'unknown-action',
  'refused',
  'navigation-failed'
]);
export type InvalidationReason = z.infer<typeof InvalidationReasonSchema>;

export interface ProjectionInvalidation {
  reason: InvalidationReason;
  /** The projection the request was made against, when known. */
  projectionId?: string;
  message: string;
}

export interface SourceActionResult<T = unknown> {
  ok: boolean;
  sourceId: string;
  actionId: string;
  /** Fresh semantic state after a successful action on a page-backed source. */
  projection?: SemanticProjection | null;
  /** Why the previous projection can no longer be trusted. */
  invalidation?: ProjectionInvalidation;
  /** The action is destructive: resend with `confirmed: true` to perform it. */
  requiresConfirmation?: boolean;
  data?: T;
  error?: string;
}

/**
 * Parse `click:3` → { kind: 'click', index: 3 }; page-level actions have no
 * index. Anything else is not a built-in action.
 */
export function parseBuiltinActionId(
  actionId: string
): { kind: BuiltinActionKind; index?: number } | null {
  const [head, tail] = actionId.split(':');
  if (!head || !(BUILTIN_ACTION_KINDS as readonly string[]).includes(head)) return null;
  const kind = head as BuiltinActionKind;
  if (kind === 'click' || kind === 'input' || kind === 'submit') {
    if (tail === undefined || !/^\d+$/.test(tail)) return null;
    return { kind, index: Number(tail) };
  }
  return tail === undefined ? { kind } : null;
}

/** Keys that must never appear in anything leaving the source boundary. */
const FORBIDDEN_KEY_RE = /cookie|token|password|passwd|secret|session[-_]?id|authorization|credential/i;

/**
 * Defensive scrub for the renderer/LLM boundary: strips any key that looks
 * like a credential from metadata/data, recursively. Projections are built
 * from typed fields so this should never find anything — it exists so a bug
 * upstream degrades into a missing field rather than a leaked secret.
 */
export function scrubSecrets<T>(value: T): T {
  if (Array.isArray(value)) return value.map((v) => scrubSecrets(v)) as unknown as T;
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (FORBIDDEN_KEY_RE.test(k)) continue;
      out[k] = scrubSecrets(v);
    }
    return out as T;
  }
  return value;
}
