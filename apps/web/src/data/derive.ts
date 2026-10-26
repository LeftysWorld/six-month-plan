import { useMemo } from 'react';
import {
  chainAt,
  addDays,
  currentTargets,
  daysSince,
  goalsOnPace,
  isActivePlan,
  milestoneProgress,
  missingSessionsForWeek,
  numberGoalStatus,
  progressFor,
  quarterRange,
  scheduleOn,
  weekStart,
  type Action,
  type ActionSchedule,
  type DateRange,
  type Goal,
  type ISODate,
  type Measurement,
  type MeasurementType,
  type NumberGoalStatus,
  type PaceLabel,
  type PathPoint,
  type Plan,
  type Progress,
  type Session,
} from '@six/core';
import type { AppData } from './model.ts';
import { useStore } from './store.tsx';

export interface GoalPace {
  goal: Goal;
  label: PaceLabel;
  /** Short summary for cards, e.g. "12 of 13 expected" or "207.5 vs 209 path". */
  summary: string;
  progress: Progress | null;
  number: NumberGoalStatus | null;
}

export interface Horizon {
  key: 'today' | 'week' | 'month' | 'quarter' | 'plan';
  name: string;
  detail: string;
  progress: Progress;
}

/** All derived views for one moment in time. */
export class View {
  constructor(
    readonly data: AppData,
    readonly today: ISODate,
    readonly dayFraction: number,
  ) {}

  get activePlans(): Plan[] {
    return this.data.plans
      .filter((p) => isActivePlan(p, this.today))
      .sort((a, b) => (a.start_date < b.start_date ? -1 : 1));
  }

  /** The plan Home focuses on: the earliest active one, else the next upcoming one. */
  get mainPlan(): Plan | null {
    const active = this.activePlans[0];
    if (active) return active;
    return (
      this.data.plans
        .filter((p) => !p.archived_at && p.start_date > this.today)
        .sort((a, b) => (a.start_date < b.start_date ? -1 : 1))[0] ?? null
    );
  }

  plan(id: string): Plan | undefined {
    return this.data.plans.find((p) => p.id === id);
  }

  /** Plans that haven't ended or been archived (batches and own clocks), earliest first. */
  get livePlans(): Plan[] {
    return this.data.plans.filter((p) => !p.archived_at && p.end_date >= this.today).sort((a, b) => (a.start_date < b.start_date ? -1 : 1));
  }

  /** Batches a goal can join: live, shared plans (not a goal's own clock). */
  get batches(): Plan[] {
    return this.livePlans.filter((p) => !p.solo);
  }

  /** The plan a goal runs in now: its live plan (earliest start), else the last one it was in. */
  planForGoal(goal: Goal): Plan | null {
    const plans = this.plansForGoal(goal.id).filter((p) => !p.archived_at);
    const live = plans.filter((p) => p.end_date >= this.today).sort((a, b) => (a.start_date < b.start_date ? -1 : 1));
    return live[0] ?? plans.sort((a, b) => (a.end_date < b.end_date ? 1 : -1))[0] ?? null;
  }

  /** Goals you're working on across every live batch and own clock (not archived or completed). */
  get activeGoals(): Goal[] {
    const live = new Set(this.livePlans.map((p) => p.id));
    const ids = new Set(this.data.planGoals.filter((pg) => live.has(pg.plan_id)).map((pg) => pg.goal_id));
    return this.data.goals.filter((g) => ids.has(g.id) && !g.archived_at && !g.completed_at);
  }

  goal(id: string): Goal | undefined {
    return this.data.goals.find((g) => g.id === id);
  }

  action(id: string | null): Action | undefined {
    return id ? this.data.actions.find((a) => a.id === id) : undefined;
  }

  goalsForPlan(planId: string, includeArchived = false): Goal[] {
    const ids = new Set(this.data.planGoals.filter((pg) => pg.plan_id === planId).map((pg) => pg.goal_id));
    // Archived and completed goals are left out of everyday lists (Completed has its own page).
    return this.data.goals.filter((g) => ids.has(g.id) && (includeArchived || (!g.archived_at && !g.completed_at)));
  }

  /**
   * The goal this one waits on, while that one isn't complete ("Up next"). A waiting goal isn't
   * judged on pace. Once the other goal is complete (or archived), it's simply running.
   */
  waitingOn(goal: Goal): Goal | null {
    if (!goal.after_goal_id || goal.completed_at) return null;
    const before = this.goal(goal.after_goal_id);
    return before && !before.completed_at && !before.archived_at ? before : null;
  }

