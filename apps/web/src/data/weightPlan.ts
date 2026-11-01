import { daysBetween, type ISODate, type PlanStep } from '@six/core';

/**
 * The plan card of a weight goal: its levels (this week, this month, the 3-month checkpoint, the
 * season) in date order, each judged against the path and the 7-day average. Pure, so it can be tested.
 */

export type WeightLevelId = 'week' | 'month' | 'quarter' | 'season';

export interface WeightLevel {
  id: WeightLevelId;
  label: string;
  /** The day the level is due. */
  end: ISODate;
  /** The weight to be at by then; null when the level isn't set yet. */
  value: number | null;
  /** What you'll do over the level (the step's note, or the goal's "done means" for the season). */
  note: string;
  /** The saved plan step behind it (none for the season, or for a level not planned yet). */
  step: PlanStep | null;
}

export interface LevelStanding {
  /** Still to lose (or gain) from the 7-day average; 0 once the average is past it. */
  toGo: number;
  /** Weeks from today to the level's day (0 when it's today or past). */
  weeks: number;
  /** The weekly pace it asks for from here. */
  needs: number;
  /** Where the path is on the level's day. */
  path: number;
  /** The target against the path on that day: positive = ahead of it (in the goal's direction). */
  offPath: number;
  /** Faster than about 1% of body weight a week, the pace that starts to cost muscle. */
  steep: boolean;
}

const r1 = (v: number) => Math.round(v * 10) / 10;

/** Levels in date order; a level that lands on the same day as an earlier one keeps its place after it. */
export function orderLevels(levels: WeightLevel[]): WeightLevel[] {
  return levels.map((l, i) => ({ l, i })).sort((a, b) => (a.l.end < b.l.end ? -1 : a.l.end > b.l.end ? 1 : a.i - b.i)).map((x) => x.l);
}

export function levelStanding(level: WeightLevel, o: { trend: number; today: ISODate; direction: number; pathAt: (d: ISODate) => number; steadyHigh: number }): LevelStanding | null {
  if (level.value == null) return null;
  const toGo = Math.max(0, r1((level.value - o.trend) * o.direction));
  const days = Math.max(0, daysBetween(o.today, level.end));
  const weeks = days / 7;
  const needs = weeks > 0 ? r1(toGo / weeks) : 0;
  const path = r1(o.pathAt(level.end));
  const offPath = r1((level.value - path) * o.direction);
  return { toGo, weeks, needs, path, offPath, steep: needs > o.steadyHigh };
}

/** "in 3 weeks", "in 4 days", "ends today", "ended Oct 12". */
export function untilText(today: ISODate, end: ISODate, ended: (d: ISODate) => string): string {
  const days = daysBetween(today, end);
  if (days < 0) return `ended ${ended(end)}`;
  if (days === 0) return 'ends today';
  if (days < 14) return `in ${days} day${days === 1 ? '' : 's'}`;
  return `in ${Math.round(days / 7)} weeks`;
}

export interface TargetCheck {
  ok: boolean;
  text: string;
}

/**
 * Is a new target for level `index` in order? Each level must sit past the one before it (the start
 * for the first) and short of the one after, so the plan only goes one way.
 */
export function checkLevelTarget(levels: WeightLevel[], index: number, draft: string, o: { start: number; direction: number; trend: number; today: ISODate; unit: string; steadyHigh: number; fmt: (v: number) => string }): TargetCheck {
  const v = Number(draft);
  if (draft.trim() === '' || !Number.isFinite(v)) return { ok: false, text: 'Enter a weight.' };
  const level = levels[index]!;
  const before = levels.slice(0, index).reverse().find((l) => l.value != null);
  const after = levels.slice(index + 1).find((l) => l.value != null);
  const prev = before ? { v: before.value!, name: before.label.toLowerCase() } : { v: o.start, name: 'your start' };
  const past = (a: number, b: number) => (a - b) * o.direction > 0; // a is further along than b
  const u = o.unit ? ` ${o.unit}` : '';
  const word = o.direction < 0 ? ['under', 'over'] : ['over', 'under'];
  if (!past(v, prev.v) || (after && !past(after.value!, v))) {
    return { ok: false, text: `Keep it ${word[0]} ${o.fmt(prev.v)} (${prev.name})${after ? ` and ${word[1]} ${o.fmt(after.value!)} (${after.label.toLowerCase()})` : ''}, so the plan only goes one way.` };
  }
  const weeks = Math.max(0, daysBetween(o.today, level.end)) / 7;
  const need = weeks > 0 ? r1(Math.max(0, (v - o.trend) * o.direction) / weeks) : 0;
  const steep = need > o.steadyHigh;
  return { ok: true, text: `Fits: ${o.fmt(r1(Math.abs(prev.v - v)))}${u} after ${prev.name}${weeks > 0 ? `, needs ${o.fmt(need)}${u} a week from your 7-day average` : ''}${steep ? `. That’s faster than ${o.fmt(o.steadyHigh)}${u} a week, the pace that keeps muscle.` : '.'}` };
}

/** "All five workouts; weight and a photo every morning" → its parts, for the week's list. */
export function noteParts(note: string): string[] {
  return note
    .split(/;|\n/)
    .map((s) => s.trim().replace(/^[-•·]\s*/, ''))
    .filter(Boolean)
    .map((s) => s.charAt(0).toUpperCase() + s.slice(1));
}
