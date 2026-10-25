import { useMemo, useRef, useState } from 'react';
import { addDays, chainAt, shortDate, suggestPath, valueOnPath, type GoalType, type PathPoint } from '@six/core';
import { useStore } from '../data/store.tsx';
import { fmt, useView } from '../data/derive.ts';
import { opsCreateGoal } from '../data/ops.ts';
import { navigate } from '../router.ts';
import { blankTask, opsAddTask, withOps } from '../data/breakdown.ts';
import { opsStartIdea } from '../data/backlog.ts';
import { chainFor, opsStartChain } from '../data/chain.ts';
import { BackLink, Empty, GOAL_COLORS, Icon, NumberInput, WEEKDAY_NAMES, useToast } from '../components/ui.tsx';
import { WeightChart } from '../components/WeightChart.tsx';

const TYPES: { value: GoalType; title: string; sub: string }[] = [
  { value: 'number', title: 'Reach a number', sub: 'Start, target, date' },
  { value: 'practice', title: 'Build a practice', sub: 'Times per week' },
  { value: 'finish', title: 'Finish something', sub: 'Dated steps' },
];

/** Set up a goal. Started from a backlog idea (ideaId), its title and why come from the idea. */
export function GoalNew({ planId, ideaId = null }: { planId: string | null; ideaId?: string | null }) {
  const { data, today, commit } = useStore();
  const view = useView();
  const toast = useToast();
  const plan = (planId && view.plan(planId)) || view.mainPlan;
  const existing = plan ? view.goalsForPlan(plan.id) : [];

  const [step, setStep] = useState(1);
  const idea = ideaId ? data.ideas.find((i) => i.id === ideaId && i.status !== 'started') ?? null : null;
  const [title, setTitle] = useState(idea?.title ?? '');
  const [type, setType] = useState<GoalType>('practice');
  // "Reach a number" fields start empty: placeholders show examples, nothing is pre-filled.
  const [unit, setUnit] = useState('');
  const [measureName, setMeasureName] = useState('');
  const [baseline, setBaseline] = useState<number | null>(null);
  const [target, setTarget] = useState<number | null>(null);
  const [targetDate, setTargetDate] = useState('');
  // A date input can't show a placeholder, so it stays a text input until focused or filled.
  const [dateFocused, setDateFocused] = useState(false);
  const dateRef = useRef<HTMLInputElement>(null);
  const [edits, setEdits] = useState<Record<string, number>>({});
  const [why, setWhy] = useState(idea?.note ?? '');
  const [doneMeans, setDoneMeans] = useState(idea?.done_means ?? '');
  const [milestones, setMilestones] = useState([{ title: '', due_date: addDays(today, 28) }]);
  const color = GOAL_COLORS[existing.length % GOAL_COLORS.length]!;

  const startDate = today;
  const path: PathPoint[] = useMemo(() => {
    if (type !== 'number' || baseline == null || target == null || !targetDate || targetDate <= startDate) return [];
    return suggestPath(baseline, target, startDate, targetDate, plan?.block_days ?? 28).map((p) => ({
      ...p,
      value: edits[p.date] ?? p.value,
    }));
  }, [type, baseline, target, startDate, targetDate, plan, edits]);

  // The current links of the chain this goal starts with.
  const periods = useMemo(() => (plan ? chainAt(plan, today < plan.start_date ? plan.start_date : today) : null), [plan, today]);
  const [notes, setNotes] = useState<{ quarter: string; month: string; week: string } | null>(null);
  const [taskTitle, setTaskTitle] = useState('');
  const [taskDays, setTaskDays] = useState<number[]>([1, 3, 5]);
  const [taskMinutes, setTaskMinutes] = useState(30);
  const startPoint = baseline != null ? { date: startDate, value: baseline } : null;
  const targetAt = (d: string) => (type === 'number' && startPoint && path.length ? fmt(valueOnPath(startPoint, path, d)) : null);

  if (!plan) return <Empty title="Create a plan first." />;

  const firstMilestone = (from: string, to: string) => milestones.find((m) => m.title.trim() && m.due_date >= from && m.due_date <= to)?.title.trim();
  const defaults = () => {
    if (!periods) return { quarter: '', month: '', week: '' };
    if (type === 'number') return { quarter: '', month: '', week: '' };
    if (type === 'finish') {
      return {
        quarter: firstMilestone(periods.quarter.start, periods.quarter.end) ? `Done: ${milestones.filter((m) => m.title.trim() && m.due_date <= periods.quarter.end).map((m) => m.title.trim()).join(', ')}` : '',
        month: firstMilestone(periods.month.start, periods.month.end) ?? '',
        week: firstMilestone(periods.week.start, periods.week.end) ?? '',
      };
    }
    return { quarter: '', month: '', week: '' };
  };
  const chainNotes = notes ?? defaults();
  // Only what the person types: no made-up "Work on …" task.
  const firstTask = taskTitle;

  // Entry requirements for a goal to start: its 3-month, month and first-week goals, and a daily task.
  const ready = [
    { key: 'quarter', label: '3-month goal', ok: !!chainNotes.quarter.trim() },
    { key: 'month', label: 'This month’s goal', ok: !!chainNotes.month.trim() },
    { key: 'week', label: 'This week’s goal', ok: !!chainNotes.week.trim() },
    { key: 'task', label: 'A daily task with its days', ok: !!firstTask.trim() && taskDays.length > 0 && taskMinutes > 0 },
  ];
  const isReady = ready.every((r) => r.ok);

  const canNext1 = title.trim().length > 0;
  const canNext2 = type !== 'number' || (target != null && !!targetDate && targetDate > today);

  function save() {
    if (!plan || !isReady) return;
    const { ops, goalId } = opsCreateGoal(
      data,
      {
        planId: plan.id,
        title,
        type,
        why,
        done_means: doneMeans,
        color,
        unit,
        measureName,
        baseline,
        target,
        targetDate,
        path,
        milestones: type === 'finish' ? milestones : [],
        action: null,
      },
      today,
    );
    // The goal starts with its current chain (3 months, this month, this week) and, optionally, a first daily task.
    let next = withOps(data, ops);
    const goal = next.goals.find((g) => g.id === goalId)!;
    const chainOps = opsStartChain(next, goal, plan, today, { quarter: chainNotes.quarter.trim(), month: chainNotes.month.trim(), week: chainNotes.week.trim() });
    next = withOps(next, chainOps);
    const all = [...ops, ...chainOps];
    if (firstTask.trim() && taskDays.length) {
      const week = chainFor(next, goal, plan, today < plan.start_date ? plan.start_date : today).week.step!;
      all.push(...opsAddTask(next, goal, week, { ...blankTask(week, today), title: firstTask.trim(), when: 'days', days: taskDays, minutes: taskMinutes, through: null }, today));
    }
    if (idea) all.push(...opsStartIdea(withOps(data, all), idea.id, goalId));
    commit(all);
    toast(`Added ${title.trim()}. It's set up through this week.`);
    navigate(`/goals/${goalId}`);
  }

  return (
    <div className="stack">
      <div className="row-between">
        <BackLink label="Cancel" fallback={idea ? '/goals/backlog' : '/goals'} />
        <span className="small muted">
          {plan.name} · step {step} of 3
        </span>
      </div>
      <div className="steps" aria-hidden="true">
        {[1, 2, 3].map((n) => (
          <div key={n} className={n <= step ? 'on' : ''} />
        ))}
      </div>

      {step === 1 && (
        <div className="stack">
          <h1>What do you want to be true in six months?</h1>
          {idea && <span className="pill none" style={{ alignSelf: 'flex-start' }}>From your backlog · selected for next commitment</span>}
          <label className="field">
            Goal
            <input autoFocus value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Comfortable on guitar" />
          </label>
          <div className="grid-3">
            {TYPES.map((t) => (
              <button key={t.value} type="button" className="choice" aria-pressed={type === t.value} onClick={() => setType(t.value)}>
                <b>{t.title}</b>
                <span>{t.sub}</span>
              </button>
            ))}
          </div>
          {existing.length >= 3 && (
            <div className="banner warn">This plan already has {existing.length} goals. Most people stick with 3–4 at first.</div>
          )}
          <button className="btn primary" disabled={!canNext1} onClick={() => setStep(2)}>
            Next
          </button>
        </div>
      )}

      {step === 2 && (
        <div className="stack">
          <h1>{title}</h1>
          {type === 'number' && (
            <>
              <div className="grid-2">
                <label className="field">
                  What you measure
                  <input value={measureName} onChange={(e) => setMeasureName(e.target.value)} placeholder="e.g. Body weight" />
                </label>
                <label className="field">
                  Unit
                  <input value={unit} onChange={(e) => setUnit(e.target.value)} placeholder="e.g. lb" />
                </label>
              </div>
              <div className="grid-3">
                <NumberInput label="Starting point" value={baseline} onChange={setBaseline} placeholder="e.g. 190" />
                <NumberInput label="Target" value={target} onChange={setTarget} placeholder="e.g. 160" />
                <label className="field">
                  By
                  <input
                    ref={dateRef}
                    type={targetDate || dateFocused ? 'date' : 'text'}
                    value={targetDate}
                    min={addDays(today, 7)}
                    placeholder={`e.g. ${shortDate(plan.end_date)}`}
                    onFocus={() => {
                      setDateFocused(true);
                      // Open the picker once the input has switched to a date input.
                      setTimeout(() => {
                        try {
                          dateRef.current?.showPicker?.();
                        } catch {
                          /* some browsers only allow showPicker on a click */
                        }
                      }, 0);
                    }}
                    onBlur={() => setDateFocused(false)}
                    onChange={(e) => setTargetDate(e.target.value)}
                  />
                </label>
              </div>
              {baseline == null && <p className="xsmall muted" style={{ margin: 0 }}>Don't know your start yet? Leave it empty and add it later.</p>}
              {path.length > 0 && baseline != null && (
                <div className="card stack-sm">
                  <div className="row-between small">
                    <b>Suggested path</b>
                    <span className="muted">
                      {fmt(((target! - baseline) / Math.max(1, path.length)))} {unit} every {Math.round((plan?.block_days ?? 28) / 7)} weeks
                    </span>
                  </div>
                  <WeightChart
                    start={{ date: startDate, value: baseline }}
                    path={path}
                    readings={[]}
                    range={{ start: startDate, end: targetDate }}
                    today={today}
                    unit={unit}
                    color={color}
                  />
                  <div className="xsmall muted">Change any block's target if the straight line doesn't fit.</div>
                  <div className="grid-3">
                    {path.map((p, i) => (
                      <NumberInput
                        key={p.date}
                        label={i === path.length - 1 ? `Goal · ${p.date.slice(5)}` : `Checkpoint ${i + 1} · ${p.date.slice(5)}`}
                        value={p.value}
                        onChange={(v) => v != null && setEdits({ ...edits, [p.date]: v })}
                      />
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
          {type === 'finish' && (
            <div className="card stack-sm">
              <b className="small">Dated steps (modules, exam booking, exam day)</b>
              {milestones.map((m, i) => (
                <div key={i} className="grid-2">
                  <input
                    className="input"
                    aria-label={`Step ${i + 1}`}
                    placeholder={`Step ${i + 1}`}
                    value={m.title}
                    onChange={(e) => setMilestones(milestones.map((x, j) => (j === i ? { ...x, title: e.target.value } : x)))}
                  />
                  <input
                    className="input"
                    type="date"
                    aria-label={`Step ${i + 1} date`}
                    value={m.due_date}
                    onChange={(e) => setMilestones(milestones.map((x, j) => (j === i ? { ...x, due_date: e.target.value } : x)))}
                  />
                </div>
              ))}
              <button
                type="button"
                className="link-btn small"
                style={{ alignSelf: 'flex-start' }}
                onClick={() => setMilestones([...milestones, { title: '', due_date: addDays(milestones.at(-1)?.due_date ?? today, 14) }])}
              >
                + Add a step
              </button>
            </div>
          )}
          {type === 'practice' && (
            <p className="muted small" style={{ margin: 0 }}>
              Practice goals are tracked by how often you show up. You can add a measurement (arm size, splits gap) on the goal page afterwards.
            </p>
          )}
          <label className="field">
            Why this matters (one line)
            <input value={why} onChange={(e) => setWhy(e.target.value)} placeholder="e.g. Play for myself at the end of the day" />
          </label>
          <label className="field">
            How will you know you made it?
            <input value={doneMeans} onChange={(e) => setDoneMeans(e.target.value)} placeholder="e.g. 3 songs recorded start to finish" />
          </label>
          <div className="btn-row">
            <button className="btn" onClick={() => setStep(1)}>
              Back
            </button>
            <button className="btn primary" disabled={!canNext2} onClick={() => setStep(3)}>
              Next
            </button>
          </div>
        </div>
      )}

      {step === 3 && periods && (
        <div className="stack">
          <h1>Ready to start</h1>
          <p className="muted small" style={{ margin: 0 }}>
            A goal starts once you know what should be true in 3 months, this month and this week, and what you'll do each day. You can change any of it later.
          </p>
          <div className="card stack">
            <div className="row-between">
              <span className="label">6 months</span>
              <span className="mono" style={{ fontSize: 10 }}>
                {shortDate(plan.start_date)} – {shortDate(plan.end_date)}
              </span>
            </div>
            <b style={{ fontSize: 16 }}>
              {title.trim()}
              {type === 'number' && target != null ? ` · ${baseline != null ? `${fmt(baseline)} → ` : ''}${fmt(target)} ${unit}` : ''}
            </b>
            {(['quarter', 'month', 'week'] as const).map((level) => {
              const node = periods[level];
              const t = targetAt(node.end);
              return (
                <label key={level} className="field">
                  {level === 'quarter' ? `${node.title}` : level === 'month' ? `This month (${node.title})` : `This week (${node.title})`} · by {shortDate(node.end)}
                  {t ? ` · target ${t} ${unit}` : ''}
                  <input
                    value={chainNotes[level]}
                    onChange={(e) => setNotes({ ...chainNotes, [level]: e.target.value })}
                    placeholder={level === 'quarter' ? 'e.g. Record song 1 start to finish' : level === 'month' ? 'e.g. Clean G–C–D–Em changes at 60 bpm' : 'e.g. Practise G–C–D 20 minutes on 5 days'}
                    required
                  />
                </label>
              );
            })}
          </div>
          <div className="card stack">
            <span className="label">First daily task</span>
            <label className="field">
              Task
              <input value={firstTask} onChange={(e) => setTaskTitle(e.target.value)} placeholder="e.g. Guitar practice" />
            </label>
            <div className="chips" role="group" aria-label="Days">
              {WEEKDAY_NAMES.map((d, i) => (
                <button
                  key={d}
                  type="button"
                  className="chip"
                  aria-pressed={taskDays.includes(i + 1)}
                  onClick={() => setTaskDays(taskDays.includes(i + 1) ? taskDays.filter((x) => x !== i + 1) : [...taskDays, i + 1].sort())}
                >
                  {d}
                </button>
              ))}
            </div>
            <label className="field">
              Minutes
              <input type="number" min={0} value={taskMinutes} onChange={(e) => setTaskMinutes(Number(e.target.value))} />
            </label>
            <span className="xsmall muted">It lands on Today on those days. Add more tasks on the goal page.</span>
          </div>
          <div className="card stack-sm ready-list" aria-label="Ready to start">
            <span className="label">To start this goal</span>
            {ready.map((r) => (
              <span key={r.key} className={`ready-item${r.ok ? ' ok' : ''}`}>
                <span className="ready-mark" aria-hidden="true">
                  {r.ok ? <Icon name="check" size={12} stroke={3} /> : null}
                </span>
                {r.label}
                <span className="visually-hidden">{r.ok ? ': done' : ': still needed'}</span>
              </span>
            ))}
          </div>
          <div className="btn-row">
            <button className="btn" onClick={() => setStep(2)}>
              Back
            </button>
            <button className="btn primary" onClick={save} disabled={!isReady}>
              {isReady ? 'Start goal' : `${ready.filter((r) => !r.ok).length} to go`}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
