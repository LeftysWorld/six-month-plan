import { blockIndex, blockRange, type ISODate, type Plan, type Session } from '@six/core';
import { fmt, type View } from './derive.ts';

/**
 * One plain sentence about what matters today, built from pace this block.
 * Points at the goal furthest behind and what would close the gap.
 */
export function coachLine(view: View, plan: Plan | null, today: ISODate, todaySessions: Session[]): string | null {
  if (!plan || plan.start_date > today) return null;
  if (view.tooEarly(plan)) return 'Pace shows up after your first week. Today counts if you do one thing on the list.';

  const block = blockRange(plan, blockIndex(plan, today));
  const paces = view.goalsForPlan(plan.id).map((g) => view.goalPace(g, plan, { start: block.start, end: today }));
  const behind = paces
    .filter((p) => p.label === 'behind' && p.progress)
    .map((p) => ({ p, gap: p.progress!.expected - p.progress!.actual }))
    .sort((a, b) => b.gap - a.gap)[0];

  const left = todaySessions.filter((s) => s.status === 'planned');
  if (behind) {
    const gap = Math.max(1, Math.round(behind.gap));
    const helping = left.find((s) => view.goalsForAction(s.action_id).some((g) => g.id === behind.p.goal.id));
    const lead = `${behind.p.goal.title} is ${fmt(gap)} session${gap === 1 ? '' : 's'} behind this block.`;
    return helping ? `${lead} Today's ${helping.title.toLowerCase()} closes some of it.` : `${lead} One short session today starts closing it.`;
  }
  if (todaySessions.length > 0 && left.length === 0) return 'Everything on today’s list is done. Rest counts too.';
  if (paces.length > 0) return 'Every goal is on pace this block. Just do the next thing.';
  return null;
}
