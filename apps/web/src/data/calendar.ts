import { addDays, isoWeekday, scheduleOn, shortDate, type Action, type ActionSchedule, type ISODate } from '@six/core';
import type { AppData, Op } from './model.ts';
import type { View } from './derive.ts';
import { blankTask, isOnce, opsGenerateThisWeek, scheduleFor, withOps } from './breakdown.ts';
import { firstCheckpoint } from './season.ts';
import { opsAddOneOff } from './ops.ts';
import { CHECKPOINT_NAME, checkpointsOf } from './dated.ts';

/**
 * The calendar: everything that happens on a date. One-day tasks (an exam, a class), one-offs,
 * milestones, a goal starting or finishing on its own dates, and the season's start, checkpoint and
 * end. Repeating tasks aren't listed one by one (that's what Today is for); the calendar can show
 * how many run each day.
 */

export type CalKind = 'task' | 'oneoff' | 'milestone' | 'checkpoint' | 'start' | 'finish' | 'done' | 'season';

export interface CalItem {
  id: string;
  date: ISODate;
  kind: CalKind;
  title: string;
  /** The goal it belongs to, or what it is. */
  sub: string;
  color: string;
  done: boolean;
  /** Where tapping it goes. */
  to: string | null;
  /** A one-off or a one-day task's session (to check it off right here). */
  sessionId?: string;
  milestoneId?: string;
}

const GREY = '#9AA49E';

export const KIND_TEXT: Record<CalKind, string> = {
  task: 'One day',
  oneoff: 'One-off',
  milestone: 'Date',
  checkpoint: 'Due',
  start: 'Starts',
  finish: 'Due',
  done: 'Done',
  season: 'Season',
};

/** Everything dated between `from` and `to`, by date, in a steady order. */
export function calendarItems(view: View, from: ISODate, to: ISODate): Map<ISODate, CalItem[]> {
  const data = view.data;
  const out = new Map<ISODate, CalItem[]>();
  const add = (item: CalItem) => {
    if (item.date < from || item.date > to) return;
    const list = out.get(item.date) ?? [];
    list.push(item);
    out.set(item.date, list);
  };
  const goalOf = (actionId: string) => view.goalsForAction(actionId).find((g) => !g.archived_at);

  // One-day tasks.
  for (const s of data.schedules) {
    if (!isOnce(s) || s.effective_from < from || s.effective_from > to) continue;
    const action = view.action(s.action_id);
    if (!action) continue;
    const session = data.sessions.find((x) => x.action_id === action.id && x.date === s.effective_from && x.status !== 'moved');
    if (action.archived_at && !session) continue;
    const goal = goalOf(action.id);
    add({
      id: `t-${s.id}`,
      date: s.effective_from,
      kind: 'task',
      title: action.title,
      sub: goal?.title ?? 'Not for a goal',
      color: goal?.color ?? GREY,
      done: !!session && session.status !== 'planned' && session.status !== 'skipped',
      to: goal ? `/goals/${goal.id}` : null,
      sessionId: session?.id,
    });
  }
  // One-offs (things added for a day, with no task behind them).
  for (const s of data.sessions) {
    if (s.action_id || !s.date || s.status === 'moved') continue;
    add({ id: `o-${s.id}`, date: s.date, kind: 'oneoff', title: s.title, sub: 'One-off', color: GREY, done: s.status !== 'planned' && s.status !== 'skipped', to: null, sessionId: s.id });
  }
  // Milestones.
  for (const m of data.milestones) {
    const goal = view.goal(m.goal_id);
    if (!goal || goal.archived_at) continue;
    add({ id: `m-${m.id}`, date: m.due_date, kind: 'milestone', title: m.title, sub: goal.title, color: goal.color, done: !!m.completed_at, to: `/goals/${goal.id}`, milestoneId: m.id });
  }
  // When each 3-month, month and week goal you've written down is due.
  for (const goal of data.goals) {
    if (goal.archived_at || goal.completed_at) continue;
    for (const cp of checkpointsOf(data, goal)) {
      add({ id: `c-${cp.id}`, date: cp.date, kind: 'checkpoint', title: `${CHECKPOINT_NAME[cp.level]}: ${cp.text}`, sub: goal.title, color: goal.color, done: cp.done, to: `/goals/${goal.id}` });
    }
  }
  // Goals starting or finishing on their own dates (not just with the season), and goals finished.
  for (const goal of data.goals) {
    if (goal.archived_at) continue;
    const plan = view.planForGoal(goal);
    if (!plan) continue;
    if (goal.completed_at) {
      add({ id: `d-${goal.id}`, date: goal.completed_at.slice(0, 10), kind: 'done', title: goal.title, sub: 'Goal complete', color: goal.color, done: true, to: `/goals/${goal.id}` });
      continue;
    }
    const w = view.plannedWindow(goal, plan);
    if (w.start !== plan.start_date) add({ id: `s-${goal.id}`, date: w.start, kind: 'start', title: goal.title, sub: w.waitsFrom && w.start === w.waitsFrom ? 'Starts (after the goal before it)' : 'Goal starts', color: goal.color, done: false, to: `/goals/${goal.id}` });
    if (w.end !== plan.end_date) add({ id: `f-${goal.id}`, date: w.end, kind: 'finish', title: goal.title, sub: 'Goal due', color: goal.color, done: false, to: `/goals/${goal.id}` });
  }
  // Seasons: start, 3-month checkpoint, end.
  for (const plan of data.plans) {
    if (plan.archived_at || plan.solo) continue;
    add({ id: `ps-${plan.id}`, date: plan.start_date, kind: 'season', title: `${plan.name} starts`, sub: 'Season', color: 'var(--accent)', done: false, to: '/goals' });
    add({ id: `pc-${plan.id}`, date: firstCheckpoint(plan), kind: 'season', title: '3-month checkpoint', sub: plan.name, color: 'var(--accent)', done: false, to: '/review' });
    add({ id: `pe-${plan.id}`, date: plan.end_date, kind: 'season', title: `${plan.name} ends`, sub: 'Season', color: 'var(--accent)', done: false, to: '/review' });
  }
  const order: CalKind[] = ['season', 'finish', 'start', 'milestone', 'checkpoint', 'task', 'oneoff', 'done'];
  for (const list of out.values()) list.sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind) || a.title.localeCompare(b.title));
  return out;
}

