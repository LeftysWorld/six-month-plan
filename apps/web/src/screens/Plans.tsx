import { useState } from 'react';
import {
  addDays,
  chainAt,
  daysBetween,
  planDayNumber,
  planTotalDays,
  quarterRange,
  shortDate,
  weekdayName,
  type Goal,
  type ISODate,
  type PaceLabel,
  type Plan,
} from '@six/core';
import { useStore } from '../data/store.tsx';
import { ConnectionStrip } from '../components/Connections.tsx';
import { fmt, useView, type View } from '../data/derive.ts';
import { opsArchivePlan, opsCreatePlan } from '../data/ops.ts';
import {
  CHAIN_LEVELS,
  catchUpPlan,
  chainFor,
  isSet,
  opsAddExtra,
  periodStatus,
  weekTally,
  type Chain,
  type ChainLevel,
  type CatchUp,
} from '../data/chain.ts';
import type { AppData, Op } from '../data/model.ts';
import { href } from '../router.ts';
import { Icon, Sheet, useToast } from '../components/ui.tsx';
import { ChainSheet } from './Flow.tsx';
import { GoalsSwitch, IdeaAdd } from './Backlog.tsx';

/** Create a batch: a shared window several goals can be committed to (defaults to six months from today). */
export function PlanForm({ onDone }: { onDone?: () => void }) {
  const { today, commit } = useStore();
  const toast = useToast();
  const [name, setName] = useState('My next six months');
  const [start, setStart] = useState(today);
  const [end, setEnd] = useState(addDays(today, 182));
  return (
    <form
      className="stack"
      onSubmit={(e) => {
        e.preventDefault();
        if (!name.trim() || end <= start) return;
        commit(opsCreatePlan({ name, start, end }).ops);
        toast(`${name.trim()} created. Commit goals to it from the backlog.`);
        onDone?.();
      }}
    >
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
        A batch is a window several goals share, with the same checkpoints. Goals can join part-way through, and a goal can also have its own clock instead.
      </p>
      <button className="btn primary" type="submit">
        Create batch
      </button>
    </form>
  );
}

/**
 * Goals: every goal you're working on, grouped the way they keep time. Batches (shared windows)
 * each have a slim line with their day count and checkpoint; goals on their own clock are
 * listed together, each with its own day count.
 */
