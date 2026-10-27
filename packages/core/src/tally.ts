import { daysBetween, type ISODate } from './dates.ts';
import { paceLabel } from './pace.ts';
import type { Milestone, PaceLabel, Session } from './types.ts';

/**
 * Tallies: a milestone that is a running total of a count task ("250 applications by Dec 15,
 * counted from 'Apply to 25 jobs'"). Every log of the task adds its count; the date ticks itself
 * off when the total reaches the target.
 */

/** Is this milestone a running total of a task's counts? */
export function isTally(m: Pick<Milestone, 'value' | 'count_action_id'>): boolean {
  return m.count_action_id != null && m.value != null && m.value > 0;
}

/** What a logged session adds to a tally: the count logged, or the planned count when it was simply ticked done. */
export function sessionCount(s: Pick<Session, 'status' | 'actual_count' | 'planned_count'>): number {
  if (s.status === 'planned' || s.status === 'moved' || s.status === 'skipped') return 0;
  if (s.actual_count != null) return Number(s.actual_count);
  return s.status === 'done' ? Number(s.planned_count ?? 0) : 0;
}

/** The total a task has logged on or before `through` (every day when omitted). */
export function tallyOf(sessions: Session[], actionId: string, through?: ISODate): number {
  let total = 0;
  for (const s of sessions) {
    if (s.action_id !== actionId) continue;
    if (through && s.date && s.date > through) continue;
    total += sessionCount(s);
  }
  return total;
}

/** The day a running total first reached `target`, or null if it hasn't. */
export function tallyReachedOn(sessions: Session[], actionId: string, target: number): ISODate | null {
  const dated = sessions.filter((s) => s.action_id === actionId && s.date && sessionCount(s) > 0).sort((a, b) => (a.date! < b.date! ? -1 : 1));
  let total = 0;
  for (const s of dated) {
    total += sessionCount(s);
    if (total >= target) return s.date!;
  }
  return null;
}

export interface TallyStatus {
  total: number;
  target: number;
  left: number;
  /** 0–1, capped at 1. */
  share: number;
  daysLeft: number;
  /** What the total should be by today if the count were spread evenly from `start` to the due date. */
  expected: number;
  /** What's needed per remaining day to land on time (null once there is no day left). */
  perDay: number | null;
  label: PaceLabel;
  reached: boolean;
}

/** Where a tally stands today. `start` is the day counting began (the goal's start, or the task's first day). */
export function tallyStatus(m: Pick<Milestone, 'value' | 'due_date'>, total: number, start: ISODate, today: ISODate, tooEarly = false): TallyStatus {
  const target = Number(m.value ?? 0);
  const left = Math.max(0, target - total);
  const span = Math.max(1, daysBetween(start, m.due_date));
  const elapsed = Math.min(span, Math.max(0, daysBetween(start, today) + 1));
  const expected = Math.round((target * elapsed) / span);
  const daysLeft = Math.max(0, daysBetween(today, m.due_date));
  const perDay = left === 0 ? 0 : daysLeft > 0 ? Math.ceil(left / daysLeft) : null;
  const reached = total >= target && target > 0;
  const label: PaceLabel = reached ? 'ahead' : tooEarly || elapsed <= 0 ? 'none' : paceLabel(total, expected);
  return { total, target, left, share: target > 0 ? Math.min(1, total / target) : 0, daysLeft, expected, perDay, label, reached };
}

/** "182 of 250 · 68 to go · 4 a day for 19 days". */
export function tallyText(t: TallyStatus, unit = ''): string {
  const u = unit ? ` ${unit}` : '';
  if (t.reached) return `${t.total} of ${t.target}${u} · done`;
  const pace = t.perDay == null ? 'past due' : t.perDay === 0 ? '' : `${t.perDay} a day for ${t.daysLeft} day${t.daysLeft === 1 ? '' : 's'}`;
  return [`${t.total} of ${t.target}${u}`, `${t.left} to go`, pace].filter(Boolean).join(' · ');
}
