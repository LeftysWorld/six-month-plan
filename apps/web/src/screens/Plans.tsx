import { useState } from 'react';
import {
  addDays,
  blockIndex,
  blockRange,
  daysBetween,
  planDayNumber,
  planTotalDays,
  planTotalWeeks,
  planWeekNumber,
  quarterRange,
  sessionCredit,
  shortDate,
  valueOnPath,
  weekStart,
  type Goal,
  type ISODate,
  type Plan,
} from '@six/core';
import { useStore } from '../data/store.tsx';
import { fmt, useView, type View } from '../data/derive.ts';
import { opsCreatePlan } from '../data/ops.ts';
import { stepAt, stepsForGoal, tasksInRange } from '../data/breakdown.ts';
import type { AppData } from '../data/model.ts';
import { href, navigate } from '../router.ts';
import { Icon } from '../components/ui.tsx';

/** Create a plan: name, start, end (defaults to six months). */
export function PlanForm({ onDone }: { onDone?: () => void }) {
  const { today, commit } = useStore();
  const [name, setName] = useState('My next six months');
  const [start, setStart] = useState(today);
  const [end, setEnd] = useState(addDays(today, 182));
  return (
    <form
      className="card stack"
      onSubmit={(e) => {
        e.preventDefault();
        if (!name.trim() || end <= start) return;
        const { ops, plan } = opsCreatePlan({ name, start, end });
        commit(ops);
        onDone?.();
        navigate(`/goals/new?plan=${plan.id}`);
      }}
    >
      <h2>New six-month plan</h2>
      <label className="field">
        Name
        <input value={name} onChange={(e) => setName(e.target.value)} required />
      </label>
      <div className="grid-2">
        <label className="field">
          Starts
          <input
            type="date"
            value={start}
            onChange={(e) => {
              setStart(e.target.value);
              setEnd(addDays(e.target.value, 182));
            }}
          />
        </label>
        <label className="field">
          Ends
          <input type="date" value={end} min={addDays(start, 7)} onChange={(e) => setEnd(e.target.value)} />
        </label>
      </div>
      <p className="xsmall muted" style={{ margin: 0 }}>
        Plans can overlap. Starting a new one never resets another.
      </p>
      <button className="btn primary" type="submit">
        Create plan and add a goal
      </button>
    </form>
  );
}

/**
 * The Plans tab answers four questions, each one tap from acting on it:
 * where am I in the six months, how is each goal doing, what needs fixing, and what's coming up.
 */
export function Plans() {
  const { data, today } = useStore();
  const [creating, setCreating] = useState(false);
  const live = data.plans.filter((p) => !p.archived_at && p.end_date >= today).sort((a, b) => (a.start_date < b.start_date ? -1 : 1));
  const past = data.plans.filter((p) => p.archived_at || p.end_date < today);
  const [pickedId, setPickedId] = useState<string | null>(null);
  const plan = live.find((p) => p.id === pickedId) ?? live.find((p) => p.start_date <= today) ?? live[0] ?? null;
  const activeCount = live.filter((p) => p.start_date <= today).length;

  return (
    <div className="stack rise">
      <div className="topbar">
        <span className="mono">
          Plans{live.length ? ` · ${activeCount} active${live.length > activeCount ? ` · ${live.length - activeCount} upcoming` : ''}` : ''}
        </span>
        <button className="btn small" onClick={() => setCreating(!creating)}>
          {creating ? 'Cancel' : (
            <>
              <Icon name="plus" size={16} stroke={2.4} /> New plan
            </>
          )}
        </button>
      </div>
      <h1 style={{ marginTop: -4 }}>Plans</h1>

      {creating && <PlanForm onDone={() => setCreating(false)} />}

      {live.length > 1 && (
        <div className="chips" role="group" aria-label="Choose a plan" style={{ flexWrap: 'nowrap', overflowX: 'auto', scrollbarWidth: 'none', margin: '0 -20px', padding: '0 20px' }}>
          {live.map((p) => (
            <button key={p.id} className="chip" aria-pressed={p.id === plan?.id} onClick={() => setPickedId(p.id)} style={{ flex: 'none', whiteSpace: 'nowrap' }}>
              {p.name}
              {p.start_date > today ? <span style={{ opacity: 0.6 }}> · {shortDate(p.start_date)}</span> : null}
            </button>
          ))}
        </div>
      )}

      {!plan && !creating && <PlanForm />}
      {plan && <PlanOverview key={plan.id} plan={plan} />}

      {past.length > 0 && (
        <details className="card tight">
          <summary className="label" style={{ cursor: 'pointer', minHeight: 32, display: 'flex', alignItems: 'center' }}>
            Archived and finished · {past.length}
          </summary>
          <div className="stack-sm" style={{ marginTop: 8 }}>
            {past.map((p) => (
              <a key={p.id} className="list-row" href={href(`/plans/${p.id}`)}>
                <span className="grow">{p.name}</span>
                <span className="mono">
                  {shortDate(p.start_date)} – {shortDate(p.end_date)}
                </span>
              </a>
            ))}
          </div>
        </details>
      )}
    </div>
  );
}