export function Plans() {
  const { data, today } = useStore();
  const view = useView();
  const toast = useToast();
  const [filter, setFilter] = useState<'all' | 'needs'>('all');
  const [menuFor, setMenuFor] = useState<Plan | null>(null);
  const [creating, setCreating] = useState(false);
  const initial = (data.profile.display_name || 'You').trim().charAt(0).toUpperCase();
  const batches = view.batches;
  const clocks = view.livePlans.filter((p) => p.solo);
  const sections = batches.map((plan) => ({ plan, cards: goalCards(view, data, plan, today) }));
  const own = clocks.flatMap((plan) => goalCards(view, data, plan, today).map((card) => ({ card, plan }))).sort((a, b) => a.card.rank - b.card.rank);
  const all = [...sections.flatMap((x) => x.cards), ...own.map((x) => x.card)];
  const needCount = all.filter((c) => c.needs).length;
  const keep = (c: GoalCardData) => filter === 'all' || c.needs;
  const setup = setupSteps(view, data, today);

  return (
    <div className="stack rise">
      <div className="topbar">
        <span className="mono">
          {all.length} goal{all.length === 1 ? '' : 's'}
          {needCount ? ` · ${needCount} need${needCount === 1 ? 's' : ''} you` : ''}
        </span>
        <a className="avatar" href={href('/settings')} aria-label="Settings">
          {initial}
        </a>
      </div>
      <h1 style={{ marginTop: -4 }}>Goals</h1>
      <GoalsSwitch current="goals" />

      {setup && (
        <div className="tile" style={{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: '14px 16px' }}>
          <span className="grow" style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <span style={{ fontSize: 15, fontWeight: 600, letterSpacing: '-0.01em' }}>{setup.title}</span>
            <span className="xsmall muted">{setup.detail}</span>
          </span>
          <a className="btn small primary" href={href(setup.to)} style={{ flex: 'none' }}>
            {setup.action}
          </a>
        </div>
      )}

      {needCount > 0 && all.length > 1 && (
        <div className="chips" role="group" aria-label="Show">
          <button className="chip" aria-pressed={filter === 'all'} onClick={() => setFilter('all')}>
            All {all.length}
          </button>
          <button className="chip" aria-pressed={filter === 'needs'} onClick={() => setFilter('needs')}>
            Needs you · {needCount}
          </button>
        </div>
      )}

      {all.length === 0 && (
        <div className="card tight small stack-sm" style={{ color: 'var(--ink-2)' }}>
          <span>
            Nothing committed yet. Goals start in the backlog: write ideas down, select the ones that matter most, prepare them, then commit, to a batch or on their own clock. Most people carry 3–4 at a time.
          </span>
          <a className="btn small primary" href={href('/goals/backlog')} style={{ alignSelf: 'flex-start' }}>
            Open the backlog
          </a>
        </div>
      )}

      {sections.map(({ plan, cards }) => (
        <section key={plan.id} className="batch stack" aria-label={`Batch: ${plan.name}`}>
          <PlanLine plan={plan} today={today} onMenu={() => setMenuFor(plan)} />
          {cards.length === 0 ? (
            <p className="small muted" style={{ margin: 0 }}>
              No goals in this batch yet. Commit one from the backlog.
            </p>
          ) : (
            <div className="goal-list">
              {cards.filter(keep).map((c) => (
                <GoalCard key={c.goal.id} card={c} plan={plan} />
              ))}
            </div>
          )}
        </section>
      ))}

      {own.length > 0 && (
        <section className="batch stack" aria-label="Goals on their own clock">
          <div className="row-between">
            <span style={{ fontSize: 15, fontWeight: 600, letterSpacing: '-0.01em' }}>Own clock</span>
            <span className="mono" style={{ fontSize: 11 }}>
              {own.length} GOAL{own.length === 1 ? '' : 'S'}
            </span>
          </div>
          <div className="goal-list">
            {own
              .filter((x) => keep(x.card))
              .map(({ card, plan }) => (
                <GoalCard key={card.goal.id} card={card} plan={plan} ownClock />
              ))}
          </div>
        </section>
      )}

      <IdeaAdd placeholder="Add a goal idea (it starts in your backlog)" after={(t) => toast(`${t} added to your backlog`)} />
      <button type="button" className="btn ghost small" onClick={() => setCreating(true)} style={{ alignSelf: 'flex-start' }}>
        <Icon name="plus" size={14} stroke={2.4} /> New batch
      </button>

      {creating && (
        <Sheet title="New batch" onClose={() => setCreating(false)}>
          <PlanForm onDone={() => setCreating(false)} />
        </Sheet>
      )}
      {menuFor && <BatchMenu plan={menuFor} onClose={() => setMenuFor(null)} />}
    </div>
  );
}

interface GoalCardData {
  goal: Goal;
  chain: Chain;
  pace: PaceLabel;
  fix: CatchUp | null;
  gaps: ChainLevel[];
  /** Something to do now: behind, a level not set, an overdue milestone or an old reading. */
  needs: boolean;
  /** Lower sorts first. */
  rank: number;
}

