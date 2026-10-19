import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from 'react';
import {
  addDays,
  describeSchedule,
  isoWeekday,
  progressFor,
  rangeLabel,
  shortDate,
  weekDates,
  weekdayName,
  type ActionKind,
  type Goal,
  type ISODate,
  type PaceLabel,
  type Plan,
  type PlanStep,
  type Session,
} from '@six/core';
import { useStore } from '../data/store.tsx';
import { fmt, minutesText, useView, type View } from '../data/derive.ts';
import type { AppData } from '../data/model.ts';
import { opsUpdateGoal } from '../data/ops.ts';
import {
  applyFrom,
  blankTask,
  childSteps,
  fixedTasksOn,
  inputFromTask,
  isOnce,
  opsAddTask,
  opsCopyTasks,
  opsCreateBreakdown,
  opsEditTask,
  opsRemoveTask,
  opsRespread,
  opsSyncPath,
  opsUpdateStep,
  stepAt,
  stepsForGoal,
  tasksInRange,
  withOps,
  type TaskInput,
  type WeekTask,
} from '../data/breakdown.ts';
import { href } from '../router.ts';
import { BackLink, Empty, Icon, PacePill, Sheet, WEEKDAY_NAMES, useToast } from '../components/ui.tsx';
import { LogSheet } from './LogSheet.tsx';

/**
 * The goal breakdown, top to bottom:
 * 6 months (the goal) → 3 months → 1 month → week → daily tasks.
 * Each level is connected to the one above it and can be edited on its own.
 */
