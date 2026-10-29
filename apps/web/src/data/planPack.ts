import { addDays, weekStart, type Action, type ActionSchedule, type Goal, type GoalGroup, type ISODate, type Milestone, type Plan } from '@six/core';
import { applyOp, type AppData, type Op } from './model.ts';
import { View } from './derive.ts';
import { isHabit } from './habits.ts';
import { opsCreateGoal } from './ops.ts';
import { opsCreateGroup } from './groups.ts';
import { FLEX_GOALS, MONTHLY_CHECK, PLAN_NAME, PLAN_START, STRETCH_DAYS, STRETCH_DETAILS } from './plans/splitsBackbend.ts';

/**
 * Apply the Splits & Backbend Plan to the data you already have, in one reviewed step:
 * - your splits goal becomes "Front splits, both sides", and three goals join it (side split, chest
 *   to shins, full backbend), each with the measurements the monthly check records
 * - five stretching tasks (Mon, Tue, Thu, Fri, Sat) that all four goals share
 * - the monthly check on the first Monday of each month
 * - the old stretching task (and the Sunday splits-gap measure) stop the day before the plan starts
 * - workouts move off Wednesday: Wed → Thu, Thu → Fri, Fri → Sat, from the plan's start
 * Nothing logged is lost: stopped tasks keep their history. The whole change can be undone at once.
 */

