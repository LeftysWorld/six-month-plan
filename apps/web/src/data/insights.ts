import {
  addDays,
  commitmentStats,
  obstacleCounts,
  weekStart,
  weekdayPattern,
  weeklyTrend,
  WEEKDAY_LONG,
  type DateRange,
  type ISODate,
  type WeekPoint,
} from '@six/core';
import type { AppData } from './model.ts';
import { minutesText } from './derive.ts';

/** Patterns across recent weeks, written as short plain sentences for the review hub and the review. */

export function actionLookup(data: AppData) {
  const byId = new Map(data.actions.map((a) => [a.id, a]));
  return (id: string | null) => (id ? byId.get(id) ?? null : null);
}

/** The last `weeks` weeks ending with the week starting `lastMonday`. */
export function trendFor(data: AppData, lastMonday: ISODate, weeks: number, today: ISODate): WeekPoint[] {
  return weeklyTrend(data.sessions, lastMonday, weeks, today, actionLookup(data));
}

/** Average minutes done and planned per week over the weeks that had anything planned. */
export function timeAverages(points: WeekPoint[]): { done: number; planned: number; weeks: number } | null {
  const used = points.filter((p) => p.planned > 0);
  if (!used.length) return null;
  const done = Math.round(used.reduce((s, p) => s + p.minutesDone, 0) / used.length);
  const planned = Math.round(used.reduce((s, p) => s + p.minutesPlanned, 0) / used.length);
  return { done, planned, weeks: used.length };
}

export function timeSentence(points: WeekPoint[]): string | null {
  const t = timeAverages(points);
  if (!t || t.planned === 0) return null;
  return `Last ${t.weeks} week${t.weeks === 1 ? '' : 's'}: about ${minutesText(roundTo5(t.done))} done a week, of ${minutesText(roundTo5(t.planned))} planned.`;
}

export function obstacleSentence(data: AppData, range: DateRange): string | null {
  const top = obstacleCounts(data.sessions, range)[0];
  if (!top || top.count < 2) return null;
  const weeks = Math.max(1, Math.round((Date.parse(range.end) - Date.parse(range.start)) / (7 * 864e5)));
  return `${top.name} got in the way ${top.count} times in the last ${weeks} week${weeks === 1 ? '' : 's'}.`;
}

export function weekdaySentence(data: AppData, range: DateRange, today: ISODate): string | null {
  const p = weekdayPattern(data.sessions, range, today);
  if (!p) return null;
  return `${p.misses} of your ${p.total} misses landed on a ${WEEKDAY_LONG[p.weekday - 1]}. Moving a task off that day may help more than doing less.`;
}

export function commitmentSentence(data: AppData): string | null {
  const s = commitmentStats(data.reviews);
  if (s.answered < 2) return null;
  return `Your planned changes stuck ${s.kept} of ${s.answered} times${s.partly ? ` (${s.partly} more partly)` : ''}.`;
}

/** The hub's insight lines: time, biggest obstacle, weekday pattern, changes that stuck. */
export function hubInsights(data: AppData, today: ISODate): { trend: WeekPoint[]; lines: string[] } {
  const lastMonday = addDays(weekStart(today), -7);
  const trend = trendFor(data, lastMonday, 8, today);
  const fourWeeks: DateRange = { start: addDays(lastMonday, -21), end: addDays(lastMonday, 6) };
  const lines = [
    timeSentence(trend.slice(-4)),
    obstacleSentence(data, fourWeeks),
    weekdaySentence(data, fourWeeks, today),
    commitmentSentence(data),
  ].filter((x): x is string => !!x);
  return { trend, lines };
}

function roundTo5(min: number): number {
  return Math.round(min / 5) * 5;
}
