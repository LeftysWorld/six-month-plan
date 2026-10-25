import { addDays, daysBetween, isoWeekday, type ISODate } from './dates.ts';
import { scheduleForWeek, sessionCredit, sessionsPerWeek, countsAsPlanned } from './schedule.ts';
import type { Action, ActionSchedule, Session } from './types.ts';

export type SuggestionKind = 'lower_frequency' | 'add_minimum' | 'raise_frequency' | 'move_day' | 'pause';

export interface Suggestion {
  actionId: string;
  kind: SuggestionKind;
  /** Plain-language reason, e.g. "4 of 7 for 3 weeks running". */
  reason: string;
  /** For lower_frequency and raise_frequency: the proposed sessions per week. */
  proposedPerWeek?: number;
  /** For move_day: the ISO weekday (1 = Monday) that keeps getting missed, and where to move it. */
  fromDay?: number;
  toDay?: number;
}

export interface WeekResult {
  weekStart: ISODate;
  planned: number;
  credit: number;
}

/** Planned vs done for one action over recent weeks (oldest first). */
export function weeklyResults(
  actionId: string,
  sessions: Session[],
  lastMonday: ISODate,
  weeks: number,
): WeekResult[] {
  const out: WeekResult[] = [];
  for (let i = weeks - 1; i >= 0; i--) {
    const monday = addDays(lastMonday, -7 * i);
    const inWeek = sessions.filter(
      (s) => s.action_id === actionId && s.week_start === monday && countsAsPlanned(s),
    );
    out.push({
      weekStart: monday,
      planned: inWeek.length,
      credit: Math.round(inWeek.reduce((sum, s) => sum + sessionCredit(s), 0) * 10) / 10,
    });
  }
  return out;
}

export const WEEKDAY_LONG = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

export interface SuggestionOptions {
  /** Minutes available per weekday, Monday first; used to pick a better day. */
  availableMinutes?: number[];
  /** Planned sessions on or after this day haven't happened yet, so they don't count as short. */
  today?: ISODate;
}

/**
 * One review suggestion per action, most important first:
 * - Nothing done for 3 weeks running: pause it.
 * - Fixed days where one weekday keeps getting missed (2 of 3 or worse over 4 weeks)
 *   while the other days mostly happen: move that day.
 * - Under 75% two or more of the last three weeks, with more than one session a week:
 *   lower it to roughly what's actually being done.
 * - Under 75% last week and no minimum version yet: add one.
 * - Every session done (or more) for 3 weeks running: raise it by one.
 * Actions that are simply on track, and one-time tasks, get no suggestion.
 */
