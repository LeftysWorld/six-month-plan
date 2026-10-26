import type { Goal, GoalGroup, Milestone } from './types.ts';
import type { ISODate } from './dates.ts';

/**
 * Prizes: a treat hangs on a date to hit (a milestone), on finishing a goal, or on a whole group
 * landing. The rules are tiny on purpose: you are the judge of what's done; the app only records
 * when, compares it with the date, and keeps the ledger.
 *
 * - open:   not done yet, date still ahead
 * - due:    not done yet, date passed (the treat is still there to earn — only the on-time bonus is lost)
 * - earned: done on or before the date
 * - late:   done after the date (treat kept, late by n days; for the on-time bonus this means missed)
 */
export type PrizeStatus = 'open' | 'due' | 'earned' | 'late';

export const DEFAULT_GROUP_THRESHOLD = 0.85;

export function prizeStatus(doneDay: ISODate | null | undefined, dueDate: ISODate | null | undefined, today: ISODate): PrizeStatus {
  if (doneDay) return !dueDate || doneDay <= dueDate ? 'earned' : 'late';
  return dueDate && today > dueDate ? 'due' : 'open';
}

/** Days between two ISO dates (b - a). */
export function daysLate(dueDate: ISODate, doneDay: ISODate): number {
  return Math.round((Date.parse(doneDay) - Date.parse(dueDate)) / 86_400_000);
}

/** Does a milestone with a value count as reached by this reading? Direction comes from the goal (losing weight: at or below). */
export function milestoneReached(goal: Pick<Goal, 'baseline_value' | 'target_value'>, milestone: Pick<Milestone, 'value'>, reading: number): boolean {
  if (milestone.value == null || !Number.isFinite(reading)) return false;
  const down = goal.baseline_value != null && goal.target_value != null ? goal.target_value < goal.baseline_value : goal.target_value != null && milestone.value > goal.target_value;
  return down ? reading <= milestone.value : reading >= milestone.value;
}

/** Has the milestone a prize to show at all? */
export function hasPrize(x: { prize?: string } | null | undefined): boolean {
  return !!x && !!x.prize && x.prize.trim().length > 0;
}

/** The date the on-time bonus is judged against: the target as it stood when the bonus was set, else the current one. */
export function bonusDate(goal: Goal): ISODate | null {
  return goal.target_date_at_set ?? goal.target_date ?? null;
}

export interface GroupScore {
  done: number;
  total: number;
  /** done / total, 0 when the group is empty. */
  share: number;
  threshold: number;
  /** Enough goals finished for the prize. */
  earned: boolean;
}

/**
 * How a group's prize stands: the share of its goals that have finished. "Finished" is a goal with
 * completed_at; archived goals are left out (dropping a goal is not failing it).
 */
export function groupScore(group: Pick<GoalGroup, 'prize_threshold'>, goals: Pick<Goal, 'completed_at' | 'archived_at'>[]): GroupScore {
  const live = goals.filter((g) => !g.archived_at);
  const total = live.length;
  const done = live.filter((g) => !!g.completed_at).length;
  const threshold = group.prize_threshold ?? DEFAULT_GROUP_THRESHOLD;
  const share = total ? done / total : 0;
  const earned = total > 0 && share >= threshold - 1e-9;
  return { done, total, share, threshold, earned };
}

/** The share as "3 of 4 · 75%". */
export function groupScoreText(s: GroupScore): string {
  return `${s.done} of ${s.total} · ${Math.round(s.share * 100)}%`;
}