export function Flow({ goalId }: { goalId: string }) {
  const { data, today, commit } = useStore();
  const view = useView();
  const toast = useToast();
  const goal = view.goal(goalId);
  const plans = goal ? view.plansForGoal(goal.id) : [];
  const plan = plans.find((p) => p.start_date <= today && p.end_date >= today) ?? plans[0] ?? null;
  const steps = goal && plan ? stepsForGoal(data, goal.id).filter((s) => s.plan_id === plan.id) : [];
  const quarters = steps.filter((s) => s.level === 'quarter');

  const focus = plan ? (today < plan.start_date ? plan.start_date : today > plan.end_date ? plan.end_date : today) : today;
  const [qId, setQ] = useState<string | null>(null);
  const [mId, setM] = useState<string | null>(null);
  const [wId, setW] = useState<string | null>(null);
  const [dayPick, setDayPick] = useState<ISODate | null>(null);

  const quarter = quarters.find((q) => q.id === qId) ?? stepAt(quarters, focus);
  const months = quarter ? childSteps(data, quarter.id) : [];
  const month = months.find((m) => m.id === mId) ?? stepAt(months, focus) ?? months[0];
  const weeks = month ? childSteps(data, month.id) : [];
  const week = weeks.find((w) => w.id === wId) ?? stepAt(weeks, focus) ?? weeks[0];
  // The day shown in the Day level: the one you tapped, else today, else the week's first day.
  const weekDays = week ? daysOfWeek(week) : [];
  const day = dayPick && weekDays.includes(dayPick) ? dayPick : weekDays.includes(today) ? today : weekDays[0] ?? today;
  const pickDay = (d: ISODate, scroll = false) => {
    setDayPick(d);
    if (scroll) window.setTimeout(() => document.getElementById('flow-day')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
  };

  if (!goal) return <Empty title="Goal not found." />;
  if (!plan) return <Empty title="This goal isn't in a plan yet." />;

  const pickQuarter = (q: PlanStep) => {
    setQ(q.id);
    setM(null);
    setW(null);
  };
  const pickMonth = (m: PlanStep) => {
    setM(m.id);
    setW(null);
  };

  return (
    <div className="stack">
      <div className="row-between">
        <BackLink label={plan.name} fallback={`/plans/${plan.id}`} />
        <a className="small strong" href={href(`/goals/${goal.id}`)} style={{ textDecoration: 'none', minHeight: 40, display: 'flex', alignItems: 'center' }}>
          Goal details ›
        </a>
      </div>
      <div>
        <div className="small muted row-start" style={{ gap: 6 }}>
          <span className="dot" style={{ background: goal.color }} />
          Breakdown
        </div>
        <h1>{goal.title}</h1>
      </div>

      {steps.length === 0 ? (
        <div className="card stack-sm">
          <h2>Break this goal down</h2>
          <p className="small muted" style={{ margin: 0 }}>
            Split {rangeLabel({ start: plan.start_date, end: plan.end_date })} into two 3-month stages, six months and weekly steps. You fill in what each one looks like and
            add the daily tasks.
          </p>
          <button className="btn primary" onClick={() => commit(opsCreateBreakdown(data, goal, plan))}>
            Create the breakdown
          </button>
        </div>
      ) : (
        <div className="flow">
          <Level n={1} name="6 months" dates={rangeLabel({ start: plan.start_date, end: plan.end_date })} color={goal.color}>
            <GoalLevel goal={goal} plan={plan} />
          </Level>

          <Level n={2} name="3 months" dates={quarter ? rangeLabel(dateRange(quarter)) : ''} color={goal.color}>
            <div className="grid-2">
              {quarters.map((q) => (
                <StepCard key={q.id} step={q} goal={goal} plan={plan} selected={q.id === quarter?.id} onSelect={() => pickQuarter(q)} />
              ))}
            </div>
            {quarter && <StepEditor key={quarter.id} step={quarter} goal={goal} plan={plan} childName="months and weeks" />}
          </Level>

          <Level n={3} name="1 month" dates={month ? rangeLabel(dateRange(month)) : ''} color={goal.color}>
            <div className="grid-3">
              {months.map((m) => (
                <StepCard key={m.id} step={m} goal={goal} plan={plan} selected={m.id === month?.id} onSelect={() => pickMonth(m)} compact />
              ))}
            </div>
            {month && <StepEditor key={month.id} step={month} goal={goal} plan={plan} childName="weeks" />}
          </Level>

          <Level n={4} name="Week" dates={week ? rangeLabel(dateRange(week)) : ''} color={goal.color}>
            <div className="week-strip" role="group" aria-label="Weeks in this month">
              {weeks.map((w) => (
                <WeekChip key={w.id} step={w} selected={w.id === week?.id} today={today} color={goal.color} onSelect={() => setW(w.id)} />
              ))}
            </div>
            {week && <StepEditor key={week.id} step={week} goal={goal} plan={plan} />}
            {week && <DailyTasks slot="week" goal={goal} plan={plan} week={week} weeks={[]} day={day} onPickDay={(d) => pickDay(d, true)} onToast={toast} />}
          </Level>

          <Level
            n={5}
            name="Daily tasks"
            dates={week ? `${weekdayName(day)}, ${shortDate(day)}${day === today ? ' · Today' : ''}` : ''}
            color={goal.color}
            last
            id="flow-day"
          >
            {week && (
              <DailyTasks
                slot="day"
                goal={goal}
                plan={plan}
                week={week}
                weeks={stepsForGoal(data, goal.id).filter((s) => s.level === 'week' && s.plan_id === plan.id)}
                day={day}
                onPickDay={(d) => pickDay(d)}
                onToast={toast}
              />
            )}
          </Level>
        </div>
      )}
    </div>
  );
}

function dateRange(s: PlanStep) {
  return { start: s.start_date, end: s.end_date };
}

// ---------- Layout: a numbered rail that connects each level to the next ----------

function Level({ n, name, dates, color, last, id, children }: { n: number; name: string; dates: string; color: string; last?: boolean; id?: string; children: ReactNode }) {
  return (
    <section className="flow-level" aria-label={name} id={id} style={{ scrollMarginTop: 12 }}>
      <div className="flow-rail" aria-hidden="true">
        <span className="flow-dot" style={{ borderColor: color, color }}>
          {n}
        </span>
        {!last && <span className="flow-line" style={{ background: color }} />}
      </div>
      <div className="stack-sm" style={{ minWidth: 0, paddingBottom: last ? 0 : 18 }}>
        <div className="row-between" style={{ minHeight: 30 }}>
          <h2 style={{ fontSize: 17 }}>{name}</h2>
          <span className="xsmall muted">{dates}</span>
        </div>
        {children}
      </div>
    </section>
  );
}

// ---------- Level 1: the goal itself ----------

function GoalLevel({ goal, plan }: { goal: Goal; plan: Plan }) {
  const { data, today, commit } = useStore();
  const view = useView();
  const toast = useToast();
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(goal.title);
  const [done, setDone] = useState(goal.done_means);
  const [target, setTarget] = useState<number | null>(goal.target_value);
  const pace = view.goalPace(goal, plan);
  const start = pace.number?.start;

  function save() {
    let ops = opsUpdateGoal(goal, { title: title.trim() || goal.title, done_means: done.trim(), target_value: goal.type === 'number' ? target : goal.target_value });
    if (goal.type === 'number' && target != null && target !== goal.target_value) {
      ops = [...ops, ...opsSpreadAll(withOps(data, ops), { ...goal, target_value: target }, plan, today)];
      toast('Goal saved and spread across every level');
    } else {
      toast('Goal saved');
    }
    commit(ops);
    setEditing(false);
  }

  return (
    <div className="card stack-sm" style={{ borderLeft: `4px solid ${goal.color}` }}>
      {editing ? (
        <>
          <label className="field">
            Goal
            <input value={title} onChange={(e) => setTitle(e.target.value)} />
          </label>
          {goal.type === 'number' && (
            <label className="field">
              Target by {shortDate(goal.target_date ?? plan.end_date)} ({goal.unit})
              <input type="number" inputMode="decimal" value={target ?? ''} onChange={(e) => setTarget(e.target.value === '' ? null : Number(e.target.value))} />
            </label>
          )}
          <label className="field">
            Done means
            <input value={done} onChange={(e) => setDone(e.target.value)} />
          </label>
          {goal.type === 'number' && <span className="xsmall muted">Changing the target re-spreads every 3-month, month and week target below.</span>}
          <div className="btn-row">
            <button className="btn small" onClick={() => setEditing(false)}>
              Cancel
            </button>
            <button className="btn primary small" onClick={save}>
              Save
            </button>
          </div>
        </>
      ) : (
        <>
          <div className="row-between">
            <b style={{ fontSize: 16 }}>{goal.title}</b>
            <div className="row-start" style={{ flexWrap: 'nowrap' }}>
              <PacePill label={pace.label} />
              <button className="link-btn small" onClick={() => setEditing(true)} aria-label="Edit the 6-month goal">
                Edit
              </button>
            </div>
          </div>
          {goal.type === 'number' && start && (
            <div className="num" style={{ fontSize: 22 }}>
              {fmt(start.value)} → {fmt(goal.target_value)} <span className="small muted" style={{ fontWeight: 400 }}>{goal.unit}</span>
            </div>
          )}
          {goal.done_means && <div className="small">Done means: {goal.done_means}</div>}
          {goal.why && <div className="xsmall muted" style={{ fontStyle: 'italic' }}>"{goal.why}"</div>}
          <div className="xsmall muted">{pace.summary}</div>
        </>
      )}
    </div>
  );
}

/** For number goals: set each 3-month target on the straight line to the goal, then spread each into months and weeks. */
function opsSpreadAll(data: AppData, goal: Goal, plan: Plan, today: ISODate) {
  const quarters = stepsForGoal(data, goal.id).filter((s) => s.level === 'quarter' && s.plan_id === plan.id);
  const startStep = quarters[0];
  if (!startStep || goal.target_value == null) return [];
  const startVal = Number(goal.baseline_value ?? data.measurements.find((m) => m.type_id === goal.measurement_type_id)?.value ?? goal.target_value);
  const total = Math.max(1, (Date.parse(plan.end_date) - Date.parse(addDays(plan.start_date, -1))) / 864e5);
  let next = data;
  let ops: ReturnType<typeof opsUpdateStep> = [];
  for (const q of quarters) {
    const t = (Date.parse(q.end_date) - Date.parse(addDays(plan.start_date, -1))) / 864e5 / total;
    const value = Math.round((startVal + (Number(goal.target_value) - startVal) * t) * 10) / 10;
    const upd = opsUpdateStep(q, { target_value: value });
    next = withOps(next, upd);
    const spread = opsRespread(next, goal, { ...q, target_value: value }, plan);
    next = withOps(next, spread);
    ops = [...ops, ...upd, ...spread];
  }
  return [...ops, ...opsSyncPath(next, goal, plan, today)];
}

// ---------- Levels 2–4: a selectable card per step, and an editor for the selected one ----------

interface StepStatus {
  state: 'past' | 'current' | 'upcoming';
  label: PaceLabel;
  text: string;
}

function stepStatus(view: View, data: AppData, goal: Goal, plan: Plan, step: PlanStep, today: ISODate): StepStatus {
  const state = step.end_date < today ? 'past' : step.start_date > today ? 'upcoming' : 'current';
  if (state === 'upcoming') return { state, label: 'none', text: `Starts ${shortDate(step.start_date)}` };
  if (goal.type === 'number') {
    const readings = view.measurementsFor(goal.measurement_type_id).filter((m) => m.measured_on <= step.end_date && m.measured_on <= today);
    const recent = readings.filter((m) => m.measured_on >= addDays(readings.at(-1)?.measured_on ?? step.end_date, -6));
    const value = recent.length ? recent.reduce((s, m) => s + Number(m.value), 0) / recent.length : null;
    if (value == null || step.target_value == null) return { state, label: 'none', text: 'No readings yet' };
    if (state === 'current') {
      const pace = view.goalPace(goal, plan);
      return { state, label: pace.label, text: `Now ${fmt(value)} · aiming for ${fmt(step.target_value)}` };
    }
    const direction = Math.sign(Number(goal.target_value ?? step.target_value) - Number(goal.baseline_value ?? value)) || -1;
    const hit = (Number(step.target_value) - value) * direction <= 0.05;
    return { state, label: hit ? 'on_track' : 'behind', text: `Ended at ${fmt(value)} · target ${fmt(step.target_value)}` };
  }
  if (goal.type === 'finish') {
    const ms = data.milestones.filter((m) => m.goal_id === goal.id && m.due_date >= step.start_date && m.due_date <= step.end_date);
    if (ms.length) {
      const done = ms.filter((m) => m.completed_at).length;
      const due = ms.filter((m) => m.due_date <= today).length;
      return { state, label: due === 0 ? 'none' : done >= due ? 'on_track' : 'behind', text: `${done} of ${ms.length} milestones` };
    }
  }
  const end = step.end_date < today ? step.end_date : addDays(today, -1);
  const sessions = view.sessionsForGoal(goal.id);
  if (end < step.start_date) return { state, label: 'none', text: 'Just started' };
  const p = progressFor(sessions, { start: step.start_date, end }, { today, dayFraction: 0 });
  if (p.planned === 0) return { state, label: 'none', text: 'No tasks yet' };
  return { state, label: p.label, text: `${fmt(p.actual)} of ${fmt(p.expected)} done` };
}

function StepCard({ step, goal, plan, selected, onSelect, compact }: { step: PlanStep; goal: Goal; plan: Plan; selected: boolean; onSelect: () => void; compact?: boolean }) {
  const { data, today } = useStore();
  const view = useView();
  const status = stepStatus(view, data, goal, plan, step, today);
  return (
    <button
      className="flow-card"
      aria-pressed={selected}
      onClick={onSelect}
      style={{ borderColor: selected ? goal.color : undefined, boxShadow: selected ? `0 0 0 1px ${goal.color}` : undefined, opacity: status.state === 'past' && !selected ? 0.75 : 1 }}
    >
      <span className="row-between" style={{ width: '100%', gap: 4 }}>
        <b style={{ fontSize: compact ? 13 : 14 }}>{step.title}</b>
        {status.state === 'current' && <span className="xsmall strong" style={{ color: goal.color }}>Now</span>}
        {status.state === 'past' && <Icon name="check" size={14} stroke={2.6} />}
      </span>
      <span className="xsmall muted">{rangeLabel(dateRange(step))}</span>
      {step.target_value != null && (
        <span className="num" style={{ fontSize: compact ? 15 : 18 }}>
          {fmt(step.target_value)} <span className="xsmall muted" style={{ fontWeight: 400 }}>{goal.unit}</span>
        </span>
      )}
      {step.target_note ? (
        <span className="xsmall" style={{ color: 'var(--ink-2)', display: '-webkit-box', WebkitLineClamp: compact ? 3 : 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
          {step.target_note}
        </span>
      ) : (
        <span className="xsmall muted" style={{ fontStyle: 'italic' }}>
          {step.target_value != null ? '' : 'Not described yet'}
        </span>
      )}
      {status.label !== 'none' && !compact && <PacePill label={status.label} />}
    </button>
  );
}

function WeekChip({ step, selected, today, color, onSelect }: { step: PlanStep; selected: boolean; today: ISODate; color: string; onSelect: () => void }) {
  const state = step.end_date < today ? 'past' : step.start_date > today ? 'upcoming' : 'current';
  return (
    <button
      className="week-chip"
      aria-pressed={selected}
      onClick={onSelect}
      style={{
        borderColor: selected ? color : state === 'current' ? color : undefined,
        background: selected ? color : undefined,
        color: selected ? '#fff' : undefined,
      }}
    >
      <b>{step.title.replace('Week ', 'W')}</b>
      <span>{shortDate(step.start_date)}</span>
      {state === 'current' && !selected && <span style={{ color, fontWeight: 600 }}>Now</span>}
    </button>
  );
}

/** Edit what a step should look like (and its number target), then optionally spread it downward. */
function StepEditor({ step, goal, plan, childName }: { step: PlanStep; goal: Goal; plan: Plan; childName?: string }) {
  const { data, today, commit } = useStore();
  const view = useView();
  const toast = useToast();
  const [note, setNote] = useState(step.target_note);
  const [target, setTarget] = useState<number | null>(step.target_value);
  const [spread, setSpread] = useState(true);
  useEffect(() => {
    setNote(step.target_note);
    setTarget(step.target_value);
  }, [step.target_note, step.target_value]);
  const status = stepStatus(view, data, goal, plan, step, today);
  const dirty = note !== step.target_note || target !== step.target_value;
  const levelWord = step.level === 'quarter' ? 'these 3 months' : step.level === 'month' ? 'this month' : 'this week';
  const milestones = useMemo(
    () => data.milestones.filter((m) => m.goal_id === goal.id && m.due_date >= step.start_date && m.due_date <= step.end_date).sort((a, b) => (a.due_date < b.due_date ? -1 : 1)),
    [data.milestones, goal.id, step.start_date, step.end_date],
  );

  function save() {
    let ops = opsUpdateStep(step, { target_note: note.trim(), target_value: goal.type === 'number' ? target : null });
    const targetChanged = goal.type === 'number' && target != null && target !== step.target_value;
    let next = withOps(data, ops);
    if (targetChanged && spread && childName) {
      const more = opsRespread(next, goal, { ...step, target_value: target }, plan);
      ops = [...ops, ...more];
      next = withOps(next, more);
    }
    if (targetChanged) ops = [...ops, ...opsSyncPath(next, goal, plan, today)];
    commit(ops);
    toast(targetChanged && spread && childName ? `${step.title} saved and spread to its ${childName}` : `${step.title} saved`);
  }

  return (
    <div className="card stack-sm flow-editor">
      <div className="row-between">
        <span className="label">
          {step.title} · {rangeLabel(dateRange(step))}
        </span>
        {status.label !== 'none' ? <PacePill label={status.label} /> : <span className="xsmall muted">{status.text}</span>}
      </div>
      {status.label !== 'none' && <span className="xsmall muted">{status.text}</span>}
      {goal.type === 'number' && (
        <label className="field">
          Target by {shortDate(step.end_date)} ({goal.unit})
          <input type="number" inputMode="decimal" step="0.1" value={target ?? ''} onChange={(e) => setTarget(e.target.value === '' ? null : Number(e.target.value))} />
        </label>
      )}
      <label className="field">
        What should be true by the end of {levelWord}?
        <textarea rows={2} value={note} placeholder={placeholderFor(goal, step)} onChange={(e) => setNote(e.target.value)} />
      </label>
      {milestones.length > 0 && (
        <div className="xsmall muted">
          Milestones in {levelWord}: {milestones.map((m) => `${m.title} (${shortDate(m.due_date)})${m.completed_at ? ' ✓' : ''}`).join(', ')}
        </div>
      )}
      {goal.type === 'number' && childName && target !== step.target_value && (
        <label className="row-start small">
          <input type="checkbox" checked={spread} onChange={(e) => setSpread(e.target.checked)} style={{ width: 20, height: 20 }} />
          Spread the new target evenly across its {childName}
        </label>
      )}
      {dirty && (
        <div className="btn-row">
          <button
            className="btn small"
            onClick={() => {
              setNote(step.target_note);
              setTarget(step.target_value);
            }}
          >
            Undo changes
          </button>
          <button className="btn primary small" onClick={save}>
            Save {step.title}
          </button>
        </div>
      )}
    </div>
  );
}

function placeholderFor(goal: Goal, step: PlanStep): string {
  if (goal.type === 'number') return step.level === 'week' ? 'e.g. Eating window every day, no weekday drinks' : 'e.g. Lock in the eating window';
  if (goal.type === 'finish') return step.level === 'week' ? 'e.g. Finish module 4 quiz' : 'e.g. Modules 1–4 passed';
  return step.level === 'week' ? 'e.g. G–C–D changes at 60 bpm' : 'e.g. Record song 1 start to finish';
}

// ---------- Level 5: the daily tasks for the selected week ----------

type Toast = (m: string, undo?: () => void) => void;

/** The calendar days of a week step (it may be a partial week at a month edge). */
function daysOfWeek(week: PlanStep): ISODate[] {
  return weekDates(addDays(week.start_date, 1 - isoWeekday(week.start_date))).filter((d) => d >= week.start_date && d <= week.end_date);
}

/**
 * Daily tasks for one week, in two places:
 * - slot "week": the whole week at once (in the Week level), tap a day to open it
 * - slot "day": the selected day's tasks with editing, plus every task in the week
 */
function DailyTasks({
  slot,
  goal,
  plan,
  week,
  weeks,
  day,
  onPickDay,
  onToast,
}: {
  slot: 'week' | 'day';
  goal: Goal;
  plan: Plan;
  week: PlanStep;
  weeks: PlanStep[];
  day: ISODate;
  onPickDay: (d: ISODate) => void;
  onToast: Toast;
}) {
  const { data, today, commit } = useStore();
  const [editing, setEditing] = useState<{ task: WeekTask | null; initial?: Partial<TaskInput> } | null>(null);
  const [logging, setLogging] = useState<Session | null>(null);
  const range = dateRange(week);
  const tasks = tasksInRange(data, goal.id, range, week.id);
  const over = week.end_date < today;
  const days = daysOfWeek(week);
  const available = data.profile.available_minutes;
  const flexible = tasks.filter((t) => t.schedule.rule === 'per_week');

  const runsOn = (t: WeekTask, d: ISODate) =>
    t.schedule.rule === 'days' && t.schedule.days.includes(isoWeekday(d)) && t.schedule.effective_from <= d && (t.schedule.effective_to == null || t.schedule.effective_to >= d);
  const goalOn = (d: ISODate) => tasks.filter((t) => runsOn(t, d));
  /** Sessions already on that day for this goal (e.g. a flexible session placed there). */
  const sessionsOn = (d: ISODate) => data.sessions.filter((x) => x.date === d && x.status !== 'moved' && tasks.some((t) => t.action.id === x.action_id));
  /** Everything for this goal on a date: fixed-day tasks plus sessions placed there. */
  const itemsOn = (d: ISODate): DayItem[] => {
    const fixed = goalOn(d).map((t) => ({
      key: t.action.id,
      title: t.action.title,
      minutes: t.action.planned_minutes,
      status: data.sessions.find((x) => x.action_id === t.action.id && x.date === d && x.status !== 'moved')?.status ?? 'planned',
    }));
    const extra = sessionsOn(d)
      .filter((x) => !fixed.some((f) => f.key === x.action_id))
      .map((x) => ({ key: x.id, title: x.title, minutes: x.planned_minutes, status: x.status }));
    return [...fixed, ...extra];
  };

  if (slot === 'week') {
    return (
      <WeekAgenda
        days={days}
        today={today}
        selected={day}
        color={goal.color}
        itemsOn={itemsOn}
        flexible={flexible.map((t) => `${t.action.title} ${t.schedule.per_week}×`)}
        minutesOn={(d) => fixedTasksOn(data, d).reduce((sum, t) => sum + t.minutes, 0)}
        capOn={(d) => available[isoWeekday(d) - 1] ?? 0}
        onOpen={onPickDay}
      />
    );
  }

  const prevWeek = weeks.filter((w) => w.end_date < week.start_date).at(-1);
  const prevTasks = prevWeek ? tasksInRange(data, goal.id, dateRange(prevWeek), prevWeek.id).filter((t) => !tasks.some((x) => x.action.id === t.action.id)) : [];
  const dayTasks = goalOn(day);
  const placed = sessionsOn(day).filter((x) => !dayTasks.some((t) => t.action.id === x.action_id));
  const dayPast = day < today;
  const dayIndex = days.indexOf(day);

  return (
    <div className="stack-sm">
      <div className="card stack-sm" style={{ borderLeft: `4px solid ${goal.color}` }}>
        <div className="row-between">
          <button className="btn small" aria-label="Previous day" disabled={dayIndex <= 0} onClick={() => onPickDay(days[dayIndex - 1]!)} style={{ minWidth: 44 }}>
            ‹
          </button>
          <div style={{ textAlign: 'center' }}>
            <b>
              {weekdayName(day)}, {shortDate(day)}
              {day === today ? ' · Today' : ''}
            </b>
            <div className="xsmall muted">
              {dayTasks.length + placed.length} task{dayTasks.length + placed.length === 1 ? '' : 's'} · shows on Today that day
            </div>
          </div>
          <button className="btn small" aria-label="Next day" disabled={dayIndex >= days.length - 1} onClick={() => onPickDay(days[dayIndex + 1]!)} style={{ minWidth: 44 }}>
            ›
          </button>
        </div>
        {dayTasks.length + placed.length === 0 && <span className="small muted">Nothing for this goal on this day.</span>}
        {dayTasks.map((t) => {
          const session = data.sessions.find((x) => x.action_id === t.action.id && x.date === day && x.status !== 'moved');
          return (
            <DayTaskRow
              key={t.action.id}
              title={t.action.title}
              detail={`${t.action.planned_minutes ? minutesText(t.action.planned_minutes) : ''}${session && session.status !== 'planned' ? ` · ${statusWord(session.status)}` : ''}`}
              color={goal.color}
              onEdit={over || dayPast ? undefined : () => setEditing({ task: t })}
              onThisDay={session && !dayPast ? () => setLogging(session) : undefined}
              thisDayLabel={session?.status === 'planned' ? 'Just this day' : 'Change log'}
            />
          );
        })}
        {placed.map((x) => {
          const t = tasks.find((tt) => tt.action.id === x.action_id);
          return (
            <DayTaskRow
              key={x.id}
              title={x.title}
              detail={`${x.planned_minutes ? minutesText(x.planned_minutes) : ''} · ${x.status === 'planned' ? 'placed on this day' : statusWord(x.status)}`}
              color={goal.color}
              onEdit={t && !over && !dayPast ? () => setEditing({ task: t }) : undefined}
              onThisDay={!dayPast ? () => setLogging(x) : undefined}
              thisDayLabel={x.status === 'planned' ? 'Just this day' : 'Change log'}
            />
          );
        })}
        {!over && !dayPast && (
          <button className="btn small ghost" onClick={() => setEditing({ task: null, initial: { when: 'once', date: day } })}>
            + Add a task on {weekdayName(day)}
          </button>
        )}
        {dayPast && <span className="xsmall muted">This day has passed. Log or fix it from Today, or pick a later day.</span>}
      </div>

      <div className="row-between" style={{ marginTop: 4 }}>
        <span className="label">All tasks in {week.title}</span>
        <span className="xsmall muted">{tasks.length}</span>
      </div>
      {tasks.length === 0 && <div className="card tight small muted">No daily tasks for {week.title} yet.</div>}
      {tasks.map((t) => (
        <TaskRow key={t.action.id} task={t} week={week} goal={goal} readOnly={over} onEdit={() => setEditing({ task: t })} />
      ))}

      {over ? (
        <p className="xsmall muted" style={{ margin: 0 }}>
          This week is over, so its tasks can't be changed. Pick the current or a future week to plan tasks.
        </p>
      ) : (
        <>
          <button className="btn primary" onClick={() => setEditing({ task: null })}>
            + Add a daily task
          </button>
          {prevWeek && prevTasks.some((t) => t.origin === 'here') && (
            <button
              className="btn ghost"
              onClick={() => {
                const ops = opsCopyTasks(data, goal, prevWeek, week, today);
                commit(ops);
                onToast(ops.length ? `Copied ${prevWeek.title}'s tasks` : 'Nothing to copy');
              }}
            >
              Copy {prevWeek.title}'s tasks into {week.title}
            </button>
          )}
        </>
      )}

      {editing && (
        <TaskSheet
          goal={goal}
          plan={plan}
          week={week}
          task={editing.task}
          initial={editing.initial}
          onClose={() => setEditing(null)}
          onSaved={(m) => {
            onToast(m);
            setEditing(null);
          }}
        />
      )}
      {logging && <LogSheet session={data.sessions.find((x) => x.id === logging.id) ?? logging} onClose={() => setLogging(null)} />}
    </div>
  );
}

interface DayItem {
  key: string;
  title: string;
  minutes: number;
  status: Session['status'];
}

/** The whole week at once: one row per day with that day's tasks. Tap a day to open it. */
function WeekAgenda({
  days,
  today,
  selected,
  color,
  itemsOn,
  flexible,
  minutesOn,
  capOn,
  onOpen,
}: {
  days: ISODate[];
  today: ISODate;
  selected: ISODate;
  color: string;
  itemsOn: (d: ISODate) => DayItem[];
  flexible: string[];
  minutesOn: (d: ISODate) => number;
  capOn: (d: ISODate) => number;
  onOpen: (d: ISODate) => void;
}) {
  return (
    <div className="stack-sm">
      {flexible.length > 0 && (
        <div className="card tight xsmall muted" style={{ borderStyle: 'dashed' }}>
          Any day this week: {flexible.join(', ')}
        </div>
      )}
      {days.map((d) => {
        const items = itemsOn(d);
        const isToday = d === today;
        const past = d < today;
        const all = minutesOn(d);
        const cap = capOn(d);
        const goalMinutes = items.reduce((sum, i) => sum + i.minutes, 0);
        return (
          <button
            key={d}
            className="week-day"
            onClick={() => onOpen(d)}
            aria-label={`${weekdayName(d)} ${shortDate(d)}: ${items.length} task${items.length === 1 ? '' : 's'}. Open day`}
            aria-pressed={d === selected}
            style={{
              borderColor: d === selected || isToday ? color : undefined,
              boxShadow: d === selected ? `0 0 0 2px ${color}` : undefined,
              background: d === selected ? `${color}12` : undefined,
              opacity: past && d !== selected ? 0.7 : 1,
            }}
          >
            <span className="week-day-date">
              <b style={{ color: isToday ? color : undefined }}>{weekdayName(d).slice(0, 3)}</b>
              <span className="num" style={{ fontSize: 20, lineHeight: 1.1 }}>
                {d.slice(8)}
              </span>
              {isToday && (
                <span className="xsmall strong" style={{ color }}>
                  Today
                </span>
              )}
            </span>
            <span className="stack-sm" style={{ gap: 6, minWidth: 0, flex: 1 }}>
              <span className="chips" style={{ gap: 5 }}>
                {items.map((i) => (
                  <span key={i.key} className="mini-chip" style={chipLook(i.status, color)}>
                    {i.status === 'done' ? '✓ ' : i.status === 'skipped' ? '✕ ' : i.status === 'minimum' || i.status === 'partial' ? '– ' : ''}
                    {i.title}
                    {i.minutes ? <span style={{ fontWeight: 400, opacity: 0.8 }}> {i.minutes}</span> : null}
                  </span>
                ))}
                {items.length === 0 && <span className="small muted">Nothing for this goal</span>}
              </span>
              <span className="xsmall" style={{ color: all > cap ? 'var(--amber-ink)' : 'var(--muted)', fontWeight: all > cap ? 600 : 400 }}>
                {goalMinutes ? `${minutesText(goalMinutes)} for this goal · ` : ''}
                {minutesText(all)} of {minutesText(cap)} planned overall{all > cap ? ' · over' : ''}
              </span>
            </span>
            <span style={{ color: 'var(--muted)', display: 'flex', alignSelf: 'center' }}>
              <Icon name="chevron" size={18} />
            </span>
          </button>
        );
      })}
      <span className="xsmall muted">Done ✓ · minimum or partial – · skipped ✕ · dashed = still to do. Tap a day to open it below.</span>
    </div>
  );
}

function chipLook(status: Session['status'], color: string): CSSProperties {
  switch (status) {
    case 'done':
      return { background: `${color}22`, color: 'var(--ink)', border: `1px solid ${color}55` };
    case 'minimum':
    case 'partial':
      return { background: 'var(--amber-soft)', color: 'var(--amber-ink)', border: '1px solid #e9c98f' };
    case 'skipped':
      return { background: 'var(--line-2)', color: 'var(--muted)', border: '1px solid var(--line)', textDecoration: 'line-through' };
    default:
      return { background: '#fff', color: 'var(--ink)', border: `1.5px dashed ${color}` };
  }
}

function statusWord(status: Session['status']): string {
  return status === 'minimum' ? 'minimum kept' : status;
}

function DayTaskRow({ title, detail, color, onEdit, onThisDay, thisDayLabel }: { title: string; detail: string; color: string; onEdit?: () => void; onThisDay?: () => void; thisDayLabel: string }) {
  return (
    <div className="list-row" style={{ gap: 8, flexWrap: 'wrap' }}>
      <span className="dot" style={{ background: color }} />
      <span className="grow">
        <span className="strong small" style={{ display: 'block' }}>
          {title}
        </span>
        {detail && <span className="xsmall muted">{detail}</span>}
      </span>
      {onThisDay && (
        <button className="btn small" onClick={onThisDay} aria-label={`${thisDayLabel}: ${title}`}>
          {thisDayLabel}
        </button>
      )}
      {onEdit && (
        <button className="btn small" onClick={onEdit} aria-label={`Edit ${title} on every day`}>
          Edit
        </button>
      )}
    </div>
  );
}

function TaskRow({ task, week, goal, readOnly, onEdit }: { task: WeekTask; week: PlanStep; goal: Goal; readOnly: boolean; onEdit: () => void }) {
  const { data } = useStore();
  const { action, schedule } = task;
  const once = isOnce(schedule);
  const when = once ? `${weekdayName(schedule.effective_from)} ${shortDate(schedule.effective_from)} only` : describeSchedule(schedule);
  const through = once ? '' : schedule.effective_to == null ? 'no end date' : schedule.effective_to === week.end_date ? 'this week' : `through ${shortDate(schedule.effective_to)}`;
  const origin = task.origin === 'carried' ? `from ${data.planSteps.find((s) => s.id === action.step_id)?.title ?? 'an earlier week'}` : task.origin === 'ongoing' ? 'from goal setup' : '';
  return (
    <div className="task" style={{ paddingLeft: 12 }}>
      <span className="dot" style={{ background: goal.color, marginRight: 10 }} />
      <span className="grow" style={{ padding: '10px 0' }}>
        <span className="title" style={{ display: 'block' }}>
          {action.title}
          {action.planned_count ? ` ×${action.planned_count}` : ''}
        </span>
        <span className="meta">
          {when}
          {through ? ` · ${through}` : ''}
          {origin ? ` · ${origin}` : ''}
          {action.planned_minutes ? ` · ${minutesText(action.planned_minutes)}` : ''}
        </span>
      </span>
      {!readOnly && (
        <button className="btn small" onClick={onEdit} aria-label={`Edit ${action.title}`} style={{ marginLeft: 8 }}>
          Edit
        </button>
      )}
    </div>
  );
}

const KINDS: { value: ActionKind; label: string }[] = [
  { value: 'check', label: 'Just do it' },
  { value: 'minutes', label: 'Minutes' },
  { value: 'count', label: 'Count' },
  { value: 'workout', label: 'Workout' },
  { value: 'study', label: 'Study' },
];

function TaskSheet({
  goal,
  plan,
  week,
  task,
  initial,
  onClose,
  onSaved,
}: {
  goal: Goal;
  plan: Plan;
  week: PlanStep;
  task: WeekTask | null;
  initial?: Partial<TaskInput>;
  onClose: () => void;
  onSaved: (m: string) => void;
}) {
  const { data, today, commit } = useStore();
  const [v, setV] = useState<TaskInput>(() => (task ? inputFromTask(task, week) : { ...blankTask(week, today), ...initial }));
  const set = (patch: Partial<TaskInput>) => setV((x) => ({ ...x, ...patch }));
  const from = applyFrom(week, today);
  const month = data.planSteps.find((s) => s.id === week.parent_id);
  const quarter = month ? data.planSteps.find((s) => s.id === month.parent_id) : undefined;
  const throughOptions: [string, ISODate | null][] = [
    ['This week', week.end_date],
    ...(month && month.end_date > week.end_date ? [[`End of ${month.title}`, month.end_date] as [string, ISODate]] : []),
    ...(quarter && quarter.end_date > (month?.end_date ?? week.end_date) ? [[`End of ${quarter.title.toLowerCase()}`, quarter.end_date] as [string, ISODate]] : []),
    ...(plan.end_date > (quarter?.end_date ?? week.end_date) ? [['End of plan', plan.end_date] as [string, ISODate]] : []),
    ['No end date', null],
  ];
  if (!throughOptions.some(([, d]) => d === v.through)) throughOptions.push([`Through ${shortDate(v.through!)}`, v.through]);
  const originalDate = task && isOnce(task.schedule) ? task.schedule.effective_from : null;
  const dayChoices = weekDates(addDays(week.start_date, 1 - isoWeekday(week.start_date))).filter(
    (d) => d >= week.start_date && d <= week.end_date && (d >= from || d === originalDate),
  );
  const valid = v.title.trim().length > 0 && (v.when !== 'days' || v.days.length > 0) && (v.when !== 'once' || dayChoices.includes(v.date));

  function save() {
    if (!valid) return;
    if (task) {
      // A one-day task on a day that has already passed only changes its details, not its date.
      const editFrom = originalDate && originalDate < from && v.when === 'once' && v.date === originalDate ? originalDate : from;
      commit(opsEditTask(data, task.action, v, editFrom, today));
      onSaved(`${v.title.trim()} updated${editFrom > today ? ` from ${shortDate(editFrom)}` : ''}`);
    } else {
      commit(opsAddTask(data, goal, week, v, today));
      onSaved(`Added ${v.title.trim()}${week.start_date <= today ? ". It's on Today when it's due." : ''}`);
    }
  }

  return (
    <Sheet title={task ? 'Edit daily task' : `New task · ${week.title}`} onClose={onClose}>
      <div className="row-start small muted" style={{ marginTop: -8 }}>
        <span className="dot" style={{ background: goal.color }} />
        {goal.title} · {rangeLabel(dateRange(week))}
      </div>
      <label className="field">
        Task
        <input autoFocus value={v.title} onChange={(e) => set({ title: e.target.value })} placeholder="e.g. Practice chord changes" />
      </label>
      <div className="stack-sm">
        <span className="xsmall muted">When</span>
        <div className="seg" role="tablist" aria-label="When">
          <button role="tab" aria-selected={v.when === 'days'} onClick={() => set({ when: 'days' })}>
            Set days
          </button>
          <button role="tab" aria-selected={v.when === 'per_week'} onClick={() => set({ when: 'per_week' })}>
            Times a week
          </button>
          <button role="tab" aria-selected={v.when === 'once'} onClick={() => set({ when: 'once', date: dayChoices.includes(v.date) ? v.date : dayChoices[0] ?? v.date })}>
            One day
          </button>
        </div>
        {v.when === 'days' && (
          <div className="chips" role="group" aria-label="Days">
            {WEEKDAY_NAMES.map((d, i) => {
              const dayNo = i + 1;
              const on = v.days.includes(dayNo);
              return (
                <button key={d} className="chip" aria-pressed={on} onClick={() => set({ days: on ? v.days.filter((x) => x !== dayNo) : [...v.days, dayNo].sort() })}>
                  {d}
                </button>
              );
            })}
            <button className="chip" onClick={() => set({ days: [1, 2, 3, 4, 5, 6, 7] })}>
              Every day
            </button>
          </div>
        )}
        {v.when === 'per_week' && (
          <label className="field">
            Times a week (place them on days from Today)
            <input type="number" min={1} max={14} value={v.perWeek} onChange={(e) => set({ perWeek: Math.min(14, Math.max(1, Number(e.target.value))) })} />
          </label>
        )}
        {v.when === 'once' && (
          <div className="chips" role="group" aria-label="Day">
            {dayChoices.map((d) => (
              <button key={d} className="chip" aria-pressed={v.date === d} onClick={() => set({ date: d })}>
                {d === today ? 'Today' : `${weekdayName(d)} ${d.slice(8)}`}
              </button>
            ))}
            {dayChoices.length === 0 && <span className="small muted">No days left this week.</span>}
          </div>
        )}
      </div>
      {v.when !== 'once' && (
        <label className="field">
          Repeat
          <select value={v.through ?? ''} onChange={(e) => set({ through: e.target.value || null })}>
            {throughOptions.map(([label, d]) => (
              <option key={label} value={d ?? ''}>
                {label}
                {d ? ` (${shortDate(d)})` : ''}
              </option>
            ))}
          </select>
        </label>
      )}
      <div className="stack-sm">
        <span className="xsmall muted">How you log it</span>
        <div className="chips">
          {KINDS.map((k) => (
            <button key={k.value} className="chip" aria-pressed={v.kind === k.value} onClick={() => set({ kind: k.value })}>
              {k.label}
            </button>
          ))}
        </div>
      </div>
      <div className="grid-2">
        <label className="field">
          Minutes
          <input type="number" min={0} value={v.minutes} onChange={(e) => set({ minutes: Math.max(0, Number(e.target.value)) })} />
        </label>
        {v.kind === 'count' && (
          <label className="field">
            How many
            <input type="number" min={1} value={v.count ?? 1} onChange={(e) => set({ count: Math.max(1, Number(e.target.value)) })} />
          </label>
        )}
      </div>
      <label className="field">
        Minimum version for hard days (optional)
        <input value={v.minLabel} onChange={(e) => set({ minLabel: e.target.value })} placeholder="e.g. 5 minutes" />
      </label>
      <label className="row-start small">
        <input type="checkbox" checked={v.priority} onChange={(e) => set({ priority: e.target.checked })} style={{ width: 20, height: 20 }} />
        Show under Priorities on Today
      </label>
      {task && (
        <p className="xsmall muted" style={{ margin: 0 }}>
          Changes apply from {from === today ? 'today' : shortDate(from)} on, on every day this task runs. Days already logged keep their history. To change only one day, tap that
          day above and choose "Just this day".
        </p>
      )}
      <div className="btn-row">
        {task && (
          <button
            className="btn danger"
            onClick={() => {
              commit(opsRemoveTask(data, task.action, from));
              onSaved(`${task.action.title} removed from ${from === today ? 'today' : shortDate(from)} on`);
            }}
          >
            Remove
          </button>
        )}
        <button className="btn primary" disabled={!valid} onClick={save}>
          {task ? 'Save changes' : 'Add task'}
        </button>
      </div>
    </Sheet>
  );
}
