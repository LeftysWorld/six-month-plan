import { bonusDate, groupScore, hasPrize, prizeStatus, shortDate, type Goal, type GoalGroup, type GroupScore, type ISODate, type Milestone, type Plan, type PrizeStatus } from '@six/core';
import type { AppData, Op } from './model.ts';
import type { View } from './derive.ts';
import { groupMembers } from './groups.ts';

/**
 * Prizes in the app: the ops that set and claim them, and the list of every prize across your goals
 * with where it stands. The rules live in @six/core (prizes.ts); this file knows the data.
 */

const nowISO = () => new Date().toISOString();

/** One prize, wherever it hangs, with its status worked out for today. */
export interface PrizeItem {
  /** Stable key: `m:<milestone id>`, `g:<goal id>`, `b:<goal id>` (on-time bonus), `grp:<group id>`. */
  key: string;
  kind: 'milestone' | 'finish' | 'bonus' | 'group';
  title: string;
  /** What it's for: the milestone's title, "Finishing", "Finishing by Apr 26", the group's name. */
  forText: string;
  goal: Goal | null;
  group: GoalGroup | null;
  color: string;
  dueDate: ISODate | null;
  doneDay: ISODate | null;
  status: PrizeStatus;
  /** For the bonus: 'late' or 'due' both mean it's gone. */
  lost: boolean;
  claimedAt: string | null;
  claim: Op[];
  unclaim: Op[];
  /** For a group prize: the score behind it. */
  score?: GroupScore;
}

/** Every prize on a goal (its dated prizes, its finish prize, its on-time bonus), in date order. */
export function goalPrizes(view: View, goal: Goal, today: ISODate, plan?: Plan | null): PrizeItem[] {
  const out: PrizeItem[] = [];
  const doneDay = goal.completed_at ? view.dayOf(goal.completed_at) : null;
  for (const m of view.milestonesOf(goal.id)) {
    if (!hasPrize(m)) continue;
    const mDone = m.completed_at ? view.dayOf(m.completed_at) : null;
    out.push({
      key: `m:${m.id}`,
      kind: 'milestone',
      title: m.prize!.trim(),
      forText: m.title,
      goal,
      group: null,
      color: goal.color,
      dueDate: m.due_date,
      doneDay: mDone,
      status: prizeStatus(mDone, m.due_date, today),
      lost: false,
      claimedAt: m.prize_claimed_at ?? null,
      claim: [{ kind: 'update', collection: 'milestones', id: m.id, patch: { prize_claimed_at: nowISO() } }],
      unclaim: [{ kind: 'update', collection: 'milestones', id: m.id, patch: { prize_claimed_at: null } }],
    });
  }
  const finishBy = goal.target_date ?? plan?.end_date ?? null;
  if (hasPrize(goal)) {
    out.push({
      key: `g:${goal.id}`,
      kind: 'finish',
      title: goal.prize!.trim(),
      forText: 'Finishing',
      goal,
      group: null,
      color: goal.color,
      dueDate: finishBy,
      doneDay,
      status: prizeStatus(doneDay, finishBy, today),
      lost: false,
      claimedAt: goal.prize_claimed_at ?? null,
      claim: [{ kind: 'update', collection: 'goals', id: goal.id, patch: { prize_claimed_at: nowISO() } }],
      unclaim: [{ kind: 'update', collection: 'goals', id: goal.id, patch: { prize_claimed_at: null } }],
    });
  }
  if (goal.prize_on_time?.trim()) {
    const by = bonusDate(goal) ?? finishBy;
    const status = prizeStatus(doneDay, by, today);
    out.push({
      key: `b:${goal.id}`,
      kind: 'bonus',
      title: goal.prize_on_time.trim(),
      forText: by ? `Finishing by ${shortDate(by)}` : 'Finishing on time',
      goal,
      group: null,
      color: goal.color,
      dueDate: by,
      doneDay,
      status,
      lost: status === 'late' || status === 'due',
      claimedAt: goal.prize_on_time_claimed_at ?? null,
      claim: [{ kind: 'update', collection: 'goals', id: goal.id, patch: { prize_on_time_claimed_at: nowISO() } }],
      unclaim: [{ kind: 'update', collection: 'goals', id: goal.id, patch: { prize_on_time_claimed_at: null } }],
    });
  }
  return out;
}

