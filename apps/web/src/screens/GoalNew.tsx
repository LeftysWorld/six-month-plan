import { useMemo, useState } from 'react';
import { addDays, daysBetween, shortDate, type GoalType } from '@six/core';
import { useStore } from '../data/store.tsx';
import { runningSchedule } from '../data/connect.ts';
import { fmt } from '../data/derive.ts';
import { useView } from '../data/useView.ts';
import { newGoalGaps, newGoalPath, opsMakeGoal, opsStartSeason, type NewGoalInput } from '../data/newGoal.ts';
import { withOps } from '../data/breakdown.ts';
import { navigate } from '../router.ts';
import { BackLink, GOAL_COLORS, NumberInput, WEEKDAY_NAMES, useToast } from '../components/ui.tsx';
import { WeightChart } from '../components/WeightChart.tsx';

const TYPES: { value: GoalType; title: string; sub: string }[] = [
  { value: 'practice', title: 'Build a practice', sub: 'Show up, times a week' },
  { value: 'number', title: 'Reach a number', sub: 'Start, target, date' },
  { value: 'finish', title: 'Finish something', sub: 'Dates to hit' },
];

/**
 * Make a goal in one go: what it is and what done looks like, when it runs, this week's goal and
 * the first daily task. Opened from the backlog ("Make it a goal") or from the Goals page.
 */
