import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import {
  addDays,
  chainAt,
  daysBetween,
  planDayNumber,
  planTotalDays,
  quarterRange,
  shortDate,
  weekdayName,
  describeSchedule,
  type Goal,
  type GoalGroup,
  type ISODate,
  type PaceLabel,
  type Plan,
} from '@six/core';
import { useStore } from '../data/store.tsx';
import { AddToGroupSheet, GroupNameSheet, GroupSheet, sharedTasksOf } from '../components/Connections.tsx';
import { opsAddToGroup, opsRemoveFromGroup } from '../data/groups.ts';
import { MoveSheet } from '../components/MoveSheet.tsx';
import { currentWindow, type Destination } from '../data/move.ts';
import { runningSchedule } from '../data/connect.ts';
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
import { Icon, PacePill, Sheet, useToast } from '../components/ui.tsx';
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
  const { data, today, commit } = useStore();
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
  const all = [...new Map([...sections.flatMap((x) => x.cards), ...own.map((x) => x.card)].map((c) => [c.goal.id, c])).values()];
  const needCount = all.filter((c) => c.needs).length;
  const keep = (c: GoalCardData) => filter === 'all' || c.needs;
  const setup = setupSteps(view, data, today);

  // Groups first (in the order they were made), then goals on their own, needs-you first.
  // A goal can belong to more than one live window (a batch and a later one, say): list it once,
  // in the window it runs in now, so one goal never shows as several cards.
  const everywhere: Placed[] = [...sections.flatMap(({ plan, cards }) => cards.map((card) => ({ card, plan, own: false }))), ...own.map(({ card, plan }) => ({ card, plan, own: true }))];
  const placed: Placed[] = [...new Map(everywhere.filter((p) => view.planForGoal(p.card.goal)?.id === p.plan.id || !everywhere.some((q) => q.card.goal.id === p.card.goal.id && view.planForGoal(q.card.goal)?.id === q.plan.id)).map((p) => [p.card.goal.id, p])).values()].sort((a, b) => a.card.rank - b.card.rank);
  const shown = placed.filter((p) => keep(p.card));
  const groups = data.groups
    .map((group) => ({ group, members: shown.filter((p) => p.card.goal.group_id === group.id) }))
    .filter((g) => g.members.length > 0);
  const grouped = new Set(groups.flatMap((g) => g.members.map((m) => m.card.goal.id)));
  const looseShown = shown.filter((p) => !grouped.has(p.card.goal.id));
  const [naming, setNaming] = useState<Goal[] | null>(null);
  const [openGroup, setOpenGroup] = useState<GoalGroup | null>(null);
  const [moving, setMoving] = useState<Goal | null>(null);
  const [movingGoals, setMovingGoals] = useState<{ goals: Goal[]; title?: string; dest: Destination | null } | null>(null);
  const dnd = useGoalDrag((d, target) => {
    const goal = d.goal;
    const [kind, id] = target.split(':') as [string, string | undefined];
    if (kind === 'plan' && id) {
      const plan = data.plans.find((x) => x.id === id);
      if (plan) setMovingGoals({ goals: d.goals, title: d.group?.name, dest: { kind: 'plan', plan } });
      return;
    }
    if (kind === 'own') {
      setMovingGoals({ goals: d.goals, title: d.group?.name, dest: { kind: 'own', months: 6 } });
      return;
    }
    if (kind === 'goal' && id) {
      const other = data.goals.find((g) => g.id === id);
      if (!other) return;
      if (other.group_id) {
        commit(opsAddToGroup(data, goal.id, other.group_id));
        toast(`${goal.title} added to ${data.groups.find((x) => x.id === other.group_id)?.name ?? 'the group'}`);
      } else setNaming([other, goal]);
    } else if (kind === 'group' && id) {
      commit(opsAddToGroup(data, goal.id, id));
      toast(`${goal.title} added to ${data.groups.find((x) => x.id === id)?.name ?? 'the group'}`);
    } else if (kind === 'loose') {
      const name = data.groups.find((x) => x.id === goal.group_id)?.name;
      const ops = opsRemoveFromGroup(data, goal.id);
      commit(ops);
      const gone = ops.some((o) => o.kind === 'delete' && o.collection === 'groups');
      toast(gone ? `${goal.title} taken out. ${name} had one goal left, so the group is gone.` : `${goal.title} taken out of ${name}`);
    }
  });

  return (
    <div className="stack rise">
      <div className="topbar">
        <span className="mono">
          {all.length} goal{all.length === 1 ? '' : 's'}
          {data.groups.length ? ` · ${data.groups.length} group${data.groups.length === 1 ? '' : 's'}` : ''}
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

      {sections.map(({ plan }) => (
        <PlanLine key={plan.id} plan={plan} today={today} onMenu={() => setMenuFor(plan)} goalIds={placed.filter((p) => p.plan.id === plan.id).map((p) => p.card.goal.id)} over={dnd.drag?.target === `plan:${plan.id}`} dragging={!!dnd.drag} />
      ))}

      {groups.map(({ group, members }) => (
        <GroupCard
          key={group.id}
          group={group}
          members={members}
          dnd={dnd}
          onOpen={() => setOpenGroup(group)}
          onMove={setMoving}
          onMoveGroup={() => setMovingGoals({ goals: members.map((m) => m.card.goal), title: group.name, dest: null })}
        />
      ))}

      {dnd.drag && (
        <div className={`own-drop${dnd.drag.target === 'own' ? ' drop-on' : ''}`} data-drop="own">
          Drop here to put {dnd.drag.group ? `${dnd.drag.group.name}'s goals each` : dnd.drag.goal.title} on {dnd.drag.group ? 'their' : 'its'} own clock
        </div>
      )}

      {(looseShown.length > 0 || (!dnd.drag?.group && dnd.drag?.goal.group_id)) && (
        <section className={`loose-goals${dnd.drag?.target === 'loose' ? ' drop-on' : ''}`} data-drop="loose" aria-label="Not in a group">
          <div className="row-between" style={{ gap: 8, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 15, fontWeight: 600, letterSpacing: '-0.01em' }}>{groups.length ? 'Not in a group' : 'Your goals'}</span>
            <span className="xsmall muted">{!dnd.drag?.group && dnd.drag?.goal.group_id ? `Drop here to take ${dnd.drag.goal.title} out of its group` : 'Drag a goal onto another to group them, or onto a batch to move it'}</span>
          </div>
          <div className="loose-tiles">
            {looseShown.map((m) => (
              <GoalTile key={m.card.goal.id} placed={m} dnd={dnd} onMove={setMoving} />
            ))}
          </div>
        </section>
      )}

      {dnd.drag && (
        <div className="drag-ghost" style={{ left: dnd.drag.x, top: dnd.drag.y }} aria-hidden="true">
          <span className="dot" style={{ background: dnd.drag.goal.color, marginRight: 8 }} />
          {dnd.drag.group ? `${dnd.drag.group.name} · ${dnd.drag.goals.length} goals` : dnd.drag.goal.title}
          {dnd.drag.target && <span className="drag-ghost-hint">{dropHint(dnd.drag)}</span>}
        </div>
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
      {naming && <GroupNameSheet goals={naming} onClose={() => setNaming(null)} />}
      {openGroup && <GroupSheet group={openGroup} onClose={() => setOpenGroup(null)} />}
      {moving && <AddToGroupSheet goal={moving} onClose={() => setMoving(null)} />}
      {movingGoals && <MoveSheet goals={movingGoals.goals} title={movingGoals.title} initial={movingGoals.dest} onClose={() => setMovingGoals(null)} />}
    </div>
  );
}

/** What letting go would do, shown on the dragged card. */
function dropHint(d: GoalDrag): string {
  if (d.target?.startsWith('plan:')) return 'Move into this batch';
  if (d.target === 'own') return d.group ? 'Each on its own clock' : 'Put on its own clock';
  if (d.target === 'loose') return 'Take out of its group';
  if (d.target?.startsWith('group:')) return 'Add to this group';
  return 'Make a group';
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
function PlanLine({ plan, today, onMenu, goalIds = [], over = false, dragging = false }: { plan: Plan; today: ISODate; onMenu: () => void; goalIds?: string[]; over?: boolean; dragging?: boolean }) {
  const started = plan.start_date <= today;
  const total = Math.max(1, daysBetween(plan.start_date, plan.end_date));
  const pos = (d: ISODate) => Math.max(0, Math.min(100, (daysBetween(plan.start_date, d) / total) * 100));
  const checkpoint = quarterRange(plan, plan.start_date).end;
  const month = chainAt(plan, today).month;
  const monthLeft = daysBetween(today, month.end);
  const used = started ? pos(today) : 0;
  return (
    <div className={`plan-line${dragging ? ' droppable' : ''}${over ? ' drop-on' : ''}`} data-drop={`plan:${plan.id}`} data-goals={goalIds.join(',')}>
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
      {dragging && <span className="xsmall" style={{ color: over ? 'var(--accent-ink)' : 'var(--muted)', fontWeight: over ? 600 : 400 }}>{over ? `Release to move into ${plan.name}` : 'Drop here to move into this batch'}</span>}
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
interface Placed {
  card: GoalCardData;
  plan: Plan;
  own: boolean;
}

/** What's being dragged (a goal, or a whole group) and where it would land. */
interface GoalDrag {
  /** The goal being dragged, or the group's first goal (for its colour) when a group is. */
  goal: Goal;
  group: GoalGroup | null;
  /** Every goal that moves: just the goal, or all of the group's goals. */
  goals: Goal[];
  x: number;
  y: number;
  target: string | null;
}

type DragWhat = Pick<GoalDrag, 'goal' | 'group' | 'goals'>;

/**
 * Drag goals like phone apps: grab the handle (or press and hold a card on a touch screen, or
 * drag it a few pixels with a mouse). A group drags by its handle too. Drop targets carry
 * data-drop: "goal:<id>", "group:<id>" and "loose" (for goals), "plan:<id>" and "own" (for goals
 * and groups). A batch line lists the goals already in it (data-goals), so dropping them there
 * again does nothing.
 */
function useGoalDrag(onDrop: (d: GoalDrag, target: string) => void) {
  const [drag, setDrag] = useState<GoalDrag | null>(null);
  const dragRef = useRef<GoalDrag | null>(null);
  const pending = useRef<{ what: DragWhat; x: number; y: number; touch: boolean; handle: boolean; timer: number | null } | null>(null);
  const off = useRef<(() => void) | null>(null);
  const suppress = useRef(false);
  const dropRef = useRef(onDrop);
  dropRef.current = onDrop;

  const targetAt = (x: number, y: number, what: DragWhat): string | null => {
    const el = document.elementFromPoint(x, y)?.closest('[data-drop]') as HTMLElement | null;
    const t = el?.dataset.drop ?? null;
    if (!t) return null;
    if (t.startsWith('plan:')) {
      const there = new Set((el?.dataset.goals ?? '').split(',').filter(Boolean));
      return what.goals.every((g) => there.has(g.id)) ? null : t;
    }
    if (t === 'own') return t;
    if (what.group) return null; // a group only goes into a batch or onto own clocks
    const goal = what.goal;
    if (t === `goal:${goal.id}`) return null;
    if (t === `group:${goal.group_id}`) return null; // already in it
    if (t === 'loose' && !goal.group_id) return null; // already on its own
    return t;
  };
  const stop = () => {
    if (pending.current?.timer) window.clearTimeout(pending.current.timer);
    pending.current = null;
    off.current?.();
    off.current = null;
  };
  const begin = (what: DragWhat, x: number, y: number) => {
    const d: GoalDrag = { ...what, x, y, target: targetAt(x, y, what) };
    dragRef.current = d;
    suppress.current = true;
    setDrag(d);
    try {
      navigator.vibrate?.(8);
    } catch {
      /* no vibration */
    }
  };
  /** From a card: hold (touch) or move a few pixels (mouse). From a handle: any small move. */
  const start = (e: ReactPointerEvent<HTMLElement>, what: DragWhat, handle = false) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    stop();
    const touch = e.pointerType !== 'mouse' && !handle;
    const p = { what, x: e.clientX, y: e.clientY, touch, handle, timer: null as number | null };
    pending.current = p;
    suppress.current = false;
    if (touch) p.timer = window.setTimeout(() => pending.current === p && begin(what, p.x, p.y), 320);
    const move = (ev: PointerEvent) => {
      const q = pending.current;
      if (!dragRef.current && q) {
        const dist = Math.hypot(ev.clientX - q.x, ev.clientY - q.y);
        if (q.touch) {
          if (dist > 10) stop(); // scrolling, not dragging
          return;
        }
        if (dist < (q.handle ? 4 : 6)) return;
        begin(q.what, ev.clientX, ev.clientY);
      }
      const d = dragRef.current;
      if (!d) return;
      ev.preventDefault();
      window.getSelection()?.removeAllRanges();
      if (ev.clientY < 72) window.scrollBy(0, -12);
      else if (ev.clientY > window.innerHeight - 72) window.scrollBy(0, 12);
      const next = { ...d, x: ev.clientX, y: ev.clientY, target: targetAt(ev.clientX, ev.clientY, d) };
      dragRef.current = next;
      setDrag(next);
    };
    const up = () => {
      const d = dragRef.current;
      dragRef.current = null;
      stop();
      setDrag(null);
      if (d?.target) dropRef.current(d, d.target);
    };
    const cancel = () => {
      dragRef.current = null;
      stop();
      setDrag(null);
    };
    const touchMove = (ev: TouchEvent) => {
      if (dragRef.current) ev.preventDefault();
    };
    const key = (ev: KeyboardEvent) => ev.key === 'Escape' && cancel();
    const menu = (ev: Event) => pending.current?.touch && ev.preventDefault();
    window.addEventListener('pointermove', move, { passive: false });
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', cancel);
    window.addEventListener('touchmove', touchMove, { passive: false });
    window.addEventListener('keydown', key);
    window.addEventListener('contextmenu', menu);
    off.current = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', cancel);
      window.removeEventListener('touchmove', touchMove);
      window.removeEventListener('keydown', key);
      window.removeEventListener('contextmenu', menu);
    };
  };
  useEffect(() => () => off.current?.(), []);
  /** True once right after a drag, so the click that ends it doesn't also open the goal. */
  const consumeClick = () => {
    const was = suppress.current;
    suppress.current = false;
    return was;
  };
  return { drag, start, consumeClick };
}

type DragApi = ReturnType<typeof useGoalDrag>;

/** The number that says the most about a goal right now, with its unit and a line under it. */
function metric(view: View, data: AppData, goal: Goal, plan: Plan, today: ISODate): { big: string; unit: string; sub: string } {
  const by = shortDate(goal.target_date ?? plan.end_date);
  if (goal.type === 'number') {
    const n = plan.start_date <= today ? view.goalPace(goal, plan).number : null;
    const now = n?.latest ?? goal.baseline_value;
    const ahead = n?.aheadBy != null ? ` · ${fmt(Math.abs(n.aheadBy))} ${n.aheadBy >= 0 ? 'ahead' : 'behind'}` : '';
    return { big: now != null ? fmt(now) : '—', unit: goal.unit ?? '', sub: `to ${fmt(goal.target_value)} by ${by}${ahead}` };
  }
  const t = weekTally(view, goal, today);
  if (goal.type === 'finish' && t.total === 0) {
    const ms = data.milestones.filter((m) => m.goal_id === goal.id);
    const next = ms.filter((m) => !m.completed_at).sort((a, b) => (a.due_date < b.due_date ? -1 : 1))[0];
    return { big: String(ms.filter((m) => m.completed_at).length), unit: `of ${ms.length} milestones`, sub: next ? `Next · ${next.title}, ${shortDate(next.due_date)}` : by };
  }
  return { big: String(t.done), unit: `of ${t.total} this week`, sub: `${goal.done_means.trim() || goal.title} · ${by}` };
}

/** Where a goal keeps time: its batch, or its own clock with the day count. */
function timing(plan: Plan, own: boolean, today: ISODate): string {
  if (!own) return plan.name;
  if (plan.start_date > today) return `Own clock · starts ${shortDate(plan.start_date)}`;
  return `Own clock · day ${Math.min(planDayNumber(plan, today), planTotalDays(plan))} of ${planTotalDays(plan)}`;
}

const GRIP = (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <circle cx="9" cy="6" r="1.6" />
    <circle cx="15" cy="6" r="1.6" />
    <circle cx="9" cy="12" r="1.6" />
    <circle cx="15" cy="12" r="1.6" />
    <circle cx="9" cy="18" r="1.6" />
    <circle cx="15" cy="18" r="1.6" />
  </svg>
);

/** One goal on the Goals page: its pace, its key number, this week's goal and the one thing to do. */
function GoalTile({ placed, dnd, compact = false, onMove }: { placed: Placed; dnd: DragApi; compact?: boolean; onMove: (g: Goal) => void }) {
  const { data, today, commit } = useStore();
  const view = useView();
  const toast = useToast();
  const [editing, setEditing] = useState<ChainLevel | null>(null);
  const { card, plan, own } = placed;
  const { goal, chain, pace, fix, gaps } = card;
  const started = plan.start_date <= today;
  const word = pace === 'behind' ? 'Behind' : pace === 'ahead' ? 'Ahead' : pace === 'on_track' ? 'On pace' : started ? 'Too early' : 'Not started';
  const pill = pace === 'behind' ? 'behind' : pace === 'ahead' ? 'ahead' : pace === 'on_track' ? 'on_track' : 'none';
  const m = metric(view, data, goal, plan, today);
  const week = chain.week;
  const weekText = isSet(week) ? [week.step?.target_value != null ? `${fmt(week.step.target_value)} ${goal.unit ?? ''}`.trim() : '', week.step?.target_note.trim() ?? ''].filter(Boolean).join(' · ') : '';
  const age = goal.type === 'number' && started ? readingAge(view, goal, today) : 0;
  const dragging = !dnd.drag?.group && dnd.drag?.goal.id === goal.id;
  const over = dnd.drag?.target === `goal:${goal.id}`;

  const addExtra = (n: number) => {
    const { ops, days } = opsAddExtra(view, data, goal, today, n);
    if (!ops.length) return;
    commit(ops);
    const ids = (ops[0] as Extract<Op, { kind: 'insert' }>).rows.map((r) => r.id);
    const when = days.map((d) => (d === today ? 'today' : weekdayName(d))).join(' and ');
    toast(`Added ${n} for ${when}`, () => commit(ids.map((id): Op => ({ kind: 'delete', collection: 'sessions', id }))));
  };

  return (
    <div
      className={`goal-tile${compact ? ' compact' : ''}${dragging ? ' lifted' : ''}${over ? ' drop-on' : ''}`}
      data-drop={goal.group_id ? undefined : `goal:${goal.id}`}
      onPointerDown={(e) => {
        if ((e.target as HTMLElement).closest('button:not(.goal-grip), input, select, textarea')) return;
        dnd.start(e, { goal, group: null, goals: [goal] });
      }}
    >
      <div className="goal-tile-head">
        <button
          type="button"
          className="goal-grip"
          aria-label={`Drag ${goal.title} onto another goal or a group. Or press to choose a group.`}
          onPointerDown={(e) => {
            e.stopPropagation();
            dnd.start(e, { goal, group: null, goals: [goal] }, true);
          }}
          onClick={() => !dnd.consumeClick() && onMove(goal)}
        >
          {GRIP}
        </button>
        <a
          href={href(`/goals/${goal.id}`)}
          draggable={false}
          className="goal-tile-title"
          onClick={(e) => dnd.consumeClick() && e.preventDefault()}
        >
          <span className="dot" style={{ width: 9, height: 9, flex: 'none', background: goal.color, boxShadow: `0 0 10px ${goal.color}` }} />
          <span>{goal.title}</span>
        </a>
        {pill !== 'none' ? <PacePill label={pill} /> : <span className="xsmall muted" style={{ flex: 'none' }}>{word}</span>}
      </div>
      <a href={href(`/goals/${goal.id}`)} draggable={false} className="goal-tile-body" onClick={(e) => dnd.consumeClick() && e.preventDefault()}>
        <span className="goal-tile-big">
          {m.big} <span>{m.unit}</span>
        </span>
        <span className="goal-tile-sub">{m.sub}</span>
      </a>
      {weekText ? (
        <span className="goal-tile-week">
          <span className="mono" style={{ color: 'var(--accent-ink)' }}>WEEK</span> {weekText}
        </span>
      ) : (
        <button className="chain-set" type="button" onClick={() => setEditing('week')} style={{ alignSelf: 'flex-start' }}>
          + {LEVEL_SET.week}
        </button>
      )}
      {weekText && gaps.length > 0 && (
        <button className="chain-set" type="button" onClick={() => setEditing(gaps[0]!)} style={{ alignSelf: 'flex-start' }}>
          + {LEVEL_SET[gaps[0]!]}
        </button>
      )}
      {fix?.extra ? (
        <button className="btn small catch-up" type="button" onClick={() => addExtra(fix.extra!)} title={fix.text} style={{ alignSelf: 'flex-start' }}>
          Add {fix.extra} this week
        </button>
      ) : fix ? (
        <span className="xsmall" style={{ color: 'var(--amber-ink)' }}>{fix.text}</span>
      ) : age == null || (age ?? 0) > 7 ? (
        <a className="btn small catch-up" href={href(`/goals/${goal.id}`)} style={{ alignSelf: 'flex-start' }}>
          Log a reading
        </a>
      ) : null}
      <span className="goal-tile-time">{timing(plan, own, today)}</span>
      {editing && <ChainSheet goal={goal} plan={plan} chain={chain} level={editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

/** A group of goals, like a phone folder: its name, its goals side by side and the tasks they share. */
function GroupCard({ group, members, dnd, onOpen, onMove, onMoveGroup }: { group: GoalGroup; members: Placed[]; dnd: DragApi; onOpen: () => void; onMove: (g: Goal) => void; onMoveGroup: () => void }) {
  const view = useView();
  const { today } = useStore();
  const shared = sharedTasksOf(view, members.map((m) => m.card.goal));
  const over = dnd.drag?.target === `group:${group.id}`;
  const lifted = dnd.drag?.group?.id === group.id;
  return (
    <section className={`group-card${over ? ' drop-on' : ''}${lifted ? ' lifted' : ''}`} data-drop={`group:${group.id}`} aria-label={`Group: ${group.name}`}>
      <div className="group-card-side">
        <div className="row-start" style={{ gap: 4, flexWrap: 'nowrap' }}>
          <button
            type="button"
            className="goal-grip"
            aria-label={`Drag ${group.name} onto a batch to move its goals`}
            onPointerDown={(e) => {
              e.stopPropagation();
              dnd.start(e, { goal: members[0]!.card.goal, group, goals: members.map((m) => m.card.goal) }, true);
            }}
            onClick={() => !dnd.consumeClick() && onMoveGroup()}
          >
            {GRIP}
          </button>
          <button type="button" className="group-card-name" onClick={onOpen} aria-label={`Open ${group.name}`} style={{ flex: 1 }}>
            {group.name}
            <Icon name="chevron" size={16} stroke={2.4} />
          </button>
        </div>
        <span className="xsmall muted">
          {members.length} goal{members.length === 1 ? '' : 's'}
          {shared.length ? ` · ${shared.length} shared task${shared.length === 1 ? '' : 's'}` : ''}
        </span>
        {shared.length > 0 && (
          <div className="group-shared">
            <span className="mono" style={{ fontSize: 10.5 }}>SHARED · COUNT FOR ALL</span>
            {shared.map((a) => {
              const sch = runningSchedule(view.data, a.id, today);
              return (
                <div key={a.id} className="group-shared-row">
                  <span>{a.title}</span>
                  <span className="xsmall muted">{sch ? describeSchedule(sch) : 'ended'}</span>
                </div>
              );
            })}
          </div>
        )}
        {over && <span className="small" style={{ color: 'var(--accent-ink)', fontWeight: 600 }}>Release to add to {group.name}</span>}
      </div>
      <div className="group-card-tiles">
        {members.map((m) => (
          <GoalTile key={m.card.goal.id} placed={m} dnd={dnd} compact onMove={onMove} />
        ))}
      </div>
    </section>
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
  const [adding, setAdding] = useState<{ goals: Goal[]; title?: string } | null>(null);
  // Goals running somewhere else now, and groups with any goal outside this batch.
  const elsewhere = view.activeGoals.filter((g) => currentWindow(data, g.id, today)?.id !== plan.id);
  const groupsOut = data.groups
    .map((gr) => ({ gr, members: view.activeGoals.filter((g) => g.group_id === gr.id) }))
    .filter(({ members }) => members.length > 1 && members.some((g) => currentWindow(data, g.id, today)?.id !== plan.id));
  return (
    <Sheet title={plan.name} onClose={onClose}>
      <span className="small muted" style={{ marginTop: -8 }}>
        Batch · {shortDate(plan.start_date)} – {shortDate(plan.end_date)} · {goals.length} goal{goals.length === 1 ? '' : 's'}
      </span>
      <p className="small" style={{ margin: 0, color: 'var(--ink-2)' }}>
        Goals join a batch when you commit them from the backlog. They share its 3-month checkpoint and its reviews; one that joins part-way through simply has less time.
      </p>
      {(elsewhere.length > 0 || groupsOut.length > 0) && (
        <div className="stack-sm">
          <span className="label">Add goals</span>
          <span className="xsmall muted">Moves a goal here from where it runs now. Its daily tasks and history stay. On the Goals page you can also drag a goal or a group onto this batch.</span>
          {groupsOut.map(({ gr, members }) => (
            <div key={gr.id} className="list-row" style={{ gap: 8 }}>
              <span className="grow">
                <span className="small strong" style={{ display: 'block' }}>
                  {gr.name}
                </span>
                <span className="xsmall muted">Group · {members.map((g) => g.title).join(', ')}</span>
              </span>
              <button className="btn small" onClick={() => setAdding({ goals: members, title: gr.name })}>
                Move here
              </button>
            </div>
          ))}
          {elsewhere.map((g) => (
            <div key={g.id} className="list-row" style={{ gap: 8 }}>
              <span className="dot" style={{ background: g.color }} />
              <span className="grow">
                <span className="small strong" style={{ display: 'block' }}>
                  {g.title}
                </span>
                <span className="xsmall muted">Now in {(() => { const w = currentWindow(data, g.id, today); return w ? (w.solo ? 'its own clock' : w.name) : 'no window'; })()}</span>
              </span>
              <button className="btn small" onClick={() => setAdding({ goals: [g] })}>
                Move here
              </button>
            </div>
          ))}
        </div>
      )}
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
      {adding && <MoveSheet goals={adding.goals} title={adding.title} initial={{ kind: 'plan', plan }} onClose={() => setAdding(null)} />}
    </Sheet>
  );
}