/** The plan in one line: name (opens the plan menu), day count, a thin timeline, month and checkpoint. */
function PlanLine({ plan, today, onMenu }: { plan: Plan; today: ISODate; onMenu: () => void }) {
  const started = plan.start_date <= today;
  const total = Math.max(1, daysBetween(plan.start_date, plan.end_date));
  const pos = (d: ISODate) => Math.max(0, Math.min(100, (daysBetween(plan.start_date, d) / total) * 100));
  const checkpoint = quarterRange(plan, plan.start_date).end;
  const month = chainAt(plan, today).month;
  const monthLeft = daysBetween(today, month.end);
  const used = started ? pos(today) : 0;
  return (
    <div className="stack-sm" style={{ gap: 8 }}>
      <div className="row-between" style={{ gap: 10 }}>
        <button
          type="button"
          onClick={onMenu}
          aria-label={`${plan.name}: batch settings`}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 6, minHeight: 36, border: 0, background: 'none', padding: 0, color: 'var(--ink)', font: 'inherit', fontSize: 15, fontWeight: 600, letterSpacing: '-0.01em', cursor: 'pointer', minWidth: 0 }}
        >
          <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{plan.name}</span>
          <span style={{ transform: 'rotate(90deg)', display: 'inline-flex', flex: 'none' }}>
            <Icon name="chevron" size={14} stroke={2.4} />
          </span>
        </button>
        <span className="mono" style={{ fontSize: 11, whiteSpace: 'nowrap' }}>
          {started ? `DAY ${Math.min(planDayNumber(plan, today), planTotalDays(plan))} / ${planTotalDays(plan)}` : `STARTS ${shortDate(plan.start_date).toUpperCase()}`}
        </span>
      </div>
      <div style={{ position: 'relative', height: 14 }} role="img" aria-label={`${Math.round(used)}% of the plan's time used. 3-month checkpoint ${shortDate(checkpoint)}.`}>
        <div style={{ position: 'absolute', left: 0, right: 0, top: 5, height: 4, borderRadius: 2, background: 'var(--track)' }} />
        <div style={{ position: 'absolute', left: 0, width: `${used}%`, top: 5, height: 4, borderRadius: 2, background: 'var(--accent)' }} />
        <div style={{ position: 'absolute', left: `calc(${pos(checkpoint)}% - 4px)`, top: 3, width: 8, height: 8, borderRadius: 2, transform: 'rotate(45deg)', background: 'var(--gold)' }} />
        {started && today <= plan.end_date && <div style={{ position: 'absolute', left: `calc(${used}% - 1px)`, top: 0, width: 2, height: 14, borderRadius: 1, background: 'var(--ink)' }} />}
      </div>
      <div className="row-between xsmall" style={{ color: 'var(--ink-2)', gap: 10 }}>
        <span>{started ? `${month.title} · ${monthLeft === 0 ? 'last day' : `${monthLeft} day${monthLeft === 1 ? '' : 's'} left`}` : `Starts in ${daysBetween(today, plan.start_date)} days`}</span>
        <span>
          <span style={{ color: 'var(--gold)' }}>◆</span> Checkpoint {shortDate(checkpoint)}
        </span>
      </div>
    </div>
  );
}

/** Every goal in the plan with what it needs, goals that need you first. */
function goalCards(view: View, data: AppData, plan: Plan, today: ISODate): GoalCardData[] {
  const started = plan.start_date <= today;
  const date = started ? today : plan.start_date;
  return view
    .goalsForPlan(plan.id)
    .map((goal, i) => {
      const chain = chainFor(data, goal, plan, date);
      const pace = started ? view.goalPace(goal, plan).label : 'none';
      const fix = started ? catchUpPlan(view, data, goal, plan, today) : null;
      const gaps = CHAIN_LEVELS.filter((l) => !isSet(chain[l]));
      const overdue = data.milestones.some((m) => m.goal_id === goal.id && !m.completed_at && m.due_date < today);
      const age = goal.type === 'number' ? readingAge(view, goal, today) : 0;
      const stale = started && (age == null || age > 7);
      const needs = started && (!!fix || gaps.length > 0 || overdue || stale);
      const rank = (fix ? 0 : overdue ? 1 : gaps.length ? 2 : stale ? 3 : 10) * 100 + i;
      return { goal, chain, pace, fix, gaps, needs, rank };
    })
    .sort((a, b) => a.rank - b.rank);
}

/** Days since the goal's last reading, or null with no readings. */
function readingAge(view: View, goal: Goal, today: ISODate): number | null {
  const last = view.measurementsFor(goal.measurement_type_id).at(-1);
  return last ? daysBetween(last.measured_on, today) : null;
}

