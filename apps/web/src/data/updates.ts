import { addDays, weekStart, type Action, type ActionSchedule, type Goal, type ISODate } from '@six/core';
import { applyOp, type AppData, type Op } from './model.ts';
import { opsEnsureWeek, opsLogSession, opsToggleMilestone } from './ops.ts';
import { invertOps, opsStopFrom } from './planPack.ts';
import { MONTHLY_CHECK } from './plans/splitsBackbend.ts';

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

// ---------- Flexibility measurements: daily, and only the ones you can take ----------

const FRONT = ['Front split (left): front hip to floor', 'Front split (right): front hip to floor'];
const CENTER = 'Center split';

function flexParts(data: AppData) {
  const types = data.measurementTypes.filter((t) => !t.archived_at);
  const goal = (re: RegExp) => data.goals.find((g) => live(g) && re.test(g.title)) ?? null;
  const front = goal(/^front splits/i) ?? goal(/split/i);
  const side = goal(/side \(center\) split|center split/i);
  const fold = goal(/chest to shins/i);
  const back = goal(/backbend/i);
  const of = (g: Goal | null) => (g ? types.filter((t) => t.goal_id === g.id) : []);
  return {
    front,
    side,
    // On the front-splits goal: the old single gap number goes; left and right stay, daily.
    gap: of(front).filter((t) => /splits? gap/i.test(t.name)),
    frontTypes: of(front).filter((t) => FRONT.includes(t.name)),
    // The side split's measurement becomes "Center split", daily.
    sideType: of(side).find((t) => t.name === CENTER) ?? of(side).find((t) => /side split|crotch/i.test(t.name)) ?? null,
    seated: of(fold).filter((t) => /seated/i.test(t.name)),
    backTypes: of(back),
  };
}

export const flexMeasuresUpdate: AppUpdate = {
  id: 'flex-measures-2026-10',
  title: 'Flexibility measurements',
  nudge: 'Front splits (left and right) and the center split, logged daily on Today; the gap, seated fold and backbend numbers removed.',
  preview(data) {
    const p = flexParts(data);
    if (!p.front || !p.side) return { done: true, blocked: 'There are no splits goals to update.', lines: [], options: [] };
    const lines: string[] = [];
    for (const t of p.gap) lines.push(`“${t.name}” removed from ${p.front.title} (the left and right measurements are the gap)`);
    for (const name of FRONT) {
      const t = p.frontTypes.find((x) => x.name === name);
      if (!t) lines.push(`“${name}” added, logged daily on Today`);
      else if (t.cadence_days > 1) lines.push(`“${name}”: logged daily on Today`);
    }
    if (!p.sideType) lines.push(`“${CENTER}” added to ${p.side.title}, logged daily on Today`);
    else if (p.sideType.name !== CENTER || p.sideType.cadence_days > 1) lines.push(`“${p.sideType.name}” becomes “${CENTER}”, logged daily on Today`);
    for (const t of p.seated) lines.push(`“${t.name}” removed`);
    for (const t of p.backTypes) lines.push(`“${t.name}” removed from the backbend`);
    if (lines.length) lines.push('Readings already logged stay in your history.');
    return { done: lines.length === 0, lines, options: [] };
  },
  ops(data) {
    const p = flexParts(data);
    if (!p.front || !p.side) return [];
    const ops: Op[] = [];
    const stop = (id: string): Op => ({ kind: 'update', collection: 'measurementTypes', id, patch: { archived_at: new Date().toISOString() } });
    for (const t of [...p.gap, ...p.seated, ...p.backTypes]) {
      ops.push(stop(t.id));
      // A goal measured by one of these is measured by nothing now (the goal itself stays).
      for (const g of data.goals.filter((x) => x.measurement_type_id === t.id)) ops.push({ kind: 'update', collection: 'goals', id: g.id, patch: { measurement_type_id: null } });
    }
    for (const name of FRONT) {
      const t = p.frontTypes.find((x) => x.name === name);
      if (!t) ops.push({ kind: 'insert', collection: 'measurementTypes', rows: [{ id: newId(), name, unit: 'in', cadence_days: 1, goal_id: p.front.id, archived_at: null, on_today: true }] });
      else if (t.cadence_days > 1 || t.on_today !== true) ops.push({ kind: 'update', collection: 'measurementTypes', id: t.id, patch: { cadence_days: 1, on_today: true } });
    }
    if (!p.sideType) ops.push({ kind: 'insert', collection: 'measurementTypes', rows: [{ id: newId(), name: CENTER, unit: 'in', cadence_days: 1, goal_id: p.side.id, archived_at: null, on_today: true }] });
    else if (p.sideType.name !== CENTER || p.sideType.cadence_days > 1 || p.sideType.on_today !== true) ops.push({ kind: 'update', collection: 'measurementTypes', id: p.sideType.id, patch: { name: CENTER, cadence_days: 1, on_today: true } });
    // The monthly check's notes follow: photos, and only the standing fold measured there.
    const check = data.actions.find((a) => !a.archived_at && a.title === MONTHLY_CHECK.title);
    if (check && check.details !== MONTHLY_CHECK.details) ops.push({ kind: 'update', collection: 'actions', id: check.id, patch: { details: MONTHLY_CHECK.details } });
    return ops;
  },
};

// ---------- The glamping site waits on the job ----------

function glampParts(data: AppData) {
  const idea = data.ideas.find((i) => i.status === 'backlog' && /glamp/i.test(i.title)) ?? null;
  const job = data.goals.find((g) => live(g) && /product owner role|land an? ai/i.test(g.title)) ?? null;
  return { idea, job };
}

export const glampWaitsUpdate: AppUpdate = {
  id: 'glamp-waits-on-job-2026-10',
  title: 'Glamping waits on the job',
  nudge: 'Your glamping idea can wait on landing the AI job: held in the backlog, and Today tells you when it’s ready.',
  preview(data) {
    const { idea, job } = glampParts(data);
    if (!idea || !job) return { done: true, blocked: 'There is no glamping idea or job goal to link.', lines: [], options: [] };
    if (idea.waits_on_goal_id || idea.waits_on_milestone_id) return { done: true, lines: [], options: [] };
    return {
      done: false,
      lines: [
        `“${idea.title}” waits on “${job.title}”: it stays in the backlog as Waiting, and can't be made a goal without “Start anyway” and a reason.`,
        'The Timeline shows it as a dashed lane after the job goal; the weekly review shows how long it has waited.',
        `When “${job.title}” is done, Today asks if you're ready to prepare it. Change what it waits on (a milestone like “Offer signed”, say) in the idea.`,
      ],
      options: [],
    };
  },
  ops(data) {
    const { idea, job } = glampParts(data);
    if (!idea || !job || idea.waits_on_goal_id || idea.waits_on_milestone_id) return [];
    return [{ kind: 'update', collection: 'ideas', id: idea.id, patch: { waits_on_goal_id: job.id, waits_on_milestone_id: null, waiting_since: new Date().toISOString() } }];
  },
};

/** Every update the app ships, newest first. */
export const APP_UPDATES: AppUpdate[] = [glampWaitsUpdate, flexMeasuresUpdate, docStudyUpdate];
