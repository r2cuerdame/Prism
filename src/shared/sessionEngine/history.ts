import type { SessionState, GeneratedSnapshot } from '@shared/domain/session';
import type { SessionCommand, SessionCommandType } from '@shared/domain/commands';
import { applySessionCommand } from './reducer';

const MAX_PAST = 100;
const MAX_SNAPSHOTS = 30;

/** Commands that mutate view state but should not create undo steps. */
const TRANSIENT_COMMANDS: ReadonlySet<SessionCommandType> = new Set<SessionCommandType>([
  'set_block_state',
  'set_status'
]);

export interface SessionHistory {
  past: SessionState[];
  present: SessionState;
  future: SessionState[];
  snapshots: GeneratedSnapshot[];
}

export function createHistory(initial: SessionState): SessionHistory {
  return { past: [], present: initial, future: [], snapshots: [] };
}

function latestIntentGoal(state: SessionState): string | null {
  for (let i = state.intentHistory.length - 1; i >= 0; i--) {
    const goal = state.intentHistory[i].interpreted?.goal;
    if (goal) return goal;
  }
  return null;
}

export function pushHistory(h: SessionHistory, cmd: SessionCommand, at?: string): SessionHistory {
  const next = applySessionCommand(h.present, cmd, at);
  if (next === h.present) return h;

  let snapshots = h.snapshots;
  if (cmd.type === 'apply_plan' && next.plan) {
    const snapshot: GeneratedSnapshot = {
      planId: next.plan.id,
      at: at ?? next.updatedAt,
      label: latestIntentGoal(next) ?? '재생성',
      state: next
    };
    snapshots = [...snapshots, snapshot];
    if (snapshots.length > MAX_SNAPSHOTS) snapshots = snapshots.slice(snapshots.length - MAX_SNAPSHOTS);
  }

  if (TRANSIENT_COMMANDS.has(cmd.type)) {
    return { ...h, present: next, snapshots };
  }

  let past = [...h.past, h.present];
  if (past.length > MAX_PAST) past = past.slice(past.length - MAX_PAST);
  return { past, present: next, future: [], snapshots };
}

export function undoHistory(h: SessionHistory): SessionHistory {
  if (h.past.length === 0) return h;
  const previous = h.past[h.past.length - 1];
  return {
    past: h.past.slice(0, -1),
    present: previous,
    future: [h.present, ...h.future],
    snapshots: h.snapshots
  };
}

export function redoHistory(h: SessionHistory): SessionHistory {
  if (h.future.length === 0) return h;
  const [next, ...rest] = h.future;
  return {
    past: [...h.past, h.present],
    present: next,
    future: rest,
    snapshots: h.snapshots
  };
}

export function canUndo(h: SessionHistory): boolean {
  return h.past.length > 0;
}

export function canRedo(h: SessionHistory): boolean {
  return h.future.length > 0;
}
