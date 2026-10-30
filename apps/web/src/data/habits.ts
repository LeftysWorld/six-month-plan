import { describeSchedule, habitStats, shortDate, type Action, type ActionSchedule, type HabitStats, type ISODate, type Session } from '@six/core';
import type { AppData, Op } from './model.ts';
import { blankTask, opsEditTask, opsGenerateThisWeek, opsRemoveTask, scheduleFor, withOps, type TaskInput } from './breakdown.ts';
import { runningSchedule } from './connect.ts';

/**
 * Habits: tasks that aren't for any goal ("Clean house, every day"). They're ordinary tasks with no
 * goal attached, so they show on Today, log the same way and count in reviews. They have their own
 * tab with streaks, and a section on Today.
 */

const newId = () => crypto.randomUUID();

/** Is this task a habit (no goal attached)? */
export function isHabit(data: AppData, actionId: string | null): boolean {
  if (!actionId) return false;
  if (data.actionGoals.some((ag) => ag.action_id === actionId)) return false;
  // A one-day task with no goal (say, a workout added for a day) is a task, not a habit.
  const schedules = data.schedules.filter((s) => s.action_id === actionId);
  return !(schedules.length > 0 && schedules.every((s) => s.effective_from === s.effective_to));
}

/** Habits you have: tasks with no goal, not archived, newest last. Ones that have ended come after running ones. */
export function habitsOf(data: AppData, today: ISODate): { action: Action; schedule: ActionSchedule | null; running: boolean }[] {
  return data.actions
    .filter((a) => !a.archived_at && isHabit(data, a.id))
    .map((action) => {
      const schedule = runningSchedule(data, action.id, today) ?? data.schedules.filter((s) => s.action_id === action.id).sort((a, b) => (a.effective_from < b.effective_from ? 1 : -1))[0] ?? null;
      const running = !!schedule && (schedule.effective_to == null || schedule.effective_to >= today);
      return { action, schedule, running };
    })
    .sort((a, b) => Number(b.running) - Number(a.running));
}

export function habitSessions(data: AppData, actionId: string): Session[] {
  return data.sessions.filter((s) => s.action_id === actionId);
}

export function statsFor(data: AppData, actionId: string, today: ISODate): HabitStats {
  return habitStats(habitSessions(data, actionId), today);
}

/** "Every day", "Mon, Wed, Fri", "3 times a week", plus "from Nov 14" / "until Dec 1" when it has dates. */
export function habitWhen(schedule: ActionSchedule | null, today: ISODate): string {
  if (!schedule) return 'Stopped';
  const parts = [describeSchedule(schedule)];
  if (schedule.effective_from > today) parts.push(`from ${shortDate(schedule.effective_from)}`);
  if (schedule.effective_to) parts.push(schedule.effective_to < today ? `ended ${shortDate(schedule.effective_to)}` : `until ${shortDate(schedule.effective_to)}`);
  return parts.join(' · ');
}

export function blankHabit(today: ISODate): TaskInput {
  const base = blankTask({ start_date: today, end_date: today } as never, today);
  return { ...base, title: '', minutes: 10, days: [1, 2, 3, 4, 5, 6, 7], through: null, start: null };
}

/** A new habit: a task with no goal, starting today (or its start date), shown on Today right away. */
export function opsCreateHabit(data: AppData, input: TaskInput, today: ISODate): { ops: Op[]; id: string } {
  const action: Action = {
    id: newId(),
    title: input.title.trim(),
    kind: input.kind,
    planned_minutes: Math.max(0, input.minutes),
    planned_count: input.kind === 'count' ? Math.max(1, input.count ?? 1) : null,
    min_label: input.minLabel.trim(),
    min_minutes: null,
    min_count: null,
    priority: false,
    step_id: null,
    archived_at: null,
    ...(input.cue.trim() ? { cue: input.cue.trim() } : {}),
  };
  const schedule = scheduleFor(action.id, input, today);
  const ops: Op[] = [
    { kind: 'insert', collection: 'actions', rows: [action as unknown as { id: string } & Record<string, unknown>] },
    { kind: 'insert', collection: 'schedules', rows: [schedule as unknown as { id: string } & Record<string, unknown>] },
  ];
  return { ops: [...ops, ...opsGenerateThisWeek(withOps(data, ops), today)], id: action.id };
}