function PlanOverview({ plan }: { plan: Plan }) {
  const { data, today } = useStore();
  const view = useView();
  const goals = view.goalsForPlan(plan.id);
  const started = plan.start_date <= today;
  const checkpoint = quarterRange(plan, plan.start_date).end;
  const horizons = started ? view.horizons(plan) : [];
  const goalsH = horizons.find((h) => h.key === 'plan');
  const weekH = horizons.find((h) => h.key === 'week');
  const attention = started ? needsAttention(view, data, plan, goals, today) : [];
  const events = comingUp(data, plan, goals, today);

  return (
    <>
      <div className="tile" style={{ gap: 14 }}>
        <div className="stack-sm" style={{ gap: 6 }}>
          <span className="mono">
            {started ? `Day ${planDayNumber(plan, today)} of ${planTotalDays(plan)} · week ${planWeekNumber(plan, today)} of ${planTotalWeeks(plan)}` : `Starts in ${daysBetween(today, plan.start_date)} days`}
          </span>
          <a href={href(`/plans/${plan.id}`)} className="row-between" style={{ textDecoration: 'none', color: 'var(--ink)', gap: 8 }}>
            <span style={{ fontSize: 28, fontWeight: 650, letterSpacing: '-0.04em', lineHeight: 1.1 }}>{plan.name}</span>
            <span className="label" style={{ display: 'inline-flex', alignItems: 'center', gap: 2, whiteSpace: 'nowrap', color: 'var(--ink-2)' }}>
              Timeline <Icon name="chevron" size={14} />
            </span>
          </a>
        </div>
        <PlanTimeline plan={plan} today={today} checkpoint={checkpoint} />
        <div className="grid-3" style={{ gap: 10, borderTop: '1px solid var(--line)', paddingTop: 14 }}>
          <Stat
            label="Goals on pace"
            value={goalsH && goalsH.progress.label !== 'none' ? `${fmt(goalsH.progress.actual)}/${goalsH.progress.planned}` : `${goals.length}`}
            sub={goalsH && goalsH.progress.label !== 'none' ? '' : goals.length === 1 ? 'goal' : 'goals'}
          />
          <Stat label="This week" value={weekH ? `${fmt(weekH.progress.actual)}/${weekH.progress.planned}` : '–'} sub="sessions" />
          <Stat
            label="Checkpoint"
            value={shortDate(checkpoint)}
            sub={checkpoint >= today ? `in ${daysBetween(today, checkpoint)} days` : 'passed'}
          />
        </div>
      </div>

      {started && goals.length > 0 && (
        <>
          <div className="row-between" style={{ margin: '14px 2px 0' }}>
            <span className="label">Needs attention</span>
            {attention.length > 0 && <span className="label">{attention.length}</span>}
          </div>
          {attention.length === 0 ? (
            <div className="card tight row-start" style={{ gap: 10, flexWrap: 'nowrap' }}>
              <span className="ring done" style={{ width: 22, height: 22, animation: 'none' }}>
                <Icon name="check" size={12} stroke={3} />
              </span>
              <span className="small" style={{ color: 'var(--ink-2)' }}>All clear. Every goal is on pace and planned through next week.</span>
            </div>
          ) : (
            <div className="tile" style={{ padding: '6px 18px', gap: 0 }}>
              {attention.map((a) => (
                <div key={a.key} className="list-row" style={{ gap: 12 }}>
                  <span className="dot" style={{ width: 8, height: 8, background: a.color, boxShadow: `0 0 10px ${a.color}` }} />
                  <span className="grow" style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                    <span style={{ fontSize: 14.5, fontWeight: 550, letterSpacing: '-0.01em' }}>{a.title}</span>
                    <span className="xsmall muted">{a.detail}</span>
                  </span>
                  <a className="btn small" href={href(a.to)} style={{ flex: 'none' }}>
                    {a.action}
                  </a>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      <div className="row-between" style={{ margin: '14px 2px 0' }}>
        <span className="label">Goals · tap to open the breakdown</span>
        <span className="label">{goals.length}</span>
      </div>
      {goals.map((g) => (
        <GoalRow key={g.id} goal={g} plan={plan} />
      ))}
      <a className="btn ghost" href={href(`/goals/new?plan=${plan.id}`)}>
        + Add a goal
      </a>

      {events.length > 0 && (
        <>
          <div className="label" style={{ margin: '14px 2px 0' }}>
            Coming up
          </div>
          <div className="tile" style={{ padding: '6px 18px', gap: 0 }}>
            {events.map((e) => (
              <a key={e.key} className="list-row" href={href(e.to)} style={{ gap: 14 }}>
                <span style={{ width: 52, flex: 'none', display: 'flex', flexDirection: 'column' }}>
                  <span className="mono" style={{ color: 'var(--ink)', fontSize: 11.5 }}>
                    {shortDate(e.date).toUpperCase()}
                  </span>
                  <span className="xsmall muted">{e.date === today ? 'today' : `in ${daysBetween(today, e.date)}d`}</span>
                </span>
                <span className="grow" style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                  {e.color && <span className="dot" style={{ width: 7, height: 7, background: e.color }} />}
                  <span style={{ fontSize: 14.5, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{e.title}</span>
                </span>
                <Icon name="chevron" size={16} />
              </a>
            ))}
          </div>
        </>
      )}
    </>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 3, minWidth: 0 }}>
      <span className="mono" style={{ fontSize: 10 }}>{label}</span>
      <span className="num" style={{ fontSize: 22, lineHeight: 1.05 }}>{value}</span>
      {sub && <span className="xsmall muted">{sub}</span>}
    </div>
  );
}

/** The plan as one bar: time used (lime), months, the 3-month checkpoint and today. */
function PlanTimeline({ plan, today, checkpoint }: { plan: Plan; today: ISODate; checkpoint: ISODate }) {
  const total = Math.max(1, daysBetween(plan.start_date, plan.end_date));
  const pos = (d: ISODate) => Math.max(0, Math.min(100, (daysBetween(plan.start_date, d) / total) * 100));
  const used = pos(today);
  const months: { date: ISODate; label: string }[] = [];
  const s = new Date(`${plan.start_date}T00:00:00Z`);
  for (let i = 1; i < 9; i++) {
    const d = new Date(Date.UTC(s.getUTCFullYear(), s.getUTCMonth() + i, 1)).toISOString().slice(0, 10);
    if (d >= plan.end_date) break;
    months.push({ date: d, label: shortDate(d).split(' ')[0]!.toUpperCase() });
  }
  return (
    <div role="img" aria-label={`${Math.round(used)}% of the plan's time used. Checkpoint ${shortDate(checkpoint)}.`}>
      <div style={{ position: 'relative', height: 30 }}>
        <div style={{ position: 'absolute', left: 0, right: 0, top: 12, height: 8, borderRadius: 4, background: 'var(--track)' }} />
        <div style={{ position: 'absolute', left: 0, width: `${used}%`, top: 12, height: 8, borderRadius: 4, background: 'var(--accent)' }} />
        {months.map((m) => (
          <div key={m.date} style={{ position: 'absolute', left: `${pos(m.date)}%`, top: 12, width: 1.5, height: 8, background: 'var(--ground)', opacity: 0.8 }} />
        ))}
        <div style={{ position: 'absolute', left: `calc(${pos(checkpoint)}% - 6px)`, top: 10, width: 12, height: 12, transform: 'rotate(45deg)', borderRadius: 3, background: 'var(--gold)', border: '2px solid var(--surface)' }} />
        {plan.start_date <= today && today <= plan.end_date && (
          <div style={{ position: 'absolute', left: `calc(${used}% - 1px)`, top: 2, width: 2, height: 28, borderRadius: 1, background: 'var(--ink)' }} />
        )}
      </div>
      <div style={{ position: 'relative', height: 14, marginTop: 4 }}>
        {months.map((m) => (
          <span key={m.date} className="mono" style={{ position: 'absolute', left: `${pos(m.date)}%`, transform: 'translateX(-50%)', fontSize: 9.5 }}>
            {m.label}
          </span>
        ))}
      </div>
    </div>
  );
}

/** A goal with its real numbers, pace, plan progress and what this week asks for. Opens the breakdown. */
function GoalRow({ goal, plan }: { goal: Goal; plan: Plan }) {
  const { data, today } = useStore();
  const view = useView();
  const started = plan.start_date <= today;
  const pace = started ? view.goalPace(goal, plan) : null;
  const label = pace?.label ?? 'none';
  const word = label === 'behind' ? 'Behind' : label === 'ahead' ? 'Ahead' : label === 'on_track' ? 'On pace' : started ? 'Too early' : 'Not started';
  const ink = label === 'behind' ? 'var(--amber-ink)' : label === 'ahead' ? 'var(--blue-ink)' : label === 'on_track' ? 'var(--accent-ink)' : 'var(--muted)';
  const prog = goalProgress(view, data, goal, plan, today);
  const steps = stepsForGoal(data, goal.id).filter((s) => s.plan_id === plan.id);
  const weeks = steps.filter((s) => s.level === 'week');
  const week = weeks.length ? stepAt(weeks, today < plan.start_date ? plan.start_date : today) : undefined;
  const weekTasks = week ? tasksInRange(data, goal.id, { start: week.start_date, end: week.end_date }, week.id).length : 0;
  const weekLine = week
    ? [week.title, week.target_value != null ? `${fmt(week.target_value)} by ${shortDate(week.end_date)}` : week.target_note || null, `${weekTasks} task${weekTasks === 1 ? '' : 's'}`]
        .filter(Boolean)
        .join(' · ')
    : 'No breakdown yet';

  return (
    <a className="tile" href={href(`/flow/${goal.id}`)} aria-label={`${goal.title}: ${word}. Open breakdown`} style={{ gap: 10 }}>
      <div className="row-between" style={{ gap: 10 }}>
        <span className="row-start" style={{ gap: 10, flexWrap: 'nowrap', minWidth: 0 }}>
          <span className="dot" style={{ width: 9, height: 9, background: goal.color, boxShadow: `0 0 12px ${goal.color}` }} />
          <span style={{ fontSize: 16.5, fontWeight: 600, letterSpacing: '-0.02em', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{goal.title}</span>
        </span>
        <span style={{ fontSize: 13, fontWeight: 600, color: ink, whiteSpace: 'nowrap' }}>{word}</span>
      </div>
      <div className="small" style={{ color: 'var(--ink-2)' }}>
        {prog.summary}
      </div>
      <div style={{ position: 'relative', height: 6, borderRadius: 3, background: 'var(--track)' }} aria-hidden="true">
        <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: `${Math.max(2, prog.done * 100)}%`, borderRadius: 3, background: goal.color }} />
        {started && prog.expected != null && (
          <div style={{ position: 'absolute', left: `calc(${Math.min(100, prog.expected * 100)}% - 1px)`, top: -4, width: 2, height: 14, borderRadius: 1, background: 'var(--ink)', opacity: 0.8 }} />
        )}
      </div>
      <div className="row-between" style={{ gap: 8 }}>
        <span className="mono" style={{ fontSize: 10.5, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{weekLine}</span>
        <Icon name="chevron" size={16} />
      </div>
    </a>
  );
}

/** How far along a goal is (0..1), where it should be by now, and a one-line summary with real numbers. */
function goalProgress(view: View, data: AppData, goal: Goal, plan: Plan, today: ISODate): { done: number; expected: number | null; summary: string } {
  const elapsed = Math.max(0, Math.min(1, daysBetween(plan.start_date, today) / Math.max(1, daysBetween(plan.start_date, plan.end_date))));
  if (goal.type === 'number') {
    const n = plan.start_date <= today ? view.goalPace(goal, plan).number : null;
    const start = n?.start.value ?? goal.baseline_value;
    const target = goal.target_value;
    if (start == null || target == null) return { done: 0, expected: null, summary: 'Set a start and target to track this.' };
    const span = Math.abs(target - start) || 1;
    const now = n?.trend ?? n?.latest ?? start;
    const path = view.pathFor(goal);
    const expectedValue = n ? valueOnPath(n.start, path, today) : start;
    const ahead = n?.aheadBy;
    return {
      done: Math.max(0, Math.min(1, Math.abs(now - start) / span)),
      expected: Math.max(0, Math.min(1, Math.abs(expectedValue - start) / span)),
      summary: `${fmt(start)} → ${n?.latest != null ? `${fmt(n.latest)} now` : 'no reading yet'} → ${fmt(target)} ${goal.unit ?? ''}${ahead != null ? ` · ${fmt(Math.abs(ahead))} ${ahead >= 0 ? 'ahead of' : 'behind'} path` : ''}`,
    };
  }
  if (goal.type === 'finish') {
    const ms = data.milestones.filter((m) => m.goal_id === goal.id).sort((a, b) => (a.due_date < b.due_date ? -1 : 1));
    const done = ms.filter((m) => m.completed_at).length;
    const due = ms.filter((m) => m.due_date <= today).length;
    const next = ms.find((m) => !m.completed_at);
    return {
      done: ms.length ? done / ms.length : 0,
      expected: ms.length ? due / ms.length : elapsed,
      summary: ms.length ? `${done} of ${ms.length} milestones${next ? ` · next: ${next.title}, ${shortDate(next.due_date)}` : ' · all done'}` : 'No milestones yet',
    };
  }
  const actionIds = new Set(view.actionsForGoal(goal.id, true).map((a) => a.id));
  const sessions = view.projectedSessions({ start: plan.start_date, end: plan.end_date }).filter((s) => s.action_id && actionIds.has(s.action_id) && s.status !== 'moved');
  const planned = sessions.length;
  const credit = sessions.reduce((sum, s) => sum + sessionCredit(s), 0);
  const thisWeek = sessions.filter((s) => (s.date ? weekStart(s.date) : s.week_start) === weekStart(today));
  const weekDone = thisWeek.reduce((sum, s) => sum + sessionCredit(s), 0);
  const pace = plan.start_date <= today ? view.goalPace(goal, plan).progress : null;
  return {
    done: planned ? credit / planned : 0,
    expected: pace && planned ? pace.expected / planned : null,
    summary: planned ? `${fmt(credit, 0)} of ${planned} sessions · this week ${fmt(weekDone, 0)}/${thisWeek.length}` : 'No tasks scheduled yet',
  };
}

interface Attention {
  key: string;
  title: string;
  detail: string;
  action: string;
  to: string;
  color: string;
  rank: number;
}

/** Things in the plan worth fixing now, most important first. */
function needsAttention(view: View, data: AppData, plan: Plan, goals: Goal[], today: ISODate): Attention[] {
  const out: Attention[] = [];
  const block = blockRange(plan, blockIndex(plan, today));
  for (const g of goals) {
    const steps = stepsForGoal(data, g.id).filter((s) => s.plan_id === plan.id);
    const pace = view.goalPace(g, plan, { start: block.start, end: today });
    if (pace.label === 'behind' && pace.progress) {
      const gap = Math.max(1, Math.round(pace.progress.expected - pace.progress.actual));
      out.push({ key: `behind-${g.id}`, title: g.title, detail: `${gap} session${gap === 1 ? '' : 's'} behind this block`, action: 'Catch up', to: `/flow/${g.id}`, color: g.color, rank: 0 });
    }
    const overdue = data.milestones.filter((m) => m.goal_id === g.id && !m.completed_at && m.due_date < today).sort((a, b) => (a.due_date < b.due_date ? -1 : 1))[0];
    if (overdue) out.push({ key: `overdue-${overdue.id}`, title: overdue.title, detail: `${g.title} · was due ${shortDate(overdue.due_date)}`, action: 'Open', to: `/goals/${g.id}`, color: g.color, rank: 1 });
    if (steps.length === 0) {
      out.push({ key: `nobreak-${g.id}`, title: g.title, detail: 'No breakdown yet: stages, weeks and daily tasks', action: 'Break down', to: `/flow/${g.id}`, color: g.color, rank: 2 });
    } else {
      const nextWeek = steps.filter((s) => s.level === 'week' && s.start_date > today).sort((a, b) => (a.start_date < b.start_date ? -1 : 1))[0];
      if (nextWeek && tasksInRange(data, g.id, { start: nextWeek.start_date, end: nextWeek.end_date }, nextWeek.id).length === 0) {
        out.push({ key: `week-${g.id}`, title: g.title, detail: `${nextWeek.title} (${shortDate(nextWeek.start_date)}) has no daily tasks`, action: 'Plan week', to: `/flow/${g.id}`, color: g.color, rank: 3 });
      }
    }
    if (g.type === 'number') {
      const last = view.measurementsFor(g.measurement_type_id).at(-1);
      const age = last ? daysBetween(last.measured_on, today) : null;
      if (age == null || age > 7) {
        out.push({ key: `reading-${g.id}`, title: g.title, detail: age == null ? 'No readings logged yet' : `Last reading ${age} days ago`, action: 'Log', to: `/goals/${g.id}`, color: g.color, rank: 4 });
      }
    }
  }
  return out.sort((a, b) => a.rank - b.rank).slice(0, 5);
}

interface Upcoming {
  key: string;
  date: ISODate;
  title: string;
  to: string;
  color?: string;
}

/** Dates in the next six weeks: checkpoint, new months, milestones, the weekly review, the plan's start or end. */
function comingUp(data: AppData, plan: Plan, goals: Goal[], today: ISODate): Upcoming[] {
  const horizon = addDays(today, 42);
  const inWindow = (d: ISODate) => d >= today && d <= horizon;
  const out: Upcoming[] = [];
  if (plan.start_date > today) out.push({ key: 'start', date: plan.start_date, title: `${plan.name} starts`, to: `/plans/${plan.id}` });
  const checkpoint = quarterRange(plan, plan.start_date).end;
  if (inWindow(checkpoint)) out.push({ key: 'checkpoint', date: checkpoint, title: '3-month checkpoint review', to: '/review' });
  const seen = new Set<string>();
  for (const g of goals) {
    for (const s of stepsForGoal(data, g.id)) {
      if (s.plan_id !== plan.id || s.level === 'week' || !inWindow(s.start_date) || s.start_date === plan.start_date) continue;
      const k = `${s.level}-${s.start_date}`;
      if (seen.has(k)) continue;
      seen.add(k);
      out.push({ key: k, date: s.start_date, title: `${s.title} begins`, to: `/flow/${g.id}` });
    }
    for (const m of data.milestones) {
      if (m.goal_id === g.id && !m.completed_at && inWindow(m.due_date)) out.push({ key: `m-${m.id}`, date: m.due_date, title: m.title, to: `/goals/${g.id}`, color: g.color });
    }
  }
  if (plan.start_date <= today) {
    const sunday = addDays(weekStart(today), 6);
    out.push({ key: 'review', date: sunday, title: 'Weekly review', to: '/review' });
  }
  if (inWindow(plan.end_date)) out.push({ key: 'end', date: plan.end_date, title: `${plan.name} ends`, to: `/plans/${plan.id}` });
  return out.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0)).slice(0, 6);
}
