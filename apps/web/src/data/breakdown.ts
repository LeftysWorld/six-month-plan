import {
  addDays,
  currentTargets,
  daysBetween,
  isoWeekday,
  missingSessionsForWeek,
  valueOnPath,
  weekStart,
  type Action,
  type ActionKind,
  type ActionSchedule,
  type DateRange,
  type Goal,
  type ISODate,
  type PathPoint,
  type Plan,
  type PlanStep,
  type Session,
  parseWorkoutPlan,
  type PlannedExercise,
} from '@six/core';
import { applyOp, type AppData, type Op } from './model.ts';
import { findMeasure } from './connect.ts';

/**
 * The goal breakdown: 6 months (the goal) → 3 months → months → weeks → daily tasks.
 * Daily tasks are actions linked to the step they were planned in, with a schedule
 * limited to the dates you chose, so they land on Today like any other action.
 */

const newId = () => crypto.randomUUID();
const nowISO = () => new Date().toISOString();
type Row = { id: string } & Record<string, unknown>;
const rows = <T extends { id: string }>(items: T[]): Row[] => items as unknown as Row[];
const round1 = (n: number) => Math.round(n * 10) / 10;

// ---------- Reading ----------

export function stepsForGoal(data: AppData, goalId: string): PlanStep[] {
  return data.planSteps
    .filter((s) => s.goal_id === goalId)
    .sort((a, b) => (a.start_date < b.start_date ? -1 : a.start_date > b.start_date ? 1 : levelRank(a) - levelRank(b)));
}

function levelRank(s: PlanStep): number {
  return s.level === 'quarter' ? 0 : s.level === 'month' ? 1 : 2;
}

/** Where a number goal starts: its baseline, else its first reading. */
export function startPoint(data: AppData, goal: Goal, plan: Plan): PathPoint | null {
  if (goal.type !== 'number') return null;
  if (goal.baseline_value != null) return { date: goal.baseline_date ?? plan.start_date, value: Number(goal.baseline_value) };
  const first = data.measurements
    .filter((m) => m.type_id === goal.measurement_type_id)
    .sort((a, b) => (a.measured_on < b.measured_on ? -1 : 1))[0];
  return first ? { date: first.measured_on, value: Number(first.value) } : null;
}

export interface WeekTask {
  action: Action;
  schedule: ActionSchedule;
  /** planned in this week, carried over from an earlier week, an ongoing action from goal setup, or planned on another goal and shared with this one */
  origin: 'here' | 'carried' | 'ongoing' | 'shared';
}

/** Tasks for a goal whose schedule touches the given dates. */
export function tasksInRange(data: AppData, goalId: string, range: DateRange, stepId?: string): WeekTask[] {
  const actionIds = new Set(data.actionGoals.filter((ag) => ag.goal_id === goalId).map((ag) => ag.action_id));
  const out: WeekTask[] = [];
  for (const action of data.actions) {
    if (!actionIds.has(action.id) || action.archived_at) continue;
    const schedule = data.schedules
      .filter((s) => s.action_id === action.id && s.effective_from <= range.end && (s.effective_to == null || s.effective_to >= range.start))
      .sort((a, b) => (a.effective_from < b.effective_from ? 1 : -1))[0];
    if (!schedule) continue;
    // A task stopped part-way through the range ("Remove" from Tuesday on) only stays listed if something was logged on it in the range.
    if (
      schedule.effective_to != null &&
      schedule.effective_to < range.end &&
      !data.sessions.some((x) => x.action_id === action.id && x.status !== 'planned' && x.status !== 'moved' && x.date != null && x.date >= range.start && x.date <= range.end)
    )
      continue;
    const step = action.step_id ? data.planSteps.find((s) => s.id === action.step_id) : undefined;
    const origin = action.step_id && action.step_id === stepId ? 'here' : step && step.goal_id !== goalId ? 'shared' : action.step_id ? 'carried' : 'ongoing';
    out.push({ action, schedule, origin });
  }
  return out.sort((a, b) => Number(b.action.priority) - Number(a.action.priority) || a.action.title.localeCompare(b.action.title));
}

