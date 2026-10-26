import { addDays, daysBetween, isoWeekday, weekDates, type ISODate } from './dates.ts';
import type { Action, ActionSchedule, Session } from './types.ts';

/** The schedule row in force for an action at any point during the week starting `monday`. */
export function scheduleForWeek(
  schedules: ActionSchedule[],
  actionId: string,
  monday: ISODate,
): ActionSchedule | null {
  const sunday = addDays(monday, 6);
  const candidates = schedules
    .filter(
      (s) =>
        s.action_id === actionId &&
        s.effective_from <= sunday &&
        (s.effective_to == null || s.effective_to >= monday),
    )
    .sort((a, b) => (a.effective_from < b.effective_from ? 1 : -1));
  return candidates[0] ?? null;
}

/** The schedule row in force on a single date. */
export function scheduleOn(
  schedules: ActionSchedule[],
  actionId: string,
  date: ISODate,
): ActionSchedule | null {
  return (
    schedules
      .filter(
        (s) =>
          s.action_id === actionId &&
          s.effective_from <= date &&
          (s.effective_to == null || s.effective_to >= date),
      )
      .sort((a, b) => (a.effective_from < b.effective_from ? 1 : -1))[0] ?? null
  );
}

export interface PlannedSlot {
  action_id: string;
  week_start: ISODate;
  slot: number;
  date: ISODate | null;
}

/**
 * The slots an action should have in a week.
 * - Fixed days: one dated slot per scheduled weekday inside the schedule's dates.
 * - N per week: N undated slots (the "not placed yet" tray). A schedule that starts
 *   mid-week gets a share of N for the days left, rounded up.
 */
export function slotsForWeek(schedule: ActionSchedule, monday: ISODate): PlannedSlot[] {
  const dates = weekDates(monday).filter(
    (d) => d >= schedule.effective_from && (schedule.effective_to == null || d <= schedule.effective_to),
  );
  if (dates.length === 0) return [];
  // A schedule that starts mid-week (an edit) numbers its slots apart from the
  // sessions the previous schedule already created that week, so none collide.
  const offset = schedule.effective_from > monday ? isoWeekday(schedule.effective_from) * 20 : 0;
  if (schedule.rule === 'days') {
    const days = [...new Set(schedule.days)].sort((a, b) => a - b);
    return days
      .map((day) => addDays(monday, day - 1))
      .filter((date) => dates.includes(date))
      .map((date, slot) => ({ action_id: schedule.action_id, week_start: monday, slot: slot + offset, date }));
  }
  const perWeek = schedule.per_week ?? 0;
  const count = dates.length === 7 ? perWeek : Math.ceil((perWeek * dates.length) / 7);
  return Array.from({ length: count }, (_, slot) => ({
    action_id: schedule.action_id,
    week_start: monday,
    slot: slot + offset,
    date: null,
  }));
}

/** A fresh planned session for a slot. */
export function sessionFromSlot(action: Action, slot: PlannedSlot, id: string): Session {
  return {
    id,
    action_id: action.id,
    week_start: slot.week_start,
    slot: slot.slot,
    date: slot.date,
    title: action.title,
    priority: action.priority,
    planned_minutes: action.planned_minutes,
    planned_count: action.planned_count,
    status: 'planned',
    actual_minutes: null,
    actual_count: null,
    note: '',
    obstacles: [],
    origin: 'scheduled',
    source: 'manual',
    moved_from: null,
    logged_at: null,
  };
}

/**
 * Sessions that are missing for a week, given the scheduled sessions that already
 * exist. Existing slots are never touched, so running this twice is harmless.
 *
 * A slot number is only a key. When a slot's number is already taken by a session on a
 * different day (the previous version of a schedule made it), the new session takes the
 * next free number instead of being dropped.
 */
export function missingSessionsForWeek(
  actions: Action[],
  schedules: ActionSchedule[],
  existing: Session[],
  monday: ISODate,
  makeId: () => string,
): Session[] {
  const mine = existing.filter((s) => s.origin === 'scheduled' && s.action_id && s.week_start === monday);
  const bySlot = new Map(mine.map((s) => [`${s.action_id}:${s.slot}`, s]));
  const out: Session[] = [];
  for (const action of actions) {
    if (action.archived_at) continue;
    const schedule = scheduleForWeek(schedules, action.id, monday);
    if (!schedule) continue;
    const used = new Set(mine.filter((s) => s.action_id === action.id).map((s) => s.slot));
    const datesHad = new Set(mine.filter((s) => s.action_id === action.id && s.date).map((s) => s.date));
    for (const slot of slotsForWeek(schedule, monday)) {
      const taken = bySlot.get(`${action.id}:${slot.slot}`);
      if (taken && (!slot.date || taken.date === slot.date)) continue;
      // A dated slot already covered by a session on that day (under another number) is not missing.
      if (slot.date && datesHad.has(slot.date)) continue;
      let number = slot.slot;
      while (used.has(number)) number += 1;
      used.add(number);
      out.push(sessionFromSlot(action, { ...slot, slot: number }, makeId()));
    }
  }
  return out;
}

/**
 * How much a session counts toward pace: done and minimum-kept count 1,
 * partial counts actual ÷ planned (capped at 1), everything else 0.
 */
export function sessionCredit(session: Session): number {
  switch (session.status) {
    case 'done':
    case 'minimum':
      return 1;
    case 'partial': {
      if (session.planned_count && session.actual_count != null) {
        return clamp01(session.actual_count / session.planned_count);
      }
      if (session.planned_minutes > 0 && session.actual_minutes != null) {
        return clamp01(session.actual_minutes / session.planned_minutes);
      }
      return 0.5;
    }
    default:
      return 0;
  }
}

/** Sessions that still count as planned work (moved sessions are replaced by their copy). */
export function countsAsPlanned(session: Session): boolean {
  return session.status !== 'moved';
}

/** True when a session has been logged in any way. */
export function isLogged(session: Session): boolean {
  return session.status !== 'planned';
}

/** Minutes planned on each date (only dated, unlogged-or-logged sessions that still count). */
export function plannedMinutesByDate(sessions: Session[], dates: ISODate[]): Record<ISODate, number> {
  const out: Record<ISODate, number> = Object.fromEntries(dates.map((d) => [d, 0]));
  for (const s of sessions) {
    if (!s.date || !(s.date in out) || !countsAsPlanned(s)) continue;
    out[s.date] = (out[s.date] ?? 0) + s.planned_minutes;
  }
  return out;
}

/** Minutes still to do today: planned minutes of sessions not yet logged. */
export function minutesLeft(sessions: Session[]): number {
  return sessions
    .filter((s) => s.status === 'planned')
    .reduce((sum, s) => sum + s.planned_minutes, 0);
}

/** Describe a schedule in plain words: "Mon, Wed, Fri" or "5× a week". */
export function describeSchedule(schedule: ActionSchedule | null): string {
  if (!schedule) return 'Not scheduled';
  if (schedule.rule === 'per_week') return `${schedule.per_week ?? 0}× a week`;
  const names = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const days = [...schedule.days].sort((a, b) => a - b);
  if (days.length === 7) return 'Every day';
  return days.map((d) => names[d - 1]).join(', ');
}

/** Sessions scheduled per week by a schedule (for capacity and suggestions). */
export function sessionsPerWeek(schedule: ActionSchedule | null): number {
  if (!schedule) return 0;
  return schedule.rule === 'per_week' ? schedule.per_week ?? 0 : new Set(schedule.days).size;
}

export function weeksBetween(a: ISODate, b: ISODate): number {
  return Math.floor(daysBetween(a, b) / 7);
}

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}
