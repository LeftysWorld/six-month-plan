import { useState } from 'react';
import {
  addDays,
  currentTargets,
  describeSchedule,
  isoWeekday,
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
import { fmt, minutesText, useView } from '../data/derive.ts';
import { opsUpdateGoal } from '../data/ops.ts';
import { CHAIN_LEVELS, catchUp, chainFor, isSet, opsEnsureStep, periodStatus, opsSetLevel, stepFor, type Chain, type ChainLevel } from '../data/chain.ts';
import { GoalExtras } from './GoalDetail.tsx';
import {
  applyFrom,
  blankTask,
  fixedTasksOn,
  inputFromTask,
  isOnce,
  opsAddTask,
  opsCopyTasks,
  opsEditTask,
  opsRemoveTask,
  stepsForGoal,
  tasksInRange,
  withOps,
  type TaskInput,
  type WeekTask,
} from '../data/breakdown.ts';
import { BackLink, Empty, Icon, PacePill, Sheet, WEEKDAY_NAMES, useToast } from '../components/ui.tsx';
import { LogSheet } from './LogSheet.tsx';
import { opsUnshareTask } from '../data/connect.ts';
import { ShareTaskSheet } from '../components/Connections.tsx';

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
  const [dayPick, setDayPick] = useState<ISODate | null>(null);
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
  const weekDays = daysOfWeek(week);
  const day = dayPick && weekDays.includes(dayPick) ? dayPick : weekDays.includes(today) ? today : weekDays[0] ?? today;
  const pickDay = (d: ISODate, scroll = false) => {
    setDayPick(d);
    if (scroll) window.setTimeout(() => document.getElementById('flow-day')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
  };
  const pace = view.goalPace(goal, plan);
  const start = pace.number?.start;
  const fix = catchUp(view, data, goal, plan, today);
  const weeks = stepsForGoal(data, goal.id).filter((s) => s.level === 'week' && s.plan_id === plan.id);

  return (
    <div className="stack">
      <div aria-hidden="true" style={{ position: 'fixed', top: -170, right: -150, width: 440, height: 440, borderRadius: '50%', background: `radial-gradient(closest-side, ${goal.color}30, transparent)`, pointerEvents: 'none', zIndex: -1 }} />
      <div className="topbar">
        <BackLink label="Goals" fallback="/goals" />
        <span className="mono" style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
          <span className="dot" style={{ width: 7, height: 7, background: goal.color, boxShadow: `0 0 10px ${goal.color}` }} />
          {plan.name}
        </span>
      </div>
      <div className="stack-sm" style={{ gap: 8 }}>
        <h1>{goal.title}</h1>
        <div className="row-start" style={{ gap: 10 }}>
          {goal.type === 'number' && start && (
            <span className="num" style={{ fontSize: 20, fontWeight: 550 }}>
              {fmt(start.value)} <span style={{ color: 'var(--muted)' }}>→</span>{' '}
              {pace.number?.latest != null && (
                <>
                  {fmt(pace.number.latest)} now <span style={{ color: 'var(--muted)' }}>→</span>{' '}
                </>
              )}
              {fmt(goal.target_value)}{' '}
              <span className="small muted" style={{ fontWeight: 400 }}>{goal.unit}</span>
            </span>
          )}
          {goal.type !== 'number' && <span className="small" style={{ color: 'var(--ink-2)' }}>{pace.summary}</span>}
          {pace.label !== 'none' && <PacePill label={pace.label} />}
        </div>
        {fix && (
          <p className="coach" style={{ padding: 0 }}>
            <Icon name="sparkle" size={16} />
            <span>{fix}</span>
          </p>
        )}
      </div>

      <div className="goal-grid">
        <div className="stack goal-chain">
          <div className="chain" role="list" aria-label="Goal chain">
            <ChainCard
              n={1}
              name="6 months"
              dates={rangeLabel({ start: plan.start_date, end: plan.end_date })}
              text={goal.done_means || goal.title}
              target={goal.type === 'number' && goal.target_value != null ? `${fmt(goal.target_value)} ${goal.unit ?? ''} by ${shortDate(goal.target_date ?? plan.end_date)}` : null}
              status={null}
              onEdit={() => setEditing('goal')}
            />
            {CHAIN_LEVELS.map((level, i) => {
              const link = chain[level];
              const set = isSet(link);
              const target = goal.type === 'number' ? link.step?.target_value ?? link.suggested : null;
              return (
                <ChainCard
                  key={level}
                  n={i + 2}
                  name={level === 'quarter' ? link.node.title : level === 'month' ? `This month · ${link.node.title}` : `This week · ${link.node.title}`}
                  dates={rangeLabel(link.node)}
                  text={set ? link.step!.target_note : null}
                  target={target != null ? `${fmt(target)} ${goal.unit ?? ''} by ${shortDate(link.node.end)}` : null}
                  status={periodStatus(view, data, goal, plan, link, today)}
                  prompt={`What should be true by ${shortDate(link.node.end)}?`}
                  current={level === 'week'}
                  onEdit={() => setEditing(level)}
                />
              );
            })}
          </div>
        </div>

        <div className="stack goal-tasks">
          <section className="stack-sm" aria-label="Week">
            <div className="row-between">
              <h2 style={{ fontSize: 18 }}>Daily tasks</h2>
              <span className="mono" style={{ fontSize: 10.5 }}>{rangeLabel(dateRange(week))}</span>
            </div>
            <DailyTasks slot="week" goal={goal} plan={plan} week={week} weeks={[]} day={day} onPickDay={(d) => pickDay(d, true)} onToast={toast} />
          </section>
          <section className="stack-sm" aria-label="Daily tasks" id="flow-day" style={{ scrollMarginTop: 12 }}>
            <DailyTasks slot="day" goal={goal} plan={plan} week={week} weeks={weeks} day={day} onPickDay={(d) => pickDay(d)} onToast={toast} />
          </section>
        </div>
      </div>

      <GoalExtras goal={goal} plan={plan} />

      {editing === 'goal' && <GoalSheet goal={goal} plan={plan} onClose={() => setEditing(null)} />}
      {editing && editing !== 'goal' && <ChainSheet goal={goal} plan={plan} chain={chain} level={editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

function dateRange(s: { start_date: ISODate; end_date: ISODate }) {
  return { start: s.start_date, end: s.end_date };
}

/** How the current period is going, in a few words: "3 of 5 done", "207.9 now · aiming for 207.8". */
/** One level of the chain: its goal (or a prompt to set one) and how the period is going. */
function ChainCard({
  n,
  name,
  dates,
  text,
  target,
  status,
  prompt,
  current,
  onEdit,
}: {
  n: number;
  name: string;
  dates: string;
  text: string | null;
  target: string | null;
  status: { text: string; label: PaceLabel } | null;
  prompt?: string;
  current?: boolean;
  onEdit: () => void;
}) {
  const empty = !text && !target;
  return (
    <div className={`chain-link${current ? ' current' : ''}`} role="listitem">
      <div className="chain-rail" aria-hidden="true">
        <span className="flow-dot">{String(n).padStart(2, '0')}</span>
        <span className="flow-line" />
      </div>
      <button type="button" className={`chain-card${empty ? ' empty' : ''}`} onClick={onEdit} aria-label={`${name}: ${empty ? 'set a goal' : 'edit'}`}>
        <span className="row-between" style={{ width: '100%', gap: 8 }}>
          <span className="mono" style={{ fontSize: 10.5, color: current ? 'var(--accent-ink)' : undefined }}>{name}</span>
          <span className="mono" style={{ fontSize: 10 }}>{dates}</span>
        </span>
        {text ? (
          <span style={{ fontSize: 16, fontWeight: 550, letterSpacing: '-0.015em', lineHeight: 1.35 }}>{text}</span>
        ) : (
          <span style={{ fontSize: 15, color: 'var(--ink-2)' }}>{prompt ?? 'Set a goal'}</span>
        )}
        {target && <span className="num" style={{ fontSize: 17 }}>{target}</span>}
        <span className="row-between" style={{ width: '100%', gap: 8 }}>
          <span className="xsmall" style={{ color: status?.label === 'behind' ? 'var(--amber-ink)' : 'var(--muted)' }}>{status?.text ?? ''}</span>
          <span className="xsmall strong" style={{ color: empty ? 'var(--accent-ink)' : 'var(--ink-2)' }}>{empty ? 'Set it ›' : 'Edit'}</span>
        </span>
      </button>
    </div>
  );
}

function placeholderFor(goal: Goal, level: ChainLevel): string {
  if (goal.type === 'number') return level === 'week' ? 'e.g. Eating window every day, no weekday drinks' : 'e.g. Lock in the eating window';
  if (goal.type === 'finish') return level === 'week' ? 'e.g. Finish the module 4 quiz' : 'e.g. Modules 1–4 passed';
  return level === 'week' ? 'e.g. G–C–D changes at 60 bpm' : 'e.g. Record song 1 start to finish';
}

/** Set or change the goal for the current 3 months, month or week. */
export function ChainSheet({ goal, plan, chain, level, onClose }: { goal: Goal; plan: Plan; chain: Chain; level: ChainLevel; onClose: () => void }) {
  const { data, commit } = useStore();
  const toast = useToast();
  const link = chain[level];
  const [note, setNote] = useState(link.step?.target_note ?? '');
  const [target, setTarget] = useState<number | null>(link.step?.target_value ?? link.suggested);
  const title = level === 'quarter' ? `${link.node.title}` : level === 'month' ? `This month · ${link.node.title}` : `This week · ${link.node.title}`;
  return (
    <Sheet title={title} onClose={onClose}>
      <div className="row-start small muted" style={{ marginTop: -8 }}>
        <span className="dot" style={{ background: goal.color }} />
        {goal.title} · {rangeLabel(link.node)}
      </div>
      <label className="field">
        What should be true by {shortDate(link.node.end)}?
        <textarea autoFocus value={note} onChange={(e) => setNote(e.target.value)} placeholder={placeholderFor(goal, level)} />
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
          toast(`${level === 'quarter' ? '3-month' : level === 'month' ? "This month's" : "This week's"} goal saved`);
          onClose();
        }}
      >
        Save
      </button>
    </Sheet>
  );
}

/** Edit the 6-month goal itself. A new target for a number goal redraws its path straight to the new value. */
function GoalSheet({ goal, plan, onClose }: { goal: Goal; plan: Plan; onClose: () => void }) {
  const { data, commit } = useStore();
  const toast = useToast();
  const [title, setTitle] = useState(goal.title);
  const [done, setDone] = useState(goal.done_means);
  const [target, setTarget] = useState<number | null>(goal.target_value);
  return (
    <Sheet title="6-month goal" onClose={onClose}>
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
        <input value={done} onChange={(e) => setDone(e.target.value)} placeholder="How you'll know it's done" />
      </label>
      <button
        className="btn primary"
        onClick={() => {
          let ops = opsUpdateGoal(goal, { title: title.trim() || goal.title, done_means: done.trim(), ...(goal.type === 'number' ? { target_value: target } : {}) });
          if (goal.type === 'number' && target !== goal.target_value) {
            const now = new Date().toISOString();
            ops = [...ops, ...currentTargets(data.goalTargets, goal.id).map((t) => ({ kind: 'update', collection: 'goalTargets', id: t.id, patch: { superseded_at: now } }) as const)];
          }
          commit(ops);
          toast('Goal saved');
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
  const [sharing, setSharing] = useState(false);
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
      <div className="card stack-sm">
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
          <button className="btn ghost" onClick={() => setSharing(true)}>
            + Use a task from another goal
          </button>
          {prevWeek && prevTasks.some((t) => t.origin === 'here') && (
            <button
              className="btn ghost"
              onClick={() => {
                const ensure = opsEnsureStep(data, week);
                const ops = opsCopyTasks(withOps(data, ensure), goal, prevWeek, week, today);
                commit(ops.length ? [...ensure, ...ops] : []);
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
      {sharing && <ShareTaskSheet goal={goal} onClose={() => setSharing(false)} onShared={(m) => onToast(m)} />}
    </div>
  );
}

interface DayItem {
  key: string;
  title: string;
  minutes: number;
  status: Session['status'];
}

/** The whole week at once: seven columns with a bar per task. Tap a day to open it below. */
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
  const bar = (status: Session['status']) =>
    status === 'done' ? 'var(--accent)' : status === 'minimum' || status === 'partial' ? 'var(--amber-bar)' : status === 'skipped' ? 'var(--border-strong)' : color;
  return (
    <div className="stack-sm" style={{ gap: 10 }}>
      <div className="week-grid" style={{ gridTemplateColumns: `repeat(${days.length}, minmax(0, 1fr))` }}>
        {days.map((d) => {
          const items = itemsOn(d);
          const isToday = d === today;
          const all = minutesOn(d);
          const cap = capOn(d);
          return (
            <button
              key={d}
              className={`week-day${isToday ? ' is-today' : ''}${d < today ? ' past' : ''}`}
              onClick={() => onOpen(d)}
              aria-label={`${weekdayName(d)} ${shortDate(d)}: ${items.length} task${items.length === 1 ? '' : 's'}. Open day`}
              aria-pressed={d === selected}
            >
              <span className="week-day-name">{weekdayName(d).charAt(0)}</span>
              <span className="week-day-num">{Number(d.slice(8))}</span>
              {isToday && <span className="visually-hidden">Today</span>}
              <span className="week-day-bars" aria-hidden="true">
                {items.slice(0, 4).map((i) => (
                  <span key={i.key} style={{ background: bar(i.status), opacity: i.status === 'planned' ? 0.85 : 1 }} />
                ))}
              </span>
              <span className={`week-day-load${all > cap ? ' over' : ''}`} title={`${minutesText(all)} of ${minutesText(cap)} planned across all goals`}>
                {all ? minutesText(all).replace(' min', 'm').replace(/ /g, '') : '–'}
              </span>
            </button>
          );
        })}
      </div>
      {flexible.length > 0 && <span className="xsmall muted">Any day this week: {flexible.join(', ')}</span>}
      <span className="mono" style={{ fontSize: 10, display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}><span style={{ width: 10, height: 4, borderRadius: 2, background: color }} />To do</span>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}><span style={{ width: 10, height: 4, borderRadius: 2, background: 'var(--accent)' }} />Done</span>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}><span style={{ width: 10, height: 4, borderRadius: 2, background: 'var(--amber-bar)' }} />Partly</span>
        <span>Number = minutes planned, all goals</span>
      </span>
    </div>
  );
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
  const view = useView();
  const origin = task.origin === 'carried' ? `from ${data.planSteps.find((s) => s.id === action.step_id)?.title ?? 'an earlier week'}` : task.origin === 'ongoing' ? 'from goal setup' : '';
  const also = view.otherGoalsForAction(action.id, goal.id);
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
        {also.length > 0 && (
          <span className="meta">
            {also.map((g) => (
              <span key={g.id} className="dot" style={{ width: 6, height: 6, background: g.color }} />
            ))}
            Also supports: {also.map((g) => g.title).join(', ')}
          </span>
        )}
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
  { value: 'measure', label: 'Log a number' },
  { value: 'photo', label: 'Photo' },
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
  const view = useView();
  const [v, setV] = useState<TaskInput>(() => (task ? inputFromTask(task, week) : { ...blankTask(week, today), ...initial }));
  const set = (patch: Partial<TaskInput>) => setV((x) => ({ ...x, ...patch }));
  // Every goal this task supports. The goal you're on always stays in the set.
  const [goalIds, setGoalIds] = useState<string[]>(() => (task ? view.goalsForAction(task.action.id).map((g) => g.id) : [goal.id]));
  const connected = new Set(view.connectionsFor(goal.id).map((c) => c.goal.id));
  const goalChoices = [
    goal,
    ...view.activeGoals.filter((g) => g.id !== goal.id).sort((a, b) => Number(connected.has(b.id)) - Number(connected.has(a.id)) || a.title.localeCompare(b.title)),
    ...goalIds.map((id) => view.goal(id)).filter((g): g is Goal => !!g && g.id !== goal.id && !view.activeGoals.includes(g)),
  ];
  const sharedWith = task ? view.otherGoalsForAction(task.action.id, goal.id) : [];
  const types = data.measurementTypes.filter((t) => !t.archived_at);
  const pickKind = (kind: ActionKind) => {
    const patch: Partial<TaskInput> = { kind };
    // A weigh-in or a photo takes no real time: don't count 30 minutes toward the day.
    if ((kind === 'measure' || kind === 'photo') && v.kind !== 'measure' && v.kind !== 'photo') patch.minutes = 0;
    if (kind === 'measure' && !v.measurementTypeId && !v.newMeasure) {
      const fromGoals = goalIds.map((id) => view.goal(id)?.measurement_type_id).find((x) => x && types.some((t) => t.id === x));
      const first = fromGoals ?? types[0]?.id ?? null;
      patch.measurementTypeId = first;
      patch.newMeasure = first ? null : { name: '', unit: data.profile.units };
    }
    set(patch);
  };
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
  const measureOk = v.kind !== 'measure' || (v.newMeasure ? v.newMeasure.name.trim().length > 0 : !!v.measurementTypeId);
  const valid = v.title.trim().length > 0 && (v.when !== 'days' || v.days.length > 0) && (v.when !== 'once' || dayChoices.includes(v.date)) && measureOk;

  function save() {
    if (!valid) return;
    if (task) {
      // A one-day task on a day that has already passed only changes its details, not its date.
      const editFrom = originalDate && originalDate < from && v.when === 'once' && v.date === originalDate ? originalDate : from;
      commit(opsEditTask(data, task.action, { ...v, goalIds }, editFrom, today, goal.id));
      onSaved(`${v.title.trim()} updated${editFrom > today ? ` from ${shortDate(editFrom)}` : ''}`);
    } else {
      const ensure = opsEnsureStep(data, week);
      commit([...ensure, ...opsAddTask(withOps(data, ensure), goal, week, { ...v, goalIds }, today)]);
      onSaved(`Added ${v.title.trim()}${week.start_date <= today ? ". It's on Today when it's due." : ''}`);
    }
  }

  return (
    <Sheet title={task ? 'Edit daily task' : `New task · ${week.title}`} onClose={onClose}>
      <div className="row-start small muted" style={{ marginTop: -8 }}>
        <span className="dot" style={{ background: goal.color }} />
        {goal.title} · {rangeLabel(dateRange(week))}
      </div>
      {sharedWith.length > 0 && (
        <div className="banner info">
          <span>Shared with {sharedWith.map((g) => g.title).join(', ')}: changes here change it there too.</span>
        </div>
      )}
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
            <button key={k.value} className="chip" aria-pressed={v.kind === k.value} onClick={() => pickKind(k.value)}>
              {k.label}
            </button>
          ))}
        </div>
        {v.kind === 'measure' && <span className="xsmall muted">Checking it off asks for the number and saves it as that day's reading, so the goal's path updates.</span>}
        {v.kind === 'photo' && <span className="xsmall muted">Checking it off opens the camera or your photos and saves the photo to that day.</span>}
      </div>
      {v.kind === 'measure' && (
        <div className="stack-sm">
          <label className="field">
            What it records
            <select
              value={v.newMeasure ? '__new' : v.measurementTypeId ?? ''}
              onChange={(e) => (e.target.value === '__new' ? set({ newMeasure: { name: '', unit: data.profile.units }, measurementTypeId: null }) : set({ measurementTypeId: e.target.value, newMeasure: null }))}
            >
              {types.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                  {t.unit ? ` (${t.unit})` : ''}
                </option>
              ))}
              <option value="__new">+ New measurement…</option>
            </select>
          </label>
          {v.newMeasure && (
            <div className="grid-2">
              <label className="field">
                Name
                <input value={v.newMeasure.name} onChange={(e) => set({ newMeasure: { ...v.newMeasure!, name: e.target.value } })} placeholder="e.g. Weight" />
              </label>
              <label className="field">
                Unit
                <input value={v.newMeasure.unit} onChange={(e) => set({ newMeasure: { ...v.newMeasure!, unit: e.target.value } })} placeholder="e.g. lb" />
              </label>
            </div>
          )}
        </div>
      )}
      <div className="grid-2">
        {v.kind !== 'measure' && v.kind !== 'photo' && (
          <label className="field">
            Minutes
            <input type="number" min={0} value={v.minutes} onChange={(e) => set({ minutes: Math.max(0, Number(e.target.value)) })} />
          </label>
        )}
        {v.kind === 'count' && (
          <label className="field">
            How many
            <input type="number" min={1} value={v.count ?? 1} onChange={(e) => set({ count: Math.max(1, Number(e.target.value)) })} />
          </label>
        )}
      </div>
      <label className="field">
        When does it happen? (optional)
        <input value={v.cue} onChange={(e) => set({ cue: e.target.value })} placeholder="e.g. After morning coffee, at my desk" />
        <span className="xsmall muted">A specific cue ("after ___, at ___") makes a habit much more likely to stick. It shows on Today.</span>
      </label>
      <label className="field">
        Minimum version for hard days (optional)
        <input value={v.minLabel} onChange={(e) => set({ minLabel: e.target.value })} placeholder="e.g. 5 minutes" />
      </label>
      {goalChoices.length > 1 && (
        <div className="stack-sm">
          <span className="xsmall muted">Supports (logging it once counts for each)</span>
          <div className="chips" role="group" aria-label="Goals this task supports">
            {goalChoices.map((g) => {
              const on = goalIds.includes(g.id);
              return (
                <button
                  key={g.id}
                  className="chip"
                  aria-pressed={on}
                  disabled={g.id === goal.id}
                  title={g.id === goal.id ? 'The goal you are on' : undefined}
                  onClick={() => setGoalIds(on ? goalIds.filter((x) => x !== g.id) : [...goalIds, g.id])}
                  style={{ display: 'inline-flex', alignItems: 'center', gap: 7 }}
                >
                  <span className="dot" style={{ width: 7, height: 7, background: g.color }} />
                  {g.title}
                </button>
              );
            })}
          </div>
        </div>
      )}
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
        {task && sharedWith.length > 0 && (
          <button
            className="btn"
            onClick={() => {
              commit(opsUnshareTask(data, task.action.id, goal.id));
              onSaved(`${task.action.title} no longer counts for ${goal.title}; it keeps running for ${sharedWith.map((g) => g.title).join(', ')}`);
            }}
          >
            Remove from this goal
          </button>
        )}
        {task && (
          <button
            className="btn danger"
            onClick={() => {
              commit(opsRemoveTask(data, task.action, from));
              onSaved(`${task.action.title} removed from ${from === today ? 'today' : shortDate(from)} on`);
            }}
          >
            {sharedWith.length > 0 ? 'Stop everywhere' : 'Remove'}
          </button>
        )}
        <button className="btn primary" disabled={!valid} onClick={save}>
          {task ? 'Save changes' : 'Add task'}
        </button>
      </div>
    </Sheet>
  );
}