export function reviewSuggestions(
  actions: Action[],
  schedules: ActionSchedule[],
  sessions: Session[],
  reviewedMonday: ISODate,
  opts: SuggestionOptions = {},
): Suggestion[] {
  const out: Suggestion[] = [];
  const today = opts.today;
  if (today) {
    sessions = sessions.filter((s) => !(s.status === 'planned' && (s.date ? s.date >= today : addDays(s.week_start, 6) >= today)));
  }
  for (const action of actions) {
    if (action.archived_at) continue;
    const schedule = scheduleForWeek(schedules, action.id, reviewedMonday);
    const perWeek = sessionsPerWeek(schedule);
    if (!schedule || perWeek === 0) continue;
    // One-time tasks ("once", or anything scheduled for less than a week) get no suggestions.
    if (schedule.effective_to && daysBetween(schedule.effective_from, schedule.effective_to) < 6) continue;
    const all = weeklyResults(action.id, sessions, reviewedMonday, 3);
    const results = all.filter((w) => w.planned > 0);
    const last = results[results.length - 1];
    if (!last || all[all.length - 1]!.planned === 0) continue;

    // Pause: three full weeks planned, nothing done.
    if (results.length === 3 && results.every((w) => w.credit === 0)) {
      out.push({ actionId: action.id, kind: 'pause', reason: `Nothing logged for 3 weeks running` });
      continue;
    }

    // One weekday keeps getting missed: moving it beats lowering the whole task.
    const move = schedule.rule === 'days' ? missedWeekday(action.id, schedule, sessions, reviewedMonday, opts.availableMinutes) : null;
    if (move) {
      out.push({ actionId: action.id, kind: 'move_day', ...move });
      continue;
    }

    const short = results.filter((w) => w.credit / w.planned < 0.75);
    if (short.length >= 2 && perWeek > 1) {
      const avg = short.reduce((sum, w) => sum + w.credit, 0) / short.length;
      const proposed = Math.max(1, Math.min(perWeek - 1, Math.round(avg)));
      out.push({
        actionId: action.id,
        kind: 'lower_frequency',
        reason: `${formatCredit(last.credit)} of ${last.planned} last week; short ${short.length} of the last ${results.length} weeks`,
        proposedPerWeek: proposed,
      });
      continue;
    }

    if (last.credit / last.planned < 0.75 && !action.min_label) {
      out.push({
        actionId: action.id,
        kind: 'add_minimum',
        reason: `${formatCredit(last.credit)} of ${last.planned} last week`,
      });
      continue;
    }

    if (results.length === 3 && perWeek < 7 && results.every((w) => w.credit >= w.planned)) {
      const extra = sessions.filter(
        (s) => s.action_id === action.id && s.origin === 'unplanned' && results.some((w) => w.weekStart === s.week_start),
      ).length;
      out.push({
        actionId: action.id,
        kind: 'raise_frequency',
        reason: extra ? `Every one done for 3 weeks, plus ${extra} extra` : 'Every one done for 3 weeks running',
        proposedPerWeek: perWeek + 1,
      });
    }
  }
  return out;
}

/**
 * For a fixed-days task: a scheduled weekday missed at least 2 of 3 times over the last
 * 4 weeks (and at least 3 occurrences), while the other days were done 75%+ of the time.
 */
function missedWeekday(
  actionId: string,
  schedule: ActionSchedule,
  sessions: Session[],
  reviewedMonday: ISODate,
  availableMinutes?: number[],
): Pick<Suggestion, 'reason' | 'fromDay' | 'toDay'> | null {
  const from = addDays(reviewedMonday, -21);
  const to = addDays(reviewedMonday, 6);
  const dated = sessions.filter(
    (s) => s.action_id === actionId && s.origin === 'scheduled' && countsAsPlanned(s) && s.date && s.date >= from && s.date <= to,
  );
  let worst: { day: number; missed: number; total: number } | null = null;
  for (const day of [...new Set(schedule.days)]) {
    const onDay = dated.filter((s) => isoWeekday(s.date!) === day);
    const missed = onDay.filter((s) => sessionCredit(s) === 0).length;
    if (onDay.length >= 3 && missed / onDay.length >= 2 / 3 && (!worst || missed / onDay.length > worst.missed / worst.total)) {
      worst = { day, missed, total: onDay.length };
    }
  }
  if (!worst) return null;
  const others = dated.filter((s) => isoWeekday(s.date!) !== worst!.day);
  const otherRate = others.length ? others.reduce((sum, s) => sum + sessionCredit(s), 0) / others.length : 0;
  if (otherRate < 0.75) return null;
  const free = [1, 2, 3, 4, 5, 6, 7].filter((d) => !schedule.days.includes(d));
  if (!free.length) return null;
  const room = (d: number) => availableMinutes?.[d - 1] ?? 0;
  const toDay = [...free].sort((a, b) => room(b) - room(a) || Math.abs(a - worst!.day) - Math.abs(b - worst!.day) || a - b)[0]!;
  return {
    reason: `Missed ${worst.missed} of the last ${worst.total} ${WEEKDAY_LONG[worst.day - 1]}s; other days ${Math.round(otherRate * 100)}% done`,
    fromDay: worst.day,
    toDay,
  };
}

function formatCredit(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}
