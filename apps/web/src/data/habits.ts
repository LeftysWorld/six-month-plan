import { describeSchedule, habitStats, scheduleOn, shortDate, type Action, type ActionSchedule, type HabitStats, type ISODate, type Session } from '@six/core';
import type { AppData, Op } from './model.ts';
import { blankTask, opsEditTask, opsGenerateThisWeek, opsRemoveTask, scheduleFor, withOps, type TaskInput } from './breakdown.ts';
import { runningSchedule } from './connect.ts';

/**
 * Habits: tasks that aren't for any goal ("Clean house, every day"). They're ordinary tasks with no
 * goal attached, so they show on Today, log the same way and count in reviews. They have their own
 * tab with streaks, and a section on Today.
 */

const newId = () => crypto.randomUUID();

/** Is this task a habit (no goal attached)? */
export function isHabit(data: AppData, actionId: string | null): boolean {
  if (!actionId) return false;
  return !data.actionGoals.some((ag) => ag.action_id === actionId);
}

/** Habits you have: tasks with no goal, not archived, newest last. Ones that have ended come after running ones. */
export function habitsOf(data: AppData, today: ISODate): { action: Action; schedule: ActionSchedule | null; running: boolean }[] {
  return data.actions
    .filter((a) => !a.archived_at && isHabit(data, a.id))
    .map((action) => {
      const schedule = runningSchedule(data, action.id, today) ?? data.schedules.filter((s) => s.action_id === action.id).sort((a, b) => (a.effective_from < b.effective_from ? 1 : -1))[0] ?? null;
      const running = !!schedule && (schedule.effective_to == null || schedule.effective_to >= today);
      return { action, schedule, running };
    })
    .sort((a, b) => Number(b.running) - Number(a.running));
}

export function habitSessions(data: AppData, actionId: string): Session[] {
  return data.sessions.filter((s) => s.action_id === actionId);
}

export function statsFor(data: AppData, actionId: string, today: ISODate): HabitStats {
  return habitStats(habitSessions(data, actionId), today);
}

/** "Every day", "Mon, Wed, Fri", "3 times a week", plus "from Nov 14" / "until Dec 1" when it has dates. */
export function habitWhen(schedule: ActionSchedule | null, today: ISODate): string {
  if (!schedule) return 'Stopped';
  const parts = [describeSchedule(schedule)];
  if (schedule.effective_from > today) parts.push(`from ${shortDate(schedule.effective_from)}`);
  if (schedule.effective_to) parts.push(schedule.effective_to < today ? `ended ${shortDate(schedule.effective_to)}` : `until ${shortDate(schedule.effective_to)}`);
  return parts.join(' · ');
}

export function blankHabit(today: ISODate): TaskInput {
  const base = blankTask({ start_date: today, end_date: today } as never, today);
  return { ...base, title: '', minutes: 10, days: [1, 2, 3, 4, 5, 6, 7], through: null, start: null };
}

/** A new habit: a task with no goal, starting today (or its start date), shown on Today right away. */
export function opsCreateHabit(data: AppData, input: TaskInput, today: ISODate): { ops: Op[]; id: string } {
  const action: Action = {
    id: newId(),
    title: input.title.trim(),
    kind: input.kind,
    planned_minutes: Math.max(0, input.minutes),
    planned_count: input.kind === 'count' ? Math.max(1, input.count ?? 1) : null,
    min_label: input.minLabel.trim(),
    min_minutes: null,
    min_count: null,
    priority: false,
    step_id: null,
    archived_at: null,
    ...(input.cue.trim() ? { cue: input.cue.trim() } : {}),
  };
  const schedule = scheduleFor(action.id, input, today);
  const ops: Op[] = [
    { kind: 'insert', collection: 'actions', rows: [action as unknown as { id: string } & Record<string, unknown>] },
    { kind: 'insert', collection: 'schedules', rows: [schedule as unknown as { id: string } & Record<string, unknown>] },
  ];
  return { ops: [...ops, ...opsGenerateThisWeek(withOps(data, ops), today)], id: action.id };
}

/** Change a habit from today on (past days keep the old schedule). */
export function opsEditHabit(data: AppData, action: Action, input: TaskInput, today: ISODate): Op[] {
  return opsEditTask(data, action, { ...input, goalIds: undefined }, today, today);
}

/** Stop a habit from today on; its history stays. */
export function opsStopHabit(data: AppData, action: Action, today: ISODate): Op[] {
  return opsRemoveTask(data, action, today);
}

/** The schedule in force on a day (for the grid: was it due?). */
export function habitDueOn(data: AppData, actionId: string, date: ISODate): boolean {
  const s = scheduleOn(data.schedules, actionId, date);
  if (!s) return false;
  return s.rule === 'per_week' || s.days.includes(((new Date(`${date}T12:00:00Z`).getUTCDay() + 6) % 7) + 1);
}
