import { useEffect, useMemo, useRef, useState } from 'react';
import { addDays, chainAt, isStale, prepGaps, shortDate, suggestPath, valueOnPath, type GoalType, type IdeaPrep, type PathPoint } from '@six/core';
import { useStore } from '../data/store.tsx';
import { fmt, useView } from '../data/derive.ts';
import { href, navigate } from '../router.ts';
import { opsSavePrep } from '../data/commit.ts';
import { BackLink, Empty, GOAL_COLORS, Icon, NumberInput, WEEKDAY_NAMES, useToast } from '../components/ui.tsx';
import { WeightChart } from '../components/WeightChart.tsx';

const TYPES: { value: GoalType; title: string; sub: string }[] = [
  { value: 'number', title: 'Reach a number', sub: 'Start, target, date' },
  { value: 'practice', title: 'Build a practice', sub: 'Times per week' },
  { value: 'finish', title: 'Finish something', sub: 'Dated steps' },
];

/**
 * Goals start in the backlog. Without a selected idea, goal setup isn't the way in:
 * send the person to the backlog (where new goal ideas are written down).
 */
export function GoalNew({ ideaId = null }: { planId?: string | null; ideaId?: string | null }) {
  const { data } = useStore();
  const idea = ideaId ? data.ideas.find((i) => i.id === ideaId) : undefined;
  useEffect(() => {
    if (!idea) navigate('/goals/backlog');
  }, [idea]);
  if (!idea) return null;
  if (idea.status !== 'selected') {
    return (
      <Empty title={idea.status === 'started' ? 'This idea is already a goal.' : 'Select this idea first.'}>
        <a className="btn" href={href('/goals/backlog')}>
          Back to the backlog
        </a>
      </Empty>
    );
  }
  return <GoalPrepare key={idea.id} ideaId={idea.id} />;
}

/**
 * Prepare a selected idea for commitment: what kind of goal it is, its target, and its first
 * 3 months, month, week and daily task. Saving stores the plan on the idea; it does not create
 * the goal. Committing is a separate step on the backlog ("Commit to the next six months").
 */
