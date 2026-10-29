import { addDays, rankAtEnd, weekStart, type Action, type ActionSchedule, type Goal, type ISODate } from '@six/core';
import { applyOp, type AppData, type Op } from './model.ts';
import { opsCreateGoal, opsCreatePlan, opsEnsureWeek, opsLogSession, opsToggleMilestone } from './ops.ts';
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

// ---------- Glamping Site: a group of four ideas, planned for next season ----------

const GLAMP_GROUP = 'Glamping Site';
const MONTHS3 = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const seasonName = (start: ISODate, end: ISODate) => `${MONTHS3[Number(start.slice(5, 7)) - 1]} ${Number(start.slice(8))} – ${MONTHS3[Number(end.slice(5, 7)) - 1]} ${Number(end.slice(8))}`;

/** The four goals-to-be, in order, with rough windows (days from the season's start; null = its end). */
export const GLAMP_IDEAS: { title: string; note: string; done: string; from: number; to: number | null }[] = [
  {
    title: 'Buy land',
    note: 'The ground the campground stands on, and the reward for finishing the AI goals.',
    done: 'Closed on a few semi-rural acres in Tennessee, North Carolina (greater Asheville) or greater Greenville SC, 30–45 min from a job-producing city: road access, power nearby, septic sized for the full build-out, zoning that allows short-term rentals, financing in place.',
    from: 0,
    to: 64,
  },
  {
    title: 'Build an A-frame',
    note: 'My home on site and the unit that appraises, so documented rental income can refinance the rest.',
    done: 'An A-frame built to code on a permanent foundation, with a full kitchen and bath; certificate of occupancy issued.',
    from: 65,
    to: null,
  },
  {
    title: 'Build 3 domes',
    note: 'The lighter units: more rentable nights without another full build.',
    done: 'Three domes on platforms, furnished with a kitchen and bath, listed and taking bookings.',
    from: 96,
    to: null,
  },
  {
    title: 'Build 3 tarp glamping sites',
    note: 'The cheapest, fastest nights to add: early income toward the mortgage.',
    done: 'Three tarp glamping sites on platforms with beds and a bathhouse nearby, listed and taking bookings.',
    from: 127,
    to: null,
  },
];

function glampSetup(data: AppData, today: ISODate) {
  const plans = data.plans.filter((p) => !p.archived_at).sort((a, b) => (a.start_date < b.start_date ? -1 : 1));
  const current = plans.find((p) => p.start_date <= today && p.end_date >= today) ?? null;
  const next = current ? plans.find((p) => p.start_date > current.start_date) ?? null : null;
  const path = data.paths.find((p) => !p.archived_at && /glamp/i.test(p.name)) ?? null;
  const job = data.goals.find((g) => live(g) && /product owner role|land an? ai/i.test(g.title)) ?? null;
  const group = data.groups.find((g) => g.name.trim().toLowerCase() === GLAMP_GROUP.toLowerCase()) ?? null;
  const inGroup = group ? data.ideas.filter((i) => i.group_id === group.id && i.status !== 'discarded') : [];
  const existing = data.ideas.find((i) => i.status === 'backlog' && /glamp/i.test(i.title) && !GLAMP_IDEAS.some((g) => g.title === i.title)) ?? null;
  const missing = GLAMP_IDEAS.filter((g) => !inGroup.some((i) => i.title === g.title));
  return { current, next, path, job, group, existing, missing };
}

