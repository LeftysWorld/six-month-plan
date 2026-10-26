import { useState } from 'react';
import { addDays, shortDate, type Goal, type ISODate, type Plan } from '@six/core';
import { useStore } from '../data/store.tsx';
import { AddToGroupSheet, GroupNameSheet } from '../components/Connections.tsx';
import { opsAddToGroup, opsRemoveFromGroup } from '../data/groups.ts';
import { MoveSheet } from '../components/MoveSheet.tsx';
import { currentWindow, type Destination } from '../data/move.ts';
import { type View } from '../data/derive.ts';
import { useView } from '../data/useView.ts';
import { opsArchivePlan, opsCreatePlan } from '../data/ops.ts';
import type { AppData } from '../data/model.ts';
import { href } from '../router.ts';
import { Icon, Sheet, useToast } from '../components/ui.tsx';
import { useGoalDrag } from '../components/goalDrag.ts';
import { nextSeasonDates, seasonsOf } from '../data/season.ts';
import { GroupRowsCard, LooseCard, SeasonHorizon, SeasonOutcomes, SeasonStats, dropHint, placeGoals } from './Season.tsx';
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
  const [menuFor, setMenuFor] = useState<Plan | null>(null);
  const [creating, setCreating] = useState(false);
  const [selected, setSelected] = useState<'current' | 'next'>('current');
  const [naming, setNaming] = useState<Goal[] | null>(null);
  const [moving, setMoving] = useState<Goal | null>(null);
  const [movingGoals, setMovingGoals] = useState<{ goals: Goal[]; title?: string; dest: Destination | null } | null>(null);
  const initial = (data.profile.display_name || 'You').trim().charAt(0).toUpperCase();
  const seasons = seasonsOf(view);
  const placed = placeGoals(view, data, today, seasons);
  const setup = setupSteps(view, data, today);
  const season = selected === 'next' ? seasons.next : seasons.current;
  const inSeason = placed.filter((p) => p.season === selected || (!seasons.current && selected === 'current'));
  const others = placed.filter((p) => p.season === 'other');
  const groups = data.groups.map((group) => ({ group, members: inSeason.filter((p) => p.card.goal.group_id === group.id) })).filter((g) => g.members.length > 0);
  const grouped = new Set(groups.flatMap((g) => g.members.map((m) => m.card.goal.id)));
  const loose = inSeason.filter((p) => !grouped.has(p.card.goal.id));

  const planNext = () => {
    if (!seasons.current) return;
    const { start, end } = nextSeasonDates(seasons.current);
    commit(opsCreatePlan({ name: 'Next season', start, end }).ops);
    setSelected('next');
    toast(`Next season planned: ${shortDate(start)} – ${shortDate(end)}. Move goals into it, or commit ideas from your backlog.`);
  };

  const dnd = useGoalDrag((d, target) => {
    const goal = d.goal;
    const [kind, id] = target.split(':') as [string, string | undefined];
    if (kind === 'already') {
      const plan = data.plans.find((x) => x.id === id);
      toast(`${d.group ? `${d.group.name}'s goals are` : `${goal.title} is`} already in ${plan?.id === seasons.current?.id ? 'this season' : plan?.id === seasons.next?.id ? 'next season' : plan?.name ?? 'that season'}`);
      return;
    }
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

  const list = (
    <div className="season-list">
      {groups.map(({ group, members }) => (
        <GroupRowsCard key={group.id} group={group} members={members} dnd={dnd} onMove={setMoving} onMoveGroup={() => setMovingGoals({ goals: members.map((m) => m.card.goal), title: group.name, dest: null })} />
      ))}
      {(loose.length > 0 || (dnd.drag && !dnd.drag.group && dnd.drag.goal.group_id)) && <LooseCard title={groups.length ? 'Not in a group' : 'Your goals'} members={loose} dnd={dnd} onMove={setMoving} />}
      {inSeason.length === 0 && selected === 'next' && (
        <div className="card small" style={{ color: 'var(--ink-2)' }}>
          Nothing in next season yet. Drag a goal or a group onto it on the horizon, use Move on a goal, or commit an idea from your backlog to it.
        </div>
      )}
      {dnd.drag && (
        <div className={`own-drop${dnd.drag.target === 'own' ? ' drop-on' : ''}`} data-drop="own">
          Drop here to put {dnd.drag.group ? `${dnd.drag.group.name}'s goals each` : dnd.drag.goal.title} on {dnd.drag.group ? 'their' : 'its'} own clock
        </div>
      )}
      {others.length > 0 && selected === 'current' && (
        <span className="xsmall muted">
          Also running in other windows: {others.map((o) => `${o.card.goal.title} (${o.plan.name})`).join(', ')}.
        </span>
      )}
    </div>
  );
  const side = season ? (
    <div className="season-side">
      <SeasonStats season={season} members={inSeason} />
      <SeasonOutcomes season={season} members={inSeason} onPlan={selected === 'next' && inSeason.length === 0 ? () => undefined : undefined} />
    </div>
  ) : null;

  return (
    <div className="stack rise">
      <div className="topbar">
        <span className="mono">
          {placed.length} goal{placed.length === 1 ? '' : 's'}
          {data.groups.length ? ` · ${data.groups.length} group${data.groups.length === 1 ? '' : 's'}` : ''}
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

      {placed.length === 0 && (
        <div className="card tight small stack-sm" style={{ color: 'var(--ink-2)' }}>
          <span>
            Nothing committed yet. Goals start in the backlog: write ideas down, select the ones that matter most, prepare them, then commit, to this season or on their own clock. Most people carry 3–4 at a time.
          </span>
          <a className="btn small primary" href={href('/goals/backlog')} style={{ alignSelf: 'flex-start' }}>
            Open the backlog
          </a>
        </div>
      )}

      {seasons.current ? (
        <SeasonHorizon seasons={seasons} selected={selected} onSelect={setSelected} placed={placed} dnd={dnd} onPlanNext={planNext} onMenu={setMenuFor} />
      ) : (
        placed.length > 0 && (
          <button type="button" className="btn small" onClick={() => setCreating(true)} style={{ alignSelf: 'flex-start' }}>
            <Icon name="plus" size={14} stroke={2.4} /> Start a season
          </button>
        )
      )}

      <div className="season-layout">
        <div className="season-main">
          <div className="only-narrow">{side}</div>
          {list}
        </div>
        <aside className="season-aside only-wide" aria-label="This season at a glance">
          {side}
        </aside>
      </div>

      {dnd.drag && (
        <div className="drag-ghost" style={{ left: dnd.drag.x, top: dnd.drag.y }} aria-hidden="true">
          <span className="dot" style={{ background: dnd.drag.goal.color, marginRight: 8 }} />
          {dnd.drag.group ? `${dnd.drag.group.name} · ${dnd.drag.goals.length} goals` : dnd.drag.goal.title}
          {dnd.drag.target && <span className="drag-ghost-hint">{dropHint(dnd.drag)}</span>}
        </div>
      )}

      <IdeaAdd placeholder="Add a goal idea (it starts in your backlog)" after={(t) => toast(`${t} added to your backlog`)} />

      {creating && (
        <Sheet title="New season" onClose={() => setCreating(false)}>
          <PlanForm onDone={() => setCreating(false)} />
        </Sheet>
      )}
      {menuFor && <BatchMenu plan={menuFor} onClose={() => setMenuFor(null)} />}
      {naming && <GroupNameSheet goals={naming} onClose={() => setNaming(null)} />}
      {moving && <AddToGroupSheet goal={moving} onClose={() => setMoving(null)} />}
      {movingGoals && <MoveSheet goals={movingGoals.goals} title={movingGoals.title} initial={movingGoals.dest} onClose={() => setMovingGoals(null)} />}
    </div>
  );
}

/** The one setup step left for a new plan (goals, then daily tasks, then a first check-in), or null. */
function setupSteps(view: View, data: AppData, today: ISODate): { title: string; detail: string; action: string; to: string } | null {
  const goals = view.activeGoals;
  if (goals.length === 0) return null; // The empty state already says this.
  // A goal waiting on another gets its tasks when it starts.
  const noTasks = goals.find((g) => g.type !== 'number' && !view.waitingOn(g) && view.actionsForGoal(g.id).length === 0);
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
