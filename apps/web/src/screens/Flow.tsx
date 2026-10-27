import { useState } from 'react';
import {
  currentTargets,
  daysBetween,
  isTally,
  tallyText,
  weekStart,
  describeSchedule,
  rangeLabel,
  shortDate,
  weekdayName,
  type Goal,
  type ISODate,
  type PaceLabel,
  type Plan,
  type PlanStep,
  type Session,
  forecastFinish,
} from '@six/core';
import { useStore } from '../data/store.tsx';
import { fmt } from '../data/derive.ts';
import { useView } from '../data/useView.ts';
import { catchUpPlan, chainFor, isSet, opsAddExtra, opsEnsureStep, periodStatus, opsSetLevel, stepFor, type Chain, type ChainLevel } from '../data/chain.ts';
import { GoalExtras, GoalManage, GoalRecord, WhyLine } from './GoalDetail.tsx';
import { GoalPrizes } from '../components/Prize.tsx';
import { PaceLine } from '../components/PaceLine.tsx';
import { GoalGroupCard } from '../components/Connections.tsx';
import { MeasureSheet } from '../components/MeasureSheet.tsx';
import { WeightChart } from '../components/WeightChart.tsx';
import { opsLogSession, opsLogUnplanned, opsRestoreSession, opsToggleMilestone, opsUpdateGoal } from '../data/ops.ts';
import { href } from '../router.ts';
import {
  isOnce,
  opsCopyTasks,
  stepsForGoal,
  tasksInRange,
  withOps,
  type WeekTask,
} from '../data/breakdown.ts';
import { BackLink, Empty, Icon, Sheet, useToast } from '../components/ui.tsx';
import { LogSheet } from './LogSheet.tsx';
import { WorkoutPlanEditor, blankExercise } from '../components/Workout.tsx';
import { goalTrack } from '../data/season.ts';
import { opsRecordReading } from '../data/connect.ts';
import { tallyFor, tallyInWeek, tallyUnit } from '../data/tally.ts';
import { TaskSheet, dateRange, daysOfWeek } from './TaskSheet.tsx';
import { pathLetter, pathsOf } from '../data/paths.ts';

/**
 * One page per goal: the goal chain, top to bottom, then this week's daily tasks.
 *   6 months (the goal) → this 3-month goal → this month's goal → this week's goal → daily tasks
 * Only the current period of each level is shown; when a month or week ends you set the next one.
 */
