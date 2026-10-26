import { quarterRange, shortDate, type Goal, type ISODate, type Plan } from '@six/core';
import { applyOp, type AppData, type Op } from './model.ts';
import { chainFor, opsStartChain } from './chain.ts';

/**
 * Moving goals to another season. A season is the review calendar a goal is on; moving a goal
 * takes it out of the season it's in now and puts it in the new one. Daily tasks, logs, readings,
 * milestones and the goal's own dates don't depend on the season, so they stay. This week's goal
 * carries over and the chain is rebuilt on the new season's calendar.
 */

/** Seasons a goal is in now or later (not archived, not ended), earliest first. */
export function liveWindows(data: AppData, goalId: string, today: ISODate): Plan[] {
  const ids = new Set(data.planGoals.filter((pg) => pg.goal_id === goalId).map((pg) => pg.plan_id));
  return data.plans.filter((p) => ids.has(p.id) && !p.archived_at && p.end_date >= today).sort((a, b) => (a.start_date < b.start_date ? -1 : 1));
}

/** The season a goal is in now (the earliest live one). */
export function currentWindow(data: AppData, goalId: string, today: ISODate): Plan | undefined {
  return liveWindows(data, goalId, today)[0];
}

/** Move goals to a season. Goals already in it are left alone. */
export function opsMoveGoals(data: AppData, goals: Goal[], to: Plan, today: ISODate): Op[] {
  let next = data;
  const all: Op[] = [];
  const push = (ops: Op[]) => {
    all.push(...ops);
    next = ops.reduce(applyOp, next);
  };
  for (const goal of goals) {
    const from = currentWindow(next, goal.id, today);
    if (from?.id === to.id) continue;
    const weekNote = from ? chainFor(next, goal, from, today < from.start_date ? from.start_date : today).week.step?.target_note.trim() ?? '' : '';
    // Out of every live season it was in (ended seasons keep their history).
    for (const w of liveWindows(next, goal.id, today)) {
      if (w.id === to.id) continue;
      push(next.planGoals.filter((pg) => pg.goal_id === goal.id && pg.plan_id === w.id).map((pg): Op => ({ kind: 'delete', collection: 'planGoals', id: pg.id })));
    }
    if (!next.planGoals.some((pg) => pg.goal_id === goal.id && pg.plan_id === to.id)) {
      push([{ kind: 'insert', collection: 'planGoals', rows: [{ id: crypto.randomUUID(), plan_id: to.id, goal_id: goal.id }] }]);
    }
    const start = today < to.start_date ? to.start_date : today;
    push(opsStartChain(next, goal, to, start, { week: weekNote }));
  }
  return all;
}

/** One line on a season: when it starts, its checkpoint, when it ends. */
export function windowLine(plan: Plan, today: ISODate): string {
  const checkpoint = quarterRange(plan, plan.start_date).end;
  const starts = plan.start_date > today ? `starts ${shortDate(plan.start_date)} · ` : '';
  return `${starts}checkpoint ${shortDate(checkpoint)} · ends ${shortDate(plan.end_date)}`;
}