/**
 * Is this a one-day task? One-day tasks are saved as a single weekday on a single date.
 * A repeating task whose range happens to be one day long (e.g. "every day this week"
 * added on a Sunday) is not one: it keeps its days, so editing it can't shrink it.
 */
export function isOnce(schedule: ActionSchedule): boolean {
  return schedule.effective_from === schedule.effective_to && schedule.rule === 'days' && schedule.days.length === 1;
}

/** Fixed-day tasks that fall on a date (any goal), with their minutes. */
export function fixedTasksOn(data: AppData, date: ISODate): { action: Action; minutes: number }[] {
  const out: { action: Action; minutes: number }[] = [];
  for (const action of data.actions) {
    if (action.archived_at) continue;
    const s = data.schedules.find(
      (x) => x.action_id === action.id && x.rule === 'days' && x.effective_from <= date && (x.effective_to == null || x.effective_to >= date),
    );
    if (s && s.days.includes(isoWeekday(date))) out.push({ action, minutes: action.planned_minutes });
  }
  return out;
}

// ---------- Building the breakdown ----------

/** The value a number goal's path reaches on a date (rounded), or null for other goal types. */
export function suggestedTarget(data: AppData, goal: Goal, plan: Plan, end: ISODate): number | null {
  if (goal.type !== 'number') return null;
  const start = startPoint(data, goal, plan);
  const path = currentTargets(data.goalTargets, goal.id).map((t) => ({ date: t.target_date, value: Number(t.target_value) }));
  if (!start || (!path.length && goal.target_value == null)) return null;
  return round1(valueOnPath(start, path.length ? path : [{ date: goal.target_date ?? plan.end_date, value: Number(goal.target_value) }], end));
}

export function makeStep(goal: Goal, plan: Plan, parent: string | null, level: PlanStep['level'], idx: number, title: string, range: DateRange, target: number | null): PlanStep {
  return {
    id: newId(),
    goal_id: goal.id,
    plan_id: plan.id,
    parent_id: parent,
    level,
    idx,
    title,
    start_date: range.start,
    end_date: range.end,
    target_value: goal.type === 'number' ? target : null,
    target_note: '',
    completed_at: null,
  };
}

// ---------- Editing a level ----------

/** Apply ops to a copy of the data, so later builders see earlier changes. */
export function withOps(data: AppData, ops: Op[]): AppData {
  return ops.reduce(applyOp, data);
}

// ---------- Daily tasks ----------

export type TaskWhen = 'once' | 'days' | 'per_week';

export interface TaskInput {
  title: string;
  kind: ActionKind;
  minutes: number;
  count: number | null;
  when: TaskWhen;
  date: ISODate;
  days: number[];
  perWeek: number;
  /** Last day the task repeats; null = keeps going with no end date (ignored for one-day tasks). */
  through: ISODate | null;
  /** First day a repeating task runs, when that's later than the day it's added (e.g. a class that starts Nov 14). */
  start?: ISODate | null;
  priority: boolean;
  minLabel: string;
  /** "After coffee, at my desk": when the task happens (optional). */
  cue: string;
  /** Every goal the task supports (the goal you're on is always one of them). Defaults to just that goal. */
  goalIds?: string[];
  /** For a measure task: the measurement it records. */
  measurementTypeId?: string | null;
  /** For a measure task: a new measurement to create for it (when none fits). */
  newMeasure?: { name: string; unit: string } | null;
  /** What the task involves (exercises, sets and reps…), shown when you log it. */
  details?: string;
  /** A workout's plan, exercise by exercise. */
  workoutPlan?: PlannedExercise[] | null;
}