/** A group's prize, if it has one, with the score behind it. */
export function groupPrize(data: AppData, view: View, group: GoalGroup, today: ISODate): PrizeItem | null {
  if (!hasPrize(group)) return null;
  const members = groupMembers(data, group.id);
  const score = groupScore(group, members);
  // Done the day the last counted goal finished; due by the end of the season its goals are in.
  const finishedDays = members.filter((g) => g.completed_at && !g.archived_at).map((g) => view.dayOf(g.completed_at!)).sort();
  const doneDay = score.earned ? finishedDays[Math.max(0, Math.ceil(score.total * score.threshold) - 1)] ?? finishedDays.at(-1) ?? null : null;
  const plans = members.map((g) => view.planForGoal(g)).filter((p): p is Plan => !!p);
  const dueDate = plans.length ? plans.map((p) => p.end_date).sort().at(-1)! : null;
  return {
    key: `grp:${group.id}`,
    kind: 'group',
    title: group.prize!.trim(),
    forText: `${group.name}: ${Math.round(score.threshold * 100)}% of its goals finished`,
    goal: null,
    group,
    color: members[0]?.color ?? 'var(--accent)',
    dueDate,
    doneDay,
    status: prizeStatus(doneDay, dueDate, today),
    lost: false,
    claimedAt: group.prize_claimed_at ?? null,
    claim: [{ kind: 'update', collection: 'groups', id: group.id, patch: { prize_claimed_at: nowISO() } }],
    unclaim: [{ kind: 'update', collection: 'groups', id: group.id, patch: { prize_claimed_at: null } }],
    score,
  };
}

/** Every prize there is, across live and completed goals and every group. */
export function allPrizes(data: AppData, view: View, today: ISODate): PrizeItem[] {
  const out: PrizeItem[] = [];
  for (const g of data.goals) {
    if (g.archived_at) continue;
    out.push(...goalPrizes(view, g, today, view.planForGoal(g)));
  }
  for (const grp of data.groups) {
    const p = groupPrize(data, view, grp, today);
    if (p) out.push(p);
  }
  return out;
}

/** Earned (on time or late, not lost) and not yet claimed: what the celebration card and the review list. */
export function unclaimedPrizes(data: AppData, view: View, today: ISODate): PrizeItem[] {
  return allPrizes(data, view, today).filter((p) => (p.status === 'earned' || p.status === 'late') && !p.lost && !p.claimedAt);
}

/** Set or change a goal's finish prize and on-time bonus. Setting a bonus fixes today's target date as its judge; clearing it frees that. */
export function opsSetGoalPrizes(goal: Goal, prize: string, prizeOnTime: string, finishBy: ISODate | null): Op[] {
  const patch: Record<string, unknown> = {};
  if (prize.trim() !== (goal.prize ?? '')) patch.prize = prize.trim();
  if (prizeOnTime.trim() !== (goal.prize_on_time ?? '')) {
    patch.prize_on_time = prizeOnTime.trim();
    if (!prizeOnTime.trim()) patch.target_date_at_set = null;
    else if (!goal.target_date_at_set) patch.target_date_at_set = finishBy;
  } else if (prizeOnTime.trim() && !goal.target_date_at_set && finishBy) patch.target_date_at_set = finishBy;
  return Object.keys(patch).length ? [{ kind: 'update', collection: 'goals', id: goal.id, patch }] : [];
}

/** Set or change a group's prize and threshold (0–1). */
export function opsSetGroupPrize(group: GoalGroup, prize: string, threshold: number | null): Op[] {
  const patch: Record<string, unknown> = {};
  if (prize.trim() !== (group.prize ?? '')) patch.prize = prize.trim();
  const t = threshold != null && Number.isFinite(threshold) ? Math.min(1, Math.max(0.05, threshold)) : null;
  if (t !== (group.prize_threshold ?? null)) patch.prize_threshold = t;
  return Object.keys(patch).length ? [{ kind: 'update', collection: 'groups', id: group.id, patch }] : [];
}

/** "Earned · Dec 9 · 4 days early", "Earned late · 12 days", "By Dec 13", "Dec 13 passed · still open". */
export function prizeWhen(p: PrizeItem): string {
  const due = p.dueDate ? shortDate(p.dueDate) : null;
  if (p.status === 'earned') {
    const early = p.dueDate && p.doneDay ? Math.round((Date.parse(p.dueDate) - Date.parse(p.doneDay)) / 86_400_000) : 0;
    return `Earned · ${p.doneDay ? shortDate(p.doneDay) : ''}${early > 0 ? ` · ${early} day${early === 1 ? '' : 's'} early` : ''}`;
  }
  if (p.status === 'late') {
    const late = p.dueDate && p.doneDay ? Math.round((Date.parse(p.doneDay) - Date.parse(p.dueDate)) / 86_400_000) : 0;
    return p.lost ? `Missed · ${due} passed` : `Earned late · ${late} day${late === 1 ? '' : 's'}`;
  }
  if (p.status === 'due') return p.lost ? `Missed · ${due} passed` : `${due} passed · still open`;
  return due ? `By ${due}` : 'Open';
}

/** The next dated prize a number goal is heading for, for the "1.6 lb to go" line. */
export function nextValuedPrize(view: View, goal: Goal): Milestone | null {
  return view.milestonesOf(goal.id).find((m) => !m.completed_at && m.value != null && hasPrize(m)) ?? null;
}
