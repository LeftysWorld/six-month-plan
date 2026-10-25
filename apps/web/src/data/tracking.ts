import { isoWeekday, weekStart, type Action, type ActionSchedule, type ISODate } from '@six/core';
import type { AppData, Op } from './model.ts';
import { opsEnsureWeek } from './ops.ts';
import { opsRemoveTask, withOps } from './breakdown.ts';

/**
 * Photos a goal tracks (a progress photo, a form check): a Photo task on the days you choose.
 * On Today they sit with your numbers, with a camera button, instead of as a task card.
 */

const newId = () => crypto.randomUUID();
type Row = { id: string } & Record<string, unknown>;

/** A goal's photo tasks that are still running. */
export function photoTrackers(data: AppData, goalId: string, today: ISODate): { action: Action; schedule: ActionSchedule | undefined }[] {
  const mine = new Set(data.actionGoals.filter((ag) => ag.goal_id === goalId).map((ag) => ag.action_id));
  return data.actions
    .filter((a) => mine.has(a.id) && a.kind === 'photo' && !a.archived_at)
    .map((action) => ({
      action,
      schedule: data.schedules
        .filter((s) => s.action_id === action.id)
        .sort((a, b) => (a.effective_from < b.effective_from ? 1 : -1))[0],
    }))
    .filter(({ schedule }) => schedule && (schedule.effective_to == null || schedule.effective_to >= today));
}

/** Start tracking a photo on a goal, on these weekdays (1 = Monday), from today with no end. */
export function opsAddPhotoTracker(data: AppData, goalId: string, name: string, days: number[], today: ISODate): Op[] {
  const action: Action = {
    id: newId(),
    title: name.trim() || 'Progress photo',
    kind: 'photo',
    planned_minutes: 0,
    planned_count: null,
    min_label: '',
    min_minutes: null,
    min_count: null,
    priority: false,
    archived_at: null,
  };
  const pick = days.length ? [...days].sort((a, b) => a - b) : [isoWeekday(today)];
  const schedule: ActionSchedule = { id: newId(), action_id: action.id, rule: 'days', days: pick, per_week: null, effective_from: today, effective_to: null };
  const ops: Op[] = [
    { kind: 'insert', collection: 'actions', rows: [action as unknown as Row] },
    { kind: 'insert', collection: 'schedules', rows: [schedule as unknown as Row] },
    { kind: 'insert', collection: 'actionGoals', rows: [{ id: newId(), action_id: action.id, goal_id: goalId }] },
  ];
  return [...ops, ...opsEnsureWeek(withOps(data, ops), weekStart(today))];
}

/** Stop a photo task from today on. Photos already taken stay. */
export function opsStopPhotoTracker(data: AppData, action: Action, today: ISODate): Op[] {
  return opsRemoveTask(data, action, today);
}

/** "Every day", "Weekdays", or "Mon, Thu". */
export function daysText(days: number[]): string {
  const d = [...days].sort((a, b) => a - b).join(',');
  if (d === '1,2,3,4,5,6,7') return 'Every day';
  if (d === '1,2,3,4,5') return 'Weekdays';
  return days.map((n) => ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'][n - 1]).join(', ');
}
