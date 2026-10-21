import { chainAt, type ISODate, type Plan, type Session } from '@six/core';
import { fmt, type View } from './derive.ts';

/** One plain sentence about what matters today: the goal furthest behind this month and what helps. */
export function coachLine(view: View, plan: Plan | null, today: ISODate, todaySessions: Session[]): string | null {
  if (!plan || plan.start_date > today) return null;
  if (view.tooEarly(plan)) return 'Pace shows up after your first week. Today counts if you do one thing on the list.';

  const month = chainAt(plan, today).month;
  const paces = view.goalsForPlan(plan.id).map((g) => view.goalPace(g, plan, { start: month.start, end: today }));
  const behind = paces
    .filter((p) => p.label === 'behind' && p.progress)
    .map((p) => ({ p, gap: p.progress!.expected - p.progress!.actual }))
    .sort((a, b) => b.gap - a.gap)[0];

  const left = todaySessions.filter((s) => s.status === 'planned');
  if (behind) {
    const gap = Math.max(1, Math.round(behind.gap));
    const helping = left.find((s) => view.goalsForAction(s.action_id).some((g) => g.id === behind.p.goal.id));
    const lead = `${behind.p.goal.title} is ${fmt(gap)} ${gap === 1 ? 'task' : 'tasks'} behind this month.`;
    return helping ? `${lead} Today's ${helping.title.toLowerCase()} closes some of it.` : `${lead} One short session today starts closing it.`;
  }
  if (todaySessions.length > 0 && left.length === 0) return 'Everything on today’s list is done. Rest counts too.';
  if (paces.length > 0) return 'Every goal is on pace this month. Just do the next thing.';
  return null;
}