/** Change a habit from today on (past days keep the old schedule). */
export function opsEditHabit(data: AppData, action: Action, input: TaskInput, today: ISODate): Op[] {
  return opsEditTask(data, action, { ...input, goalIds: undefined }, today, today);
}

/** Stop a habit from today on; its history stays. */
export function opsStopHabit(data: AppData, action: Action, today: ISODate): Op[] {
  return opsRemoveTask(data, action, today);
}


// ---------- The Habits tab: the week grid, slipping, graduating ----------

export type CellState = 'done' | 'small' | 'part' | 'missed' | 'skipped' | 'planned' | 'none' | 'future';

/** One day of a habit in the week grid. */
export interface HabitCell {
  date: ISODate;
  state: CellState;
  /** The session on that day, if any. */
  session: Session | null;
  /** Can it be tapped? (Not a future day.) */
  open: boolean;
}

const KEPT = new Set(['done', 'minimum', 'partial']);

function cellState(s: Session | null, date: ISODate, today: ISODate): CellState {
  if (date > today) return s && s.status !== 'planned' ? 'done' : 'future';
  if (!s) return 'none';
  if (s.status === 'minimum') return 'small';
  if (s.status === 'done') return 'done';
  if (s.status === 'partial') return 'part';
  if (s.status === 'skipped') return 'skipped';
  return date < today ? 'missed' : 'planned';
}

/** A habit's seven days, Monday to Sunday, for the week starting `monday`. */
export function weekCells(data: AppData, actionId: string, monday: ISODate, today: ISODate): HabitCell[] {
  const sessions = habitSessions(data, actionId).filter((s) => s.status !== 'moved');
  return Array.from({ length: 7 }, (_, i) => {
    const date = addDaysISO(monday, i);
    const s = sessions.find((x) => x.date === date) ?? null;
    return { date, state: cellState(s, date, today), session: s, open: date <= today };
  });
}

/** How the week is going: kept so far, and how many are due by now (times-a-week habits count the undated ones too). */
export function weekKept(data: AppData, actionId: string, monday: ISODate, today: ISODate): { kept: number; due: number; planned: number } {
  const sessions = habitSessions(data, actionId).filter((s) => s.status !== 'moved' && s.status !== 'skipped' && (s.date ? weekStartISO(s.date) === monday : s.week_start === monday));
  const kept = sessions.filter((s) => KEPT.has(s.status)).length;
  const end = addDaysISO(monday, 6);
  const dated = sessions.filter((s) => s.date);
  const undated = sessions.filter((s) => !s.date);
  let due = dated.filter((s) => s.date! < today || KEPT.has(s.status)).length;
  if (undated.length) {
    // Times a week: by today, a fair share of the week's count is due.
    const dayIn = today > end ? 7 : today < monday ? 0 : daysBetweenISO(monday, today);
    const share = Math.floor((sessions.length * dayIn) / 7);
    due = Math.max(due, Math.min(sessions.length, share));
  }
  return { kept, due, planned: sessions.length };
}

/** Kept / due over the `weeks` whole weeks before this one (null when nothing was due). */
export function usualRate(data: AppData, actionId: string, today: ISODate, weeks = 4): number | null {
  const thisMonday = weekStartISO(today);
  let kept = 0;
  let due = 0;
  for (let w = 1; w <= weeks; w++) {
    const k = weekKept(data, actionId, addDaysISO(thisMonday, -7 * w), today);
    kept += Math.min(k.kept, k.planned);
    due += k.planned;
  }
  return due ? kept / due : null;
}

