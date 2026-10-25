import { type Action, type GoalLink, type ISODate, type Session } from '@six/core';
import type { AppData, Op } from './model.ts';
import { opsLogSession } from './ops.ts';

/**
 * Connected goals and shared tasks. A task can support any number of goals (action_goals);
 * logging it once counts for each. Goals can also be connected by hand (goal_links).
 */

const newId = () => crypto.randomUUID();
type Row = { id: string } & Record<string, unknown>;

/** The hand-made link between two goals, if there is one (either way round). */
export function linkBetween(data: AppData, a: string, b: string): GoalLink | undefined {
  return data.goalLinks.find((l) => (l.goal_a === a && l.goal_b === b) || (l.goal_a === b && l.goal_b === a));
}

/** Connect two goals by hand, or update the note if they're already connected. */
export function opsLinkGoals(data: AppData, a: string, b: string, note: string): Op[] {
  if (a === b) return [];
  const existing = linkBetween(data, a, b);
  if (existing) return existing.note === note.trim() ? [] : [{ kind: 'update', collection: 'goalLinks', id: existing.id, patch: { note: note.trim() } }];
  const row: GoalLink = { id: newId(), goal_a: a, goal_b: b, note: note.trim(), created_at: new Date().toISOString() };
  return [{ kind: 'insert', collection: 'goalLinks', rows: [row as unknown as Row] }];
}

export function opsUnlinkGoals(link: GoalLink): Op[] {
  return [{ kind: 'delete', collection: 'goalLinks', id: link.id }];
}

/** Let another goal share an existing task. Its sessions already exist, so it shows on Today as before. */
export function opsShareTask(data: AppData, actionId: string, goalId: string): Op[] {
  if (data.actionGoals.some((ag) => ag.action_id === actionId && ag.goal_id === goalId)) return [];
  return [{ kind: 'insert', collection: 'actionGoals', rows: [{ id: newId(), action_id: actionId, goal_id: goalId }] }];
}

/** Take a task off one goal; it keeps running for the others. */
export function opsUnshareTask(data: AppData, actionId: string, goalId: string): Op[] {
  return data.actionGoals.filter((ag) => ag.action_id === actionId && ag.goal_id === goalId).map((ag): Op => ({ kind: 'delete', collection: 'actionGoals', id: ag.id }));
}

/** Make a task support exactly these goals (it always keeps at least one). */
export function opsSetTaskGoals(data: AppData, actionId: string, goalIds: string[]): Op[] {
  if (goalIds.length === 0) return [];
  const want = new Set(goalIds);
  const have = data.actionGoals.filter((ag) => ag.action_id === actionId);
  const ops: Op[] = have.filter((ag) => !want.has(ag.goal_id)).map((ag): Op => ({ kind: 'delete', collection: 'actionGoals', id: ag.id }));
  for (const g of want) if (!have.some((ag) => ag.goal_id === g)) ops.push(...opsShareTask(data, actionId, g));
  return ops;
}

/** The newest reading of a measurement, for pre-filling a weigh-in. */
export function lastReading(data: AppData, typeId: string | null | undefined): { value: number; date: ISODate } | null {
  if (!typeId) return null;
  const m = data.measurements.filter((x) => x.type_id === typeId).sort((a, b) => (a.measured_on < b.measured_on ? 1 : -1))[0];
  return m ? { value: Number(m.value), date: m.measured_on } : null;
}

/**
 * Log a measure task: record the number as that day's reading (replacing one already entered
 * for the same day) and mark the task done. Returns the ops and the ops that undo them.
 */
export function opsLogMeasure(data: AppData, session: Session, action: Action, value: number, date: ISODate): { ops: Op[]; undo: Op[] } {
  const { ops, undo } = opsRecordReading(data, action.measurement_type_id, value, date);
  ops.push(...opsLogSession(session, { status: 'done', actual_count: null, on: date }));
  const { id, ...before } = session;
  undo.push({ kind: 'update', collection: 'sessions', id, patch: before as Record<string, unknown> });
  return { ops, undo };
}

/** Save a day's reading (replacing one already entered that day), with the ops that undo it. */
export function opsRecordReading(data: AppData, typeId: string | null | undefined, value: number, date: ISODate): { ops: Op[]; undo: Op[] } {
  const ops: Op[] = [];
  const undo: Op[] = [];
  if (!typeId) return { ops, undo };
  const same = data.measurements.find((m) => m.type_id === typeId && m.measured_on === date);
  if (same) {
    ops.push({ kind: 'update', collection: 'measurements', id: same.id, patch: { value } });
    undo.push({ kind: 'update', collection: 'measurements', id: same.id, patch: { value: same.value } });
  } else {
    const id = newId();
    ops.push({ kind: 'insert', collection: 'measurements', rows: [{ id, type_id: typeId, value, measured_on: date, source: 'task', note: '' }] });
    undo.push({ kind: 'delete', collection: 'measurements', id });
  }
  return { ops, undo };
}

/** The reading a measure task saved on a day, if any. */
export function readingOn(data: AppData, typeId: string | null | undefined, date: ISODate | null): number | null {
  if (!typeId || !date) return null;
  const m = data.measurements.find((x) => x.type_id === typeId && x.measured_on === date);
  return m ? Number(m.value) : null;
}