const newId = () => crypto.randomUUID();
type Row = { id: string } & Record<string, unknown>;
const COLORS = ['#8B6CF6', '#3FB6C9', '#E8559B', '#FF7A45'];
/** Training days move off Wednesday: Mon, Tue, Thu, Fri, Sat. */
export const DAY_MOVES: Record<number, number> = { 3: 4, 4: 5, 5: 6 };
const DAY = ['', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export interface PackPreview {
  start: ISODate;
  season: Plan | null;
  /** Your current splits goal, which becomes "Front splits, both sides". */
  existingGoal: Goal | null;
  existingGroup: GoalGroup | null;
  /** Tasks that stop the day before the plan starts (history kept). */
  stopping: { action: Action; why: string }[];
  /** Workouts moving off Wednesday. */
  moving: { action: Action; from: number[]; to: number[] }[];
  /** The first Mondays the monthly check lands on. */
  checks: ISODate[];
  alreadyApplied: boolean;
}

export interface PackChoices {
  /** Put the four goals in their own group, or in the group your splits goal is already in. */
  grouping: 'own' | 'existing';
  /** Which of the stopping tasks to stop (all by default). */
  stop: string[];
  /** Move the workouts off Wednesday. */
  moveWorkouts: boolean;
}

function liveSchedules(data: AppData, actionId: string, from: ISODate): ActionSchedule[] {
  return data.schedules.filter((s) => s.action_id === actionId && (s.effective_to == null || s.effective_to >= from));
}

/** The first Monday of each month from `start` through `end`. */
export function firstMondays(start: ISODate, end: ISODate): ISODate[] {
  const out: ISODate[] = [];
  let y = Number(start.slice(0, 4));
  let m = Number(start.slice(5, 7));
  for (let i = 0; i < 24; i++) {
    const first = `${y}-${String(m).padStart(2, '0')}-01`;
    const dow = new Date(`${first}T00:00:00Z`).getUTCDay();
    const monday = addDays(first, (8 - dow) % 7);
    if (monday > end) break;
    if (monday >= start) out.push(monday);
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
  }
  return out;
}

export function previewSplitsPack(data: AppData, today: ISODate): PackPreview {
  const view = new View(data, today, 0);
  const start = PLAN_START > today ? PLAN_START : today;
  const live = (g: Goal) => !g.archived_at && !g.completed_at;
  const existingGoal = data.goals.find((g) => live(g) && /split/i.test(g.title) && !/side \(center\)|chest to shins|backbend/i.test(g.title)) ?? null;
  const season = (existingGoal ? view.planForGoal(existingGoal) : null) ?? view.mainPlan;
  const existingGroup = existingGoal?.group_id ? data.groups.find((x) => x.id === existingGoal.group_id) ?? null : null;
  const alreadyApplied = data.actions.some((a) => !a.archived_at && a.kind === 'stretch' && STRETCH_DAYS.some((d) => d.title === a.title));

  const stopping: PackPreview['stopping'] = [];
  for (const a of data.actions) {
    if (a.archived_at || a.kind === 'stretch' || liveSchedules(data, a.id, start).length === 0) continue;
    if (/stretch/i.test(a.title)) stopping.push({ action: a, why: isHabit(data, a.id) ? 'your stretching habit' : 'the old stretching task' });
    else if (/splits? gap/i.test(a.title)) stopping.push({ action: a, why: 'replaced by the monthly check' });
  }

  const moving: PackPreview['moving'] = [];
  for (const a of data.actions) {
    if (a.archived_at || a.kind !== 'workout') continue;
    const s = liveSchedules(data, a.id, start).find((x) => x.rule === 'days' && (x.effective_to == null || x.effective_to >= start));
    if (!s) continue;
    const to = [...new Set(s.days.map((d) => DAY_MOVES[d] ?? d))].sort((x, y) => x - y);
    if (to.join() !== [...s.days].sort((x, y) => x - y).join()) moving.push({ action: a, from: [...s.days].sort((x, y) => x - y), to });
  }

  return { start, season, existingGoal, existingGroup, stopping, moving, checks: season ? firstMondays(start, season.end_date) : [], alreadyApplied };
}

export const dayNames = (days: number[]) => days.map((d) => DAY[d]).join(', ');

/** Change a task's days from `from` on: the old schedule ends the day before; planned sessions from then are remade. */
export function opsRescheduleDays(data: AppData, action: Action, days: number[], from: ISODate): Op[] {
  const ops: Op[] = [];
  for (const s of liveSchedules(data, action.id, from)) {
    if (s.rule !== 'days') continue;
    if (s.effective_from >= from) {
      ops.push({ kind: 'update', collection: 'schedules', id: s.id, patch: { days } });
    } else {
      ops.push({ kind: 'update', collection: 'schedules', id: s.id, patch: { effective_to: addDays(from, -1) } });
      const fresh: ActionSchedule = { ...s, id: newId(), days, effective_from: from };
      ops.push({ kind: 'insert', collection: 'schedules', rows: [fresh as unknown as Row] });
    }
  }
  const fromWeek = weekStart(from);
  for (const x of data.sessions) {
    if (x.action_id !== action.id || x.status !== 'planned' || x.origin !== 'scheduled') continue;
    if (x.date ? x.date >= from : x.week_start >= fromWeek) ops.push({ kind: 'delete', collection: 'sessions', id: x.id });
  }
  return ops;
}

/**
 * Stop a task from `from` on and keep everything before: its schedule ends the day before (one that
 * hadn't started yet is removed), and sessions still planned from then on are taken off. Unlike
 * removing a task, this never deletes days already planned before `from`, logged or not.
 */
export function opsStopFrom(data: AppData, action: Action, from: ISODate): Op[] {
  const ops: Op[] = [];
  for (const s of liveSchedules(data, action.id, from)) {
    if (s.effective_from >= from) ops.push({ kind: 'delete', collection: 'schedules', id: s.id });
    else ops.push({ kind: 'update', collection: 'schedules', id: s.id, patch: { effective_to: addDays(from, -1) } });
  }
  const fromWeek = weekStart(from);
  for (const x of data.sessions) {
    if (x.action_id !== action.id || x.status !== 'planned') continue;
    if (x.date ? x.date >= from : x.week_start >= fromWeek) ops.push({ kind: 'delete', collection: 'sessions', id: x.id });
  }
  return ops;
}

/** Every op that puts the data back the way it was before `ops` (applied in order). */
export function invertOps(data: AppData, ops: Op[]): Op[] {
  const undo: Op[] = [];
  let current = data;
  for (const op of ops) {
    if (op.kind === 'insert') {
      for (const r of op.rows) undo.unshift({ kind: 'delete', collection: op.collection, id: r.id });
    } else if (op.kind === 'update') {
      const row = (current[op.collection] as unknown as Row[]).find((r) => r.id === op.id);
      if (row) undo.unshift({ kind: 'update', collection: op.collection, id: op.id, patch: Object.fromEntries(Object.keys(op.patch).map((k) => [k, row[k] ?? null])) });
    } else if (op.kind === 'delete') {
      const row = (current[op.collection] as unknown as Row[]).find((r) => r.id === op.id);
      if (row) undo.unshift({ kind: 'insert', collection: op.collection, rows: [row] });
    }
    current = applyOp(current, op);
  }
  return undo;
}

export function opsApplySplitsPack(data: AppData, today: ISODate, choices: PackChoices): { ops: Op[]; undo: Op[]; goalIds: string[] } {
  const p = previewSplitsPack(data, today);
  if (!p.season) throw new Error('There is no season to put the goals in.');
  if (p.alreadyApplied) throw new Error('The plan is already in your goals.');
  const season = p.season;
  const start = p.start;
  const ops: Op[] = [];
  let next = data;
  const add = (more: Op[]) => {
    ops.push(...more);
    next = more.reduce(applyOp, next);
  };

  // 1. Goals: the splits goal becomes the front-splits goal; the others are new.
  const goalIds: Record<string, string> = {};
  FLEX_GOALS.forEach((g, i) => {
    if (g.key === 'front' && p.existingGoal) {
      goalIds.front = p.existingGoal.id;
      add([{ kind: 'update', collection: 'goals', id: p.existingGoal.id, patch: { title: g.title, why: g.why, done_means: g.doneMeans } }]);
      return;
    }
    const made = opsCreateGoal(
      next,
      { planId: season.id, title: g.title, type: 'practice', why: g.why, done_means: g.doneMeans, color: COLORS[i % COLORS.length]!, unit: '', measureName: '', baseline: null, target: null, targetDate: season.end_date, path: [], milestones: [], action: null },
      today,
    );
    add(made.ops);
    goalIds[g.key] = made.goalId;
    if (start > season.start_date) add([{ kind: 'update', collection: 'goals', id: made.goalId, patch: { start_date: start } }]);
  });
  const ids = FLEX_GOALS.map((g) => goalIds[g.key]!);

  // 2. What the monthly check records, on each goal's page (not on Today: it's monthly).
  for (const g of FLEX_GOALS) {
    for (const m of g.measures) {
      if (next.measurementTypes.some((t) => !t.archived_at && t.goal_id === goalIds[g.key] && t.name === m.name)) continue;
      add([{ kind: 'insert', collection: 'measurementTypes', rows: [{ id: newId(), name: m.name, unit: m.unit, cadence_days: 28, goal_id: goalIds[g.key]!, archived_at: null, on_today: false }] }]);
    }
    for (const m of g.milestones) {
      const due = addDays(start, Math.round(m.monthsIn * 30.4));
      const milestone: Milestone = { id: newId(), goal_id: goalIds[g.key]!, title: m.title, due_date: due > season.end_date ? season.end_date : due, completed_at: null, value: null, prize: '', prize_claimed_at: null };
      add([{ kind: 'insert', collection: 'milestones', rows: [milestone as unknown as Row] }]);
    }
  }

  // 3. The group.
  if (choices.grouping === 'existing' && p.existingGroup) {
    for (const id of ids) if (id !== p.existingGoal?.id) add([{ kind: 'update', collection: 'goals', id, patch: { group_id: p.existingGroup.id } }]);
  } else {
    add(opsCreateGroup(next, 'Splits & backbend', ids).ops);
  }

  // 4. Five stretching tasks, shared by all four goals.
  for (const d of STRETCH_DAYS) {
    const action: Action = { id: newId(), title: d.title, kind: 'stretch', planned_minutes: d.minutes, planned_count: null, min_label: 'The Daily Eight on easy-day effort', min_minutes: 15, min_count: null, priority: true, archived_at: null, details: STRETCH_DETAILS, stretch_plan: d.plan };
    const schedule: ActionSchedule = { id: newId(), action_id: action.id, rule: 'days', days: [d.day], per_week: null, effective_from: start, effective_to: null };
    add([
      { kind: 'insert', collection: 'actions', rows: [action as unknown as Row] },
      { kind: 'insert', collection: 'schedules', rows: [schedule as unknown as Row] },
      { kind: 'insert', collection: 'actionGoals', rows: ids.map((g) => ({ id: newId(), action_id: action.id, goal_id: g })) },
    ]);
  }

  // 5. The monthly check: one task, one day a month.
  if (p.checks.length) {
    const check: Action = { id: newId(), title: MONTHLY_CHECK.title, kind: 'check', planned_minutes: MONTHLY_CHECK.minutes, planned_count: null, min_label: '', min_minutes: null, min_count: null, priority: true, archived_at: null, details: MONTHLY_CHECK.details };
    add([
      { kind: 'insert', collection: 'actions', rows: [check as unknown as Row] },
      { kind: 'insert', collection: 'schedules', rows: p.checks.map((day) => ({ id: newId(), action_id: check.id, rule: 'days', days: [1], per_week: null, effective_from: day, effective_to: day })) },
      { kind: 'insert', collection: 'actionGoals', rows: ids.map((g) => ({ id: newId(), action_id: check.id, goal_id: g })) },
    ]);
  }

  // 6. The old stretching task stops the day before (history kept).
  for (const s of p.stopping) if (choices.stop.includes(s.action.id)) add(opsStopFrom(next, next.actions.find((a) => a.id === s.action.id)!, start));

  // 7. Workouts off Wednesday.
  if (choices.moveWorkouts) for (const m of p.moving) add(opsRescheduleDays(next, m.action, m.to, start));

  return { ops, undo: invertOps(data, ops), goalIds: ids };
}

export const PACK = { name: PLAN_NAME, start: PLAN_START };
