import { addDays, weekStart, type Action, type ActionSchedule, type Goal, type GoalGroup, type ISODate, type Milestone, type Plan, type Session } from '@six/core';
import { applyOp, type AppData, type Op } from './model.ts';
import { View } from './derive.ts';
import { isHabit } from './habits.ts';
import { opsCreateGoal, opsEnsureWeek } from './ops.ts';
import { opsCreateGroup } from './groups.ts';
import { FLEX_GOALS, MONTHLY_CHECK, PLAN_NAME, PLAN_START, STRETCH_DAYS, STRETCH_DETAILS } from './plans/splitsBackbend.ts';

/**
 * Apply the Splits & Backbend Plan to the data you already have, in one reviewed step:
 * - your splits goal becomes "Front splits, both sides", and three goals join it (side split, chest
 *   to shins, full backbend) in your Body group, each with the measurements the monthly check records
 * - five stretching tasks (Mon, Tue, Thu, Fri, Sat) that all four goals share
 * - the monthly check on the first Monday of each month
 * - the old stretching task (and the Sunday splits-gap measure) stop the day before the plan starts
 * - workouts move off Wednesday from this week: Wed → Thu, Thu → Fri, Fri → Sat. This week keeps one
 *   of each workout, on its new day: a copy left on the old day is taken off.
 * Nothing logged is lost: stopped tasks keep their history. The whole change can be undone at once.
 *
 * Already applied an earlier version (the one that started Nov 2, in its own group)? The same step
 * updates it: earlier start, goals into Body, the stretching sessions' current holds, this week fixed.
 */

