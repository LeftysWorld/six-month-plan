import { addDays, daysBetween, type ISODate } from './dates.ts';
import { paceLabel } from './pace.ts';
import type { Goal, Milestone, PaceLabel } from './types.ts';

/**
 * Projects: temporary work with a finish line that, together with its sibling projects, delivers
 * a goal's six-month outcome (a program, in project-management terms). A project is a goal row
 * with parent_id set, so it has tasks, milestones and photos like any goal.
 *
 * Progress is measured by milestones (each one a step or a deliverable). Everything here is pure:
 * no UI, no database.
 */

/** How many projects can be active at once by default, across all goals. */
export const DEFAULT_WIP_LIMIT = 4;

/** Fewer days than this since a project started and the forecast stays quiet (one good day isn't a rate). */
export const FORECAST_MIN_DAYS = 7;
/** The forecast uses the last 4 weeks when there's enough in them, so it follows how you're going now. */
export const FORECAST_WINDOW_DAYS = 28;
/** A forecast further out than this isn't a date, it's "not at this pace". */
export const FORECAST_MAX_DAYS = 730;

export type ProjectPhase = 'not_started' | 'active' | 'done' | 'dropped';
/** What a project shows: its phase, plus "waiting" (on another project) and "at risk". */
export type ProjectState = 'not_started' | 'waiting' | 'active' | 'at_risk' | 'done' | 'dropped';
/** Critical Chain buffer: the gap between the target date and the deadline. */
export type BufferState = 'none' | 'ok' | 'using' | 'over';

export const STATE_TEXT: Record<ProjectState, string> = {
  not_started: 'Not started',
  waiting: 'Waiting',
  active: 'Active',
  at_risk: 'At risk',
  done: 'Done',
  dropped: 'Dropped',
};

export function isProject(goal: Pick<Goal, 'parent_id'> | null | undefined): boolean {
  return !!goal?.parent_id;
}

export function projectPhase(p: Goal): ProjectPhase {
  if (p.dropped_at) return 'dropped';
  if (p.completed_at) return 'done';
  if (p.started_at) return 'active';
  return 'not_started';
}

/** Projects that count toward the WIP limit: started, not finished, dropped or archived. */
export function activeProjects(goals: Goal[]): Goal[] {
  return goals.filter((g) => isProject(g) && !g.archived_at && projectPhase(g) === 'active');
}

export function wipLimit(limit: number | null | undefined): number {
  return limit && limit > 0 ? Math.round(limit) : DEFAULT_WIP_LIMIT;
}

/** A project's window: its start and target end, falling back to the window it runs in. */
export function projectWindow(p: Goal, fallback: { start: ISODate; end: ISODate }): { start: ISODate; end: ISODate } {
  const start = p.start_date ?? p.started_at?.slice(0, 10) ?? fallback.start;
  let end = p.target_date ?? fallback.end;
  if (end < start) end = start;
  return { start, end };
}

const day = (iso: string | null | undefined) => (iso ? iso.slice(0, 10) : null);

export interface Forecast {
  /** When it will likely finish at the current rate (the finish date once done). */
  date: ISODate | null;
  /** Milestones a week lately (null when there's no rate yet). */
  ratePerWeek: number | null;
  /** Why there's no date: just started, nothing done yet, nothing to measure, or too slow to call. */
  reason: 'done' | 'rate' | 'too_early' | 'no_rate' | 'no_milestones' | 'too_slow';
}

/**
 * Forecast the finish from the rate milestones have been completed. Uses the last 4 weeks when at
 * least two were completed in them (how you're going now), else the whole time since the start.
 * Stays quiet for the first week and until something is done: a forecast from nothing is noise.
 */
export function forecastFinish(milestones: Milestone[], start: ISODate, today: ISODate): Forecast {
  const total = milestones.length;
  if (!total) return { date: null, ratePerWeek: null, reason: 'no_milestones' };
  const completions = milestones.map((m) => day(m.completed_at)).filter((d): d is ISODate => !!d && d <= today).sort();
  const remaining = total - milestones.filter((m) => m.completed_at).length;
  if (remaining <= 0) return { date: completions.at(-1) ?? today, ratePerWeek: null, reason: 'done' };
  const elapsed = daysBetween(start, today);
  if (elapsed < FORECAST_MIN_DAYS) return { date: null, ratePerWeek: null, reason: 'too_early' };
  const window = Math.min(FORECAST_WINDOW_DAYS, elapsed);
  const recent = completions.filter((d) => d > addDays(today, -window));
  const sinceStart = completions.filter((d) => d >= start);
  const use = recent.length >= 2 ? { n: recent.length, days: window } : { n: sinceStart.length, days: elapsed };
  if (use.n === 0) return { date: null, ratePerWeek: null, reason: 'no_rate' };
  const perDay = use.n / use.days;
  const days = Math.ceil(remaining / perDay);
  const ratePerWeek = Math.round(perDay * 7 * 10) / 10;
  if (days > FORECAST_MAX_DAYS) return { date: null, ratePerWeek, reason: 'too_slow' };
  return { date: addDays(today, days), ratePerWeek, reason: 'rate' };
}

