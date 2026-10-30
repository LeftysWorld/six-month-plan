import { addDays, isoWeekday, weekStart, type Action, type Goal, type ISODate, type Plan, type Session } from '@six/core';
import type { View } from './derive.ts';
import { goalPrizes, type PrizeItem } from './prizes.ts';
import type { Stage } from './season.ts';

/**
 * What sits beside your goals on Goals → Now: the next two weeks, today's tasks, one goal in depth,
 * prizes in reach, quick logging, and what's starting next. Pure functions over the view.
 */

export interface BesideGoal {
  goal: Goal;
  plan: Plan;
  start: ISODate;
  stage: Stage;
}

export type AgendaKind = 'date' | 'start' | 'review';
export interface AgendaItem {
  date: ISODate;
  kind: AgendaKind;
  title: string;
  color: string;
  /** The goal it belongs to (none for the weekly review). */
  goal: Goal | null;
}

const SAT = 6;

/**
 * The next `days` days from today: open milestones of the season's goals, goals that start, and the
 * Saturday reviews (this week's only if it isn't done yet). Sorted by date, then dates before starts
 * before reviews.
 */
export function agenda(view: View, goals: BesideGoal[], today: ISODate, days = 14, reviewedThisWeek = false): { items: AgendaItem[]; after: AgendaItem | null } {
  const end = addDays(today, days - 1);
  const ids = new Set(goals.map((g) => g.goal.id));
  const byId = new Map(goals.map((g) => [g.goal.id, g.goal]));
  const open = view.data.milestones.filter((m) => ids.has(m.goal_id) && !m.completed_at && m.due_date >= today).sort((a, b) => (a.due_date < b.due_date ? -1 : 1));
  const items: AgendaItem[] = [];
  for (const m of open) {
    if (m.due_date > end) break;
    const g = byId.get(m.goal_id)!;
    items.push({ date: m.due_date, kind: 'date', title: m.title, color: g.color, goal: g });
  }
  for (const g of goals) {
    if (g.start > today && g.start <= end) items.push({ date: g.start, kind: 'start', title: `${g.goal.title} starts`, color: g.goal.color, goal: g.goal });
  }
  const thisSat = addDays(weekStart(today), 5);
  for (let i = 0; i < days; i++) {
    const d = addDays(today, i);
    if (isoWeekday(d) !== SAT) continue;
    if (reviewedThisWeek && d === thisSat) continue;
    items.push({ date: d, kind: 'review', title: 'Weekly review', color: '#9AA0AE', goal: null });
  }
  const order: Record<AgendaKind, number> = { date: 0, start: 1, review: 2 };
  items.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : order[a.kind] - order[b.kind]));
  const next = open.find((m) => m.due_date > end);
  const after = next ? { date: next.due_date, kind: 'date' as const, title: next.title, color: byId.get(next.goal_id)!.color, goal: byId.get(next.goal_id)! } : null;
  return { items, after };
}

/** Today's sessions for the goals in progress (one per task), each with its goal. */
export function todayTasks(view: View, goals: BesideGoal[], today: ISODate): { session: Session; action: Action | undefined; goal: Goal }[] {
  const ids = new Set(goals.filter((g) => g.stage === 'now').map((g) => g.goal.id));
  const out: { session: Session; action: Action | undefined; goal: Goal }[] = [];
  for (const s of view.sessionsOn(today)) {
    if (s.status === 'moved') continue;
    const goal = view.goalsForAction(s.action_id).find((g) => ids.has(g.id));
    if (!goal) continue;
    out.push({ session: s, action: view.action(s.action_id), goal });
  }
  return out;
}

/** How a task repeats, in a few words: "every day", "Mon, Wed, Fri", "3 a week". */
export function scheduleWords(view: View, actionId: string, today: ISODate): string {
  const s = view.scheduleFor(actionId, today) ?? view.data.schedules.filter((x) => x.action_id === actionId).sort((a, b) => (a.effective_from < b.effective_from ? 1 : -1))[0];
  if (!s) return 'not scheduled';
  const from = s.effective_from > today ? ` from ${s.effective_from.slice(5).replace('-', '/')}` : '';
  if (s.rule === 'per_week') return `${s.per_week ?? 1} a week${from}`;
  if (s.days.length === 7) return `every day${from}`;
  const names = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  return s.days.slice().sort((a, b) => a - b).map((d) => names[d - 1]).join(', ') + from;
}

/** One goal in depth: its milestones, its tasks, and the last few things logged against it. */
export function focusOf(view: View, goal: Goal, today: ISODate) {
  const milestones = view.milestonesOf(goal.id).slice().sort((a, b) => (a.due_date < b.due_date ? -1 : 1));
  const actions = view.actionsForGoal(goal.id);
  const actionIds = new Set(actions.map((a) => a.id));
  const sessions = view.data.sessions
    .filter((s) => s.action_id && actionIds.has(s.action_id) && (s.status === 'done' || s.status === 'partial' || s.status === 'minimum') && s.date && s.date <= today)
    .sort((a, b) => ((a.logged_at ?? a.date ?? '') < (b.logged_at ?? b.date ?? '') ? 1 : -1));
  const types = view.measurementTypesForGoal(goal.id);
  const readings = types.flatMap((t) => view.measurementsFor(t.id).map((m) => ({ date: m.measured_on, text: `${t.name}: ${m.value}${t.unit ? ` ${t.unit}` : ''}` })));
  const logs = [
    ...sessions.map((s) => ({ date: s.date!, text: `${s.title}${s.actual_count != null ? ` · ${s.actual_count}` : s.actual_minutes ? ` · ${s.actual_minutes} min` : ''}` })),
    ...readings,
  ]
    .sort((a, b) => (a.date < b.date ? 1 : -1))
    .slice(0, 5);
  return { milestones, actions: actions.map((a) => ({ action: a, when: scheduleWords(view, a.id, today) })), logs };
}

/** Prizes still to win on the goals in progress, soonest first, and the goals with none yet. */
export function prizesInReach(view: View, goals: BesideGoal[], today: ISODate): { prizes: PrizeItem[]; without: Goal[] } {
  const now = goals.filter((g) => g.stage === 'now');
  const prizes: PrizeItem[] = [];
  const without: Goal[] = [];
  for (const g of now) {
    const all = goalPrizes(view, g.goal, today, g.plan);
    const open = all.filter((p) => (p.status === 'open' || p.status === 'due') && !p.lost && !p.claimedAt);
    prizes.push(...open);
    if (all.length === 0) without.push(g.goal);
  }
  prizes.sort((a, b) => ((a.dueDate ?? '9999') < (b.dueDate ?? '9999') ? -1 : 1));
  return { prizes, without };
}

/** The goals starting next week (Monday to Sunday), each with its first date and first task. */
export function comingNext(view: View, goals: BesideGoal[], week: { start: ISODate; end: ISODate }) {
  return goals
    .filter((g) => g.start >= week.start && g.start <= week.end)
    .sort((a, b) => (a.start < b.start ? -1 : 1))
    .map((g) => {
      const first = view.milestonesOf(g.goal.id).filter((m) => !m.completed_at).sort((a, b) => (a.due_date < b.due_date ? -1 : 1))[0] ?? null;
      const task = view.actionsForGoal(g.goal.id)[0] ?? null;
      return { ...g, first, task };
    });
}
