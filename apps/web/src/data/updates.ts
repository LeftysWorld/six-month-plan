import { addDays, weekStart, type Action, type ActionSchedule, type Goal, type ISODate } from '@six/core';
import { applyOp, type AppData, type Op } from './model.ts';
import { opsEnsureWeek, opsLogSession, opsToggleMilestone } from './ops.ts';
import { invertOps, opsStopFrom } from './planPack.ts';

/**
 * Small changes to your plan, shipped with the app and applied on your data with one tap (Today
 * shows them while they're waiting; Settings → Plans lists them). Each lists what it changes
 * first, offers a choice or two, and can be undone at once. For changes too small for a plan pack:
 * "study an hour a day from Monday".
 */

export interface UpdateOption {
  id: string;
  label: string;
  on: boolean;
}

export interface UpdatePreview {
  /** Nothing left to do (already applied, or nothing to apply it to). */
  done: boolean;
  /** Why it can't apply, when it can't. */
  blocked?: string;
  lines: string[];
  options: UpdateOption[];
}

export interface AppUpdate {
  id: string;
  title: string;
  /** One line for Today. */
  nudge: string;
  preview(data: AppData, today: ISODate): UpdatePreview;
  ops(data: AppData, today: ISODate, options: Record<string, boolean>): Op[];
}