/** How many repeating tasks run on a day (tasks with set days; times-a-week tasks aren't tied to a day). */
export function repeatingOn(data: AppData, date: ISODate): { goals: number; habits: number } {
  let goals = 0;
  let habits = 0;
  const wd = isoWeekday(date);
  for (const a of data.actions) {
    if (a.archived_at) continue;
    const s: ActionSchedule | null = scheduleOn(data.schedules, a.id, date);
    if (!s || isOnce(s) || s.rule !== 'days' || !s.days.includes(wd)) continue;
    if (data.actionGoals.some((ag) => ag.action_id === a.id)) goals += 1;
    else habits += 1;
  }
  return { goals, habits };
}

/**
 * Put something on a date: for a goal it's a one-day task of that goal (it shows on Today that day
 * and on the goal's page); with no goal it's a one-off.
 */
export function opsAddOnDate(data: AppData, input: { title: string; date: ISODate; goalId: string | null; minutes?: number }, today: ISODate): Op[] {
  const title = input.title.trim();
  if (!title) return [];
  if (!input.goalId) return opsAddOneOff({ title, minutes: input.minutes ?? 30, priority: false, date: input.date });
  const action: Action = { id: crypto.randomUUID(), title, kind: 'check', planned_minutes: input.minutes ?? 30, planned_count: null, min_label: '', min_minutes: null, min_count: null, priority: false, step_id: null, archived_at: null };
  const task = { ...blankTask({ start_date: today, end_date: today } as never, today), title, when: 'once' as const, date: input.date };
  const schedule = scheduleFor(action.id, task, input.date);
  const ops: Op[] = [
    { kind: 'insert', collection: 'actions', rows: [action as unknown as { id: string } & Record<string, unknown>] },
    { kind: 'insert', collection: 'schedules', rows: [schedule as unknown as { id: string } & Record<string, unknown>] },
    { kind: 'insert', collection: 'actionGoals', rows: [{ id: crypto.randomUUID(), action_id: action.id, goal_id: input.goalId }] },
  ];
  return [...ops, ...opsGenerateThisWeek(withOps(data, ops), today)];
}

/** "Mon Nov 14" */
export function dayTitle(date: ISODate): string {
  return `${['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'][isoWeekday(date) - 1]} ${shortDate(date)}`;
}

export { addDays };