const LEVEL_SHORT: Record<ChainLevel, string> = { quarter: '3 MO', month: 'MONTH', week: 'WEEK' };
const LEVEL_SET: Record<ChainLevel, string> = { quarter: 'Set 3-month goal', month: "Set this month's goal", week: "Set this week's goal" };
const LEVEL_LONG: Record<ChainLevel, string> = { quarter: '3-month goal', month: "This month's goal", week: "This week's goal" };

/** One goal: outcome, its chain, this week's progress and the one thing to do if it's behind. */
function GoalCard({ card, plan, ownClock = false }: { card: GoalCardData; plan: Plan; ownClock?: boolean }) {
  const { data, today, commit } = useStore();
  const view = useView();
  const toast = useToast();
  const [editing, setEditing] = useState<ChainLevel | null>(null);
  const { goal, chain, pace, fix } = card;
  const started = plan.start_date <= today;
  const word = pace === 'behind' ? 'Behind' : pace === 'ahead' ? 'Ahead' : pace === 'on_track' ? 'On pace' : started ? 'Too early' : 'Not started';
  const ink = pace === 'behind' ? 'var(--amber-ink)' : pace === 'ahead' ? 'var(--blue-ink)' : pace === 'on_track' ? 'var(--accent-ink)' : 'var(--muted)';
  const week = footer(view, data, goal, plan, today);
  const age = goal.type === 'number' && started ? readingAge(view, goal, today) : 0;

  const addExtra = (n: number) => {
    const { ops, days } = opsAddExtra(view, data, goal, today, n);
    if (!ops.length) return;
    commit(ops);
    const ids = (ops[0] as Extract<Op, { kind: 'insert' }>).rows.map((r) => r.id);
    const when = days.map((d) => (d === today ? 'today' : weekdayName(d))).join(' and ');
    toast(`Added ${n} for ${when}`, () => commit(ids.map((id): Op => ({ kind: 'delete', collection: 'sessions', id }))));
  };

  return (
    <div className="tile" style={{ gap: 12, padding: '18px 18px 16px' }}>
      <div className="row-between" style={{ alignItems: 'flex-start', gap: 10 }}>
        <a href={href(`/goals/${goal.id}`)} style={{ display: 'flex', flexDirection: 'column', gap: 3, minWidth: 0, color: 'inherit', textDecoration: 'none' }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 9, fontSize: 17, fontWeight: 600, letterSpacing: '-0.02em' }}>
            <span className="dot" style={{ width: 9, height: 9, flex: 'none', background: goal.color, boxShadow: `0 0 12px ${goal.color}` }} />
            <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{goal.title}</span>
          </span>
          <span className="small" style={{ color: 'var(--ink-2)', paddingLeft: 18 }}>
            {outcome(view, goal, plan, today)}
          </span>
        </a>
        <span style={{ flex: 'none', fontSize: 13, fontWeight: 600, color: ink }}>{word}</span>
      </div>
      <ConnectionStrip goal={goal} />
      {ownClock && (
        <div className="own-clock" role="img" aria-label={`Own clock: day ${Math.min(planDayNumber(plan, today), planTotalDays(plan))} of ${planTotalDays(plan)}, ends ${shortDate(plan.end_date)}`}>
          <span className="mono">
            DAY {Math.max(1, Math.min(planDayNumber(plan, today), planTotalDays(plan)))} / {planTotalDays(plan)}
          </span>
          <span className="own-track" aria-hidden="true">
            <span style={{ width: `${Math.max(2, Math.min(100, (daysBetween(plan.start_date, today) / Math.max(1, daysBetween(plan.start_date, plan.end_date))) * 100))}%` }} />
          </span>
          <span className="mono">ENDS {shortDate(plan.end_date).toUpperCase()}</span>
        </div>
      )}

      <div role="list" aria-label={`${goal.title} chain`} style={{ paddingLeft: 4 }}>
        {CHAIN_LEVELS.map((level) => {
          const link = chain[level];
          const set = isSet(link);
          const status = set && started ? periodStatus(view, data, goal, plan, link, today) : null;
          const labelInk = level === 'week' ? 'var(--accent-ink)' : status?.label === 'behind' ? 'var(--amber-ink)' : 'var(--muted)';
          const value = link.step?.target_value != null ? `${fmt(link.step.target_value)} ${goal.unit ?? ''}`.trim() : '';
          const text = [value, link.step?.target_note.trim() ?? ''].filter(Boolean).join(' · ');
          return (
            <div key={level} role="listitem" style={{ display: 'grid', gridTemplateColumns: '50px minmax(0, 1fr)', gap: 10, alignItems: 'start', padding: '7px 0', borderTop: '1px solid var(--line)' }}>
              <span className="mono" style={{ fontSize: 10.5, paddingTop: set ? 3 : 9, color: labelInk }}>
                {LEVEL_SHORT[level]}
              </span>
              {set ? (
                <button
                  type="button"
                  onClick={() => setEditing(level)}
                  aria-label={`${LEVEL_LONG[level]}: ${text}. Edit`}
                  style={{ border: 0, background: 'none', padding: 0, textAlign: 'left', font: 'inherit', cursor: 'pointer', fontSize: 14, lineHeight: 1.4, color: level === 'week' ? 'var(--ink)' : 'var(--ink-2)', fontWeight: level === 'week' ? 550 : 450 }}
                >
                  {text}
                </button>
              ) : (
                <button className="chain-set" type="button" onClick={() => setEditing(level)}>
                  + {LEVEL_SET[level]}
                </button>
              )}
            </div>
          );
        })}
      </div>

      {fix && fix.extra == null && <span className="xsmall" style={{ color: 'var(--amber-ink)' }}>{fix.text}</span>}

      <div className="row-between" style={{ gap: 10, borderTop: '1px solid var(--line)', paddingTop: 12 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0 }}>
          <span className="small" style={{ color: 'var(--ink-2)' }}>{week.text}</span>
          {week.pips && (
            <span style={{ display: 'flex', gap: 3, flexWrap: 'wrap' }} aria-hidden="true">
              {Array.from({ length: week.pips.total }, (_, i) => (
                <span key={i} style={{ width: 18, height: 5, borderRadius: 3, background: i < week.pips!.done ? goal.color : 'var(--track)' }} />
              ))}
            </span>
          )}
        </div>
        {fix?.extra ? (
          <button className="btn small catch-up" type="button" onClick={() => addExtra(fix.extra!)} title={fix.text} style={{ flex: 'none' }}>
            Add {fix.extra} this week
          </button>
        ) : age == null || (age ?? 0) > 7 ? (
          <a className="btn small catch-up" href={href(`/goals/${goal.id}`)} style={{ flex: 'none' }}>
            Log a reading
          </a>
        ) : (
          <a className="avatar" href={href(`/goals/${goal.id}`)} aria-label={`Open ${goal.title}`} style={{ flex: 'none', color: 'var(--ink-2)' }}>
            <Icon name="chevron" size={16} stroke={2.2} />
          </a>
        )}
      </div>

      {editing && <ChainSheet goal={goal} plan={plan} chain={chain} level={editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

/** The 6-month outcome in one line: start → now → target for numbers, else what "done" means. */
function outcome(view: View, goal: Goal, plan: Plan, today: ISODate): string {
  const by = shortDate(goal.target_date ?? plan.end_date);
  if (goal.type === 'number' && goal.target_value != null) {
    const n = plan.start_date <= today ? view.goalPace(goal, plan).number : null;
    const start = n?.start.value ?? goal.baseline_value;
    const now = n?.latest;
    return `${start != null ? `${fmt(start)} → ` : ''}${now != null ? `${fmt(now)} now → ` : ''}${fmt(goal.target_value)} ${goal.unit ?? ''} · ${by}`;
  }
  return `${goal.done_means.trim() || 'Done in six months'} · ${by}`;
}

/** The card's bottom line: this week's tasks (with pips), the latest reading, or the next milestone. */
function footer(view: View, data: AppData, goal: Goal, plan: Plan, today: ISODate): { text: string; pips: { done: number; total: number } | null } {
  if (goal.type === 'number') {
    const n = plan.start_date <= today ? view.goalPace(goal, plan).number : null;
    const age = readingAge(view, goal, today);
    if (!n || n.latest == null || age == null) return { text: 'No readings yet', pips: null };
    const ahead = n.aheadBy != null ? ` · ${fmt(Math.abs(n.aheadBy))} ${n.aheadBy >= 0 ? 'ahead of' : 'behind'} path` : '';
    return { text: `${fmt(n.latest)} ${goal.unit ?? ''}${age > 7 ? `, ${age} days ago` : ' now'}${ahead}`, pips: null };
  }
  const t = weekTally(view, goal, today);
  if (goal.type === 'finish' && t.total === 0) {
    const next = data.milestones.filter((m) => m.goal_id === goal.id && !m.completed_at).sort((a, b) => (a.due_date < b.due_date ? -1 : 1))[0];
    return { text: next ? `Next · ${next.title}, ${shortDate(next.due_date)}` : 'No milestones yet', pips: null };
  }
  if (t.total === 0) return { text: 'No tasks this week', pips: null };
  return { text: `This week ${t.done} of ${t.total}`, pips: t.total <= 14 ? t : null };
}

/** The one setup step left for a new plan (goals, then daily tasks, then a first check-in), or null. */
function setupSteps(view: View, data: AppData, today: ISODate): { title: string; detail: string; action: string; to: string } | null {
  const goals = view.activeGoals;
  if (goals.length === 0) return null; // The empty state already says this.
  const noTasks = goals.find((g) => g.type !== 'number' && view.actionsForGoal(g.id).length === 0);
  if (noTasks) return { title: `Add daily tasks for ${noTasks.title}`, detail: 'Daily tasks on the goal page land on your Today list.', action: 'Add tasks', to: `/goals/${noTasks.id}` };
  const actionIds = new Set(goals.flatMap((g) => view.actionsForGoal(g.id, true).map((a) => a.id)));
  const checkedIn = data.sessions.some((x) => x.action_id && actionIds.has(x.action_id) && x.status !== 'planned' && x.status !== 'moved');
  const started = goals.some((g) => (view.planForGoal(g)?.start_date ?? today) <= today);
  if (!checkedIn && started) return { title: 'Do your first check-in', detail: 'Tick one thing off on Today. That starts your streak.', action: 'Open Today', to: '/today' };
  return null;
}

/** A batch's settings: its dates, finished batches, and archiving. */
function BatchMenu({ plan, onClose }: { plan: Plan; onClose: () => void }) {
  const { data, today, commit } = useStore();
  const view = useView();
  const toast = useToast();
  const goals = view.goalsForPlan(plan.id);
  const past = data.plans.filter((p) => !p.solo && (p.archived_at || p.end_date < today));
  return (
    <Sheet title={plan.name} onClose={onClose}>
      <span className="small muted" style={{ marginTop: -8 }}>
        Batch · {shortDate(plan.start_date)} – {shortDate(plan.end_date)} · {goals.length} goal{goals.length === 1 ? '' : 's'}
      </span>
      <p className="small" style={{ margin: 0, color: 'var(--ink-2)' }}>
        Goals join a batch when you commit them from the backlog. They share its 3-month checkpoint and its reviews; one that joins part-way through simply has less time.
      </p>
      {past.length > 0 && (
        <details>
          <summary className="label" style={{ cursor: 'pointer', minHeight: 32, display: 'flex', alignItems: 'center' }}>
            Finished and archived batches · {past.length}
          </summary>
          {past.map((p) => (
            <div key={p.id} className="list-row small">
              <span className="grow">{p.name}</span>
              <span className="mono">
                {shortDate(p.start_date)} – {shortDate(p.end_date)}
              </span>
            </div>
          ))}
        </details>
      )}
      <button
        className="btn small danger"
        onClick={() => {
          commit(opsArchivePlan(plan, true));
          toast(`${plan.name} archived. Its history is kept.`);
          onClose();
        }}
      >
        Archive {plan.name}
      </button>
    </Sheet>
  );
}