export interface ProjectStats {
  phase: ProjectPhase;
  state: ProjectState;
  start: ISODate;
  end: ISODate;
  deadline: ISODate | null;
  total: number;
  done: number;
  /** Milestones due before today. */
  expected: number;
  /** Share done, 0..1. */
  fraction: number;
  /** Where even progress would put it today, 0..1 (by milestone due dates; by time without milestones). */
  expectedFraction: number;
  label: PaceLabel;
  forecast: Forecast;
  /** Milestones a week needed from now to finish by the target date. */
  neededPerWeek: number | null;
  /** Days between the plan (baseline end, else target) and the forecast or finish. Positive = late. */
  varianceDays: number | null;
  buffer: BufferState;
  /** Unfinished projects this one waits on (finish-to-start). */
  waitingOn: string[];
  /** Past its target date and not done. */
  overdue: boolean;
}

/** Everything a project shows: phase, pace, forecast, variance and buffer. */
export function projectStats(p: Goal, milestones: Milestone[], all: Goal[], today: ISODate, fallback: { start: ISODate; end: ISODate }): ProjectStats {
  const phase = projectPhase(p);
  const { start, end } = projectWindow(p, fallback);
  const deadline = p.deadline && p.deadline >= end ? p.deadline : null;
  const total = milestones.length;
  const done = milestones.filter((m) => m.completed_at).length;
  const expected = milestones.filter((m) => m.due_date < today).length;
  const span = Math.max(1, daysBetween(start, end));
  const timeShare = today <= start ? 0 : Math.min(1, daysBetween(start, today) / span);
  const fraction = phase === 'done' ? 1 : total ? done / total : 0;
  const expectedFraction = total ? expected / total : timeShare;
  const label: PaceLabel = phase === 'active' && total ? paceLabel(done, expected) : 'none';
  const forecast = phase === 'done' ? { date: day(p.completed_at), ratePerWeek: null, reason: 'done' as const } : phase === 'active' ? forecastFinish(milestones, start, today) : { date: null, ratePerWeek: null, reason: 'too_early' as const };
  const remaining = total - done;
  const weeksLeft = daysBetween(today, end) / 7;
  const neededPerWeek = phase === 'active' && remaining > 0 && weeksLeft > 0 ? Math.round((remaining / weeksLeft) * 10) / 10 : null;
  const planned = p.baseline_end ?? p.target_date ?? null;
  const compare = forecast.date;
  const varianceDays = planned && compare ? daysBetween(planned, compare) : null;
  const finish = compare ?? (phase === 'active' && end < today ? today : null);
  let buffer: BufferState = 'none';
  if (deadline && finish && phase !== 'dropped') buffer = finish <= end ? 'ok' : finish <= deadline ? 'using' : 'over';
  else if (deadline) buffer = 'ok';
  const overdue = phase === 'active' && end < today && remaining !== 0;
  const waitingOn = phase === 'not_started' ? waitingFor(p, all) : [];
  let state: ProjectState = phase;
  if (phase === 'not_started' && waitingOn.length) state = 'waiting';
  if (phase === 'active') {
    const lateForecast = !!forecast.date && forecast.date > (deadline ?? end);
    if (label === 'behind' || lateForecast || overdue || forecast.reason === 'too_slow') state = 'at_risk';
  }
  return { phase, state, start, end, deadline, total, done, expected, fraction, expectedFraction, label, forecast, neededPerWeek, varianceDays, buffer, waitingOn, overdue };
}

/** Predecessors that haven't finished. A dropped predecessor no longer holds anything up. */
export function waitingFor(p: Goal, all: Goal[]): string[] {
  return (p.depends_on ?? []).filter((id) => {
    const pre = all.find((g) => g.id === id);
    return !!pre && !pre.completed_at && !pre.dropped_at && !pre.archived_at;
  });
}

/** Would "project depends on candidate" make a loop (candidate already waits on project, directly or not)? */
export function wouldCycle(projectId: string, candidateId: string, all: Goal[]): boolean {
  if (projectId === candidateId) return true;
  const seen = new Set<string>();
  const stack = [candidateId];
  while (stack.length) {
    const id = stack.pop()!;
    if (id === projectId) return true;
    if (seen.has(id)) continue;
    seen.add(id);
    for (const dep of all.find((g) => g.id === id)?.depends_on ?? []) stack.push(dep);
  }
  return false;
}

/** Projects that were waiting and can start now that `finishedId` is done. */
export function readyAfter(finishedId: string, all: Goal[]): Goal[] {
  return all.filter((g) => isProject(g) && !g.archived_at && projectPhase(g) === 'not_started' && (g.depends_on ?? []).includes(finishedId) && waitingFor(g, all).length === 0);
}

/**
 * When a predecessor is expected to end on or after a waiting project's planned start, suggest
 * moving the project (only when its start isn't fixed). Returns the new start and how far it moves.
 */