export const glampGroupUpdate: AppUpdate = {
  id: 'glamping-site-group-2026-10',
  title: 'Glamping Site',
  nudge: 'Glamping Site as its own group: buy land, an A-frame, 3 domes and 3 tarp sites, selected for next and planned on next season’s Roadmap.',
  preview(data, today) {
    const p = glampSetup(data, today);
    if (!p.current) return { done: true, blocked: 'Start a season first.', lines: [], options: [] };
    if (!p.missing.length) return { done: true, lines: [], options: [] };
    const nextDates = p.next ?? null;
    const lines = [
      `A “${GLAMP_GROUP}” group${p.group ? ' (yours)' : ''} with ${GLAMP_IDEAS.map((g) => `“${g.title}”`).join(', ')}, each with why it matters and what done means, in Selected for next.`,
      p.existing ? `Your “${p.existing.title}” idea becomes “Buy land”, keeping its history.` : '',
      `Planned for ${nextDates ? nextDates.name : 'next season (made now: the six months after this one)'} on the Roadmap, as dashed bars: land first, then the A-frame, domes and tarp sites.`,
      p.job ? `The group waits on “${p.job.title}”: when it's done, Today says the ideas are ready.` : '',
      p.path ? `All four on ${p.path.name}.` : '',
      'Making one a goal puts it in the group. To start one sooner, pick this season when you make it.',
    ].filter(Boolean);
    return { done: false, lines, options: [] };
  },
  ops(data, today) {
    const p = glampSetup(data, today);
    if (!p.current || !p.missing.length) return [];
    const ops: Op[] = [];
    let next = data;
    const add = (more: Op[]) => {
      ops.push(...more);
      next = more.reduce(applyOp, next);
    };
    const nowIso = new Date().toISOString();
    // Next season: the six months after this one, if there isn't one yet.
    let season = p.next;
    if (!season) {
      const start = addDays(p.current.end_date, 1);
      const end = addDays(start, 182);
      const made = opsCreatePlan({ name: seasonName(start, end), start, end });
      add(made.ops);
      season = made.plan;
    }
    // The group, waiting on the job (or keeping what it already waits on).
    let groupId = p.group?.id;
    if (!groupId) {
      groupId = newId();
      add([{ kind: 'insert', collection: 'groups', rows: [{ id: groupId, name: GLAMP_GROUP, created_at: nowIso, ...(p.job ? { waits_on_goal_id: p.job.id, waits_on_milestone_id: null, waiting_since: p.existing?.waiting_since ?? nowIso } : {}) } as Row] }]);
    } else if (p.job && !p.group!.waits_on_goal_id && !p.group!.waits_on_milestone_id) {
      add([{ kind: 'update', collection: 'groups', id: groupId, patch: { waits_on_goal_id: p.job.id, waiting_since: p.existing?.waiting_since ?? nowIso } }]);
    }
    for (const g of GLAMP_IDEAS) {
      if (!p.missing.some((m) => m.title === g.title)) continue;
      const from = addDays(season.start_date, g.from);
      const to = g.to == null ? season.end_date : addDays(season.start_date, g.to);
      const fields = { title: g.title, note: g.note, done_means: g.done, group_id: groupId, plan_id: season.id, planned_start: from, planned_end: to > season.end_date ? season.end_date : to, path_id: p.path?.id ?? null, shortlisted_at: nowIso, status: 'backlog', rank: rankAtEnd(next.ideas, 'selected') };
      if (g.title === 'Buy land' && p.existing) {
        // The idea it grew from: renamed, its own wait moved to the group.
        add([{ kind: 'update', collection: 'ideas', id: p.existing.id, patch: { ...fields, waits_on_goal_id: null, waits_on_milestone_id: null, waiting_since: null } }]);
      } else {
        add([{ kind: 'insert', collection: 'ideas', rows: [{ id: newId(), goal_id: null, created_at: nowIso, started_at: null, ...fields } as Row] }]);
      }
    }
    return ops;
  },
};

// ---------- Fermentation: kombucha to sake, every Sunday ----------

const FERMENT_GROUP = 'Fermentation';
const FERMENT_TASK = 'Fermentation Sunday';

/**
 * The ladder from the fermentation roadmap: each ferment hands skills to the next. This season:
 * kombucha (a batch every Sunday), hard kombucha, a hydromel mead, and koji basics (amazake, miso,
 * growing koji). Next season, as planned ideas: doburoku, then sake. Dates are days from the season's
 * start (Oct 26) for goals, and from next season's start for ideas.
 */
export const FERMENT_GOALS: { title: string; why: string; done: string; from: number; to: number | null; color: string; milestones: { title: string; day: number }[] }[] = [
  {
    title: 'Kombucha, dialed in',
    why: 'The first ferment, and the base for hard kombucha: batch one was okay, batch two or three is the real thing.',
    done: 'A batch I’d happily pour (batch 2 or 3), brewed every Sunday: 7–14 days first ferment, then 2–4 days in bottles for fizz.',
    from: 0,
    to: 34,
    color: '#F5B83D',
    milestones: [
      { title: 'Batch 2 bottled', day: 13 },
      { title: 'A batch I’d happily pour', day: 34 },
    ],
  },
  {
    title: 'Hard kombucha',
    why: 'Kombucha plus champagne yeast under an airlock: the step that teaches the gear and the yeast mead needs.',
    done: '2–3 batches with one good: 10–14 days normal ferment, 7–14 days under an airlock with EC-1118, 5–7 days conditioning in bottles.',
    from: 13,
    to: 97,
    color: '#FF7A45',
    milestones: [
      { title: 'Gear: airlock jar, EC-1118, hydrometer, Star San, Fermaid O', day: 12 },
      { title: 'Batch 1 under the airlock', day: 20 },
      { title: 'Batch 1 bottled', day: 48 },
      { title: 'Batch 2: more nutrient, steady temperature', day: 97 },
    ],
  },
  {
    title: 'Mead: a hydromel',
    why: 'Almost all the hard kombucha gear carries over, and a hydromel drinks well in weeks, not a year.',
    done: 'A 5–8% hydromel I’d pour at 4–6 weeks (staggered nutrients), with batch 2 started before batch 1 was done.',
    from: 41,
    to: null,
    color: '#E8559B',
    milestones: [
      { title: 'Gear: 71B or D47 yeast, raw honey (~3 lb/gal), auto-siphon, gram scale', day: 40 },
      { title: 'Hydromel batch 1 started', day: 41 },
      { title: 'Batch 2 started', day: 69 },
      { title: 'Batch 1 tasted at 6 weeks', day: 83 },
    ],
  },
  {
    title: 'Koji basics: amazake, miso, grown koji',
    why: 'Koji turning starch into sugar is the step miso, doburoku and sake all depend on: amazake shows it in a day, miso over months.',
    done: 'Two batches of amazake, a white miso tasted and a red miso aging, and koji grown three times.',
    from: 55,
    to: null,
    color: '#3FB6C9',
    milestones: [
      { title: 'Gear: rice koji, probe thermometer, a cooker that holds 140°F, crock, soybeans, salt', day: 54 },
      { title: 'Amazake batch 1', day: 55 },
      { title: 'White miso and a red miso started', day: 62 },
      { title: 'Amazake batch 2', day: 69 },
      { title: 'Koji incubator: cooler, seedling mat, hygrometer, koji-kin', day: 96 },
      { title: 'White miso tasted', day: 118 },
      { title: 'Koji grown: 3 runs', day: 160 },
    ],
  },
];