/**
 * Habits slipping this week: kept noticeably less than usual with a few already due, or the last two
 * due days missed. Each comes with what to say about it.
 */
export function slippingHabits(data: AppData, today: ISODate): { action: Action; kept: number; due: number; usual: number | null; why: string }[] {
  const monday = weekStartISO(today);
  const out: { action: Action; kept: number; due: number; usual: number | null; why: string }[] = [];
  for (const h of habitsOf(data, today).filter((x) => x.running)) {
    const w = weekKept(data, h.action.id, monday, today);
    const usual = usualRate(data, h.action.id, today);
    const past = habitSessions(data, h.action.id)
      .filter((s) => s.date && s.date < today && s.status !== 'moved' && s.status !== 'skipped')
      .sort((a, b) => (a.date! < b.date! ? 1 : -1))
      .slice(0, 2);
    const twoMissed = past.length === 2 && past.every((s) => s.status === 'planned');
    const behind = w.due >= 2 && w.kept / w.due <= (usual ?? 1) - 0.3;
    if (!twoMissed && !behind) continue;
    const why = `${w.kept} of ${w.due} so far this week${usual != null ? ` · you usually keep ${Math.round(usual * 100)}%` : ''}`;
    out.push({ action: h.action, kept: w.kept, due: w.due, usual, why: twoMissed && !behind ? `Missed the last two days · ${why}` : why });
  }
  return out;
}

/** How long a habit has been tracked (days since its first session) and its rate over the last 8 weeks. */
export function trackRecord(data: AppData, actionId: string, today: ISODate): { days: number; rate8: number | null } {
  const sessions = habitSessions(data, actionId).filter((s) => s.status !== 'moved');
  const first = sessions.map((s) => s.date ?? s.week_start).sort()[0];
  const days = first ? daysBetweenISO(first, today) : 0;
  return { days, rate8: usualRate(data, actionId, today, 8) };
}

/** Ready to graduate: tracked about eight weeks with 85% or better kept. */
export function readyToGraduate(data: AppData, actionId: string, today: ISODate): boolean {
  const r = trackRecord(data, actionId, today);
  return r.days >= 56 && r.rate8 != null && r.rate8 >= 0.85;
}

/** Stopped habits split into the ones that stuck (Kept: 8+ weeks at 80%+) and the rest. */
export function keptAndStopped(data: AppData, today: ISODate): { kept: Action[]; stopped: Action[] } {
  const kept: Action[] = [];
  const stopped: Action[] = [];
  for (const h of habitsOf(data, today).filter((x) => !x.running)) {
    const end = h.schedule?.effective_to ?? today;
    const r = trackRecord(data, h.action.id, addDaysISO(end, 1));
    (r.days >= 56 && r.rate8 != null && r.rate8 >= 0.8 ? kept : stopped).push(h.action);
  }
  return { kept, stopped };
}

/**
 * Tap a day in the grid: nothing → done → the small version (when it has one) → nothing. A day with
 * no session gets one: a times-a-week habit uses one of the week's open ones, any other habit logs
 * an extra. Clearing an extra removes it.
 */