  /** Goals that start after this one. */
  followersOf(goalId: string): Goal[] {
    return this.data.goals.filter((g) => g.after_goal_id === goalId && !g.archived_at && !g.completed_at);
  }

  /**
   * Where a goal's own run starts: the latest of its window's start, its own start date, and the
   * day the goal it waited on was completed (never past the window's end).
   */
  startFor(goal: Goal, plan: Plan): ISODate {
    const before = goal.after_goal_id ? this.goal(goal.after_goal_id) : undefined;
    const done = before?.completed_at?.slice(0, 10);
    const start = [plan.start_date, goal.start_date ?? '', done ?? ''].sort().at(-1)!;
    return start > plan.end_date ? plan.end_date : start;
  }

  /** Where a goal ends: its finish-by date inside its window, else the window's end (never before it starts). */
  endFor(goal: Goal, plan: Plan): ISODate {
    const end = goal.target_date && goal.target_date <= plan.end_date ? goal.target_date : plan.end_date;
    const start = this.startFor(goal, plan);
    return end < start ? start : end;
  }

  /**
   * A goal's dates as planned, for the roadmap: its start and end, and for a goal still waiting on
   * another, the earliest it can start (the day after that one is due to end).
   */
  plannedWindow(goal: Goal, plan: Plan): { start: ISODate; end: ISODate; waitsFrom: ISODate | null } {
    let start = this.startFor(goal, plan);
    const before = this.waitingOn(goal);
    let waitsFrom: ISODate | null = null;
    if (before) {
      const bp = this.planForGoal(before);
      if (bp) {
        waitsFrom = addDays(this.endFor(before, bp), 1);
        if (waitsFrom > start) start = waitsFrom > plan.end_date ? plan.end_date : waitsFrom;
      }
    }
    const end0 = this.endFor(goal, plan);
    return { start, end: end0 < start ? start : end0, waitsFrom };
  }

  plansForGoal(goalId: string): Plan[] {
    const ids = new Set(this.data.planGoals.filter((pg) => pg.goal_id === goalId).map((pg) => pg.plan_id));
    return this.data.plans.filter((p) => ids.has(p.id));
  }

  actionsForGoal(goalId: string, includeArchived = false): Action[] {
    const ids = new Set(this.data.actionGoals.filter((ag) => ag.goal_id === goalId).map((ag) => ag.action_id));
    return this.data.actions.filter((a) => ids.has(a.id) && (includeArchived || !a.archived_at));
  }

  goalsForAction(actionId: string | null): Goal[] {
    if (!actionId) return [];
    const ids = new Set(this.data.actionGoals.filter((ag) => ag.action_id === actionId).map((ag) => ag.goal_id));
    return this.data.goals.filter((g) => ids.has(g.id));
  }

  /** Live goals (not archived) other than `exceptGoalId` that a task also supports. */
  otherGoalsForAction(actionId: string | null, exceptGoalId: string): Goal[] {
    return this.goalsForAction(actionId).filter((g) => g.id !== exceptGoalId && !g.archived_at);
  }

  /**
   * Goals connected to a goal: the other goals in its group, and goals that share a daily task
   * with it. Each comes with whether it's in the same group and the live tasks they share.
   * Archived goals are left out.
   */
  connectionsFor(goalId: string): Connection[] {
    const out = new Map<string, Connection>();
    const me = this.goal(goalId);
    const add = (id: string): Connection | null => {
      const goal = this.goal(id);
      if (!goal || goal.archived_at || id === goalId) return null;
      let c = out.get(id);
      if (!c) out.set(id, (c = { goal, sameGroup: !!me?.group_id && goal.group_id === me.group_id, shared: [] }));
      return c;
    };
    if (me?.group_id) for (const g of this.data.goals) if (g.group_id === me.group_id) add(g.id);
    for (const action of this.actionsForGoal(goalId)) {
      for (const g of this.otherGoalsForAction(action.id, goalId)) add(g.id)?.shared.push(action);
    }
    // Goals you're working on first, then completed ones.
    return [...out.values()].sort((a, b) => Number(b.sameGroup) - Number(a.sameGroup) || Number(!!a.goal.completed_at) - Number(!!b.goal.completed_at) || a.goal.title.localeCompare(b.goal.title));
  }

