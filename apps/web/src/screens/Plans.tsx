import { useState } from 'react';
import {
  addDays,
  daysBetween,
  planDayNumber,
  planMonths,
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
import { opsArchivePlan, opsCreatePlan, opsLinkGoalToPlan } from '../data/ops.ts';
import { tasksInRange } from '../data/breakdown.ts';
import { catchUp, chainFor, chainGaps, isSet, type ChainLevel } from '../data/chain.ts';
import type { AppData } from '../data/model.ts';
import { href, navigate } from '../router.ts';
import { Icon, useToast } from '../components/ui.tsx';

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
 * Goals: where you are in the six months, how each goal is doing, what needs your attention,
 * and what's coming up. Each goal opens its one page (chain + daily tasks).
 */
export function Plans({ planId = null }: { planId?: string | null }) {
  const { data, today } = useStore();
  const [creating, setCreating] = useState(false);
  const live = data.plans.filter((p) => !p.archived_at && p.end_date >= today).sort((a, b) => (a.start_date < b.start_date ? -1 : 1));
  const past = data.plans.filter((p) => p.archived_at || p.end_date < today);
  const [pickedId, setPickedId] = useState<string | null>(planId);
  const plan = live.find((p) => p.id === pickedId) ?? data.plans.find((p) => p.id === pickedId) ?? live.find((p) => p.start_date <= today) ?? live[0] ?? null;
  const activeCount = live.filter((p) => p.start_date <= today).length;
  const initial = (data.profile.display_name || 'You').trim().charAt(0).toUpperCase();

  return (
    <div className="stack rise">
      <div className="topbar">
        <span className="mono">
          {plan ? plan.name : 'No plan yet'}
          {live.length > 1 ? ` · ${activeCount} active` : ''}
        </span>
        <a className="avatar" href={href('/settings')} aria-label="Settings">
          {initial}
        </a>
      </div>
      <div className="row-between" style={{ alignItems: 'flex-end', marginTop: -4 }}>
        <h1>Goals</h1>
        <button className="btn small" onClick={() => setCreating(!creating)}>
          {creating ? 'Cancel' : (
            <>
              <Icon name="plus" size={16} stroke={2.4} /> New plan
            </>
          )}
        </button>
      </div>

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
            Archived and finished plans · {past.length}
          </summary>
          <div className="stack-sm" style={{ marginTop: 8 }}>
            {past.map((p) => (
              <button key={p.id} className="list-row" onClick={() => setPickedId(p.id)} style={{ background: 'none', border: 0, borderTop: '1px solid var(--line)', width: '100%', cursor: 'pointer', font: 'inherit', color: 'inherit', textAlign: 'left' }}>
                <span className="grow">{p.name}</span>
                <span className="mono">
                  {shortDate(p.start_date)} – {shortDate(p.end_date)}
                </span>
              </button>
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
  const setup = setupSteps(view, data, plan, goals, today);
  const setupLeft = setup.filter((x) => !x.done).length;

  return (
    <>
      <div className="tile" style={{ gap: 14 }}>
        <div className="stack-sm" style={{ gap: 6 }}>
          <span className="mono">
            {started ? `Day ${planDayNumber(plan, today)} of ${planTotalDays(plan)} · week ${planWeekNumber(plan, today)} of ${planTotalWeeks(plan)}` : `Starts in ${daysBetween(today, plan.start_date)} days`}
          </span>
          <span style={{ fontSize: 28, fontWeight: 650, letterSpacing: '-0.04em', lineHeight: 1.1 }}>{plan.name}</span>
        </div>
        <PlanTimeline plan={plan} today={today} checkpoint={checkpoint} />
        <div className="grid-3" style={{ gap: 10, borderTop: '1px solid var(--line)', paddingTop: 14 }}>
          {goalsH && goalsH.progress.label !== 'none' ? (
            <Stat label="Goals on pace" value={`${fmt(goalsH.progress.actual, 0)}/${goalsH.progress.planned}`} sub="" />
          ) : (
            <Stat label="Goals" value={`${goals.length}`} sub={goals.length === 0 ? 'add 3–4' : started ? 'pace after week 1' : 'ready to start'} />
          )}
          <Stat label="This week" value={weekH ? `${fmt(weekH.progress.actual, 0)}/${weekH.progress.planned}` : '–'} sub="tasks done" />
          <Stat label="Checkpoint" value={shortDate(checkpoint)} sub={checkpoint >= today ? `in ${daysBetween(today, checkpoint)} days` : 'passed'} />
        </div>
      </div>

      {setupLeft > 0 && (
        <div className="tile" style={{ gap: 12 }}>
          <div className="row-between">
            <span className="label" style={{ color: 'var(--accent-ink)' }}>Get this plan ready</span>
            <span className="label">
              {setup.length - setupLeft} of {setup.length}
            </span>
          </div>
          <div className="segments" style={{ gridTemplateColumns: `repeat(${setup.length}, minmax(0, 1fr))` }} aria-hidden="true">
            {setup.map((x) => (
              <span key={x.key} className={x.done ? 'on' : ''} />
            ))}
          </div>
          <div>
            {setup.map((x, i) => {
              const isNext = !x.done && setup.findIndex((y) => !y.done) === i;
              return (
                <div key={x.key} className="list-row" style={{ gap: 12, opacity: x.done ? 0.6 : 1 }}>
                  <span className={`ring ${x.done ? 'done' : ''}`} style={{ width: 24, height: 24, animation: 'none' }}>
                    {x.done && <Icon name="check" size={12} stroke={3} />}
                  </span>
                  <span className="grow" style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                    <span style={{ fontSize: 15, fontWeight: 550, letterSpacing: '-0.01em', textDecoration: x.done ? 'line-through' : undefined }}>{x.title}</span>
                    {isNext && <span className="xsmall muted">{x.detail}</span>}
                  </span>
                  {isNext && (
                    <a className="btn small primary" href={href(x.to)} style={{ flex: 'none' }}>
                      {x.action}
                    </a>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {started && goals.length > 0 && attention.length > 0 && (
        <>
          <div className="row-between" style={{ margin: '14px 2px 0' }}>
            <span className="label">Needs attention</span>
            <span className="label">{attention.length}</span>
          </div>
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
        </>
      )}

      <div className="row-between" style={{ margin: '14px 2px 0' }}>
        <span className="label">Your goals</span>
        <span className="label">{goals.length}</span>
      </div>
      {goals.length === 0 && (
        <div className="card tight small" style={{ color: 'var(--ink-2)' }}>
          No goals yet. Six months from now, what do you want to be true? Most people start with 3–4: a number to reach, a habit to build, something to finish.
        </div>
      )}
      <div className="goal-list">
        {goals.map((g) => (
          <GoalRow key={g.id} goal={g} plan={plan} />
        ))}
      </div>
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

      <PlanSettings plan={plan} />
    </>
  );
}

/** Less-used plan actions, tucked away: add a goal from another plan, archive the plan. */
function PlanSettings({ plan }: { plan: Plan }) {
  const { data, commit } = useStore();
  const view = useView();
  const toast = useToast();
  const inPlan = new Set(view.goalsForPlan(plan.id).map((g) => g.id));
  const others = data.goals.filter((g) => !g.archived_at && !inPlan.has(g.id));
  return (
    <details className="card tight">
      <summary className="label" style={{ cursor: 'pointer', minHeight: 32, display: 'flex', alignItems: 'center' }}>
        Plan settings
      </summary>
      <div className="stack-sm" style={{ marginTop: 10 }}>
        <span className="small muted">
          {shortDate(plan.start_date)} – {shortDate(plan.end_date)}
        </span>
        {others.length > 0 && (
          <>
            <span className="small strong">Add a goal from another plan</span>
            <div className="chips">
              {others.map((g) => (
                <button
                  key={g.id}
                  className="chip"
                  onClick={() => {
                    commit(opsLinkGoalToPlan(data, g.id, plan.id));
                    toast(`${g.title} added to ${plan.name}`);
                  }}
                >
                  + {g.title}
                </button>
              ))}
            </div>
          </>
        )}
        <button
          className="btn small danger"
          onClick={() => {
            commit(opsArchivePlan(plan, !plan.archived_at));
            toast(plan.archived_at ? 'Plan restored' : 'Plan archived. Its history is kept.');
          }}
        >
          {plan.archived_at ? 'Restore plan' : 'Archive plan'}
        </button>
      </div>
    </details>
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
  const months = planMonths(plan).slice(1);
  return (
    <div role="img" aria-label={`${Math.round(used)}% of the plan's time used. Checkpoint ${shortDate(checkpoint)}.`}>
      <div style={{ position: 'relative', height: 30 }}>
        <div style={{ position: 'absolute', left: 0, right: 0, top: 12, height: 8, borderRadius: 4, background: 'var(--track)' }} />
        <div style={{ position: 'absolute', left: 0, width: `${used}%`, top: 12, height: 8, borderRadius: 4, background: 'var(--accent)' }} />
        {months.map((m) => (
          <div key={m.start} style={{ position: 'absolute', left: `${pos(m.start)}%`, top: 12, width: 1.5, height: 8, background: 'var(--ground)', opacity: 0.8 }} />
        ))}
        <div style={{ position: 'absolute', left: `calc(${pos(checkpoint)}% - 6px)`, top: 10, width: 12, height: 12, transform: 'rotate(45deg)', borderRadius: 3, background: 'var(--gold)', border: '2px solid var(--surface)' }} />
        {plan.start_date <= today && today <= plan.end_date && (
          <div style={{ position: 'absolute', left: `calc(${used}% - 1px)`, top: 2, width: 2, height: 28, borderRadius: 1, background: 'var(--ink)' }} />
        )}
      </div>
      <div style={{ position: 'relative', height: 14, marginTop: 4 }}>
        {planMonths(plan).map((m, i) => (
          <span key={m.start} className="mono" style={{ position: 'absolute', left: `${(pos(m.start) + pos(m.end)) / 2}%`, transform: 'translateX(-50%)', fontSize: 9.5 }}>
            M{i + 1}
          </span>
        ))}
      </div>
    </div>
  );
}

/** A goal with its real numbers, pace, plan progress and this week's goal. Opens the goal page. */
function GoalRow({ goal, plan }: { goal: Goal; plan: Plan }) {
  const { data, today } = useStore();
  const view = useView();
  const started = plan.start_date <= today;
  const pace = started ? view.goalPace(goal, plan) : null;
  const label = pace?.label ?? 'none';
  const word = label === 'behind' ? 'Behind' : label === 'ahead' ? 'Ahead' : label === 'on_track' ? 'On pace' : started ? 'Too early' : 'Not started';
  const ink = label === 'behind' ? 'var(--amber-ink)' : label === 'ahead' ? 'var(--blue-ink)' : label === 'on_track' ? 'var(--accent-ink)' : 'var(--muted)';
  const prog = goalProgress(view, data, goal, plan, today);
  const chain = chainFor(data, goal, plan, today < plan.start_date ? plan.start_date : today);
  const week = chain.week;
  const weekTasks = tasksInRange(data, goal.id, { start: week.node.start, end: week.node.end }).length;
  const fix = started ? catchUp(view, data, goal, plan, today) : null;
  const weekGoal = isSet(week) ? week.step!.target_note || (week.step!.target_value != null ? `${fmt(week.step!.target_value)} ${goal.unit ?? ''}` : '') : '';

  return (
    <a className="tile" href={href(`/goals/${goal.id}`)} aria-label={`${goal.title}: ${word}. Open goal`} style={{ gap: 10 }}>
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
      {fix && <span className="xsmall" style={{ color: 'var(--amber-ink)' }}>{fix}</span>}
      <div className="row-between" style={{ gap: 8 }}>
        <span className="mono" style={{ fontSize: 10.5, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {weekGoal ? `This week · ${weekGoal}` : "This week's goal not set"} · {weekTasks} task{weekTasks === 1 ? '' : 's'}
        </span>
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
    summary: planned ? `${fmt(credit, 0)} of ${planned} done · this week ${fmt(weekDone, 0)} of ${thisWeek.length}` : 'No tasks scheduled yet',
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

const LEVEL_WORD: Record<ChainLevel, string> = { quarter: '3-month goal', month: "this month's goal", week: "this week's goal" };

/** Things worth doing now, most important first: catch-ups, overdue milestones, unset goals, stale readings. */
function needsAttention(view: View, data: AppData, plan: Plan, goals: Goal[], today: ISODate): Attention[] {
  const out: Attention[] = [];
  for (const g of goals) {
    const fix = catchUp(view, data, g, plan, today);
    if (fix) out.push({ key: `behind-${g.id}`, title: g.title, detail: fix, action: 'Catch up', to: `/goals/${g.id}`, color: g.color, rank: 0 });
    const overdue = data.milestones.filter((m) => m.goal_id === g.id && !m.completed_at && m.due_date < today).sort((a, b) => (a.due_date < b.due_date ? -1 : 1))[0];
    if (overdue && g.type !== 'finish') out.push({ key: `overdue-${overdue.id}`, title: overdue.title, detail: `${g.title} · was due ${shortDate(overdue.due_date)}`, action: 'Open', to: `/goals/${g.id}`, color: g.color, rank: 1 });
    const gaps = chainGaps(chainFor(data, g, plan, today));
    if (gaps.length) {
      const first = gaps[gaps.length - 1]!;
      out.push({ key: `gap-${g.id}`, title: g.title, detail: `Set ${gaps.map((l) => LEVEL_WORD[l]).join(', ')}`, action: first === 'week' ? 'Set week' : 'Set goal', to: `/goals/${g.id}`, color: g.color, rank: 2 });
    }
    if (g.type === 'number') {
      const last = view.measurementsFor(g.measurement_type_id).at(-1);
      const age = last ? daysBetween(last.measured_on, today) : null;
      if (age == null || age > 7) out.push({ key: `reading-${g.id}`, title: g.title, detail: age == null ? 'No readings logged yet' : `Last reading ${age} days ago`, action: 'Log', to: `/goals/${g.id}`, color: g.color, rank: 3 });
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

/** Dates in the next six weeks: new months, the checkpoint, milestones, the weekly review, the plan's start or end. */
function comingUp(data: AppData, plan: Plan, goals: Goal[], today: ISODate): Upcoming[] {
  const horizon = addDays(today, 42);
  const inWindow = (d: ISODate) => d >= today && d <= horizon;
  const out: Upcoming[] = [];
  if (plan.start_date > today) out.push({ key: 'start', date: plan.start_date, title: `${plan.name} starts`, to: `/goals?plan=${plan.id}` });
  const checkpoint = quarterRange(plan, plan.start_date).end;
  if (inWindow(checkpoint)) out.push({ key: 'checkpoint', date: checkpoint, title: '3-month checkpoint: set the next 3-month goals', to: '/review' });
  planMonths(plan).forEach((m, i) => {
    if (i > 0 && inWindow(m.start)) out.push({ key: `month-${m.start}`, date: m.start, title: `Month ${i + 1} begins: set this month's goals`, to: '/goals' });
  });
  for (const g of goals) {
    for (const m of data.milestones) {
      if (m.goal_id === g.id && !m.completed_at && inWindow(m.due_date)) out.push({ key: `m-${m.id}`, date: m.due_date, title: m.title, to: `/goals/${g.id}`, color: g.color });
    }
  }
  if (plan.start_date <= today) out.push({ key: 'review', date: addDays(weekStart(today), 6), title: 'Weekly review', to: '/review' });
  if (inWindow(plan.end_date)) out.push({ key: 'end', date: plan.end_date, title: `${plan.name} ends`, to: `/goals?plan=${plan.id}` });
  return out.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0)).slice(0, 6);
}

interface SetupStep {
  key: string;
  title: string;
  detail: string;
  action: string;
  to: string;
  done: boolean;
}

/** What a new plan needs before it runs itself: goals, this week's goals, daily tasks, a first check-in. */
function setupSteps(view: View, data: AppData, plan: Plan, goals: Goal[], today: ISODate): SetupStep[] {
  const first = goals[0];
  const unset = goals.find((g) => !isSet(chainFor(data, g, plan, today < plan.start_date ? plan.start_date : today).week));
  const noTasks = goals.find((g) => view.actionsForGoal(g.id).length === 0);
  const actionIds = new Set(goals.flatMap((g) => view.actionsForGoal(g.id, true).map((a) => a.id)));
  const checkedIn = data.sessions.some((x) => x.action_id && actionIds.has(x.action_id) && x.status !== 'planned' && x.status !== 'moved');
  return [
    {
      key: 'goals',
      title: goals.length >= 3 ? `${goals.length} goals added` : goals.length ? `Add more goals (${goals.length} so far)` : 'Add your first goal',
      detail: 'A number to reach, a habit to build or something to finish. 3–4 is a good start.',
      action: 'Add goal',
      to: `/goals/new?plan=${plan.id}`,
      done: goals.length >= 3,
    },
    {
      key: 'chain',
      title: unset ? `Set this week's goal for ${unset.title}` : goals.length ? "This week's goals set" : "Set this week's goals",
      detail: 'One line each for the next 3 months, this month and this week. Each goal suggests a start.',
      action: 'Set goals',
      to: unset ? `/goals/${unset.id}` : first ? `/goals/${first.id}` : `/goals/new?plan=${plan.id}`,
      done: goals.length > 0 && !unset,
    },
    {
      key: 'tasks',
      title: noTasks ? `Add daily tasks for ${noTasks.title}` : goals.length ? 'Daily tasks for every goal' : 'Add daily tasks',
      detail: 'Daily tasks on the goal page land on your Today list.',
      action: 'Add tasks',
      to: noTasks ? `/goals/${noTasks.id}` : first ? `/goals/${first.id}` : `/goals/new?plan=${plan.id}`,
      done: goals.length > 0 && !noTasks,
    },
    {
      key: 'checkin',
      title: checkedIn ? 'First check-in done' : 'Do your first check-in',
      detail: 'Tick one thing off on Today. That starts your streak.',
      action: 'Open Today',
      to: '/today',
      done: checkedIn,
    },
  ];
}