const newId = () => crypto.randomUUID();
type Row = { id: string } & Record<string, unknown>;
const live = (g: Goal) => !g.archived_at && !g.completed_at;
const DAY = ['', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
function dayLabel(d: ISODate): string {
  return `${DAY[new Date(`${d}T00:00:00Z`).getUTCDay() || 7]} ${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][Number(d.slice(5, 7)) - 1]} ${Number(d.slice(8))}`;
}

/** Undo for an update: every op inverted, in reverse. */
export function applyUpdate(update: AppUpdate, data: AppData, today: ISODate, options: Record<string, boolean>): { ops: Op[]; undo: Op[] } {
  const ops = update.ops(data, today, options);
  return { ops, undo: invertOps(data, ops) };
}

// ---------- Doc Film Academy: an hour a day ----------

export const DOC_STUDY = {
  start: '2026-11-02' as ISODate,
  title: 'Doc Film Academy: study',
  minutes: 60,
  days: [1, 2, 3, 4, 5, 6, 7],
};

function docGoal(data: AppData): Goal | null {
  return data.goals.find((g) => live(g) && /documentar/i.test(g.title)) ?? null;
}
function goalActions(data: AppData, goal: Goal): Action[] {
  const ids = new Set(data.actionGoals.filter((x) => x.goal_id === goal.id).map((x) => x.action_id));
  return data.actions.filter((a) => ids.has(a.id) && !a.archived_at);
}
const liveFrom = (data: AppData, actionId: string, from: ISODate) => data.schedules.filter((s) => s.action_id === actionId && (s.effective_to == null || s.effective_to >= from));

function docParts(data: AppData, today: ISODate) {
  const goal = docGoal(data);
  const start = DOC_STUDY.start > today ? DOC_STUDY.start : today;
  if (!goal) return { goal, start, course: null, compare: [], bought: null, practice: [], drafts: [] };
  const actions = goalActions(data, goal);
  const course = actions.find((a) => a.title === DOC_STUDY.title) ?? actions.find((a) => !/compare|choose|buy/i.test(a.title) && /course|docfilm|doc film|fundamentals|study/i.test(a.title)) ?? null;
  const compare = actions
    .filter((a) => /compare|choose|buy/i.test(a.title) && /course/i.test(a.title))
    .flatMap((a) => data.sessions.filter((s) => s.action_id === a.id && s.status === 'planned' && (s.date ?? s.week_start) <= today));
  const bought = data.milestones.find((m) => m.goal_id === goal.id && !m.completed_at && /course (bought|chosen)|buy the course/i.test(m.title)) ?? null;
  const practice = actions.filter((a) => a.id !== course?.id && /shoot|edit|log every clip|clips?/i.test(a.title) && liveFrom(data, a.id, start).length > 0);
  // The rest of the milestones drafted with the goal (not done yet), for "set your own later".
  const drafts = data.milestones.filter((m) => m.goal_id === goal.id && !m.completed_at && m.id !== bought?.id);
  return { goal, start, course, compare, bought, practice, drafts };
}

function courseIsSet(data: AppData, course: Action | null, start: ISODate): boolean {
  if (!course || course.title !== DOC_STUDY.title || course.planned_minutes !== DOC_STUDY.minutes) return false;
  const s = liveFrom(data, course.id, start);
  return s.length === 1 && s[0]!.rule === 'days' && s[0]!.effective_from <= start && s[0]!.effective_to == null && s[0]!.days.length === 7;
}

export const docStudyUpdate: AppUpdate = {
  id: 'doc-study-2026-11',
  title: 'Doc Film Academy: an hour a day',
  nudge: 'You bought the Doc Film Academy course: study an hour a day from Monday?',
  preview(data, today) {
    const p = docParts(data, today);
    if (!p.goal) return { done: true, blocked: 'There is no documentary goal to add it to.', lines: [], options: [] };
    const set = courseIsSet(data, p.course, p.start);
    const lines: string[] = [];
    if (!set) lines.push(`${p.goal.title}: “${DOC_STUDY.title}”, 1 hour every day from ${dayLabel(p.start)}${p.course ? ` (was “${p.course.title}”, ${p.course.planned_minutes} min)` : ''}. No end date.`);
    if (p.compare.length) lines.push(`“${data.actions.find((a) => a.id === p.compare[0]!.action_id)?.title}” marked done: you bought it`);
    if (p.bought) lines.push(`Milestone “${p.bought.title}” ticked`);
    const options: UpdateOption[] = [];
    if (p.practice.length) options.push({ id: 'pausePractice', label: `Pause ${p.practice.map((a) => `“${a.title}”`).join(' and ')} until you add your own practice (history kept)`, on: true });
    if (p.drafts.length && !set) options.push({ id: 'clearMilestones', label: `Remove the ${p.drafts.length} other milestone${p.drafts.length === 1 ? '' : 's'} drafted with the goal (${p.drafts.map((m) => `“${m.title}”`).join(', ')}), to set your own once the course is going`, on: false });
    const done = set && !p.compare.length && !p.bought && !p.practice.length;
    return { done, lines, options };
  },
  ops(data, today, options) {
    const p = docParts(data, today);
    if (!p.goal) return [];
    const ops: Op[] = [];
    let next = data;
    const add = (more: Op[]) => {
      ops.push(...more);
      next = more.reduce(applyOp, next);
    };

    if (!courseIsSet(data, p.course, p.start)) {
      let courseId = p.course?.id;
      if (p.course) {
        add([{ kind: 'update', collection: 'actions', id: p.course.id, patch: { title: DOC_STUDY.title, planned_minutes: DOC_STUDY.minutes, min_label: '15 minutes: one lesson', min_minutes: 15 } }]);
        for (const s of liveFrom(next, p.course.id, p.start)) {
          if (s.effective_from >= p.start) add([{ kind: 'delete', collection: 'schedules', id: s.id }]);
          else add([{ kind: 'update', collection: 'schedules', id: s.id, patch: { effective_to: addDays(p.start, -1) } }]);
        }
        // Planned days from the start are made again from the new schedule (an hour, every day).
        const fromWeek = weekStart(p.start);
        for (const x of next.sessions) {
          if (x.action_id !== p.course.id || x.status !== 'planned') continue;
          if (x.date ? x.date >= p.start : x.week_start >= fromWeek) add([{ kind: 'delete', collection: 'sessions', id: x.id }]);
        }
      } else {
        const action: Action = { id: newId(), title: DOC_STUDY.title, kind: 'minutes', planned_minutes: DOC_STUDY.minutes, planned_count: null, min_label: '15 minutes: one lesson', min_minutes: 15, min_count: null, priority: false, archived_at: null };
        courseId = action.id;
        add([
          { kind: 'insert', collection: 'actions', rows: [action as unknown as Row] },
          { kind: 'insert', collection: 'actionGoals', rows: [{ id: newId(), action_id: action.id, goal_id: p.goal.id }] },
        ]);
      }
      const schedule: ActionSchedule = { id: newId(), action_id: courseId!, rule: 'days', days: DOC_STUDY.days, per_week: null, effective_from: p.start, effective_to: null };
      add([{ kind: 'insert', collection: 'schedules', rows: [schedule as unknown as Row] }]);
    }

    for (const s of p.compare) add(opsLogSession(s, { status: 'done', note: 'Bought the Doc Film Academy course.', on: today }));
    if (p.bought) add(opsToggleMilestone(p.bought));
    if (options.pausePractice) for (const a of p.practice) add(opsStopFrom(next, next.actions.find((x) => x.id === a.id)!, p.start));
    if (options.clearMilestones) for (const m of p.drafts) add([{ kind: 'delete', collection: 'milestones', id: m.id }]);
    add(opsEnsureWeek(next, weekStart(today)));
    return ops;
  },
};

/** Every update the app ships, newest first. */
export const APP_UPDATES: AppUpdate[] = [docStudyUpdate];