/** The measurement a measure task records: an existing one, or a new one created with the task. */
function measureFor(data: AppData, input: TaskInput, goalId: string): { id: string | null; ops: Op[] } {
  if (input.kind !== 'measure') return { id: null, ops: [] };
  if (input.newMeasure && input.newMeasure.name.trim()) {
    // Already tracking one with this name? Use it, so the goal's chart gets the readings.
    const existing = findMeasure(data, goalId, input.newMeasure.name, input.newMeasure.unit);
    if (existing) return { id: existing, ops: [] };
    const id = newId();
    const row = { id, name: input.newMeasure.name.trim(), unit: input.newMeasure.unit.trim(), cadence_days: 1, goal_id: goalId, archived_at: null };
    return { id, ops: [{ kind: 'insert', collection: 'measurementTypes', rows: rows([row]) }] };
  }
  return { id: input.measurementTypeId ?? null, ops: [] };
}

export function scheduleFor(actionId: string, input: TaskInput, from0: ISODate): ActionSchedule {
  // A repeating task can start later than the day it's added.
  const from = input.start && input.start > from0 ? input.start : from0;
  if (input.when === 'once') {
    return { id: newId(), action_id: actionId, rule: 'days', days: [isoWeekday(input.date)], per_week: null, effective_from: input.date, effective_to: input.date };
  }
  return {
    id: newId(),
    action_id: actionId,
    rule: input.when === 'days' ? 'days' : 'per_week',
    days: input.when === 'days' ? [...input.days].sort((a, b) => a - b) : [],
    per_week: input.when === 'per_week' ? input.perWeek : null,
    effective_from: from,
    effective_to: input.through && input.through < from ? from : input.through,
  };
}

/** Create this week's missing sessions so a new or changed task shows up on Today right away. */
export function opsGenerateThisWeek(data: AppData, today: ISODate): Op[] {
  const missing = missingSessionsForWeek(data.actions, data.schedules, data.sessions, weekStart(today), newId);
  return missing.length ? [{ kind: 'insertIgnore', collection: 'sessions', rows: rows(missing) }] : [];
}

/** First day a change can apply: today, or the step's first day if it's in the future. */
export function applyFrom(step: PlanStep, today: ISODate): ISODate {
  return step.start_date > today ? step.start_date : today;
}

export function opsAddTask(data: AppData, goal: Goal, step: PlanStep, input: TaskInput, today: ISODate): Op[] {
  const measure = measureFor(data, input, goal.id);
  const goalIds = [...new Set([goal.id, ...(input.goalIds ?? [])])];
  const action: Action = {
    id: newId(),
    title: input.title.trim(),
    kind: input.kind,
    planned_minutes: Math.max(0, input.minutes),
    planned_count: input.kind === 'count' ? Math.max(1, input.count ?? 1) : null,
    min_label: input.minLabel.trim(),
    min_minutes: null,
    min_count: null,
    priority: input.priority,
    step_id: step.id,
    archived_at: null,
    // Only sent when used, so a database without the cue column still works.
    ...(input.cue.trim() ? { cue: input.cue.trim() } : {}),
    ...(measure.id ? { measurement_type_id: measure.id } : {}),
    // Only sent when used, so a database without the details column still works.
    ...(input.details?.trim() ? { details: input.details.trim() } : {}),
    ...(input.kind === 'workout' && input.workoutPlan?.length ? { workout_plan: cleanPlan(input.workoutPlan) } : {}),
  };
  const schedule = scheduleFor(action.id, input, applyFrom(step, today));
  const ops: Op[] = [
    ...measure.ops,
    { kind: 'insert', collection: 'actions', rows: rows([action]) },
    { kind: 'insert', collection: 'schedules', rows: rows([schedule]) },
    { kind: 'insert', collection: 'actionGoals', rows: rows(goalIds.map((g) => ({ id: newId(), action_id: action.id, goal_id: g }))) },
  ];
  return [...ops, ...opsGenerateThisWeek(withOps(data, ops), today)];
}

/** Planned (not yet logged) sessions of an action from a date on. */
function plannedFrom(sessions: Session[], actionId: string, from: ISODate): Session[] {
  return sessions.filter(
    (s) => s.action_id === actionId && s.status === 'planned' && s.origin === 'scheduled' && (s.date ? s.date >= from : s.week_start >= weekStart(from)),
  );
}