export const FERMENT_IDEAS: { title: string; note: string; done: string; from: number; to: number | null }[] = [
  {
    title: 'Doburoku',
    note: 'Unfiltered sake: the same rice-and-koji additions as sake, but forgiving. Sake yeast, and the “let it go too far and it sours” lesson, cheaply.',
    done: '3–4 batches to good: 2–3 weeks each, staged rice and koji additions, sake yeast (Wyeast 4134 or WLP705), caught before it sours.',
    from: 0,
    to: 64,
  },
  {
    title: 'Sake',
    note: 'The goal the whole ladder leads to.',
    done: 'A first sake in a fridge on a temperature controller at 50–55°F: a 2-week shubo, three staged additions, pressed, pasteurized, aging 1–3 months.',
    from: 65,
    to: null,
  },
];

const FERMENT_DETAILS = [
  'One session every Sunday: start or bottle the week’s kombucha, then whatever ferment is in progress.',
  'Fall: kombucha batch 2, then hard kombucha, then the first hydromel.',
  'Holidays: amazake, a white miso, mead batch 2; start a red miso.',
  'Winter: grow koji (3–5 runs, 48 h at 86–90°F, humid). A second red miso if the first looked right.',
  'Spring–summer (next season): doburoku, then the first sake with a temperature-controlled fridge.',
  'Most of it is low-touch waiting: three jars going at once is normal after the first month.',
].join('\n');

function fermentSetup(data: AppData, today: ISODate) {
  const plans = data.plans.filter((p) => !p.archived_at).sort((a, b) => (a.start_date < b.start_date ? -1 : 1));
  const current = plans.find((p) => p.start_date <= today && p.end_date >= today) ?? null;
  const next = current ? plans.find((p) => p.start_date > current.start_date) ?? null : null;
  const group = data.groups.find((g) => g.name.trim().toLowerCase() === FERMENT_GROUP.toLowerCase()) ?? null;
  const goals = data.goals.filter((g) => !g.archived_at && FERMENT_GOALS.some((f) => f.title === g.title));
  const ideas = data.ideas.filter((i) => i.status !== 'discarded' && FERMENT_IDEAS.some((f) => f.title === i.title));
  const task = data.actions.find((a) => !a.archived_at && a.title === FERMENT_TASK) ?? null;
  return { current, next, group, goals, ideas, task };
}

