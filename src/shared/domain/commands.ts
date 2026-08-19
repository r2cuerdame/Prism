import { z } from 'zod';
import { ComponentBlockSchema, LayoutPlanSchema } from './layoutPlan';
import { IntentSchema } from './intent';
import { SourceItemKindSchema, SourceItemSchema } from './sourceItem';
import { SessionStatusSchema } from './session';
import { ProvenanceSchema } from './provenance';

/**
 * The single edit language of a Session. Direct manipulation (drag/resize/
 * remove/dock), natural-language edits and regeneration ALL compile down to
 * these commands — there is no separate "chat version" of the page (GOAL.md §4).
 */
export const SessionCommandSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('move_block'),
    blockId: z.string(),
    toIndex: z.number().int().min(0)
  }),
  z.object({
    type: z.literal('resize_block'),
    blockId: z.string(),
    span: z.number().int().min(1).max(12).optional(),
    heightPx: z.number().int().min(120).max(2000).nullable().optional()
  }),
  z.object({
    type: z.literal('remove_block'),
    blockId: z.string(),
    reason: z.string().optional()
  }),
  z.object({
    type: z.literal('dock_block'),
    blockId: z.string(),
    docked: z.boolean()
  }),
  z.object({
    type: z.literal('lock_block'),
    blockId: z.string(),
    locked: z.boolean()
  }),
  z.object({
    type: z.literal('set_block_props'),
    blockId: z.string(),
    props: z.record(z.string(), z.unknown())
  }),
  z.object({
    type: z.literal('set_block_state'),
    blockId: z.string(),
    state: z.record(z.string(), z.unknown())
  }),
  z.object({
    type: z.literal('insert_block'),
    block: ComponentBlockSchema,
    atIndex: z.number().int().min(0).optional()
  }),
  z.object({
    type: z.literal('adjust_mix'),
    kind: z.union([SourceItemKindSchema, z.literal('all')]),
    direction: z.enum(['more', 'less', 'none'])
  }),
  z.object({
    type: z.literal('apply_plan'),
    plan: LayoutPlanSchema,
    /** New items to merge into the session pool. */
    items: z.array(SourceItemSchema).optional(),
    /** Evidence records for those items. */
    provenance: z.array(ProvenanceSchema).optional()
  }),
  z.object({
    type: z.literal('replace_block'),
    blockId: z.string(),
    block: ComponentBlockSchema,
    items: z.array(SourceItemSchema).optional(),
    provenance: z.array(ProvenanceSchema).optional()
  }),
  z.object({
    type: z.literal('add_intent'),
    intent: IntentSchema
  }),
  z.object({
    type: z.literal('set_status'),
    status: SessionStatusSchema,
    detail: z.string().optional()
  }),
  z.object({
    type: z.literal('rename_session'),
    title: z.string()
  }),
  /** A standing tuning instruction for this Session's future generations. */
  z.object({
    type: z.literal('add_hint_note'),
    note: z.string().min(1).max(400)
  }),
  z.object({
    type: z.literal('remove_hint_note'),
    note: z.string()
  })
]);

export type SessionCommand = z.infer<typeof SessionCommandSchema>;
export type SessionCommandType = SessionCommand['type'];
