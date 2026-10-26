import { addDays, chainAt, clockDays, daysBetween, quarterRange, shortDate, type Goal, type ISODate, type Plan } from '@six/core';
import { applyOp, type AppData, type Op } from './model.ts';
import { opsArchivePlan, opsCreatePlan } from './ops.ts';
import { chainFor, opsStartChain, type ChainLevel } from './chain.ts';

/**
 * Moving goals between time windows: into a batch, or onto their own clock. A move takes the goal
 * out of the window it runs in now and puts it in the new one. Daily tasks, logs and readings don't
 * depend on the window, so they stay. The chain is rebuilt on the new window's calendar: this
 * week's goal always carries over; the month and 3-month goals carry over when the new period ends
 * within a week of the old one, and otherwise wait to be set again.
 */

export type Destination = { kind: 'plan'; plan: Plan } | { kind: 'own'; months: 3 | 6 };

/** Windows a goal runs in now or later (not archived, not ended). */
function liveWindows(data: AppData, goalId: string, today: ISODate): Plan[] {
  const ids = new Set(data.planGoals.filter((pg) => pg.goal_id === goalId).map((pg) => pg.plan_id));
  return data.plans.filter((p) => ids.has(p.id) && !p.archived_at && p.end_date >= today).sort((a, b) => (a.start_date < b.start_date ? -1 : 1));
}

/** The window a goal runs in now (the earliest live one). */
export function currentWindow(data: AppData, goalId: string, today: ISODate): Plan | undefined {
  return liveWindows(data, goalId, today)[0];
}

export interface MovePlan {
  goal: Goal;
  from: Plan | undefined;
  to: Plan;
  /** Notes that carry over, per level. Empty means it needs setting again. */
  notes: Record<ChainLevel, string>;
  /** Number goals: the targets that carry over with their notes. */
  values: Partial<Record<ChainLevel, number | null>>;
  /** Levels that had a goal written down but won't carry over (their dates don't line up). */
  dropped: ChainLevel[];
}

const near = (a: ISODate, b: ISODate) => Math.abs(daysBetween(a, b)) <= 7;

/** Work out a move without changing anything: what carries over and what needs setting again. */
export function planMove(data: AppData, goal: Goal, to: Plan, today: ISODate): MovePlan {
  const from = currentWindow(data, goal.id, today);
  const notes: Record<ChainLevel, string> = { quarter: '', month: '', week: '' };
  const values: Partial<Record<ChainLevel, number | null>> = {};
  const dropped: ChainLevel[] = [];
  if (from) {
    const was = chainFor(data, goal, from, today < from.start_date ? from.start_date : today);
    const at = today < to.start_date ? to.start_date : today;
    const will = chainAt(to, at);
    for (const level of ['quarter', 'month', 'week'] as ChainLevel[]) {
      const step = was[level].step;
      const note = step?.target_note.trim() ?? '';
      if (!note && step?.target_value == null) continue;
      if (level === 'week' || near(was[level].node.end, will[level].end)) {
        notes[level] = note;
        if (step?.target_value != null) values[level] = step.target_value;
      } else dropped.push(level);
    }
  }
  return { goal, from, to, notes, values, dropped };
}

/** The window an own clock would get if made today (for showing its dates before it's saved). */
export function ownClockWindow(goal: Goal, months: 3 | 6, today: ISODate): Plan {
  return { id: `own-${goal.id}`, name: goal.title, start_date: today, end_date: addDays(today, clockDays(months) - 1), block_days: 28, archived_at: null, solo: true };
}

/** Move goals to a batch, or each onto its own clock. Goals already there are left alone. */
export function opsMoveGoals(data: AppData, goals: Goal[], dest: Destination, today: ISODate): Op[] {
  let next = data;
  const all: Op[] = [];
  const push = (ops: Op[]) => {
    all.push(...ops);
    next = ops.reduce(applyOp, next);
  };
  for (const goal of goals) {
    let to: Plan;
    if (dest.kind === 'own') {
      const { ops, plan } = opsCreatePlan({ name: goal.title, start: today, end: addDays(today, clockDays(dest.months) - 1), solo: true });
      push(ops);
      to = plan;
    } else {
      to = dest.plan;
      if (currentWindow(next, goal.id, today)?.id === to.id) continue;
    }
    const move = planMove(next, goal, to, today);
    // Out of every live window it was in (ended windows keep their history).
    for (const w of liveWindows(next, goal.id, today)) {
      if (w.id === to.id) continue;
      push(next.planGoals.filter((pg) => pg.goal_id === goal.id && pg.plan_id === w.id).map((pg): Op => ({ kind: 'delete', collection: 'planGoals', id: pg.id })));
      // An own clock with no goal left in it is done with.
      if (w.solo && !next.planGoals.some((pg) => pg.plan_id === w.id)) push(opsArchivePlan(w, true));
    }
    if (!next.planGoals.some((pg) => pg.goal_id === goal.id && pg.plan_id === to.id)) {
      push([{ kind: 'insert', collection: 'planGoals', rows: [{ id: crypto.randomUUID(), plan_id: to.id, goal_id: goal.id }] }]);
    }
    const from = today < to.start_date ? to.start_date : today;
    push(opsStartChain(next, goal, to, from, move.notes, move.values));
  }
  return all;
}

/** One line on what a move means for a window: when it starts, its checkpoint, when it ends. */
export function windowLine(plan: Plan, today: ISODate): string {
  const checkpoint = quarterRange(plan, plan.start_date).end;
  const starts = plan.start_date > today ? `starts ${shortDate(plan.start_date)} · ` : '';
  return `${starts}checkpoint ${shortDate(checkpoint)} · ends ${shortDate(plan.end_date)}`;
}
