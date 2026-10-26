import { addDays, daysBetween, isoWeekday, progressFor, quarterRange, shortDate, type Goal, type ISODate, type PaceLabel, type Plan } from '@six/core';
import { fmt, type View } from './derive.ts';

/**
 * Seasons: the Goals page shows two six-month windows on one horizon. "This season" is the batch
 * running today; "next season" is the batch after it (or a placeholder to plan one). Goals on
 * their own clock show in the season they run in.
 */

export interface Seasons {
  current: Plan | null;
  next: Plan | null;
}

export function seasonsOf(view: View): Seasons {
  const today = view.today;
  const batches = view.batches;
  const current = batches.find((p) => p.start_date <= today && p.end_date >= today) ?? batches[0] ?? null;
  const next = current ? batches.filter((p) => p.id !== current.id && p.start_date > current.start_date).sort((a, b) => (a.start_date < b.start_date ? -1 : 1))[0] ?? null : null;
  return { current, next };
}

/** Where a season would start and end if planned now: the day after this one, for six months. */
export function nextSeasonDates(current: Plan): { start: ISODate; end: ISODate } {
  const start = addDays(current.end_date, 1);
  return { start, end: addDays(start, 182) };
}

/** The first 3-month checkpoint still ahead in a window (or its end). */
export function nextCheckpoint(plan: Plan, today: ISODate): ISODate {
  const first = quarterRange(plan, plan.start_date).end;
  if (first >= today) return first;
  const now = quarterRange(plan, today).end;
  return now >= today ? now : plan.end_date;
}

/** The first 3-month checkpoint of a window (for the horizon's diamonds). */
export function firstCheckpoint(plan: Plan): ISODate {
  return quarterRange(plan, plan.start_date).end;
}

/** The weekly review opens on Saturday: "Today", "Tomorrow" or "Saturday". */
export function nextReviewWord(today: ISODate): string {
  const d = isoWeekday(today);
  return d === 6 ? 'Today' : d === 5 ? 'Tomorrow' : d === 7 ? 'Today' : 'Saturday';
}

export interface Track {
  /** Share of the goal done, 0..100. */
  prog: number;
  /** Where an even pace would put it today, 0..100. */
  exp: number;
  /** Where it stands, in words ("209.6 lb", "14 done", "2 of 5 milestones"). */
  now: string;
  /** What done is, in words ("195 lb", "3 songs recorded"). */
  target: string;
  /** When it's due. */
  by: ISODate;
  label: PaceLabel;
  /** One short status word or phrase for the row. */
  status: string;
  started: boolean;
}

const clamp = (n: number) => Math.max(0, Math.min(100, Math.round(n)));

/** A goal's progress across its whole window, against even pace, for the season rows. */
export function goalTrack(view: View, goal: Goal, plan: Plan): Track {
  const today = view.today;
  const by = goal.target_date && goal.target_date <= plan.end_date ? goal.target_date : plan.end_date;
  const started = plan.start_date <= today;
  const span = Math.max(1, daysBetween(plan.start_date, by));
  const timeShare = started ? clamp((daysBetween(plan.start_date, today) / span) * 100) : 0;
  const pace = started ? view.goalPace(goal, plan) : null;
  const label: PaceLabel = pace?.label ?? 'none';
  const target = goal.type === 'number' && goal.target_value != null ? `${fmt(goal.target_value)} ${goal.unit ?? ''}`.trim() : goal.done_means.trim() || goal.title;
  const word = (fallback: string) => (!started ? 'Planned' : label === 'ahead' ? 'Ahead' : label === 'behind' ? 'Behind' : label === 'on_track' ? 'On pace' : fallback);

  // A goal with projects: the average share done across its projects, against where their
  // milestones (or time) say it should be.
  const roll = view.rollupFor(goal, plan);
  if (roll) {
    const status = !started ? 'Planned' : roll.atRisk ? `${roll.atRisk} at risk` : word('Too early');
    return { prog: clamp(roll.fraction * 100), exp: started ? clamp(roll.expectedFraction * 100) : 0, now: `${roll.done} of ${roll.count} project${roll.count === 1 ? '' : 's'} done`, target, by, label: roll.label, status, started };
  }
  if (goal.type === 'number') {
    const n = pace?.number;
    const start = n?.start.value ?? goal.baseline_value;
    const latest = n?.latest ?? null;
    const t = goal.target_value;
    const whole = start != null && t != null ? t - start : 0;
    const prog = whole && latest != null && start != null ? clamp(((latest - start) / whole) * 100) : 0;
    // With a saved path, even pace is the path's value today; without one, a straight line.
    const hasPath = view.pathFor(goal).length > 0;
    const exp = whole && n && start != null && hasPath ? clamp(((n.pathToday - start) / whole) * 100) : timeShare;
    const units = hasPath ? n?.aheadBy ?? null : whole && latest != null && start != null ? (latest - (start + (whole * timeShare) / 100)) * Math.sign(whole) : null;
    const ahead = units != null && Math.abs(units) >= 0.05 ? `${fmt(Math.abs(units))} ${goal.unit ?? ''} ${units > 0 ? 'ahead' : 'behind'}`.replace(/\s+/g, ' ') : null;
    return { prog, exp, now: latest != null ? `${fmt(latest)} ${goal.unit ?? ''}`.trim() : 'No readings yet', target, by, label, status: started && ahead ? ahead : word('Too early'), started };
  }
  if (goal.type === 'finish') {
    const ms = view.data.milestones.filter((m) => m.goal_id === goal.id);
    const done = ms.filter((m) => m.completed_at).length;
    return { prog: ms.length ? clamp((done / ms.length) * 100) : 0, exp: timeShare, now: ms.length ? `${done} of ${ms.length} milestones` : 'No milestones yet', target, by, label, status: word(ms.length ? 'Too early' : 'No milestones'), started };
  }
  // Task-based goals: sessions done against everything planned in the window (weeks not generated
  // yet are projected from the schedules).
  const range = { start: plan.start_date, end: by };
  const actionIds = new Set(view.data.actionGoals.filter((ag) => ag.goal_id === goal.id).map((ag) => ag.action_id));
  const sessions = view.projectedSessions(range).filter((s) => s.action_id && actionIds.has(s.action_id));
  const p = progressFor(sessions, range, { today, dayFraction: 0 });
  const prog = p.planned ? clamp((p.actual / p.planned) * 100) : 0;
  const exp = p.planned ? clamp((p.expected / p.planned) * 100) : timeShare;
  const behindBy = started && p.expected - p.actual >= 1 ? Math.round(p.expected - p.actual) : 0;
  return {
    prog,
    exp,
    now: p.planned ? `${fmt(p.actual, 0)} of ${fmt(p.planned, 0)} done` : 'No tasks yet',
    target,
    by,
    label,
    status: label === 'behind' && behindBy ? `${behindBy} behind` : word(p.planned ? 'Too early' : 'No tasks'),
    started,
  };
}

export const dateWord = (d: ISODate) => shortDate(d);
