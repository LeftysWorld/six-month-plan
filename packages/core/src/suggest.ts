import { addDays, type ISODate } from './dates.ts';
import { scheduleForWeek, sessionCredit, sessionsPerWeek, countsAsPlanned } from './schedule.ts';
import type { Action, ActionSchedule, Session } from './types.ts';

export type SuggestionKind = 'lower_frequency' | 'add_minimum';

export interface Suggestion {
  actionId: string;
  kind: SuggestionKind;
  /** Plain-language reason, e.g. "4 of 7 for 3 weeks running". */
  reason: string;
  /** For lower_frequency: the proposed sessions per week. */
  proposedPerWeek?: number;
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

/**
 * Review suggestions for actions that keep falling short.
 * - Under 75% two or more of the last three weeks, with more than one session a week:
 *   suggest lowering to roughly what's actually being done.
 * - Under 75% last week and no minimum version yet: suggest adding one.
 * Actions on track get no suggestion.
 */
export function reviewSuggestions(
  actions: Action[],
  schedules: ActionSchedule[],
  sessions: Session[],
  reviewedMonday: ISODate,
): Suggestion[] {
  const out: Suggestion[] = [];
  for (const action of actions) {
    if (action.archived_at) continue;
    const schedule = scheduleForWeek(schedules, action.id, reviewedMonday);
    const perWeek = sessionsPerWeek(schedule);
    if (!schedule || perWeek === 0) continue;
    const results = weeklyResults(action.id, sessions, reviewedMonday, 3).filter((w) => w.planned > 0);
    const last = results[results.length - 1];
    if (!last) continue;
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
    }
  }
  return out;
}

function formatCredit(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}
