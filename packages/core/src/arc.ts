import { daysBetween, type ISODate } from './dates.ts';
import { planTotalDays, planWeekNumber } from './plan.ts';
import type { Plan } from './types.ts';

/**
 * Where today sits in a season, and what that part of a season asks of you. A to-do list is the
 * same on day 1 and day 100; a season isn't. Week 1 says "just show up"; the middle says "this is
 * where people quit"; the last two weeks say "finish, don't start."
 */
export type ArcPhase = 'before' | 'start' | 'build' | 'middle' | 'push' | 'finish' | 'after';

export interface SeasonArc {
  phase: ArcPhase;
  /** 1-based week, clamped to the season. */
  week: number;
  weeks: number;
  /** Days left including today (0 after the end). */
  daysLeft: number;
  /** 0..1 of the season elapsed. */
  elapsed: number;
  /** One line for Today, in the voice of a coach who read the plan. */
  line: string;
}

export function seasonArc(plan: Plan, today: ISODate): SeasonArc {
  const total = planTotalDays(plan);
  const weeks = Math.max(1, Math.ceil(total / 7));
  const dayIdx = daysBetween(plan.start_date, today); // 0 on the first day
  const elapsed = Math.max(0, Math.min(1, (dayIdx + 1) / total));
  const daysLeft = Math.max(0, daysBetween(today, plan.end_date) + 1);
  const week = Math.max(1, Math.min(weeks, planWeekNumber(plan, today)));
  let phase: ArcPhase;
  if (today < plan.start_date) phase = 'before';
  else if (today > plan.end_date) phase = 'after';
  else if (week <= 2) phase = 'start';
  else if (daysLeft <= 14) phase = 'finish';
  else if (elapsed < 0.3) phase = 'build';
  else if (elapsed < 0.65) phase = 'middle';
  else phase = 'push';
  const lines: Record<ArcPhase, string> = {
    before: `Starts in ${Math.max(1, daysBetween(today, plan.start_date))} day${daysBetween(today, plan.start_date) === 1 ? '' : 's'}. Set the dates and the prizes now; the first week is for showing up.`,
    start: week === 1 ? 'Week 1. Nothing to prove yet: just show up and log it. The streak starts here.' : 'Week 2. Still early. Make the tasks small enough that a bad day can’t stop them.',
    build: 'The habits are forming. Protect the mornings; the plan only works if the days do.',
    middle: 'The middle. This is where most people quit. Read your why, do the next task, that’s all.',
    push: `${Math.ceil(daysLeft / 7)} weeks left. Pace matters now: check the path, move what has to move, and don’t start anything new.`,
    finish: daysLeft <= 7 ? 'Last week. Finish, don’t start. Then vs now is waiting.' : 'Two weeks left. Finish, don’t start. Close the dates you can and let the rest go to next season.',
    after: 'The season is over. Do the retrospective and start the next one from what this one taught you.',
  };
  return { phase, week, weeks, daysLeft, elapsed, line: lines[phase] };
}

export type ChapterPhase = Exclude<ArcPhase, 'before' | 'after'>;

export interface Chapter {
  phase: ChapterPhase;
  name: string;
  start: ISODate;
  end: ISODate;
}

/**
 * The season as five stretches, with the same boundaries seasonArc uses to pick a phase:
 * Start (the first two weeks), Build (to 30% of the way), Middle (to 65%), Push, Finish (the last
 * two weeks). Every day of the season is in exactly one chapter.
 */
export function seasonChapters(plan: Plan): Chapter[] {
  const total = planTotalDays(plan);
  const s = plan.start_date;
  const e = plan.end_date;
  const add = (d: ISODate, n: number) => new Date(Date.parse(d) + n * 86400000).toISOString().slice(0, 10);
  // seasonArc: start = week <= 2; build = elapsed < 0.3; middle = elapsed < 0.65; finish = daysLeft <= 14.
  const startEnd = add(s, 13);
  const buildEnd = add(s, Math.ceil(0.3 * total) - 2);
  const middleEnd = add(s, Math.ceil(0.65 * total) - 2);
  const finishStart = add(e, -13);
  const clampTo = (d: ISODate, lo: ISODate, hi: ISODate) => (d < lo ? lo : d > hi ? hi : d);
  const b0 = clampTo(startEnd, s, e);
  const b1 = clampTo(buildEnd, b0, e);
  const b2 = clampTo(middleEnd, b1, e);
  const b3 = clampTo(add(finishStart, -1), b2, e);
  return [
    { phase: 'start', name: 'Start', start: s, end: b0 },
    { phase: 'build', name: 'Build', start: add(b0, 1), end: b1 },
    { phase: 'middle', name: 'Middle', start: add(b1, 1), end: b2 },
    { phase: 'push', name: 'Push', start: add(b2, 1), end: b3 },
    { phase: 'finish', name: 'Finish', start: add(b3, 1), end: e },
  ].filter((c) => c.start <= c.end) as Chapter[];
}

/** The chapter a date falls in (null outside the season). */
export function chapterAt(plan: Plan, date: ISODate): Chapter | null {
  return seasonChapters(plan).find((c) => date >= c.start && date <= c.end) ?? null;
}