/** Change a task from `from` on. Earlier days keep the old version. */
export function opsEditTask(data: AppData, action: Action, input: TaskInput, from: ISODate, today: ISODate, goalId?: string): Op[] {
  const measure = measureFor(data, input, goalId ?? data.actionGoals.find((ag) => ag.action_id === action.id)?.goal_id ?? '');
  const ops: Op[] = [
    ...measure.ops,
    {
      kind: 'update',
      collection: 'actions',
      id: action.id,
      patch: {
        title: input.title.trim(),
        kind: input.kind,
        planned_minutes: Math.max(0, input.minutes),
        planned_count: input.kind === 'count' ? Math.max(1, input.count ?? 1) : null,
        min_label: input.minLabel.trim(),
        priority: input.priority,
        ...(input.cue.trim() || action.cue ? { cue: input.cue.trim() } : {}),
        ...(measure.id || action.measurement_type_id ? { measurement_type_id: measure.id } : {}),
        ...(input.details?.trim() || action.details ? { details: input.details?.trim() ?? '' } : {}),
        ...(input.workoutPlan?.length || action.workout_plan?.length ? { workout_plan: input.kind === 'workout' && input.workoutPlan?.length ? cleanPlan(input.workoutPlan) : null } : {}),
      },
    },
  ];
  if (input.goalIds?.length) {
    const want = new Set(input.goalIds);
    const have = data.actionGoals.filter((ag) => ag.action_id === action.id);
    for (const ag of have) if (!want.has(ag.goal_id)) ops.push({ kind: 'delete', collection: 'actionGoals', id: ag.id });
    for (const g of want) if (!have.some((ag) => ag.goal_id === g)) ops.push({ kind: 'insert', collection: 'actionGoals', rows: rows([{ id: newId(), action_id: action.id, goal_id: g }]) });
  }
  const live = data.schedules.filter((s) => s.action_id === action.id && (s.effective_to == null || s.effective_to >= from));
  for (const s of live) {
    if (s.effective_from >= from) ops.push({ kind: 'delete', collection: 'schedules', id: s.id });
    else ops.push({ kind: 'update', collection: 'schedules', id: s.id, patch: { effective_to: addDays(from, -1) } });
  }
  const fresh = scheduleFor(action.id, input, from);
  if (input.when === 'once' && input.date < from) fresh.effective_from = fresh.effective_to = from;
  ops.push({ kind: 'insert', collection: 'schedules', rows: rows([fresh]) });
  for (const s of plannedFrom(data.sessions, action.id, from)) ops.push({ kind: 'delete', collection: 'sessions', id: s.id });
  return [...ops, ...opsGenerateThisWeek(withOps(data, ops), today)];
}

/** Stop a task from `from` on. Logged history is kept; a task that never ran is archived. */
export function opsRemoveTask(data: AppData, action: Action, from: ISODate): Op[] {
  const ops: Op[] = [];
  const all = data.schedules.filter((s) => s.action_id === action.id);
  // Never logged: there is no history to keep, so the task goes entirely rather than lingering as "stopped yesterday".
  const everLogged = data.sessions.some((s) => s.action_id === action.id && s.status !== 'planned' && s.status !== 'moved');
  if (!everLogged && all.length) from = all.reduce((lo, s) => (s.effective_from < lo ? s.effective_from : lo), from);
  let remaining = 0;
  for (const s of all) {
    if (s.effective_to != null && s.effective_to < from) {
      remaining++;
      continue;
    }
    if (s.effective_from >= from) ops.push({ kind: 'delete', collection: 'schedules', id: s.id });
    else {
      ops.push({ kind: 'update', collection: 'schedules', id: s.id, patch: { effective_to: addDays(from, -1) } });
      remaining++;
    }
  }
  for (const s of plannedFrom(data.sessions, action.id, from)) ops.push({ kind: 'delete', collection: 'sessions', id: s.id });
  const logged = data.sessions.some((s) => s.action_id === action.id && s.status !== 'planned');
  if (remaining === 0 && !logged) ops.push({ kind: 'update', collection: 'actions', id: action.id, patch: { archived_at: nowISO() } });
  return ops;
}