export function GoalNew({ ideaId = null }: { ideaId?: string | null }) {
  const { data, today, commit } = useStore();
  const view = useView();
  const toast = useToast();
  const idea = ideaId ? data.ideas.find((i) => i.id === ideaId) : undefined;
  const seasons = view.batches;
  const [planId, setPlanId] = useState<string>(seasons.find((p) => p.start_date <= today)?.id ?? seasons[0]?.id ?? '');
  const [seasonName, setSeasonName] = useState('My six months');
  const plan = seasons.find((p) => p.id === planId) ?? null;
  // With no season running, one starts today when the goal is made.
  const season = plan ?? opsStartSeason(seasonName, today).plan;
  const from = today < season.start_date ? season.start_date : today;
  const existing = plan ? view.goalsForPlan(plan.id) : [];
  const color = GOAL_COLORS[existing.length % GOAL_COLORS.length]!;

  const [title, setTitle] = useState(idea?.title ?? '');
  const [type, setType] = useState<GoalType>('practice');
  const [why, setWhy] = useState(idea?.note ?? '');
  const [doneMeans, setDoneMeans] = useState(idea?.done_means ?? '');
  const [start, setStart] = useState('');
  const [finish, setFinish] = useState('');
  const [unit, setUnit] = useState('');
  const [measureName, setMeasureName] = useState('');
  const [baseline, setBaseline] = useState<number | null>(null);
  const [target, setTarget] = useState<number | null>(null);
  const [targetDate, setTargetDate] = useState('');
  const [edits, setEdits] = useState<Record<string, number>>({});
  const [milestones, setMilestones] = useState([{ title: '', due_date: addDays(from, 28) }]);
  const [weekGoal, setWeekGoal] = useState('');
  const [taskTitle, setTaskTitle] = useState('');
  const [taskDays, setTaskDays] = useState<number[]>([1, 3, 5]);
  const [taskMinutes, setTaskMinutes] = useState(30);
  const [share, setShare] = useState<string[]>([]);
  const [groupWith, setGroupWith] = useState<string | null>(null);

  const others = view.activeGoals;
  const shareable = [...new Map(others.flatMap((g) => view.actionsForGoal(g.id).filter((a) => !!runningSchedule(data, a.id, today))).map((a) => [a.id, a])).values()];
  const end = type === 'number' ? targetDate || season.end_date : finish || season.end_date;
  const horizon = daysBetween(start && start > from ? start : from, end) + 1;

  const input: NewGoalInput = {
    title,
    type,
    why,
    doneMeans,
    color,
    planId: season.id,
    start: start || null,
    finish: finish || null,
    unit,
    measureName,
    baseline,
    target,
    targetDate,
    pathEdits: edits,
    milestones,
    weekGoal,
    task: taskTitle.trim() ? { title: taskTitle, days: taskDays, minutes: taskMinutes } : null,
    shareActionIds: share,
    groupWithGoalId: groupWith,
    ideaId: idea?.id ?? null,
  };
  const path = useMemo(() => newGoalPath(input, start && start > from ? start : from, season.block_days), [type, baseline, target, targetDate, edits, start, from, season.block_days]); // eslint-disable-line react-hooks/exhaustive-deps
  const gaps = newGoalGaps(input, today);

  function make() {
    if (gaps.length) return;
    const ops = [];
    let base = data;
    if (!plan) {
      const s = opsStartSeason(seasonName, today);
      ops.push(...s.ops);
      base = withOps(base, s.ops);
    }
    const made = opsMakeGoal(base, season, input, today);
    ops.push(...made.ops);
    commit(ops);
    toast(`${title.trim()} is a goal${start && start > today ? `, starting ${shortDate(start)}` : ''}. Its tasks show on Today.`);
    navigate(`/goals/${made.goalId}`);
  }

  return (
    <div className="stack">
      <BackLink label="Cancel" fallback="/goals/backlog" />
      <h1>Make a goal</h1>

      <div className="card stack">
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
        <label className="field">
          Why it matters <span style={{ fontWeight: 400 }}>(one line for the hard days)</span>
          <input value={why} onChange={(e) => setWhy(e.target.value)} placeholder="e.g. Play for myself at the end of the day" />
        </label>
        {type !== 'number' && (
          <label className="field">
            What done looks like · by {shortDate(end)}
            <input value={doneMeans} onChange={(e) => setDoneMeans(e.target.value)} placeholder="e.g. 3 songs recorded start to finish" />
          </label>
        )}
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
                <input type="date" value={targetDate} min={addDays(today, 7)} max={season.end_date} onChange={(e) => setTargetDate(e.target.value)} />
              </label>
            </div>
            {baseline == null && <span className="xsmall muted">Don't know your start yet? Leave it empty and log your first reading later.</span>}
            {path.length > 0 && baseline != null && (
              <div className="stack-sm">
                <div className="row-between small">
                  <b>Suggested path</b>
                  <span className="muted">
                    {fmt((target! - baseline) / Math.max(1, path.length))} {unit} every {Math.round(season.block_days / 7)} weeks
                  </span>
                </div>
                <WeightChart start={{ date: from, value: baseline }} path={path} readings={[]} range={{ start: from, end: targetDate }} today={today} unit={unit} color={color} />
                <div className="grid-3">
                  {path.map((p, i) => (
                    <NumberInput key={p.date} label={i === path.length - 1 ? `Goal · ${p.date.slice(5)}` : `Checkpoint ${i + 1} · ${p.date.slice(5)}`} value={p.value} onChange={(v) => v != null && setEdits({ ...edits, [p.date]: v })} />
                  ))}
                </div>
              </div>
            )}
          </>
        )}
        {type === 'finish' && (
          <div className="stack-sm">
            <span className="label">Dates to hit (modules, exam booking, exam day)</span>
            {milestones.map((m, i) => (
              <div key={i} className="grid-2">
                <input className="input" aria-label={`Date ${i + 1}`} placeholder={`e.g. ${i === 0 ? 'Module 1 done' : 'Exam booked'}`} value={m.title} onChange={(e) => setMilestones(milestones.map((x, j) => (j === i ? { ...x, title: e.target.value } : x)))} />
                <input className="input" type="date" aria-label={`Date ${i + 1}`} value={m.due_date} min={from} max={end} onChange={(e) => e.target.value && setMilestones(milestones.map((x, j) => (j === i ? { ...x, due_date: e.target.value } : x)))} />
              </div>
            ))}
            <button type="button" className="link-btn small" style={{ alignSelf: 'flex-start' }} onClick={() => setMilestones([...milestones, { title: '', due_date: addDays(milestones.at(-1)?.due_date ?? from, 14) }])}>
              + Add a date
            </button>
          </div>
        )}
      </div>

      <div className="card stack">
        <span className="label">When</span>
        {seasons.length === 0 ? (
          <label className="field">
            Your season starts today and runs six months · to {shortDate(season.end_date)}
            <input value={seasonName} onChange={(e) => setSeasonName(e.target.value)} placeholder="e.g. Winter to summer" />
            <span className="xsmall muted" style={{ fontWeight: 400 }}>
              A season is the review calendar: month reviews, a 3-month checkpoint, a retrospective. Every goal has its own start and finish inside it.
            </span>
          </label>
        ) : seasons.length > 1 ? (
          <label className="field">
            Season
            <select value={planId} onChange={(e) => setPlanId(e.target.value)}>
              {seasons.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} · {shortDate(p.start_date)} – {shortDate(p.end_date)}
                </option>
              ))}
            </select>
          </label>
        ) : (
          <span className="small muted">
            {season.name} · {shortDate(season.start_date)} – {shortDate(season.end_date)}
          </span>
        )}
        <div className="grid-2">
          <label className="field">
            Starts <span style={{ fontWeight: 400 }}>(optional)</span>
            <input type="date" value={start} min={from} max={end} onChange={(e) => setStart(e.target.value)} />
            <span className="xsmall muted" style={{ fontWeight: 400 }}>
              Empty means {from === today ? 'today' : shortDate(from)}. Later for a course that begins in a month.
            </span>
          </label>
          {type !== 'number' && (
            <label className="field">
              Finish by <span style={{ fontWeight: 400 }}>(optional)</span>
              <input type="date" value={finish} min={start || from} max={season.end_date} onChange={(e) => setFinish(e.target.value)} />
              <span className="xsmall muted" style={{ fontWeight: 400 }}>
                Empty means the end of the season. Earlier for an exam or a course.
              </span>
            </label>
          )}
        </div>
        <span className="xsmall muted">About {Math.max(1, Math.round(horizon / 7))} weeks{horizon < 170 ? ', less than six months, and that’s fine' : ''}.</span>
        {existing.length >= 3 && <div className="banner warn">{season.name} already has {existing.length} goals. Most people stick with 3–4 at a time.</div>}
      </div>

      <div className="card stack">
        <label className="field">
          This week's goal <span style={{ fontWeight: 400 }}>(optional, one line)</span>
          <input value={weekGoal} onChange={(e) => setWeekGoal(e.target.value)} placeholder="e.g. G–C–D changes at 60 bpm" />
        </label>
        {type !== 'number' && (
          <>
            <span className="label">First daily task</span>
            <label className="field">
              Task
              <input value={taskTitle} onChange={(e) => setTaskTitle(e.target.value)} placeholder="e.g. Guitar practice" />
            </label>
            <div className="chips" role="group" aria-label="Days">
              {WEEKDAY_NAMES.map((d, i) => (
                <button key={d} type="button" className="chip" aria-pressed={taskDays.includes(i + 1)} onClick={() => setTaskDays(taskDays.includes(i + 1) ? taskDays.filter((x) => x !== i + 1) : [...taskDays, i + 1].sort())}>
                  {d}
                </button>
              ))}
            </div>
            <label className="field">
              Minutes
              <input type="number" min={0} value={taskMinutes} onChange={(e) => setTaskMinutes(Number(e.target.value))} />
            </label>
            {shareable.length > 0 && (
              <div className="stack-sm">
                <span className="xsmall muted">Or share a task you already do (logged once, counts for both):</span>
                <div className="chips" role="group" aria-label="Tasks to share">
                  {shareable.map((a) => {
                    const on = share.includes(a.id);
                    return (
                      <button key={a.id} type="button" className="chip" aria-pressed={on} onClick={() => setShare(on ? share.filter((x) => x !== a.id) : [...share, a.id])}>
                        {a.title}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </>
        )}
        {type === 'number' && <span className="xsmall muted">A "Log a number" task for {measureName.trim() || 'this measurement'} can be added on the goal page; your readings drive the pace either way.</span>}
        {others.length > 0 && (
          <div className="stack-sm">
            <span className="xsmall muted">Group it with a goal it works with (optional):</span>
            <div className="chips" role="radiogroup" aria-label="Group with">
              {others.map((g) => {
                const on = groupWith === g.id;
                const gr = g.group_id ? data.groups.find((x) => x.id === g.group_id) : undefined;
                return (
                  <button key={g.id} type="button" className="chip" role="radio" aria-checked={on} onClick={() => setGroupWith(on ? null : g.id)} style={{ display: 'inline-flex', alignItems: 'center', gap: 7 }}>
                    <span className="dot" style={{ width: 7, height: 7, background: g.color }} />
                    {g.title}
                    {gr ? <span className="muted"> · {gr.name}</span> : null}
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {gaps.length > 0 && <span className="xsmall muted">Still needs {gaps.join(', ')}.</span>}
      <button className="btn primary" disabled={gaps.length > 0} onClick={make}>
        Make it a goal
      </button>
    </div>
  );
}