  /** The same goals, reordered so connected goals sit next to each other (first appearance wins). */
  groupConnected<T extends Goal>(goals: T[]): T[] {
    const ids = new Set(goals.map((g) => g.id));
    const placed = new Set<string>();
    const out: T[] = [];
    for (const g of goals) {
      if (placed.has(g.id)) continue;
      const queue = [g.id];
      while (queue.length) {
        const id = queue.shift()!;
        if (placed.has(id) || !ids.has(id)) continue;
        placed.add(id);
        out.push(goals.find((x) => x.id === id)!);
        for (const c of this.connectionsFor(id)) if (!placed.has(c.goal.id)) queue.push(c.goal.id);
      }
    }
    return out;
  }

  /** First goal colour for a session (one-offs get a neutral grey). */
  colorFor(session: Session): string {
    return this.goalsForAction(session.action_id)[0]?.color ?? '#9AA49E';
  }

  scheduleFor(actionId: string, date: ISODate = this.today): ActionSchedule | null {
    return scheduleOn(this.data.schedules, actionId, date);
  }

  sessionsOn(date: ISODate): Session[] {
    return this.data.sessions.filter((s) => s.date === date && s.status !== 'moved');
  }

  sessionsInWeek(monday: ISODate): Session[] {
    return this.data.sessions.filter(
      (s) => s.status !== 'moved' && (s.date ? weekStart(s.date) === monday : s.week_start === monday),
    );
  }

  /**
   * Can this session go on this date? A task happens at most once a day: a day that already has
   * that task (planned or logged) can't take another, so missed days can't be made up on one day.
   * One-offs with no task behind them can go anywhere.
   */
  canPlace(session: Session, date: ISODate): boolean {
    if (!session.action_id) return true;
    return !this.data.sessions.some((s) => s.id !== session.id && s.action_id === session.action_id && s.date === date && s.status !== 'moved');
  }

  unplacedThisWeek(): Session[] {
    const monday = weekStart(this.today);
    return this.data.sessions.filter((s) => !s.date && s.week_start === monday && s.status === 'planned');
  }

  sessionsForGoal(goalId: string): Session[] {
    const actionIds = new Set(this.data.actionGoals.filter((ag) => ag.goal_id === goalId).map((ag) => ag.action_id));
    return this.data.sessions.filter((s) => s.action_id && actionIds.has(s.action_id));
  }

  measurementsFor(typeId: string | null): Measurement[] {
    if (!typeId) return [];
    return this.data.measurements
      .filter((m) => m.type_id === typeId)
      .sort((a, b) => (a.measured_on < b.measured_on ? -1 : 1));
  }

  measurementTypesForGoal(goalId: string): MeasurementType[] {
    return this.data.measurementTypes.filter((t) => !t.archived_at && (t.goal_id === goalId));
  }

  /** Measurement types due for a reading on or before `date`. */
  measurementsDue(date: ISODate = this.today): MeasurementType[] {
    return this.data.measurementTypes.filter((t) => {
      if (t.archived_at) return false;
      const last = this.measurementsFor(t.id).at(-1);
      return !last || addDays(last.measured_on, t.cadence_days) <= addDays(date, 1);
    });
  }

  pathFor(goal: Goal): PathPoint[] {
    return currentTargets(this.data.goalTargets, goal.id).map((t) => ({ date: t.target_date, value: Number(t.target_value) }));
  }

  tooEarly(plan: Plan | null): boolean {
    return !plan || addDays(plan.start_date, 7) > this.today;
  }

  /** Pace for one goal over a period (practice goals) or overall (number and finish goals). */
  goalPace(goal: Goal, plan: Plan | null, range?: DateRange): GoalPace {
    const early = this.tooEarly(plan);
    const waiting = this.waitingOn(goal);
    if (waiting) return { goal, label: 'none', summary: `Up next · after ${waiting.title}`, progress: null, number: null };
    const fallbackStart = plan?.start_date ?? this.today;
    if (goal.type === 'number') {
      const status = numberGoalStatus(goal, this.pathFor(goal), this.measurementsFor(goal.measurement_type_id), this.today, fallbackStart, early);
      const summary =
        status.trend == null
          ? 'No readings yet'
          : `${fmt(status.trend)} vs ${fmt(status.pathToday)} path`;
      return { goal, label: status.label, summary, progress: null, number: status };
    }
    if (goal.type === 'finish') {
      const ms = this.data.milestones.filter((m) => m.goal_id === goal.id);
      const progress = milestoneProgress(ms, this.today, early);
      return {
        goal,
        label: ms.length ? progress.label : 'none',
        summary: ms.length ? `${progress.actual} of ${progress.planned} milestones` : 'No milestones yet',
        progress,
        number: null,
      };
    }
    const period = range ?? { start: plan?.start_date ?? addDays(this.today, -28), end: this.today };
    // Today's sessions don't count against pace until the day is over (done early still helps).
    const progress = progressFor(this.sessionsForGoal(goal.id), period, { today: this.today, dayFraction: 0, tooEarly: early });
    return {
      goal,
      label: progress.planned ? progress.label : 'none',
      summary: progress.planned ? `${fmt(progress.actual, 0)} done, ${fmt(progress.expected, 0)} expected by now` : 'No tasks yet',
      progress,
      number: null,
    };
  }

