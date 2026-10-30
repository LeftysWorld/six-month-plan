import { isoWeekday, weekStart, type Action, type ActionSchedule, type ISODate } from '@six/core';
import type { AppData, CollectionKey, Op } from './model.ts';
import { opsEnsureWeek } from './ops.ts';
import { withOps } from './breakdown.ts';

/**
 * A practice workout: a copy of one of your workouts, on today only, to try the workout log
 * without touching your real tasks. Removing it deletes it completely, logs included.
 */

const MARK = 'Practice workout: remove it in Settings when you’re done trying it.';
const newId = () => crypto.randomUUID();
type Row = { id: string } & Record<string, unknown>;

export const isPractice = (a: Action) => a.details?.startsWith(MARK) ?? false;

export function practiceWorkouts(data: AppData): Action[] {
  return data.actions.filter(isPractice);
}

/** The workout a practice copy is made from: the first one with a plan. */
export function practiceSource(data: AppData): Action | undefined {
  return data.actions.find((a) => !a.archived_at && a.kind === 'workout' && a.workout_plan?.length && !isPractice(a));
}

export function opsAddPracticeWorkout(data: AppData, today: ISODate): Op[] {
  const from = practiceSource(data);
  if (!from) return [];
  const goalIds = data.actionGoals.filter((ag) => ag.action_id === from.id).map((ag) => ag.goal_id);
  const action: Action = {
    id: newId(),
    title: `Practice · ${from.title}`,
    kind: 'workout',
    planned_minutes: from.planned_minutes,
    planned_count: null,
    min_label: '',
    min_minutes: null,
    min_count: null,
    priority: false,
    archived_at: null,
    details: `${MARK}\n\n${from.details?.trim() ?? ''}`.trim(),
    workout_plan: from.workout_plan,
  };
  const schedule: ActionSchedule = { id: newId(), action_id: action.id, rule: 'days', days: [isoWeekday(today)], per_week: null, effective_from: today, effective_to: today };
  const ops: Op[] = [
    { kind: 'insert', collection: 'actions', rows: [action as unknown as Row] },
    { kind: 'insert', collection: 'schedules', rows: [schedule as unknown as Row] },
    { kind: 'insert', collection: 'actionGoals', rows: goalIds.map((g) => ({ id: newId(), action_id: action.id, goal_id: g })) },
  ];
  return [...ops, ...opsEnsureWeek(withOps(data, ops), weekStart(today))];
}

/** Delete every practice workout and everything logged on it. */
export function opsRemovePracticeWorkouts(data: AppData): Op[] {
  const ops: Op[] = [];
  const del = (collection: CollectionKey, id: string) => ops.push({ kind: 'delete', collection, id });
  for (const a of practiceWorkouts(data)) {
    const sessions = data.sessions.filter((s) => s.action_id === a.id);
    const ids = new Set(sessions.map((s) => s.id));
    for (const w of data.workoutSets.filter((w) => ids.has(w.session_id))) del('workoutSets', w.id);
    for (const w of data.workoutExercises.filter((w) => ids.has(w.session_id))) del('workoutExercises', w.id);
    for (const f of data.attachments.filter((f) => ids.has(f.session_id))) del('attachments', f.id);
    for (const s of sessions) del('sessions', s.id);
    for (const s of data.schedules.filter((s) => s.action_id === a.id)) del('schedules', s.id);
    for (const ag of data.actionGoals.filter((ag) => ag.action_id === a.id)) del('actionGoals', ag.id);
    del('actions', a.id);
  }
  return ops;
}