export function Flow({ goalId }: { goalId: string }) {
  const { data, today } = useStore();
  const view = useView();
  const toast = useToast();
  const goal = view.goal(goalId);
  const plans = goal ? view.plansForGoal(goal.id) : [];
  const plan = plans.find((p) => p.start_date <= today && p.end_date >= today) ?? plans[0] ?? null;
  const [editing, setEditing] = useState<ChainLevel | 'goal' | null>(null);

  if (!goal) return <Empty title="Goal not found." />;
  if (!plan) {
    return (
      <div className="stack">
        <BackLink label="Goals" fallback="/goals" />
        <h1>{goal.title}</h1>
        <Empty title="This goal isn't in a plan yet." />
        <GoalExtras goal={goal} plan={null} />
      </div>
    );
  }

  const focus = today < plan.start_date ? plan.start_date : today > plan.end_date ? plan.end_date : today;
  const chain = chainFor(data, goal, plan, focus);
  const week = stepFor(goal, plan, chain, 'week');
  const weeks = stepsForGoal(data, goal.id).filter((s) => s.level === 'week' && s.plan_id === plan.id);
  const t = goalTrack(view, goal, plan);
  const group = goal.group_id ? data.groups.find((g) => g.id === goal.group_id) : undefined;
  const windowName = plan.name;
  const ink = !t.started ? 'var(--muted)' : t.label === 'behind' ? 'var(--amber-ink)' : t.label === 'ahead' ? 'var(--blue-ink)' : 'var(--ink-2)';

  return (
    <div className="stack rise">
      <BackLink label="Goals" fallback="/goals" />
      <div className="stack-sm" style={{ gap: 6 }}>
        <div className="row-start" style={{ gap: 10, flexWrap: 'nowrap' }}>
          <span className="dot" style={{ width: 11, height: 11, flex: 'none', background: goal.color }} />
          <h1 style={{ margin: 0 }}>{goal.title}</h1>
          <button type="button" className="icon-btn title-edit" onClick={() => setEditing('goal')} aria-label="Edit goal name">
            <Icon name="edit" size={17} />
          </button>
        </div>
        <span className="small row-start" style={{ gap: 6, color: 'var(--muted)' }}>
          <span>{windowName}</span>
          {group && (
            <>
              <span aria-hidden="true">·</span>
              <a href={href(`/goals/group/${group.id}`)}>{group.name}</a>
            </>
          )}
          <span aria-hidden="true">·</span>
          <span style={{ color: ink }}>{t.status}</span>
        </span>
        <WhyLine goal={goal} />
      </div>

      <div className="goal-page">
        <div className="goal-page-main">
          <ProgressCard goal={goal} plan={plan} chain={chain} onSetWeek={() => setEditing('week')} />
          <ThisWeekCard goal={goal} plan={plan} chain={chain} week={week} weeks={weeks} onEditWeek={() => setEditing('week')} onToast={toast} />
          <PlanCard goal={goal} plan={plan} chain={chain} onEdit={setEditing} />
        </div>
        <aside className="goal-page-side">
          <GoalRecord goal={goal} />
          <GoalPrizes goal={goal} plan={plan} />
          <GoalGroupCard goal={goal} />
          <GoalManage goal={goal} />
        </aside>
      </div>

      {editing === 'goal' && <GoalSheet goal={goal} plan={plan} onClose={() => setEditing(null)} />}
      {editing && editing !== 'goal' && <ChainSheet goal={goal} plan={plan} chain={chain} level={editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

function placeholderFor(goal: Goal): string {
  if (goal.type === 'number') return 'e.g. Eating window every day, no weekday drinks';
  if (goal.type === 'finish') return 'e.g. Finish the module 4 quiz';
  return 'e.g. G–C–D changes at 60 bpm';
}

/** Set or change this week's goal. */
export function ChainSheet({ goal, plan, chain, level, onClose }: { goal: Goal; plan: Plan; chain: Chain; level: ChainLevel; onClose: () => void }) {
  const { data, commit } = useStore();
  const toast = useToast();
  const link = chain[level];
  const [note, setNote] = useState(link.step?.target_note ?? '');
  const [target, setTarget] = useState<number | null>(link.step?.target_value ?? link.suggested);
  const title = `This week · ${link.node.title}`;
  return (
    <Sheet title={title} onClose={onClose}>
      <div className="row-start small muted" style={{ marginTop: -8 }}>
        <span className="dot" style={{ background: goal.color }} />
        {goal.title} · {rangeLabel(link.node)}
      </div>
      <label className="field">
        What should be true by {shortDate(link.node.end)}?
        <textarea autoFocus value={note} onChange={(e) => setNote(e.target.value)} placeholder={placeholderFor(goal)} />
      </label>
      {goal.type === 'number' && (
        <label className="field">
          Target by {shortDate(link.node.end)} ({goal.unit})
          <input type="number" inputMode="decimal" value={target ?? ''} onChange={(e) => setTarget(e.target.value === '' ? null : Number(e.target.value))} />
          {link.suggested != null && <span className="xsmall muted">Your path says {fmt(link.suggested)} by then.</span>}
        </label>
      )}
      <button
        className="btn primary"
        onClick={() => {
          commit(opsSetLevel(data, goal, plan, chain, level, { target_note: note.trim(), ...(goal.type === 'number' ? { target_value: target } : {}) }));
          toast("This week's goal saved");
          onClose();
        }}
      >
        Save
      </button>
    </Sheet>
  );
}

/** Edit the 6-month goal itself. A new target for a number goal redraws its path straight to the new value. */
/** "At this pace: done Jan 4": when a finish goal will likely be done, from how fast its milestones get done. */
function ForecastLine({ goal, plan, by }: { goal: Goal; plan: Plan; by: ISODate }) {
  const { today } = useStore();
  const view = useView();
  const milestones = view.data.milestones.filter((m) => m.goal_id === goal.id);
  if (!milestones.length) return null;
  const f = forecastFinish(milestones, view.startFor(goal, plan), today, (t) => view.dayOf(t));
  if (f.reason === 'done') return null;
  const late = !!f.date && f.date > by;
  const text =
    f.reason === 'pace'
      ? `At this pace: done ${shortDate(f.date!)}${late ? `, after ${shortDate(by)}` : ''}`
      : f.reason === 'too_slow'
        ? `At this pace it won’t be done by ${shortDate(by)}`
        : 'At this pace: shows after the first week and the first milestone';
  return (
    <span className="xsmall" style={{ color: late || f.reason === 'too_slow' ? 'var(--amber-ink)' : 'var(--muted)' }}>
      {text}
    </span>
  );
}

function GoalSheet({ goal, plan, onClose }: { goal: Goal; plan: Plan; onClose: () => void }) {
  const { data, commit } = useStore();
  const toast = useToast();
  const [finishBy, setFinishBy] = useState(goal.target_date ?? '');
  const [startOn, setStartOn] = useState(goal.start_date ?? '');
  const [title, setTitle] = useState(goal.title);
  const paths = pathsOf(data);
  const [pathId, setPathId] = useState<string>(goal.path_id ?? '');
  const [why, setWhy] = useState(goal.why);
  const [done, setDone] = useState(goal.done_means);
  const [target, setTarget] = useState<number | null>(goal.target_value);
  return (
    <Sheet title="Edit goal" onClose={onClose}>
      <label className="field">
        Name
        <input value={title} onChange={(e) => setTitle(e.target.value)} autoFocus placeholder="What you're working toward" />
      </label>
      <label className="field">
        Why it matters
        <textarea rows={2} value={why} onChange={(e) => setWhy(e.target.value)} placeholder="One line for the hard days" />
      </label>
      {goal.type === 'number' && (
        <label className="field">
          Target by {shortDate(goal.target_date ?? plan.end_date)} ({goal.unit})
          <input type="number" inputMode="decimal" value={target ?? ''} onChange={(e) => setTarget(e.target.value === '' ? null : Number(e.target.value))} />
        </label>
      )}
      <label className="field">
        Done means
        <input value={done} onChange={(e) => setDone(e.target.value)} placeholder="How you'll know it's done" />
      </label>
      {paths.length > 0 && (
        <label className="field">
          Path <span style={{ fontWeight: 400 }}>(which life is this a bet on?)</span>
          <select value={pathId} onChange={(e) => setPathId(e.target.value)}>
            <option value="">No path</option>
            {paths.map((p) => (
              <option key={p.id} value={p.id}>
                {pathLetter(data, p)} · {p.name}
              </option>
            ))}
          </select>
        </label>
      )}
      <label className="field">
        Starts <span style={{ fontWeight: 400 }}>(optional)</span>
        <input type="date" value={startOn} min={plan.start_date} max={finishBy || plan.end_date} onChange={(e) => setStartOn(e.target.value)} />
        <span className="xsmall muted" style={{ fontWeight: 400 }}>
          Empty means it starts with the season ({shortDate(plan.start_date)}). Later for a course that begins in a month, or a goal that follows another. You can also drag it on the Roadmap.
        </span>
      </label>
      {goal.type !== 'number' && (
        <label className="field">
          Finish by <span style={{ fontWeight: 400 }}>(optional)</span>
          <input type="date" value={finishBy} min={plan.start_date} max={plan.end_date} onChange={(e) => setFinishBy(e.target.value)} />
          <span className="xsmall muted" style={{ fontWeight: 400 }}>
            Empty means the end of the season ({shortDate(plan.end_date)}). Earlier for a course or an exam that ends sooner.
          </span>
        </label>
      )}
      <button
        className="btn primary"
        onClick={() => {
          // Dates are only sent when they change.
          const extra: Partial<Goal> = {};
          if (goal.type !== 'number' && (finishBy || null) !== (goal.target_date ?? null)) extra.target_date = finishBy || null;
          // A start can't be after the finish (or outside the window); the finish wins.
          const end = (goal.type !== 'number' ? finishBy : goal.target_date) || plan.end_date;
          const start = startOn && startOn > end ? end : startOn && startOn < plan.start_date ? plan.start_date : startOn;
          const storedStart = start && start > plan.start_date ? start : null;
          if (storedStart !== (goal.start_date ?? null)) extra.start_date = storedStart;
          if ((pathId || null) !== (goal.path_id ?? null)) extra.path_id = pathId || null;
          const patch: Partial<Goal> = { title: title.trim() || goal.title, why: why.trim(), done_means: done.trim(), ...(goal.type === 'number' ? { target_value: target } : {}), ...extra };
          let ops = opsUpdateGoal(goal, patch);
          const wasTargets = currentTargets(data.goalTargets, goal.id);
          if (goal.type === 'number' && target !== goal.target_value) {
            const now = new Date().toISOString();
            ops = [...ops, ...wasTargets.map((t) => ({ kind: 'update', collection: 'goalTargets', id: t.id, patch: { superseded_at: now } }) as const)];
          }
          const was: Partial<Goal> = {};
          for (const k of Object.keys(patch) as (keyof Goal)[]) (was as Record<string, unknown>)[k] = goal[k] ?? null;
          commit(ops);
          toast('Goal saved', () =>
            commit([
              ...opsUpdateGoal(goal, was),
              ...(goal.type === 'number' && target !== goal.target_value ? wasTargets.map((t) => ({ kind: 'update', collection: 'goalTargets', id: t.id, patch: { superseded_at: null } }) as const) : []),
            ]),
          );
          onClose();
        }}
      >
        Save
      </button>
    </Sheet>
  );
}

// ---------- Level 5: the daily tasks for the selected week ----------

type Toast = (m: string, undo?: () => void) => void;


/**
 * Progress: the only place the goal's numbers appear. Where it is, a track across the whole window
 * against even pace, what done is and when, and the one next step as a button. A number goal's
 * trend, readings and chart show here (always, no button), and today's reading is logged here.
 */
function ProgressCard({ goal, plan, chain, onSetWeek }: { goal: Goal; plan: Plan; chain: Chain; onSetWeek: () => void }) {
  const { data, today, commit } = useStore();
  const view = useView();
  const toast = useToast();
  const [logging, setLogging] = useState(false);
  const [value, setValue] = useState('');
  const [error, setError] = useState('');
  const t = goalTrack(view, goal, plan);
  const type = goal.type === 'number' ? data.measurementTypes.find((m) => m.id === goal.measurement_type_id) : undefined;
  const readings = goal.type === 'number' ? view.measurementsFor(goal.measurement_type_id) : [];
  const last = readings.at(-1);
  const fix = t.started ? catchUpPlan(view, data, goal, plan, today) : null;

  // The one next step.
  let next: { label: string; sub: string; run: () => void } | null = null;
  // A number goal's reading can be logged any day, including before its window starts.
  if (goal.type === 'number' && type && last?.measured_on !== today) {
    const age = last ? daysBetween(last.measured_on, today) : null;
    next = { label: `Log today’s ${type.name.toLowerCase()}`, sub: age == null ? 'No readings yet' : `Last one ${age === 1 ? 'yesterday' : `${age} days ago`}`, run: () => setLogging(true) };
  } else if (t.started && fix?.extra) {
    next = { label: `Add ${fix.extra} this week`, sub: fix.text, run: () => {
      const { ops, days } = opsAddExtra(view, data, goal, today, fix.extra!);
      if (!ops.length) return toast('No room left this week');
      commit(ops);
      toast(`Added ${fix.extra} for ${days.map((d) => (d === today ? 'today' : weekdayName(d))).join(' and ')}`);
    } };
  } else if (t.started && !isSet(chain.week)) {
    next = { label: 'Set this week’s goal', sub: `What should be true by ${shortDate(chain.week.node.end)}?`, run: onSetWeek };
  } else if (goal.type === 'finish') {
    const m = data.milestones.filter((x) => x.goal_id === goal.id && !x.completed_at && !isTally(x)).sort((a, b) => (a.due_date < b.due_date ? -1 : 1))[0];
    if (m) next = { label: `Done: ${m.title}`, sub: `Due ${shortDate(m.due_date)}${m.due_date < today ? ' · past due' : ''}`, run: () => {
      commit(opsToggleMilestone(m));
      toast(`${m.title} done`, () => commit(opsToggleMilestone({ ...m, completed_at: new Date().toISOString() })));
    } };
  }

  function saveReading() {
    const v = Number(value);
    if (value.trim() === '' || !Number.isFinite(v)) {
      setError('Enter a number');
      return;
    }
    if (!type) return;
    const { ops, undo } = opsRecordReading(data, type.id, v, today);
    // A "Log a number" task for this measurement today is checked off too.
    const task = data.sessions.find((x) => x.date === today && x.status === 'planned' && view.action(x.action_id)?.kind === 'measure' && view.action(x.action_id)?.measurement_type_id === type.id);
    commit([...ops, ...(task ? opsLogSession(task, { status: 'done', on: today }) : [])]);
    toast(`${type.name}: ${fmt(v)} ${type.unit}`.trim(), () => commit([...undo, ...(task ? opsRestoreSession(task) : [])]));
    setLogging(false);
    setValue('');
  }

  const nextButton = next && (
    <button type="button" className="next-step" onClick={next.run}>
      <b>{next.label}</b>
      <span>{next.sub}</span>
    </button>
  );
  // A number goal's chart is always shown: the path, every reading and the 7-day trend.
  // It starts at the first reading when that's before the window (a starting weigh-in, say).
  const chartStart = readings[0] && readings[0].measured_on < plan.start_date ? readings[0].measured_on : plan.start_date;
  const chart =
    goal.type === 'number' ? (
      <div className="stack-sm">
        <WeightChart
          start={view.goalPace(goal, plan).number?.start ?? { date: chartStart, value: Number(goal.baseline_value ?? readings[0]?.value ?? 0) }}
          path={view.pathFor(goal)}
          readings={readings}
          range={{ start: chartStart, end: goal.target_date ?? plan.end_date }}
          today={today}
          unit={goal.unit ?? ''}
          color={goal.color}
        />
        {readings.length > 0 && (
          <div>
            {[...readings].reverse().slice(0, 5).map((m) => (
              <div key={m.id} className="list-row small" style={{ minHeight: 40, padding: '8px 0' }}>
                <span className="grow">{m.measured_on === today ? 'Today' : shortDate(m.measured_on)}</span>
                <span className="num">
                  {fmt(Number(m.value))} {type?.unit}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    ) : null;
  const logForm =
      logging && type ? (
      <form
        className="stack-sm"
        onSubmit={(e) => {
          e.preventDefault();
          saveReading();
        }}
      >
        <div className="row-start" style={{ flexWrap: 'nowrap' }}>
          <label className="visually-hidden" htmlFor="reading-today">
            {type.name} today
          </label>
          <input id="reading-today" className="input" type="number" step="any" inputMode="decimal" autoFocus value={value} placeholder={last ? fmt(last.value) : ''} onChange={(e) => (setValue(e.target.value), setError(''))} />
          <span className="small muted">{type.unit}</span>
          <button className="btn small primary" type="submit" style={{ minHeight: 44, flex: 'none' }}>
            Save
          </button>
          <button className="btn small" type="button" onClick={() => setLogging(false)} style={{ minHeight: 44, flex: 'none' }}>
            Cancel
          </button>
        </div>
        {error && <span className="xsmall" style={{ color: 'var(--danger)' }}>{error}</span>}
      </form>
    ) : null;

  if (!t.started) {
    return (
      <section className="card stack-sm progress-card">
        <div className="progress-top">
          <div className="stack-sm" style={{ gap: 4, minWidth: 0 }}>
            <span className="mono">{`STARTS ${shortDate(view.startFor(goal, plan)).toUpperCase()}`}</span>
            <span style={{ fontSize: 17, fontWeight: 600 }}>
              {t.target} by {shortDate(t.by)}
            </span>
            {goal.type === 'number' && last && (
              <span className="small muted">
                Last {type?.name.toLowerCase() ?? 'reading'}: {fmt(Number(last.value))} {type?.unit} · {last.measured_on === today ? 'today' : shortDate(last.measured_on)}
              </span>
            )}
          </div>
          {nextButton}
        </div>
        {logForm}
        {chart}
      </section>
    );
  }
  return (
    <section className="card progress-card" aria-label="Progress">
      <div className="progress-top">
        <div className="stack-sm" style={{ gap: 4, minWidth: 0 }}>
          <span className="progress-now num">{t.now}</span>
          <span className="small muted">
            toward {t.target} by {shortDate(t.by)}
          </span>
        </div>
        {nextButton}
      </div>
      {logForm}
      <span className="season-track" style={{ marginLeft: 0, height: 8 }} aria-label={`${t.prog}% done, even pace ${t.exp}%`}>
        <span className="season-fill" style={{ width: `${t.prog}%`, background: goal.color }} />
        <span className="season-tick" style={{ left: `${t.exp}%` }} />
      </span>
      <span className="row-between xsmall muted">
        <span>Start {shortDate(view.startFor(goal, plan))}</span>
        <span>Tick: even pace</span>
        <span>{shortDate(t.by)}</span>
      </span>
      {fix && !fix.extra && <span className="xsmall" style={{ color: 'var(--amber-ink)' }}>{fix.text}</span>}
      {goal.type === 'finish' && <ForecastLine goal={goal} plan={plan} by={t.by} />}
      {goal.type === 'number' && <PaceLine goal={goal} plan={plan} onWeek={onSetWeek} />}
      {chart}
    </section>
  );
}

type DayState = 'done' | 'part' | 'skip' | 'missed' | 'due' | 'plan' | 'none';

/**
 * This week: the week goal (edit in place), then each daily task with a Monday-to-Sunday strip
 * of done, partly done, missed and planned days. Tap a day to log it (or change its log); tap the
 * task to edit it. Adding a task offers the tasks other goals already have.
 */
function ThisWeekCard({ goal, plan, chain, week, weeks, onEditWeek, onToast }: { goal: Goal; plan: Plan; chain: Chain; week: PlanStep; weeks: PlanStep[]; onEditWeek: () => void; onToast: Toast }) {
  const { data, today, commit } = useStore();
  const view = useView();
  const [editing, setEditing] = useState<{ task: WeekTask | null } | null>(null);
  const [logging, setLogging] = useState<Session | null>(null);
  const [measuring, setMeasuring] = useState<Session | null>(null);
  const days = daysOfWeek(week);
  const tasks = tasksInRange(data, goal.id, dateRange(week), week.id);
  // Tasks that start after this week (coursework from the first class, an exam day), soonest first.
  const comingUp = view
    .actionsForGoal(goal.id)
    .map((a) => ({ action: a, schedule: data.schedules.filter((s) => s.action_id === a.id && s.effective_from > week.end_date).sort((x, y) => (x.effective_from < y.effective_from ? -1 : 1))[0] }))
    .filter((x): x is { action: typeof x.action; schedule: NonNullable<typeof x.schedule> } => !!x.schedule && !tasks.some((t) => t.action.id === x.action.id))
    .sort((a, b) => (a.schedule.effective_from < b.schedule.effective_from ? -1 : 1))
    .slice(0, 4);
  const over = week.end_date < today;
  const weekText = isSet(chain.week) ? [chain.week.step?.target_value != null ? `${fmt(chain.week.step.target_value)} ${goal.unit ?? ''}`.trim() : '', chain.week.step?.target_note.trim() ?? ''].filter(Boolean).join(' · ') : '';
  const prevWeek = weeks.filter((w) => w.end_date < week.start_date).at(-1);
  const prevTasks = prevWeek ? tasksInRange(data, goal.id, dateRange(prevWeek), prevWeek.id).filter((t) => t.origin === 'here' && !tasks.some((x) => x.action.id === t.action.id)) : [];
  const left = daysBetween(today, week.end_date);

  const sessionOn = (actionId: string, d: ISODate) => data.sessions.find((x) => x.action_id === actionId && x.date === d && x.status !== 'moved');
  const stateOf = (actionId: string, d: ISODate): DayState => {
    const x = sessionOn(actionId, d);
    if (!x) return 'none';
    if (x.status === 'done') return 'done';
    if (x.status === 'partial' || x.status === 'minimum') return 'part';
    if (x.status === 'skipped') return 'skip';
    return d < today ? 'missed' : d === today ? 'due' : 'plan';
  };
  function tapDay(t: WeekTask, d: ISODate) {
    if (d > today) return onToast(`You can log ${t.action.title} on ${weekdayName(d)}`);
    const x = sessionOn(t.action.id, d);
    if (x && x.status !== 'planned') return setLogging(x);
    const target = x ?? data.sessions.find((s) => s.action_id === t.action.id && !s.date && s.week_start === weekStart(d) && s.status === 'planned');
    if (t.action.kind === 'measure' && target) return setMeasuring(target);
    if (t.action.kind === 'photo' && target) return setLogging(target);
    if (target) {
      if (!target.date && !view.canPlace(target, d)) return onToast(`${t.action.title} is already logged that day`);
      commit(opsLogSession(target, { status: 'done', on: d }));
      return onToast(`${t.action.title} done ${d === today ? 'today' : `on ${weekdayName(d)}`}`, () => commit(opsRestoreSession(target)));
    }
    // Not planned that day: log it as an extra (a task still happens at most once a day).
    const extra = opsLogUnplanned(data, t.action, d, t.action.planned_minutes);
    commit(extra);
    const added = extra.find((op) => op.kind === 'insert');
    const ids = added?.kind === 'insert' ? added.rows.map((r) => r.id) : [];
    onToast(`${t.action.title} logged ${d === today ? 'today' : `on ${weekdayName(d)}`} as an extra`, () => commit(ids.map((id) => ({ kind: 'delete', collection: 'sessions', id }))));
  }

  return (
    <section className="card week-card" aria-label="This week">
      <div className="week-card-head">
        <b>This week</b>
        <span className="xsmall muted">
          {rangeLabel(dateRange(week))}
          {!over ? ` · ${left === 0 ? 'last day' : `${left} day${left === 1 ? '' : 's'} left`}` : ''}
        </span>
      </div>
      <button type="button" className="week-goal" onClick={onEditWeek}>
        <span className="mono" style={{ color: 'var(--accent-ink)' }}>WEEK GOAL</span>
        {weekText ? <span className="week-goal-text">{weekText}</span> : <span className="week-goal-text muted">What should be true by {shortDate(week.end_date)}?</span>}
        <span className="xsmall" style={{ color: 'var(--accent-ink)', fontWeight: 600 }}>{weekText ? 'Edit' : 'Set it'}</span>
      </button>
      {data.milestones
        .filter((m) => m.goal_id === goal.id && isTally(m) && !m.completed_at)
        .map((m) => {
          const t = tallyFor(view, m, today);
          if (!t) return null;
          const inWeek = tallyInWeek(data, m, week.start_date);
          const unit = tallyUnit(m);
          return (
            <div key={m.id} className="week-row" style={{ gap: 4 }}>
              <span className="row-between small">
                <span>
                  <b className="num">{t.total}</b> of {t.target}{unit ? ` ${unit}` : ''} <span className="muted">· +{inWeek} this week</span>
                </span>
                <span className="xsmall" style={{ color: t.label === 'behind' ? 'var(--amber-ink)' : 'var(--muted)', whiteSpace: 'nowrap' }}>
                  {t.perDay == null ? 'past due' : t.perDay === 0 ? 'done' : `${t.perDay}/day to land ${shortDate(m.due_date)}`}
                </span>
              </span>
              <span className="tally-bar" aria-hidden="true">
                <span style={{ width: `${Math.round(t.share * 100)}%`, background: goal.color }} />
                {!t.reached && <i style={{ left: `${Math.min(100, Math.round((t.expected / t.target) * 100))}%` }} />}
              </span>
            </div>
          );
        })}
      {tasks.length === 0 && <span className="small muted week-row">No daily tasks this week yet.</span>}
      {comingUp.length > 0 && (
        <div className="week-row coming-up">
          <span className="xsmall muted">Coming up</span>
          {comingUp.map(({ action, schedule }) => (
            <span key={action.id} className="small">
              {action.title}{' '}
              <span className="xsmall muted">
                · {isOnce(schedule) ? `${weekdayName(schedule.effective_from)} ${shortDate(schedule.effective_from)}` : `${describeSchedule(schedule).toLowerCase()} from ${shortDate(schedule.effective_from)}${schedule.effective_to ? ` to ${shortDate(schedule.effective_to)}` : ''}`}
              </span>
            </span>
          ))}
        </div>
      )}
      {tasks.map((t) => {
        const also = view.otherGoalsForAction(t.action.id, goal.id);
        const done = days.filter((d) => ['done', 'part'].includes(stateOf(t.action.id, d))).length;
        return (
          <div key={t.action.id} className="week-row">
            <button type="button" className="week-task" onClick={() => setEditing({ task: t })} aria-label={`Edit ${t.action.title}`}>
              <span className="small">{t.action.title}</span>
              <span className="xsmall muted">
                {isOnce(t.schedule) ? `${weekdayName(t.schedule.effective_from)} only` : describeSchedule(t.schedule)} · {done} this week
                {also.length ? ` · shared with ${also.map((g) => g.title).join(', ')}` : ''}
              </span>
            </button>
            <span className="week-strip" role="group" aria-label={`${t.action.title} this week`}>
              {days.map((d) => {
                const st = stateOf(t.action.id, d);
                const letter = weekdayName(d).charAt(0);
                return (
                  <button key={d} type="button" className={`week-day ${st}${d === today ? ' today' : ''}`} onClick={() => tapDay(t, d)} aria-label={`${t.action.title}, ${weekdayName(d)}: ${st === 'none' ? 'not planned' : st}`}>
                    {letter}
                  </button>
                );
              })}
            </span>
          </div>
        );
      })}
      {!over && (
        <div className="week-actions">
          <button type="button" className="link-btn small" onClick={() => setEditing({ task: null })} style={{ paddingLeft: 0 }}>
            + Add a task
          </button>
          {prevWeek && prevTasks.length > 0 && (
            <button
              type="button"
              className="link-btn small"
              onClick={() => {
                const ensure = opsEnsureStep(data, week);
                const ops = opsCopyTasks(withOps(data, ensure), goal, prevWeek, week, today);
                commit(ops.length ? [...ensure, ...ops] : []);
                onToast(ops.length ? `Copied ${prevWeek.title}'s tasks` : 'Nothing to copy');
              }}
            >
              Copy last week’s tasks
            </button>
          )}
          <span className="xsmall muted">Tap a day to log it. Amber: missed.</span>
        </div>
      )}
      {editing && (
        <TaskSheet
          goal={goal}
          plan={plan}
          week={week}
          task={editing.task}
          onClose={() => setEditing(null)}
          onSaved={(m) => {
            onToast(m);
            setEditing(null);
          }}
        />
      )}
      {logging && <LogSheet session={data.sessions.find((x) => x.id === logging.id) ?? logging} onClose={() => setLogging(null)} />}
      {measuring && <MeasureSheet session={data.sessions.find((x) => x.id === measuring.id) ?? measuring} onClose={() => setMeasuring(null)} />}
    </section>
  );
}

/** The plan: this week's goal, the next dates to hit, and the season's finish, soonest first. Tap a line to edit it. */
function PlanCard({ goal, plan, chain, onEdit }: { goal: Goal; plan: Plan; chain: Chain; onEdit: (level: ChainLevel | 'goal') => void }) {
  const { data, today } = useStore();
  const view = useView();
  const seasonTarget = goal.type === 'number' && goal.target_value != null ? `${fmt(goal.target_value)} ${goal.unit ?? ''}`.trim() : '';
  const week = chain.week;
  const weekSet = isSet(week);
  const weekValue = goal.type === 'number' ? week.step?.target_value ?? week.suggested : null;
  const weekText = weekSet ? [weekValue != null ? `${fmt(weekValue)} ${goal.unit ?? ''}`.trim() : '', week.step!.target_note.trim()].filter(Boolean).join(' · ') : '';
  const weekStatus = weekSet && view.startFor(goal, plan) <= today ? periodStatus(view, data, goal, plan, week, today) : null;
  // The next two dates to hit that aren't done yet.
  const upcoming = view
    .milestonesOf(goal.id)
    .filter((m) => !m.completed_at && m.due_date >= today)
    .slice(0, 2);
  const lines: { key: string; name: string; text: string; when: string; status: { text: string; label: PaceLabel } | null; current: boolean; onClick?: () => void; edit: boolean }[] = [
    { key: 'week', name: 'This week', text: weekText, when: rangeLabel(week.node), status: weekStatus, current: true, onClick: () => onEdit('week'), edit: true },
    ...upcoming.map((m) => {
      const t = tallyFor(view, m, today);
      return { key: m.id, name: t ? 'Running total' : 'Date to hit', text: m.title, when: `by ${shortDate(m.due_date)}`, status: t ? { text: tallyText(t), label: t.label } : null, current: false, edit: false };
    }),
    {
      key: 'goal',
      name: 'Season',
      text: [seasonTarget, goal.done_means.trim()].filter(Boolean).join(' · ') || goal.title,
      when: `by ${shortDate(view.endFor(goal, plan))}`,
      status: null,
      current: false,
      onClick: () => onEdit('goal'),
      edit: true,
    },
  ];
  return (
    <section className="card plan-card" aria-label="The plan">
      <b className="plan-card-title">The plan</b>
      {lines.map((l, i) => (
        <button key={l.key} type="button" className={`plan-line-row${l.current ? ' current' : ''}`} onClick={l.onClick} disabled={!l.onClick} style={l.onClick ? undefined : { cursor: 'default' }}>
          <span className="plan-rail" aria-hidden="true">
            <span className="plan-dot" style={l.current ? { background: goal.color, borderColor: goal.color } : undefined} />
            {i < lines.length - 1 && <span className="plan-stem" />}
          </span>
          <span className="plan-text">
            {l.text ? <span className="small" style={{ fontWeight: l.current ? 600 : 450 }}>{l.text}</span> : <span className="small" style={{ color: 'var(--accent-ink)' }}>+ Set this week’s goal</span>}
            <span className="xsmall muted">
              {l.name.toUpperCase()} · {l.when}
              {l.status ? <span style={{ color: l.status.label === 'behind' ? 'var(--amber-ink)' : undefined }}> · {l.status.text}</span> : null}
            </span>
          </span>
          <span className="xsmall" style={{ color: 'var(--accent-ink)', fontWeight: 600 }}>{l.text && l.edit ? 'Edit' : ''}</span>
        </button>
      ))}
    </section>
  );
}