  /**
   * Sessions for a period, including weeks not generated yet (projected from the
   * schedules, never saved), so a block's total reflects the whole block.
   */
  projectedSessions(range: DateRange, base: Session[] = this.data.sessions): Session[] {
    const out = [...base];
    const generated = new Set(this.data.sessions.filter((s) => s.origin === 'scheduled').map((s) => s.week_start));
    for (let monday = weekStart(range.start); monday <= range.end; monday = addDays(monday, 7)) {
      if (monday <= weekStart(this.today) || generated.has(monday)) continue;
      let n = 0;
      out.push(...missingSessionsForWeek(this.data.actions, this.data.schedules, [], monday, () => `projected-${monday}-${n++}`));
    }
    return out;
  }

  /** The five plan-vs-actual horizons for Home. */
  horizons(plan: Plan): Horizon[] {
    const opts = { today: this.today, dayFraction: this.dayFraction };
    const early = this.tooEarly(plan);
    const goals = this.goalsForPlan(plan.id);
    const goalIds = new Set(goals.map((g) => g.id));
    const actionIds = new Set(this.data.actionGoals.filter((ag) => goalIds.has(ag.goal_id)).map((ag) => ag.action_id));
    const inPlan = (s: Session) => !s.action_id || actionIds.has(s.action_id);
    const milestones = this.data.milestones.filter((m) => goalIds.has(m.goal_id));
    const monday = weekStart(this.today);
    const month = chainAt(plan, this.today).month;
    const quarter = quarterRange(plan, this.today);
    const labels = goals.map((g) => this.goalPace(g, plan).label);
    return [
      {
        key: 'today',
        name: 'Today',
        detail: 'tasks',
        progress: progressFor(this.data.sessions, { start: this.today, end: this.today }, opts),
      },
      {
        key: 'week',
        name: 'Week',
        detail: `${short(monday)}–${short(addDays(monday, 6))}`,
        progress: progressFor(this.data.sessions, { start: monday, end: addDays(monday, 6) }, { ...opts, dayFraction: 0 }),
      },
      {
        key: 'month',
        name: 'This month',
        detail: `${short(month.start)}–${short(month.end)}`,
        progress: progressFor(this.projectedSessions(month).filter(inPlan), month, { ...opts, dayFraction: 0, tooEarly: early }, milestones),
      },
      {
        key: 'quarter',
        name: '3 months',
        detail: `to ${short(quarter.end)}`,
        progress: progressFor(this.projectedSessions(quarter).filter(inPlan), quarter, { ...opts, dayFraction: 0, tooEarly: early }, milestones),
      },
      {
        key: 'plan',
        name: '6 months',
        detail: 'goals on pace',
        progress: goalsOnPace(labels, early),
      },
    ];
  }

  /** Days since anything was last logged (null if nothing ever was). */
  daysAway(): number | null {
    const dates = [
      ...this.data.sessions.filter((s) => s.logged_at).map((s) => s.logged_at!.slice(0, 10)),
      ...this.data.measurements.map((m) => m.measured_on),
    ];
    return daysSince(dates, this.today);
  }
}

export function useView(): View {
  const { data, today, dayFraction } = useStore();
  return useMemo(() => new View(data, today, dayFraction), [data, today, dayFraction]);
}

export function fmt(n: number | null | undefined, digits = 1): string {
  if (n == null || Number.isNaN(n)) return '–';
  const rounded = Math.round(n * 10 ** digits) / 10 ** digits;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(digits);
}

export function minutesText(min: number): string {
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `${h}h ${m}m` : `${h}h`;
}

function short(date: ISODate): string {
  const [, m, d] = date.split('-').map(Number);
  return `${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][(m ?? 1) - 1]} ${d}`;
}

export interface Connection {
  goal: Goal;
  /** True when both goals are in the same group. */
  sameGroup: boolean;
  /** Live daily tasks both goals share. */
  shared: Action[];
}