function GoalPrepare({ ideaId }: { ideaId: string }) {
  const { data, today, commit } = useStore();
  const view = useView();
  const toast = useToast();
  const idea = data.ideas.find((i) => i.id === ideaId)!;
  const prep: IdeaPrep = idea.prep ?? {};
  const live = data.plans.filter((p) => !p.archived_at && p.end_date >= today).sort((a, b) => (a.start_date < b.start_date ? -1 : 1));
  const [planId, setPlanId] = useState<string | null>(prep.plan_id && live.some((p) => p.id === prep.plan_id) ? prep.plan_id : view.mainPlan?.id ?? live[0]?.id ?? null);
  const plan = (planId && view.plan(planId)) || view.mainPlan;
  const existing = plan ? view.goalsForPlan(plan.id) : [];

  const [step, setStep] = useState(1);
  const [title, setTitle] = useState(idea.title);
  const [type, setType] = useState<GoalType>(prep.type ?? 'practice');
  // "Reach a number" fields start empty: placeholders show examples, nothing is pre-filled.
  const [unit, setUnit] = useState(prep.unit ?? '');
  const [measureName, setMeasureName] = useState(prep.measure_name ?? '');
  const [baseline, setBaseline] = useState<number | null>(prep.baseline ?? null);
  const [target, setTarget] = useState<number | null>(prep.target ?? null);
  const [targetDate, setTargetDate] = useState(prep.target_date ?? '');
  // A date input can't show a placeholder, so it stays a text input until focused or filled.
  const [dateFocused, setDateFocused] = useState(false);
  const dateRef = useRef<HTMLInputElement>(null);
  const [edits, setEdits] = useState<Record<string, number>>(prep.path_edits ?? {});
  const [why, setWhy] = useState(idea.note);
  const [doneMeans, setDoneMeans] = useState(idea.done_means ?? '');
  const [milestones, setMilestones] = useState(prep.milestones?.length ? prep.milestones : [{ title: '', due_date: addDays(today, 28) }]);
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
  const [notes, setNotes] = useState<{ quarter: string; month: string; week: string } | null>(
    prep.quarter || prep.month || prep.week ? { quarter: prep.quarter ?? '', month: prep.month ?? '', week: prep.week ?? '' } : null,
  );
  const [taskTitle, setTaskTitle] = useState(prep.task?.title ?? '');
  const [taskDays, setTaskDays] = useState<number[]>(prep.task?.days ?? [1, 3, 5]);
  const [taskMinutes, setTaskMinutes] = useState(prep.task?.minutes ?? 30);
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

  // Entry requirements for committing: its 3-month, month and first-week goals, and a daily task.
  const ready = [
    { key: 'quarter', label: '3-month goal', ok: !!chainNotes.quarter.trim() },
    { key: 'month', label: 'This month’s goal', ok: !!chainNotes.month.trim() },
    { key: 'week', label: 'This week’s goal', ok: !!chainNotes.week.trim() },
    { key: 'task', label: 'A daily task with its days', ok: !!firstTask.trim() && taskDays.length > 0 && taskMinutes > 0 },
  ];
  const isReady = ready.every((r) => r.ok);
  const stale = (level: 'quarter' | 'month' | 'week') => !!periods && isStale(prep, level, periods[level].start) && chainNotes[level] === (prep[level] ?? '');

  const canNext1 = title.trim().length > 0;
  const canNext2 = type !== 'number' || (target != null && !!targetDate && targetDate > today);

  /** Save the prepared plan on the idea and go back to the backlog. Nothing is committed. */
  function savePlan() {
    if (!plan || !periods) return;
    const next: IdeaPrep = {
      type,
      unit,
      measure_name: measureName,
      baseline,
      target,
      target_date: targetDate || undefined,
      path_edits: edits,
      milestones: type === 'finish' ? milestones.filter((m) => m.title.trim()) : [],
      quarter: chainNotes.quarter.trim(),
      month: chainNotes.month.trim(),
      week: chainNotes.week.trim(),
      quarter_of: periods.quarter.start,
      month_of: periods.month.start,
      week_of: periods.week.start,
      task: { title: firstTask.trim(), days: taskDays, minutes: taskMinutes },
      plan_id: plan.id,
    };
    const ops = opsSavePrep(idea, next, title);
    const patch = ops[0]!.kind === 'update' ? (ops[0] as { patch: Record<string, unknown> }).patch : {};
    if (why.trim() !== idea.note) patch.note = why.trim();
    if (doneMeans.trim() !== (idea.done_means ?? '')) patch.done_means = doneMeans.trim();
    commit(ops);
    const left = prepGaps(next, periods).length;
    toast(left ? `Plan saved. ${left} more to do before you can commit.` : 'Plan saved. Commit it from the backlog when you’re ready.');
    navigate('/goals/backlog');
  }

  return (
    <div className="stack">
      <div className="row-between">
        <BackLink label="Cancel" fallback="/goals/backlog" />
        <span className="small muted">
          Prepare · step {step} of 3
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
          <span className="pill none" style={{ alignSelf: 'flex-start' }}>Preparing a selected idea · nothing is committed until you say so</span>
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
          {live.length > 1 && (
            <label className="field">
              For which plan?
              <select value={plan.id} onChange={(e) => setPlanId(e.target.value)}>
                {live.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} · {shortDate(p.start_date)} – {shortDate(p.end_date)}
                  </option>
                ))}
              </select>
            </label>
          )}
          {existing.length >= 3 && (
            <div className="banner warn">{plan.name} already has {existing.length} goals. Most people stick with 3–4 at first.</div>
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
          <h1>Prepare to commit</h1>
          <p className="muted small" style={{ margin: 0 }}>
            Write what should be true in 3 months, this month and this week, and what you'll do each day. Saving keeps this plan on the idea; you commit it from the backlog when you're ready.
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
                  {stale(level) && (
                    <span className="xsmall" style={{ color: 'var(--amber-ink)', fontWeight: 400 }}>
                      Written for {shortDate(prep[`${level}_of`]!)}. Still right for {level === 'week' ? 'this week' : level === 'month' ? 'this month' : 'these 3 months'}? Saving confirms it.
                    </span>
                  )}
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
            <span className="xsmall muted">Once committed, it lands on Today on those days. Add more tasks on the goal page.</span>
          </div>
          <div className="card stack-sm ready-list" aria-label="Ready to commit">
            <span className="label">To commit this goal</span>
            {ready.map((r) => (
              <span key={r.key} className={`ready-item${r.ok ? ' ok' : ''}`}>
                <span className="ready-mark" aria-hidden="true">
                  {r.ok ? <Icon name="check" size={12} stroke={3} /> : null}
                </span>
                {r.label}
                <span className="visually-hidden">{r.ok ? ': done' : ': still needed'}</span>
              </span>
            ))}
            <span className="xsmall muted" style={{ marginTop: 4 }}>
              {isReady ? 'Ready to commit. Save the plan, then commit it from the backlog.' : 'You can save now and finish later.'}
            </span>
          </div>
          <div className="btn-row">
            <button className="btn" onClick={() => setStep(2)}>
              Back
            </button>
            <button className="btn primary" onClick={savePlan}>
              Save plan
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