export function opsTapDay(data: AppData, action: Action, date: ISODate, today: ISODate): Op[] {
  if (date > today) return [];
  const sessions = habitSessions(data, action.id).filter((s) => s.status !== 'moved');
  const s = sessions.find((x) => x.date === date);
  const hasSmall = !!action.min_label?.trim();
  const clear = (x: Session): Op[] => {
    if (x.origin === 'unplanned') return [{ kind: 'delete', collection: 'sessions', id: x.id }];
    // A times-a-week session goes back to "any day this week".
    const weekly = !!data.schedules.find((sc) => sc.action_id === action.id && sc.rule === 'per_week' && sc.effective_from <= date && (sc.effective_to == null || sc.effective_to >= date));
    return [{ kind: 'update', collection: 'sessions', id: x.id, patch: { status: 'planned', logged_at: null, actual_minutes: null, actual_count: null, ...(weekly ? { date: null } : {}) } }];
  };
  if (s) {
    if (s.status === 'done' || s.status === 'partial') return hasSmall ? [{ kind: 'update', collection: 'sessions', id: s.id, patch: { status: 'minimum', logged_at: new Date().toISOString() } }] : clear(s);
    if (s.status === 'minimum') return clear(s);
    return [{ kind: 'update', collection: 'sessions', id: s.id, patch: { status: 'done', logged_at: new Date().toISOString(), actual_minutes: s.planned_minutes, actual_count: s.planned_count } }];
  }
  const open = sessions.find((x) => !x.date && x.week_start === weekStartISO(date) && x.status === 'planned');
  if (open) return [{ kind: 'update', collection: 'sessions', id: open.id, patch: { status: 'done', date, logged_at: new Date().toISOString(), actual_minutes: open.planned_minutes, actual_count: open.planned_count } }];
  return opsLogUnplannedHabit(action, date);
}

/** Log the small version for today (on today's session, or an extra). */
export function opsSmallToday(data: AppData, action: Action, today: ISODate): Op[] {
  const s = habitSessions(data, action.id).find((x) => x.date === today && x.status !== 'moved') ?? habitSessions(data, action.id).find((x) => !x.date && x.week_start === weekStartISO(today) && x.status === 'planned');
  if (s) return [{ kind: 'update', collection: 'sessions', id: s.id, patch: { status: 'minimum', date: today, logged_at: new Date().toISOString() } }];
  const ops = opsLogUnplannedHabit(action, today);
  return ops.map((o) => (o.kind === 'insert' ? { ...o, rows: o.rows.map((r) => ({ ...r, status: 'minimum' })) } : o));
}

/** Pause a habit for a week: stop it from today and start it again a week from today. */
export function opsPauseHabit(data: AppData, action: Action, today: ISODate): Op[] {
  const current = runningSchedule(data, action.id, today);
  if (!current) return [];
  const back = addDaysISO(today, 7);
  const ops = opsRemoveTask(data, action, today).filter((o) => !(o.kind === 'update' && o.collection === 'actions'));
  // A habit that ends within the week simply stops.
  if (current.effective_to && current.effective_to < back) return ops;
  const again: ActionSchedule = { ...current, id: newId(), effective_from: back };
  return [...ops, { kind: 'insert', collection: 'schedules', rows: [again as unknown as { id: string } & Record<string, unknown>] }];
}

function opsLogUnplannedHabit(action: Action, date: ISODate): Op[] {
  const monday = weekStartISO(date);
  const session: Session = {
    id: newId(),
    action_id: action.id,
    week_start: monday,
    slot: 1000 + Math.floor(Math.random() * 100000),
    date,
    title: action.title,
    priority: false,
    planned_minutes: 0,
    planned_count: null,
    status: 'done',
    actual_minutes: action.planned_minutes || null,
    actual_count: null,
    note: '',
    obstacles: [],
    origin: 'unplanned',
    source: 'manual',
    moved_from: null,
    logged_at: new Date().toISOString(),
  } as Session;
  return [{ kind: 'insert', collection: 'sessions', rows: [session as unknown as { id: string } & Record<string, unknown>] }];
}

function addDaysISO(d: ISODate, n: number): ISODate {
  const t = new Date(`${d}T00:00:00Z`);
  t.setUTCDate(t.getUTCDate() + n);
  return t.toISOString().slice(0, 10);
}
function daysBetweenISO(a: ISODate, b: ISODate): number {
  return Math.round((new Date(`${b}T00:00:00Z`).getTime() - new Date(`${a}T00:00:00Z`).getTime()) / 86400000);
}
function weekStartISO(d: ISODate): ISODate {
  const dow = (new Date(`${d}T00:00:00Z`).getUTCDay() + 6) % 7;
  return addDaysISO(d, -dow);
}
