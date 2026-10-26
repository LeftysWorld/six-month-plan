import { type Action, type ActionSchedule, type Goal, type ISODate, type Session } from '@six/core';
import type { View } from './derive.ts';
import type { AppData, Op } from './model.ts';
import { opsLogSession } from './ops.ts';

/**
 * Connected goals and shared tasks. A task can support any number of goals (action_goals);
 * logging it once counts for each. Goals in the same group count as connected too (groups.ts).
 */

const newId = () => crypto.randomUUID();
type Row = { id: string } & Record<string, unknown>;

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

/**
 * The schedule a task runs on from `today` on: the one in force today, else the next one that
 * starts later. Null when the task has finished (every schedule ended before today).
 * Tasks added from a goal page usually end with their week, so "no end date" isn't the test.
 */
export function runningSchedule(data: AppData, actionId: string, today: ISODate): ActionSchedule | null {
  const live = data.schedules.filter((s) => s.action_id === actionId && (s.effective_to == null || s.effective_to >= today));
  const now = live.filter((s) => s.effective_from <= today).sort((a, b) => (a.effective_from < b.effective_from ? 1 : -1))[0];
  return now ?? live.sort((a, b) => (a.effective_from < b.effective_from ? -1 : 1))[0] ?? null;
}

export interface ShareGroup {
  goal: Goal;
  connected: boolean;
  tasks: { action: Action; schedule: ActionSchedule }[];
}

/**
 * Tasks another goal could share with `goalId`: still running, not archived, not already on it.
 * Grouped by the goal they're on, connected goals first. `onlyGoalId` limits it to one goal.
 */
export function shareCandidates(view: View, goalId: string, today: ISODate, onlyGoalId?: string): ShareGroup[] {
  const data = view.data;
  const connected = new Set(view.connectionsFor(goalId).map((c) => c.goal.id));
  const mine = new Set(view.actionsForGoal(goalId).map((a) => a.id));
  const seen = new Set<string>();
  return view.activeGoals
    .filter((g) => g.id !== goalId && (!onlyGoalId || g.id === onlyGoalId))
    .sort((a, b) => Number(connected.has(b.id)) - Number(connected.has(a.id)) || a.title.localeCompare(b.title))
    .map((g) => ({
      goal: g,
      connected: connected.has(g.id),
      tasks: view
        .actionsForGoal(g.id)
        .filter((a) => !mine.has(a.id) && !seen.has(a.id))
        .map((a) => ({ action: a, schedule: runningSchedule(data, a.id, today) }))
        .filter((t): t is { action: Action; schedule: ActionSchedule } => !!t.schedule)
        .map((t) => (seen.add(t.action.id), t)),
    }))
    .filter((x) => x.tasks.length > 0);
}

/** Tasks whose title looks like what you're typing (same words, either way round), for a "use this one?" hint. */
export function matchingTasks(groups: ShareGroup[], typed: string): { action: Action; schedule: ActionSchedule; goal: Goal }[] {
  const norm = (t: string) => t.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
  const q = norm(typed);
  if (q.length < 3) return [];
  return groups.flatMap((g) =>
    g.tasks
      .filter((t) => {
        const title = norm(t.action.title);
        return title.includes(q) || (title.length >= 3 && q.includes(title));
      })
      .map((t) => ({ ...t, goal: g.goal })),
  );
}

// ---------- One measurement per name per goal ----------

const measureKey = (name: string, unit: string) => `${name.trim().toLowerCase()}|${unit.trim().toLowerCase()}`;

/** The goal a measurement belongs to: the goal it was added to, or the goal it is the main number of. */
export function measureOwner(data: AppData, typeId: string): string | null {
  const t = data.measurementTypes.find((m) => m.id === typeId);
  return data.goals.find((g) => g.measurement_type_id === typeId)?.id ?? t?.goal_id ?? null;
}

/** An active measurement with this name and unit on the goal, if there is one (so a second isn't made). */
export function findMeasure(data: AppData, goalId: string, name: string, unit: string): string | null {
  const key = measureKey(name, unit);
  return data.measurementTypes.find((t) => !t.archived_at && measureKey(t.name, t.unit) === key && measureOwner(data, t.id) === goalId)?.id ?? null;
}

/**
 * Merge measurements a goal has twice (same name and unit, e.g. two "Weight (lb)"): the goal's
 * main one is kept, readings move onto it (on a day both have one, the kept one's stays), tasks
 * and goals point at it, and the copy is archived. Runs when the app opens.
 */
export function opsMergeDuplicateMeasures(data: AppData): Op[] {
  const ops: Op[] = [];
  const groups = new Map<string, string[]>();
  for (const t of data.measurementTypes) {
    if (t.archived_at) continue;
    const owner = measureOwner(data, t.id);
    if (!owner) continue;
    const key = `${owner}|${measureKey(t.name, t.unit)}`;
    groups.set(key, [...(groups.get(key) ?? []), t.id]);
  }
  for (const ids of groups.values()) {
    if (ids.length < 2) continue;
    const keep = ids.find((id) => data.goals.some((g) => g.measurement_type_id === id)) ?? ids[0]!;
    const keptDays = new Set(data.measurements.filter((m) => m.type_id === keep).map((m) => m.measured_on));
    for (const dup of ids.filter((id) => id !== keep)) {
      for (const m of data.measurements.filter((x) => x.type_id === dup)) {
        if (keptDays.has(m.measured_on)) ops.push({ kind: 'delete', collection: 'measurements', id: m.id });
        else {
          keptDays.add(m.measured_on);
          ops.push({ kind: 'update', collection: 'measurements', id: m.id, patch: { type_id: keep } });
        }
      }
      for (const a of data.actions.filter((x) => x.measurement_type_id === dup)) {
        ops.push({ kind: 'update', collection: 'actions', id: a.id, patch: { measurement_type_id: keep } });
      }
      for (const g of data.goals.filter((x) => x.measurement_type_id === dup)) {
        ops.push({ kind: 'update', collection: 'goals', id: g.id, patch: { measurement_type_id: keep } });
      }
      ops.push({ kind: 'update', collection: 'measurementTypes', id: dup, patch: { archived_at: new Date().toISOString() } });
    }
  }
  return ops;
}

/** Whether a measurement shows in Today's numbers (archived ones never do). */
export function measureOnToday(data: AppData, typeId: string): boolean {
  const t = data.measurementTypes.find((m) => m.id === typeId);
  if (!t || t.archived_at) return false;
  return t.on_today ?? data.goals.some((g) => g.measurement_type_id === typeId);
}

/** "Body fat (%)": a measurement's name with its unit. */
export function measureLabel(t: { name: string; unit: string }): string {
  return t.unit.trim() ? `${t.name} (${t.unit.trim()})` : t.name;
}