const newId = () => crypto.randomUUID();
type Row = { id: string } & Record<string, unknown>;
const COLORS = ['#8B6CF6', '#3FB6C9', '#E8559B', '#FF7A45'];
/** Training days move off Wednesday: Mon, Tue, Thu, Fri, Sat. */
export const DAY_MOVES: Record<number, number> = { 3: 4, 4: 5, 5: 6 };
const DAY = ['', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
export const OWN_GROUP = 'Splits & backbend';

/** none: not applied yet. older: applied, but an earlier version (or this week still needs fixing). current: nothing to do. */
export type PackState = 'none' | 'older' | 'current';

export interface PackPreview {
  state: PackState;
  start: ISODate;
  season: Plan | null;
  /** Your current splits goal, which becomes "Front splits, both sides". */
  existingGoal: Goal | null;
  /** Where the goals go by default: your Body group (or the group your splits goal is in). */
  bodyGroup: GoalGroup | null;
  /** Tasks that stop the day before the plan starts (history kept). */
  stopping: { action: Action; why: string }[];
  /** Workouts moving off Wednesday, from this week. */
  moving: { action: Action; from: number[]; to: number[] }[];
  /** This week's extra copies of moving workouts that come off (planned, never logged). */
  extras: Session[];
  /** The first Mondays the monthly check lands on. */
  checks: ISODate[];
  /** For an update: what changes, one line each. */
  updates: string[];
}

export interface PackChoices {
  /** Put the four goals in your Body group, or in a group of their own. */
  grouping: 'body' | 'own';
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

const live = (g: Goal) => !g.archived_at && !g.completed_at;
const packTitles = new Set(STRETCH_DAYS.map((d) => d.title));
const stretchActions = (data: AppData) => data.actions.filter((a) => !a.archived_at && a.kind === 'stretch' && packTitles.has(a.title));

/** The pack's goals that exist, by key (front is your splits goal). */
function packGoals(data: AppData, existingGoal: Goal | null): Partial<Record<(typeof FLEX_GOALS)[number]['key'], Goal>> {
  const out: Partial<Record<(typeof FLEX_GOALS)[number]['key'], Goal>> = {};
  for (const g of FLEX_GOALS) {
    const found = g.key === 'front' ? existingGoal : data.goals.find((x) => live(x) && x.title === g.title);
    if (found) out[g.key] = found;
  }
  return out;
}

/** The days a workout's schedule moves to, when it trains on Wednesday (null when it doesn't need to move). */
function movedDays(days: number[]): number[] | null {
  const to = [...new Set(days.map((d) => DAY_MOVES[d] ?? d))].sort((x, y) => x - y);
  return to.join() === [...days].sort((x, y) => x - y).join() ? null : to;
}

/**
 * The same JSON, whatever order its keys come back in. The database stores stretch_plan as jsonb,
 * which re-sorts keys (and drops none), so a plain JSON.stringify comparison never matched after a
 * save and the update kept offering itself.
 */
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).filter(([, v]) => v !== undefined && v !== null);
    return `{${entries.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

/** A stretching task already has this version's holds and notes. Line endings don't count. */
function samePlan(a: Action, d: (typeof STRETCH_DAYS)[number]): boolean {
  return canonical(a.stretch_plan) === canonical(d.plan) && (a.details ?? '').replace(/\r\n/g, '\n').trim() === STRETCH_DETAILS.trim();
}

export function previewSplitsPack(data: AppData, today: ISODate): PackPreview {
  const view = new View(data, today, 0);
  const start = PLAN_START > today ? PLAN_START : today;
  const monday = weekStart(today);
  const existingGoal = data.goals.find((g) => live(g) && /split/i.test(g.title) && !/side \(center\)|chest to shins|backbend/i.test(g.title)) ?? null;
  const season = (existingGoal ? view.planForGoal(existingGoal) : null) ?? view.mainPlan;
  const groupOfGoal = existingGoal?.group_id ? data.groups.find((x) => x.id === existingGoal.group_id) ?? null : null;
  const bodyGroup = data.groups.find((x) => /^body$/i.test(x.name.trim())) ?? data.groups.find((x) => /\bbody\b/i.test(x.name)) ?? (groupOfGoal && groupOfGoal.name !== OWN_GROUP ? groupOfGoal : null);
  const applied = stretchActions(data);

  const stopping: PackPreview['stopping'] = [];
  for (const a of data.actions) {
    if (a.archived_at || a.kind === 'stretch' || liveSchedules(data, a.id, start).length === 0) continue;
    if (/stretch/i.test(a.title)) stopping.push({ action: a, why: isHabit(data, a.id) ? 'your stretching habit' : 'the old stretching task' });
    else if (/splits? gap/i.test(a.title)) stopping.push({ action: a, why: 'replaced by the monthly check' });
  }

  // Workouts that train on a Wednesday this week or later move. Once moved, nothing is on Wednesday,
  // so applying again moves nothing.
  const workouts = data.actions.filter((a) => !a.archived_at && a.kind === 'workout');
  const onWednesday = workouts.some((a) => liveSchedules(data, a.id, monday).some((s) => s.rule === 'days' && s.days.includes(3)));
  const moving: PackPreview['moving'] = [];
  if (onWednesday) {
    for (const a of workouts) {
      // The schedule in effect this week (an update to the Nov 2 version also has one from Nov 2).
      const s = liveSchedules(data, a.id, monday)
        .filter((x) => x.rule === 'days' && x.effective_from <= addDays(monday, 6))
        .sort((x, y) => (x.effective_from < y.effective_from ? 1 : -1))[0];
      if (!s) continue;
      const to = movedDays(s.days);
      if (to) moving.push({ action: a, from: [...s.days].sort((x, y) => x - y), to });
    }
  }
  const extras = moving.flatMap((m) => fitWeek(data, m.action.id, m.to, monday, today).remove);

  const updates: string[] = [];
  let state: PackState = 'none';
  if (applied.length) {
    const goals = packGoals(data, existingGoal);
    const late = applied.filter((a) => data.schedules.some((s) => s.action_id === a.id && s.effective_from > start));
    if (late.length) updates.push(`Stretching starts ${start === today ? 'today' : 'on'} ${dayLabel(start)} instead of ${dayLabel(data.schedules.filter((s) => late.some((a) => a.id === s.action_id)).map((s) => s.effective_from).sort()[0]!)}`);
    const outside = bodyGroup ? Object.values(goals).filter((g) => g!.group_id !== bodyGroup.id) : [];
    if (outside.length) updates.push(`The four goals move into ${bodyGroup!.name}`);
    const stale = applied.filter((a) => {
      const d = STRETCH_DAYS.find((x) => x.title === a.title)!;
      return !samePlan(a, d);
    });
    if (stale.length) updates.push('The stretching sessions get sets and timers (Left and Right, 3 × 45 s, rest between)');
    if (stopping.length) updates.push(`${stopping.map((s) => s.action.title).join(' and ')} stop${stopping.length === 1 ? 's' : ''} after ${dayLabel(addDays(start, -1))}`);
    if (moving.length) updates.push(`Workouts move off Wednesday from this week, not from Nov 2`);
    const missing = FLEX_GOALS.flatMap((g) => (goals[g.key] ? g.measures.filter((m) => !data.measurementTypes.some((t) => !t.archived_at && t.goal_id === goals[g.key]!.id && t.name === m.name)) : []));
    if (missing.length) updates.push(`New measurement${missing.length === 1 ? '' : 's'} to track: ${missing.map((m) => m.name).join(', ')}`);
    state = updates.length || extras.length ? 'older' : 'current';
  }

  return { state, start, season, existingGoal, bodyGroup, stopping, moving, extras, checks: season ? firstMondays(start, season.end_date) : [], updates };
}

const WEEKDAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTH = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function dayLabel(d: ISODate): string {
  const date = new Date(`${d}T00:00:00Z`);
  return `${WEEKDAY[date.getUTCDay()]} ${MONTH[date.getUTCMonth()]} ${date.getUTCDate()}`;
}

export const dayNames = (days: number[]) => days.map((d) => DAY[d]).join(', ');

/**
 * One session of a task per scheduled day in the week of `monday`, on that day. A session you
 * already logged counts first, wherever it is; then one already on the day; then a planned one
 * from another day, which moves (unless the day has passed). Planned copies left over are removed.
 */
export function fitWeek(data: AppData, actionId: string, days: number[], monday: ISODate, today: ISODate): { ops: Op[]; remove: Session[] } {
  const targets = [...new Set(days)].sort((a, b) => a - b).map((d) => addDays(monday, d - 1));
  const mine = data.sessions.filter((s) => s.action_id === actionId && s.origin === 'scheduled' && s.week_start === monday && s.status !== 'moved');
  const logged = (s: Session) => s.status !== 'planned';
  const used = new Set<string>();
  const ops: Op[] = [];
  const free = (s: Session) => !used.has(s.id);
  for (const t of targets) {
    const pick =
      mine.find((s) => free(s) && s.date === t && logged(s)) ??
      mine.find((s) => free(s) && logged(s) && !targets.includes(s.date ?? '')) ??
      mine.find((s) => free(s) && s.date === t) ??
      mine.find((s) => free(s) && !targets.includes(s.date ?? ''));
    if (!pick) continue;
    used.add(pick.id);
    // Two updates, so a database without scheduled_on still saves the day.
    if (!logged(pick) && pick.date !== t && t >= today) ops.push({ kind: 'update', collection: 'sessions', id: pick.id, patch: { date: t } });
    if (pick.scheduled_on !== t) ops.push({ kind: 'update', collection: 'sessions', id: pick.id, patch: { scheduled_on: t } });
  }
  const remove = mine.filter((s) => free(s) && !logged(s));
  for (const s of remove) ops.push({ kind: 'delete', collection: 'sessions', id: s.id });
  return { ops, remove };
}

/**
 * Change a task's days from the week of `monday` on: the schedule before ends the Sunday before,
 * one from `monday` on replaces any that start later, this week is fitted to the new days, and
 * planned sessions in later weeks are remade.
 */
export function opsRescheduleDays(data: AppData, action: Action, days: number[], monday: ISODate, today: ISODate): Op[] {
  const ops: Op[] = [];
  for (const s of liveSchedules(data, action.id, monday)) {
    if (s.rule !== 'days') continue;
    if (s.effective_from >= monday) ops.push({ kind: 'delete', collection: 'schedules', id: s.id });
    else ops.push({ kind: 'update', collection: 'schedules', id: s.id, patch: { effective_to: addDays(monday, -1) } });
  }
  const fresh: ActionSchedule = { id: newId(), action_id: action.id, rule: 'days', days, per_week: null, effective_from: monday, effective_to: null };
  ops.push({ kind: 'insert', collection: 'schedules', rows: [fresh as unknown as Row] });
  ops.push(...fitWeek(data, action.id, days, monday, today).ops);
  for (const x of data.sessions) {
    if (x.action_id !== action.id || x.status !== 'planned' || x.origin !== 'scheduled') continue;
    if (x.week_start > monday) ops.push({ kind: 'delete', collection: 'sessions', id: x.id });
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
    if (op.kind === 'insert' || op.kind === 'insertIgnore') {
      const had = new Set((current[op.collection] as unknown as Row[]).map((r) => r.id));
      for (const r of op.rows) if (!had.has(r.id)) undo.unshift({ kind: 'delete', collection: op.collection, id: r.id });
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
  if (p.state === 'current') throw new Error('The plan is already in your goals, up to date.');
  const season = p.season;
  const start = p.start;
  const ops: Op[] = [];
  let next = data;
  const add = (more: Op[]) => {
    ops.push(...more);
    next = more.reduce(applyOp, next);
  };

  const goalIds: Record<string, string> = {};
  if (p.state === 'none') {
    // 1. Goals: the splits goal becomes the front-splits goal; the others are new.
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
  } else {
    // An earlier version: the goals exist. Their start moves up to the plan's.
    const goals = packGoals(data, p.existingGoal);
    for (const g of FLEX_GOALS) {
      const goal = goals[g.key];
      if (!goal) continue;
      goalIds[g.key] = goal.id;
      if (goal.start_date && goal.start_date > start) add([{ kind: 'update', collection: 'goals', id: goal.id, patch: { start_date: start > season.start_date ? start : null } }]);
    }
  }
  const ids = FLEX_GOALS.map((g) => goalIds[g.key]).filter((id): id is string => !!id);
  if (p.state === 'older') {
    // Measurements the plan added since: on each goal's page, the group's page and the monthly check.
    for (const g of FLEX_GOALS) {
      if (!goalIds[g.key]) continue;
      for (const m of g.measures) {
        if (next.measurementTypes.some((t) => !t.archived_at && t.goal_id === goalIds[g.key] && t.name === m.name)) continue;
        add([{ kind: 'insert', collection: 'measurementTypes', rows: [{ id: newId(), name: m.name, unit: m.unit, cadence_days: 28, goal_id: goalIds[g.key]!, archived_at: null, on_today: false }] }]);
      }
    }
  }

  // 3. The group: Body by default (where your splits goal was), or one of their own.
  const ownBefore = next.groups.find((x) => x.name === OWN_GROUP);
  if (choices.grouping === 'body' && p.bodyGroup) {
    for (const id of ids) if (next.goals.find((x) => x.id === id)?.group_id !== p.bodyGroup.id) add([{ kind: 'update', collection: 'goals', id, patch: { group_id: p.bodyGroup.id } }]);
    // The earlier version's own group, now empty, goes away.
    if (ownBefore && !next.goals.some((x) => x.group_id === ownBefore.id && !x.archived_at)) add([{ kind: 'delete', collection: 'groups', id: ownBefore.id }]);
  } else if (ownBefore) {
    for (const id of ids) if (next.goals.find((x) => x.id === id)?.group_id !== ownBefore.id) add([{ kind: 'update', collection: 'goals', id, patch: { group_id: ownBefore.id } }]);
  } else {
    add(opsCreateGroup(next, OWN_GROUP, ids).ops);
  }

  if (p.state === 'none') {
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
  } else {
    // An earlier version: the stretching tasks start earlier and get the current holds.
    for (const a of stretchActions(next)) {
      const d = STRETCH_DAYS.find((x) => x.title === a.title)!;
      if (!samePlan(a, d)) add([{ kind: 'update', collection: 'actions', id: a.id, patch: { stretch_plan: d.plan, details: STRETCH_DETAILS, planned_minutes: d.minutes } }]);
      for (const s of next.schedules.filter((x) => x.action_id === a.id && x.effective_from > start)) add([{ kind: 'update', collection: 'schedules', id: s.id, patch: { effective_from: start } }]);
    }
    const check = next.actions.find((a) => !a.archived_at && a.title === MONTHLY_CHECK.title);
    if (check && check.details !== MONTHLY_CHECK.details) add([{ kind: 'update', collection: 'actions', id: check.id, patch: { details: MONTHLY_CHECK.details } }]);
  }

  // 6. The old stretching task stops the day before (history kept).
  for (const s of p.stopping) if (choices.stop.includes(s.action.id)) add(opsStopFrom(next, next.actions.find((a) => a.id === s.action.id)!, start));

  // 7. Workouts off Wednesday, from this week: one of each, on its new day.
  if (choices.moveWorkouts) for (const m of p.moving) add(opsRescheduleDays(next, next.actions.find((a) => a.id === m.action.id)!, m.to, weekStart(today), today));

  // 8. This week's sessions for the new schedules (stretching from the start day).
  add(opsEnsureWeek(next, weekStart(today)));

  return { ops, undo: invertOps(data, ops), goalIds: ids };
}

export const PACK = { name: PLAN_NAME, start: PLAN_START };
