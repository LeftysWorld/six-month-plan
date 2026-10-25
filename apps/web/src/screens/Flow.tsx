import { useState } from 'react';
import {
  addDays,
  currentTargets,
  daysBetween,
  weekStart,
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
import { CHAIN_LEVELS, catchUpPlan, chainFor, isSet, opsAddExtra, opsEnsureStep, periodStatus, opsSetLevel, stepFor, type Chain, type ChainLevel } from '../data/chain.ts';
import { GoalExtras, GoalManage, GoalRecord, WhyLine } from './GoalDetail.tsx';
import { GoalGroupCard } from '../components/Connections.tsx';
import { MeasureSheet } from '../components/MeasureSheet.tsx';
import { WeightChart } from '../components/WeightChart.tsx';
import { opsLogSession, opsLogUnplanned, opsRestoreSession, opsToggleMilestone, opsUpdateGoal } from '../data/ops.ts';
import { href } from '../router.ts';
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
import { goalTrack } from '../data/season.ts';
import { matchingTasks, opsRecordReading, opsShareTask, opsUnshareTask, shareCandidates } from '../data/connect.ts';
import { ConnectionStrip, ShareTaskSheet } from '../components/Connections.tsx';

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
  const windowName = plan.solo
    ? today < plan.start_date
      ? `Own clock · starts ${shortDate(plan.start_date)}`
      : `Own clock · day ${Math.max(1, Math.min(daysBetween(plan.start_date, today) + 1, daysBetween(plan.start_date, plan.end_date) + 1))} of ${daysBetween(plan.start_date, plan.end_date) + 1}`
    : plan.name;
  const ink = !t.started ? 'var(--muted)' : t.label === 'behind' ? 'var(--amber-ink)' : t.label === 'ahead' ? 'var(--blue-ink)' : 'var(--ink-2)';

  return (
    <div className="stack rise">
      <BackLink label="Goals" fallback="/goals" />
      <div className="stack-sm" style={{ gap: 6 }}>
        <div className="row-start" style={{ gap: 10, flexWrap: 'nowrap' }}>
          <span className="dot" style={{ width: 11, height: 11, flex: 'none', background: goal.color }} />
          <h1 style={{ margin: 0 }}>{goal.title}</h1>
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
          <GoalGroupCard goal={goal} />
          <GoalManage goal={goal} />
        </aside>
      </div>

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
  // New task: offer the tasks other goals already have, so a duplicate isn't made by accident.
  const candidates = task ? [] : shareCandidates(view, goal.id, today);
  const matches = matchingTasks(candidates, v.title);
  const [browsing, setBrowsing] = useState(false);
  const useExisting = (actionId: string, title: string, from: string) => {
    commit(opsShareTask(data, actionId, goal.id));
    onSaved(`Using ${title} from ${from}: it now counts for ${goal.title} too`);
  };
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
      {matches.length > 0 && (
        <div className="banner info stack-sm" style={{ alignItems: 'stretch' }}>
          {matches.slice(0, 3).map((m) => (
            <div key={m.action.id} className="row-between" style={{ gap: 8 }}>
              <span className="small">
                <b>{m.action.title}</b> already exists on {m.goal.title}. Use that one instead?
              </span>
              <button className="btn small" style={{ flex: 'none' }} onClick={() => useExisting(m.action.id, m.action.title, m.goal.title)}>
                Use it
              </button>
            </div>
          ))}
        </div>
      )}
      {!task && candidates.length > 0 && !v.title.trim() && (
        <div className="card tight stack-sm">
          <div className="row-between">
            <span className="xsmall muted">Or use one you already have (logged once, counts for both)</span>
            <button className="link-btn small" onClick={() => setBrowsing(true)}>
              See all
            </button>
          </div>
          <div className="chips">
            {candidates.flatMap((g) => g.tasks.map((t) => ({ ...t, goal: g.goal }))).slice(0, 6).map((t) => (
              <button key={t.action.id} className="chip" onClick={() => useExisting(t.action.id, t.action.title, t.goal.title)} style={{ display: 'inline-flex', alignItems: 'center', gap: 7 }} title={`From ${t.goal.title} · ${describeSchedule(t.schedule)}`}>
                <span className="dot" style={{ width: 7, height: 7, background: t.goal.color }} />
                {t.action.title}
              </button>
            ))}
          </div>
        </div>
      )}
      {browsing && <ShareTaskSheet goal={goal} onClose={() => setBrowsing(false)} onShared={(m) => onSaved(m)} />}
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
        Details (optional)
        <textarea rows={4} value={v.details ?? ''} onChange={(e) => set({ details: e.target.value })} placeholder="e.g. exercises with sets × reps, starting weights and rest" />
        <span className="xsmall muted">Shown when you tap the task on Today.</span>
      </label>
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



// ---------- The goal page's cards ----------

/**
 * Progress: the only place the goal's numbers appear. Where it is, a track across the whole window
 * against even pace, what done is and when, and the one next step as a button. A number goal's
 * trend and readings open from here, and today's reading is logged here.
 */
function ProgressCard({ goal, plan, chain, onSetWeek }: { goal: Goal; plan: Plan; chain: Chain; onSetWeek: () => void }) {
  const { data, today, commit } = useStore();
  const view = useView();
  const toast = useToast();
  const [open, setOpen] = useState(false);
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
    const m = data.milestones.filter((x) => x.goal_id === goal.id && !x.completed_at).sort((a, b) => (a.due_date < b.due_date ? -1 : 1))[0];
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
            <span className="mono">STARTS {shortDate(plan.start_date).toUpperCase()}</span>
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
        <span>Start {shortDate(plan.start_date)}</span>
        <span>Tick: even pace</span>
        <span>{shortDate(t.by)}</span>
      </span>
      {fix && !fix.extra && <span className="xsmall" style={{ color: 'var(--amber-ink)' }}>{fix.text}</span>}
      {goal.type === 'number' && readings.length > 0 && (
        <>
          <button type="button" className="link-btn small" onClick={() => setOpen(!open)} style={{ alignSelf: 'flex-start', paddingLeft: 0 }}>
            {open ? 'Show less' : 'Show trend and readings'}
          </button>
          {open && (
            <div className="stack-sm">
              <WeightChart
                start={view.goalPace(goal, plan).number?.start ?? { date: plan.start_date, value: Number(goal.baseline_value ?? readings[0]!.value) }}
                path={view.pathFor(goal)}
                readings={readings}
                range={{ start: plan.start_date, end: goal.target_date ?? plan.end_date }}
                today={today}
                unit={goal.unit ?? ''}
                color={goal.color}
              />
              <div>
                {[...readings].reverse().slice(0, 6).map((m) => (
                  <div key={m.id} className="list-row small" style={{ minHeight: 40, padding: '8px 0' }}>
                    <span className="grow">{m.measured_on === today ? 'Today' : shortDate(m.measured_on)}</span>
                    <span className="num">
                      {fmt(Number(m.value))} {type?.unit}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}
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
    commit(opsLogUnplanned(data, t.action, d, t.action.planned_minutes));
    onToast(`${t.action.title} logged ${d === today ? 'today' : `on ${weekdayName(d)}`} as an extra`);
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
      {tasks.length === 0 && <span className="small muted week-row">No daily tasks this week yet.</span>}
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

/** The plan: this week → this month → 3 months → the season, soonest first, one line each with its status. Tap to edit. */
function PlanCard({ goal, plan, chain, onEdit }: { goal: Goal; plan: Plan; chain: Chain; onEdit: (level: ChainLevel | 'goal') => void }) {
  const { data, today } = useStore();
  const view = useView();
  const seasonTarget = goal.type === 'number' && goal.target_value != null ? `${fmt(goal.target_value)} ${goal.unit ?? ''}`.trim() : '';
  const longestFirst: { key: ChainLevel | 'goal'; name: string; text: string; when: string; status: { text: string; label: PaceLabel } | null; current: boolean }[] = [
    {
      key: 'goal',
      name: plan.solo ? 'Own clock' : 'Season',
      text: [seasonTarget, goal.done_means.trim()].filter(Boolean).join(' · ') || goal.title,
      when: `by ${shortDate(goal.target_date && goal.target_date <= plan.end_date ? goal.target_date : plan.end_date)}`,
      status: null,
      current: false,
    },
    ...CHAIN_LEVELS.map((level) => {
      const link = chain[level];
      const set = isSet(link);
      const value = goal.type === 'number' ? link.step?.target_value ?? link.suggested : null;
      const text = set ? [value != null ? `${fmt(value)} ${goal.unit ?? ''}`.trim() : '', link.step!.target_note.trim()].filter(Boolean).join(' · ') : '';
      return {
        key: level,
        name: level === 'quarter' ? '3 months' : level === 'month' ? 'This month' : 'This week',
        text,
        when: `${level === 'quarter' ? 'checkpoint ' : ''}${rangeLabel(link.node)}`,
        status: set && plan.start_date <= today ? periodStatus(view, data, goal, plan, link, today) : null,
        current: level === 'week',
      };
    }),
  ];
  // Soonest first: this week → this month → 3 months → the season.
  const lines = [...longestFirst].reverse();
  return (
    <section className="card plan-card" aria-label="The plan">
      <b className="plan-card-title">The plan</b>
      {lines.map((l, i) => (
        <button key={l.key} type="button" className={`plan-line-row${l.current ? ' current' : ''}`} onClick={() => onEdit(l.key)}>
          <span className="plan-rail" aria-hidden="true">
            <span className="plan-dot" style={l.current ? { background: goal.color, borderColor: goal.color } : undefined} />
            {i < lines.length - 1 && <span className="plan-stem" />}
          </span>
          <span className="plan-text">
            {l.text ? <span className="small" style={{ fontWeight: l.current ? 600 : 450 }}>{l.text}</span> : <span className="small" style={{ color: 'var(--accent-ink)' }}>+ Set {l.name.toLowerCase()}’s goal</span>}
            <span className="xsmall muted">
              {l.name.toUpperCase()} · {l.when}
              {l.status ? <span style={{ color: l.status.label === 'behind' ? 'var(--amber-ink)' : undefined }}> · {l.status.text}</span> : null}
            </span>
          </span>
          <span className="xsmall" style={{ color: 'var(--accent-ink)', fontWeight: 600 }}>{l.text ? 'Edit' : ''}</span>
        </button>
      ))}
    </section>
  );
}