export function shiftSuggestion(p: Goal, predecessorEnds: ISODate[]): { start: ISODate; days: number } | null {
  if (projectPhase(p) !== 'not_started' || p.fixed_start || !p.start_date || !predecessorEnds.length) return null;
  const latest = [...predecessorEnds].sort().at(-1)!;
  if (latest < p.start_date) return null;
  const start = addDays(latest, 1);
  return { start, days: daysBetween(p.start_date, start) };
}

/** Move a project's flexible dates by `days`: start and target always, the deadline unless it's fixed. */
export function shiftedDates(p: Goal, days: number): Pick<Goal, 'start_date' | 'target_date' | 'deadline'> {
  const move = (d: ISODate | null | undefined) => (d ? addDays(d, days) : d ?? null);
  return { start_date: move(p.start_date), target_date: move(p.target_date), deadline: p.fixed_deadline ? p.deadline ?? null : move(p.deadline) };
}

export interface BurnupPoint {
  date: ISODate;
  /** Milestones done by this date (only up to today). */
  done: number | null;
  /** Milestones that existed by this date: scope grows when you add some. */
  scope: number;
}

/**
 * A burn-up: work done against total scope, week by week from the start to the later of the
 * target and today. Unlike a burn-down it shows scope growth honestly: the top line moves.
 */
export function burnup(milestones: Milestone[], start: ISODate, end: ISODate, today: ISODate): BurnupPoint[] {
  const last = end > today ? end : today;
  const dates: ISODate[] = [];
  const step = Math.max(7, Math.ceil(daysBetween(start, last) / 40 / 7) * 7);
  for (let d = start; d < last; d = addDays(d, step)) dates.push(d);
  dates.push(last);
  if (today > start && today < last && !dates.includes(today)) dates.push(today);
  dates.sort();
  const added = (m: Milestone) => {
    const c = day(m.created_at);
    return c && c > start ? c : start;
  };
  return dates.map((d) => ({
    date: d,
    done: d <= today ? milestones.filter((m) => day(m.completed_at) && day(m.completed_at)! <= d).length : null,
    scope: milestones.filter((m) => added(m) <= d).length,
  }));
}

export interface Rollup {
  /** Projects counted (not dropped). */
  count: number;
  done: number;
  active: number;
  atRisk: number;
  waiting: number;
  notStarted: number;
  /** Mean share done across projects, 0..1. */
  fraction: number;
  /** Mean share expected by now, 0..1. */
  expectedFraction: number;
  label: PaceLabel;
}

/**
 * A goal's progress from its projects: each project counts equally (no sizing), done counts as
 * all of it, and the goal's pace compares the average done with the average expected.
 */
export function rollup(stats: ProjectStats[], tooEarly = false): Rollup {
  const live = stats.filter((s) => s.phase !== 'dropped');
  const n = live.length;
  const count = (st: ProjectState) => live.filter((s) => s.state === st).length;
  const fraction = n ? live.reduce((a, s) => a + s.fraction, 0) / n : 0;
  const expectedFraction = n ? live.reduce((a, s) => a + s.expectedFraction, 0) / n : 0;
  return {
    count: n,
    done: count('done'),
    active: count('active'),
    atRisk: count('at_risk'),
    waiting: count('waiting'),
    notStarted: count('not_started'),
    fraction,
    expectedFraction,
    label: tooEarly || !n ? 'none' : paceLabel(fraction, expectedFraction),
  };
}

/** N milestones spread evenly from start to end: "Module 1" … "Module 7", the last one due on the end date. */
export function evenMilestones(base: string, n: number, start: ISODate, end: ISODate): { title: string; due_date: ISODate }[] {
  const count = Math.max(1, Math.min(60, Math.round(n)));
  const span = Math.max(count, daysBetween(start, end));
  const name = base.trim() || 'Step';
  return Array.from({ length: count }, (_, i) => ({
    title: `${name} ${i + 1}`,
    due_date: addDays(start, Math.round(((i + 1) * span) / count)),
  }));
}

/** Lessons from closed projects, newest first: what to carry into the next one. */
export function lessons(goals: Goal[]): { project: Goal; carry: string; worked: string; didnt: string; on: ISODate }[] {
  return goals
    .filter((g) => isProject(g) && g.closeout && (g.closeout.carry.trim() || g.closeout.worked.trim() || g.closeout.didnt.trim()))
    .map((g) => ({ project: g, carry: g.closeout!.carry.trim(), worked: g.closeout!.worked.trim(), didnt: g.closeout!.didnt.trim(), on: g.closeout!.closed_on }))
    .sort((a, b) => (a.on < b.on ? 1 : -1));
}

/** Benefits checks that are due: closed projects whose check-back date has come with no answer yet. */
export function benefitChecksDue(goals: Goal[], today: ISODate): Goal[] {
  return goals.filter((g) => isProject(g) && !g.archived_at && g.benefit_check_on && g.benefit_check_on <= today && g.benefit_question?.trim() && !g.benefit_result?.trim());
}

/** Lines of a multi-line field, trimmed, empty ones dropped (scope in/out, pre-mortem). */
export function lines(text: string | null | undefined): string[] {
  return (text ?? '')
    .split('\n')
    .map((l) => l.replace(/^[-*•]\s*/, '').trim())
    .filter(Boolean);
}
