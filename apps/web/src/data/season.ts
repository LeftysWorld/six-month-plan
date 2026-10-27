import { addDays, daysBetween, isoWeekday, paceLabel, progressFor, quarterRange, shortDate, type Goal, type ISODate, type PaceLabel, type Plan } from '@six/core';
import { fmt, type View } from './derive.ts';
import { headlineTally, tallyUnit } from './tally.ts';

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

/** The weekly review opens on Saturday: "Today", "Tomorrow", "Saturday", or "Done" once this week's is saved. */
export function nextReviewWord(today: ISODate, done = false): string {
  const d = isoWeekday(today);
  if (done && d >= 6) return 'Done';
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
  // A goal runs from its own start to its finish date.
  const from = view.startFor(goal, plan);
  const by = view.endFor(goal, plan);
  const started = from <= today;
  const span = Math.max(1, daysBetween(from, by));
  const timeShare = started ? clamp((daysBetween(from, today) / span) * 100) : 0;
  const pace = started ? view.goalPace(goal, plan) : null;
  const label: PaceLabel = pace?.label ?? 'none';
  const target = goal.type === 'number' && goal.target_value != null ? `${fmt(goal.target_value)} ${goal.unit ?? ''}`.trim() : goal.done_means.trim() || goal.title;
  const word = (fallback: string) => (!started ? (from > today ? `Starts ${shortDate(from)}` : 'Planned') : label === 'ahead' ? 'Ahead' : label === 'behind' ? 'Behind' : label === 'on_track' ? 'On pace' : fallback);

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
  // A goal with a running total ("250 applications") is summed up by the total, not by milestones ticked.
  const tally = headlineTally(view, goal.id, today);
  if (tally && started) {
    const { m, t } = tally;
    const unit = tallyUnit(m);
    const status = t.reached ? 'Done' : t.label === 'none' ? word('Too early') : `${t.left} to go${t.perDay && t.perDay > 0 ? ` · ${t.perDay}/day` : ''}`;
    return { prog: clamp(t.share * 100), exp: clamp((t.expected / Math.max(1, t.target)) * 100), now: `${t.total} of ${t.target}${unit ? ` ${unit}` : ''}`, target: m.title, by: m.due_date > by ? by : m.due_date, label: t.reached ? 'ahead' : t.label, status, started };
  }
  if (goal.type === 'finish') {
    const ms = view.data.milestones.filter((m) => m.goal_id === goal.id);
    const done = ms.filter((m) => m.completed_at).length;
    return { prog: ms.length ? clamp((done / ms.length) * 100) : 0, exp: timeShare, now: ms.length ? `${done} of ${ms.length} milestones` : 'No milestones yet', target, by, label, status: word(ms.length ? 'Too early' : 'No milestones'), started };
  }
  // Task-based goals: sessions done against everything planned in the window (weeks not generated
  // yet are projected from the schedules).
  const range = { start: from, end: by };
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

export interface GroupTrack {
  /** Goals in the group (not archived), finished ones included. */
  count: number;
  done: number;
  /** Average share done across the group's goals, 0..100 (finished goals count as 100). */
  prog: number;
  /** Average share an even pace would have by now, 0..100. */
  exp: number;
  label: PaceLabel;
  /** The latest date any of its goals is due. */
  by: ISODate | null;
}

/**
 * A group's roll-up: one bar for everything its goals add up to. Each goal counts equally;
 * a finished goal counts as all of it, and a goal waiting on another counts as not started.
 */
/**
 * A group's pace in one sentence: "AI is on pace." / "Body is behind, mostly the splits (2 weeks)." /
 * "AI: two of four done, the rest on pace."
 */
export function groupSentence(view: View, group: { id: string; name: string }): string {
  const goals = view.data.goals.filter((g) => g.group_id === group.id && !g.archived_at);
  const running = goals.filter((g) => !g.completed_at);
  const done = goals.length - running.length;
  const tracks = running.map((g) => ({ g, t: view.planForGoal(g) ? goalTrack(view, g, view.planForGoal(g)!) : null })).filter((x) => x.t && x.t.started) as { g: Goal; t: Track }[];
  const behind = tracks.filter((x) => x.t.label === 'behind');
  const ahead = tracks.filter((x) => x.t.label === 'ahead');
  const doneText = done ? `${done} of ${goals.length} done` : '';
  if (running.length === 0 && goals.length) return `${group.name}: all ${goals.length} done.`;
  if (tracks.length === 0) return `${group.name}: ${doneText || 'not started yet'}.`;
  if (behind.length === 0) return `${group.name} is ${ahead.length === tracks.length ? 'ahead' : 'on pace'}${doneText ? `, ${doneText}` : ''}.`;
  const worst = behind.sort((a, b) => a.t.prog - a.t.exp - (b.t.prog - b.t.exp))[0]!;
  const mostly = behind.length < tracks.length ? `, mostly ${worst.g.title}${worst.t.status && /behind/.test(worst.t.status) ? ` (${worst.t.status})` : ''}` : '';
  return `${group.name} is behind${mostly}${doneText ? `; ${doneText}` : ''}.`;
}

export function groupTrack(view: View, groupId: string): GroupTrack {
  const goals = view.data.goals.filter((g) => g.group_id === groupId && !g.archived_at);
  let prog = 0;
  let exp = 0;
  let done = 0;
  let by: ISODate | null = null;
  let anyStarted = false;
  for (const g of goals) {
    if (g.completed_at) {
      done += 1;
      prog += 100;
      exp += 100;
      continue;
    }
    const plan = view.planForGoal(g);
    if (!plan) continue;
    const t = goalTrack(view, g, plan);
    prog += t.prog;
    exp += t.exp;
    if (t.started) anyStarted = true;
    if (!by || t.by > by) by = t.by;
  }
  const n = goals.length || 1;
  const avgProg = clamp(prog / n);
  const avgExp = clamp(exp / n);
  return { count: goals.length, done, prog: avgProg, exp: avgExp, label: anyStarted ? paceLabel(avgProg, avgExp) : 'none', by };
}

export type DayDot = 'done' | 'part' | 'missed' | 'due' | 'none';

/**
 * The last seven days of a goal's tasks, oldest first, as one dot each: done, partly done, missed
 * (planned, day over, nothing logged), due (today, still open) or nothing planned. The thing on a
 * goal's row that changes every day.
 */
export function weekDots(view: View, goalId: string, days = 7): { date: ISODate; state: DayDot }[] {
  const today = view.today;
  const actionIds = new Set(view.data.actionGoals.filter((ag) => ag.goal_id === goalId).map((ag) => ag.action_id));
  const out: { date: ISODate; state: DayDot }[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const date = addDays(today, -i);
    const on = view.data.sessions.filter((s) => s.action_id && actionIds.has(s.action_id) && s.date === date && s.status !== 'moved');
    let state: DayDot = 'none';
    if (on.some((s) => s.status === 'done')) state = 'done';
    else if (on.some((s) => s.status === 'partial' || s.status === 'minimum')) state = 'part';
    else if (on.some((s) => s.status === 'planned')) state = date < today ? 'missed' : 'due';
    else if (on.some((s) => s.status === 'skipped')) state = 'missed';
    out.push({ date, state });
  }
  return out;
}

/** The next open date on a goal ("Mock interview · Nov 3"), soonest first, or null. */
export function nextDue(view: View, goalId: string): { title: string; date: ISODate; late: boolean } | null {
  const m = view.data.milestones
    .filter((x) => x.goal_id === goalId && !x.completed_at)
    .sort((a, b) => (a.due_date < b.due_date ? -1 : 1))[0];
  return m ? { title: m.title, date: m.due_date, late: m.due_date < view.today } : null;
}