/** Copy last week's one-week tasks into this week (anything already repeating is skipped). */
export function opsCopyTasks(data: AppData, goal: Goal, fromWeek: PlanStep, toWeek: PlanStep, today: ISODate): Op[] {
  const already = new Set(tasksInRange(data, goal.id, { start: toWeek.start_date, end: toWeek.end_date }).map((t) => t.action.id));
  let next = data;
  const ops: Op[] = [];
  for (const t of tasksInRange(data, goal.id, { start: fromWeek.start_date, end: fromWeek.end_date }, fromWeek.id)) {
    if (already.has(t.action.id)) continue;
    const input = { ...inputFromTask(t, toWeek), through: toWeek.end_date };
    if (input.when === 'once') {
      input.date = addDays(t.schedule.effective_from, daysBetween(fromWeek.start_date, toWeek.start_date));
      if (input.date < today || input.date > toWeek.end_date) continue;
    }
    const added = opsAddTask(next, goal, toWeek, input, today);
    ops.push(...added);
    next = withOps(next, added);
  }
  return ops;
}

/** Form values for an existing task. */
export function inputFromTask(t: WeekTask, week: PlanStep): TaskInput {
  const once = isOnce(t.schedule);
  return {
    title: t.action.title,
    kind: t.action.kind,
    minutes: t.action.planned_minutes,
    count: t.action.planned_count,
    when: once ? 'once' : t.schedule.rule === 'days' ? 'days' : 'per_week',
    date: once ? t.schedule.effective_from : week.start_date,
    days: t.schedule.rule === 'days' ? t.schedule.days : [1, 3, 5],
    perWeek: t.schedule.per_week ?? 3,
    // Keep an ongoing task ongoing: editing must never quietly give it an end date.
    through: once ? week.end_date : t.schedule.effective_to,
    start: once ? null : t.schedule.effective_from > week.start_date ? t.schedule.effective_from : null,
    priority: t.action.priority,
    minLabel: t.action.min_label,
    cue: t.action.cue ?? '',
    measurementTypeId: t.action.measurement_type_id ?? null,
    newMeasure: null,
    details: t.action.details ?? '',
    workoutPlan: t.action.workout_plan ?? null,
  };
}

/** A plan as saved: named exercises only, with whole, positive numbers. */
export function cleanPlan(plan: PlannedExercise[]): PlannedExercise[] {
  return plan
    .filter((e) => e.name.trim())
    .map((e) => {
      const lo = Math.max(1, Math.round(e.reps_min || 1));
      return {
        ...e,
        name: e.name.trim(),
        sets: Math.max(1, Math.round(e.sets || 1)),
        reps_min: lo,
        reps_max: Math.max(lo, Math.round(e.reps_max || lo)),
        weight: e.weight != null && Number.isFinite(e.weight) ? e.weight : null,
        weight_note: e.weight_note.trim(),
        rest: e.rest.trim(),
        note: e.note.trim(),
      };
    });
}

/**
 * Workout tasks whose exercises are written in their details get a plan read from them, once,
 * so the workout log can be filled in for you. Runs when the app opens.
 */
export function opsFillWorkoutPlans(data: AppData): Op[] {
  const ops: Op[] = [];
  for (const a of data.actions) {
    if (a.kind !== 'workout' || a.workout_plan?.length || !a.details?.trim()) continue;
    const plan = parseWorkoutPlan(a.details);
    if (plan.length) ops.push({ kind: 'update', collection: 'actions', id: a.id, patch: { workout_plan: plan } });
  }
  return ops;
}

export function blankTask(week: PlanStep, today: ISODate): TaskInput {
  const date = week.start_date > today ? week.start_date : today <= week.end_date ? today : week.end_date;
  return {
    title: '',
    kind: 'check',
    minutes: 30,
    count: 3,
    when: 'days',
    date,
    days: [1, 3, 5],
    perWeek: 3,
    through: week.end_date,
    priority: false,
    minLabel: '',
    cue: '',
  };
}