export const fermentUpdate: AppUpdate = {
  id: 'fermentation-group-2026-10',
  title: 'Fermentation: kombucha to sake',
  nudge: 'Fermentation as a group: kombucha every Sunday, then hard kombucha, mead and koji this season; doburoku and sake next.',
  preview(data, today) {
    const p = fermentSetup(data, today);
    if (!p.current) return { done: true, blocked: 'Start a season first.', lines: [], options: [] };
    if (p.goals.length === FERMENT_GOALS.length && p.ideas.length === FERMENT_IDEAS.length && p.task) return { done: true, lines: [], options: [] };
    const S = p.current.start_date;
    const day = (n: number | null) => (n == null ? p.current!.end_date : addDays(S, n));
    const lines = [
      `A “${FERMENT_GROUP}” group, with four goals this season:`,
      ...FERMENT_GOALS.map((g) => `${g.title}: ${dayLabel(day(g.from))} – ${dayLabel(day(g.to))}`),
      `“${FERMENT_TASK}”: one session every Sunday from ${dayLabel(nextSunday(today))}, shared by all four (start or bottle the week’s kombucha, then whatever’s in progress). The minimum: start the next kombucha.`,
      `Each goal has its dates from the roadmap, including when to buy the gear for it.`,
      `Next season, selected for next and on its Roadmap: Doburoku, then Sake${p.next ? '' : ' (next season is made now)'}.`,
    ];
    return { done: false, lines, options: [] };
  },
  ops(data, today) {
    const p = fermentSetup(data, today);
    if (!p.current) return [];
    const ops: Op[] = [];
    let next = data;
    const add = (more: Op[]) => {
      ops.push(...more);
      next = more.reduce(applyOp, next);
    };
    const season = p.current;
    const nowIso = new Date().toISOString();
    let groupId = p.group?.id;
    if (!groupId) {
      groupId = newId();
      add([{ kind: 'insert', collection: 'groups', rows: [{ id: groupId, name: FERMENT_GROUP, created_at: nowIso } as Row] }]);
    }
    // The goals, in the group, with their dates and the roadmap's milestones.
    const goalIds: string[] = [];
    for (const f of FERMENT_GOALS) {
      const have = next.goals.find((g) => !g.archived_at && g.title === f.title);
      if (have) {
        goalIds.push(have.id);
        continue;
      }
      const start = addDays(season.start_date, f.from);
      const end = f.to == null ? season.end_date : addDays(season.start_date, f.to);
      const made = opsCreateGoal(
        next,
        { planId: season.id, title: f.title, type: 'finish', why: f.why, done_means: f.done, color: f.color, unit: '', measureName: '', baseline: null, target: null, targetDate: end, path: [], milestones: f.milestones.map((m) => ({ title: m.title, due_date: addDays(season.start_date, m.day) })), action: null },
        today,
      );
      add(made.ops);
      add([{ kind: 'update', collection: 'goals', id: made.goalId, patch: { group_id: groupId, ...(start > season.start_date ? { start_date: start } : {}), ...(end < season.end_date ? { target_date: end } : {}) } }]);
      goalIds.push(made.goalId);
    }
    // One Sunday session, shared by all four goals.
    if (!p.task) {
      const action: Action = { id: newId(), title: FERMENT_TASK, kind: 'minutes', planned_minutes: 60, planned_count: null, min_label: 'Start the next kombucha', min_minutes: 20, min_count: null, priority: false, archived_at: null, details: FERMENT_DETAILS };
      const schedule: ActionSchedule = { id: newId(), action_id: action.id, rule: 'days', days: [7], per_week: null, effective_from: today, effective_to: null };
      add([
        { kind: 'insert', collection: 'actions', rows: [action as unknown as Row] },
        { kind: 'insert', collection: 'schedules', rows: [schedule as unknown as Row] },
        { kind: 'insert', collection: 'actionGoals', rows: goalIds.map((g) => ({ id: newId(), action_id: action.id, goal_id: g })) },
      ]);
    }
    // Next season: doburoku, then sake, as planned ideas in the group.
    let nextSeason = p.next;
    if (!nextSeason) {
      const start = addDays(season.end_date, 1);
      const end = addDays(start, 182);
      const made = opsCreatePlan({ name: seasonName(start, end), start, end });
      add(made.ops);
      nextSeason = made.plan;
    }
    for (const f of FERMENT_IDEAS) {
      if (next.ideas.some((i) => i.status !== 'discarded' && i.title === f.title)) continue;
      const from = addDays(nextSeason.start_date, f.from);
      const to = f.to == null ? nextSeason.end_date : addDays(nextSeason.start_date, f.to);
      add([{ kind: 'insert', collection: 'ideas', rows: [{ id: newId(), title: f.title, note: f.note, done_means: f.done, status: 'backlog', shortlisted_at: nowIso, rank: rankAtEnd(next.ideas, 'selected'), goal_id: null, created_at: nowIso, started_at: null, group_id: groupId, plan_id: nextSeason.id, planned_start: from, planned_end: to > nextSeason.end_date ? nextSeason.end_date : to } as Row] }]);
    }
    add(opsEnsureWeek(next, weekStart(today)));
    return ops;
  },
};

/** The next Sunday on or after a day. */
function nextSunday(d: ISODate): ISODate {
  const dow = new Date(`${d}T00:00:00Z`).getUTCDay();
  return addDays(d, (7 - dow) % 7);
}

/** Every update the app ships, newest first. */
export const APP_UPDATES: AppUpdate[] = [fermentUpdate, glampGroupUpdate, flexMeasuresUpdate, docStudyUpdate];
