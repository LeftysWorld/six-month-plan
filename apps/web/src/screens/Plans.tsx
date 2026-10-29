import { useState } from 'react';
import { addDays, shortDate, type Goal, type ISODate, type Plan } from '@six/core';
import { useStore } from '../data/store.tsx';
import { AddToGroupSheet, GroupNameSheet } from '../components/Connections.tsx';
import { opsAddToGroup, opsRemoveFromGroup } from '../data/groups.ts';
import { MoveSheet } from '../components/MoveSheet.tsx';
import { currentWindow } from '../data/move.ts';
import { type View } from '../data/derive.ts';
import { useView } from '../data/useView.ts';
import { opsArchivePlan, opsCreatePlan } from '../data/ops.ts';
import type { AppData } from '../data/model.ts';
import { href } from '../router.ts';
import { Icon, Sheet, useToast } from '../components/ui.tsx';
import { useGoalDrag } from '../components/goalDrag.ts';
import { nextSeasonDates, seasonsOf } from '../data/season.ts';
import { GoalRow, GroupRowsCard, LooseCard, SeasonHorizon, SeasonOutcomes, SeasonStats, dropHint, placeGoals, type Placed } from './Season.tsx';
import { pathLetter, pathsOf } from '../data/paths.ts';
import { groupGradient } from '../data/palette.ts';
import { byOrder, placeAmong } from '../data/order.ts';
import { SeasonCardButton } from '../components/SeasonCard.tsx';
import { SeasonStart } from '../components/SeasonStart.tsx';
import { GoalsSwitch, IdeaAdd } from './Backlog.tsx';

/** Start a season: the six-month review calendar goals share (defaults to six months from today). */
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
        toast(`${name.trim()} started. Make goals for it from the backlog.`);
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
        A season is the review calendar your goals share: month reviews, a 3-month checkpoint and a retrospective. Each goal has its own start and finish inside it.
      </p>
      <button className="btn primary" type="submit">
        Start the season
      </button>
    </form>
  );
}

/**
 * Goals: every goal you're working on, in the season it belongs to, in groups or on their own.
 */
export function Plans() {
  const { data, today, commit } = useStore();
  const view = useView();
  const toast = useToast();
  const [menuFor, setMenuFor] = useState<Plan | null>(null);
  const [creating, setCreating] = useState(false);
  const [selected, setSelected] = useState<'current' | 'next'>('current');
  // Group by your groups (the default) or by path: the life each goal is a bet on.
  const [by, setByState] = useState<'group' | 'path'>(() => {
    try {
      return localStorage.getItem('six.goals.by') === 'path' ? 'path' : 'group';
    } catch {
      return 'group';
    }
  });
  const setBy = (v: 'group' | 'path') => {
    setByState(v);
    try {
      localStorage.setItem('six.goals.by', v);
    } catch {
      // storage blocked: just for now
    }
  };
  const [naming, setNaming] = useState<Goal[] | null>(null);
  const [moving, setMoving] = useState<Goal | null>(null);
  const [movingGoals, setMovingGoals] = useState<{ goals: Goal[]; title?: string; dest: Plan | null } | null>(null);
  const initial = (data.profile.display_name || 'You').trim().charAt(0).toUpperCase();
  const seasons = seasonsOf(view);
  const placed = placeGoals(view, data, today, seasons);
  const setup = setupSteps(view, data, today);
  const season = selected === 'next' ? seasons.next : seasons.current;
  const inSeason = placed.filter((p) => p.season === selected || (!seasons.current && selected === 'current'));
  const others = placed.filter((p) => p.season === 'other');
  const orderPlaced = (ps: Placed[]) => byOrder(ps.map((p) => ({ id: p.card.goal.id, sort_order: p.card.goal.sort_order, p }))).map((x) => x.p);
  const groups = byOrder(data.groups)
    .map((group) => ({ group, members: orderPlaced(inSeason.filter((p) => p.card.goal.group_id === group.id)) }))
    .filter((g) => g.members.length > 0);
  const grouped = new Set(groups.flatMap((g) => g.members.map((m) => m.card.goal.id)));
  const loose = orderPlaced(inSeason.filter((p) => !grouped.has(p.card.goal.id)));

  const planNext = () => {
    if (!seasons.current) return;
    const { start, end } = nextSeasonDates(seasons.current);
    commit(opsCreatePlan({ name: 'Next season', start, end }).ops);
    setSelected('next');
    toast(`Next season planned: ${shortDate(start)} – ${shortDate(end)}. Move goals into it, or commit ideas from your backlog.`);
  };

  const dnd = useGoalDrag((d, target) => {
    const goal = d.goal;
    const [kind, id, side] = target.split(':') as [string, string | undefined, string | undefined];
    if (kind === 'order' && id) {
      // Put the goal above or below a sibling in its own container.
      const siblings = (goal.group_id ? groups.find((g) => g.group.id === goal.group_id)?.members ?? [] : loose).map((p) => p.card.goal);
      const at = siblings.findIndex((g) => g.id === id);
      const beforeId = side === 'before' ? id : siblings[at + 1]?.id ?? null;
      const ops = placeAmong('goals', siblings, goal.id, beforeId);
      if (ops.length) commit(ops);
      return;
    }
    if (kind === 'gorder' && id && d.group) {
      const all = groups.map((g) => g.group);
      const at = all.findIndex((g) => g.id === id);
      const beforeId = side === 'before' ? id : all[at + 1]?.id ?? null;
      const ops = placeAmong('groups', all, d.group.id, beforeId);
      if (ops.length) commit(ops);
      return;
    }
    if (kind === 'already') {
      const plan = data.plans.find((x) => x.id === id);
      toast(`${d.group ? `${d.group.name}'s goals are` : `${goal.title} is`} already in ${plan?.id === seasons.current?.id ? 'this season' : plan?.id === seasons.next?.id ? 'next season' : plan?.name ?? 'that season'}`);
      return;
    }
    if (kind === 'plan' && id) {
      const plan = data.plans.find((x) => x.id === id);
      if (plan) setMovingGoals({ goals: d.goals, title: d.group?.name, dest: plan });
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
      toast(gone ? `${goal.title} taken out. ${name} is empty, so the group is gone.` : `${goal.title} taken out of ${name}`);
    }
  });

  const paths = pathsOf(data);
  const done = data.goals.filter((g) => g.completed_at && !g.archived_at).length;
  const archived = data.goals.filter((g) => g.archived_at).length;
  const pathList = (
    <div className="season-list">
      {[...paths.map((p) => ({ path: p, members: orderPlaced(inSeason.filter((m) => m.card.goal.path_id === p.id)) })), { path: null, members: orderPlaced(inSeason.filter((m) => !m.card.goal.path_id || !paths.some((p) => p.id === m.card.goal.path_id))) }]
        .filter((x) => x.members.length > 0 || x.path)
        .map(({ path, members }) => (
          <section
            key={path?.id ?? 'none'}
            className="season-card group-card"
            aria-label={path ? `${pathLetter(data, path)}: ${path.name}` : 'No path'}
            style={{ ['--group-gradient' as string]: groupGradient(path?.id ?? 'no-path', members.length ? members.map((m) => m.card.goal.color) : [path?.color ?? '#9aa0ae']) }}
          >
            <div className="season-card-head group-head">
              {path ? (
                <a href={href(`/paths/${path.id}`)} className="season-card-title">
                  <b>
                    {pathLetter(data, path)} · {path.name}
                  </b>
                  <span className="xsmall muted">
                    {members.length} goal{members.length === 1 ? '' : 's'}
                    {path.headline ? ` · ${path.headline}` : ''}
                  </span>
                  <span className="season-open">
                    Open <Icon name="chevron" size={14} stroke={2.4} />
                  </span>
                </a>
              ) : (
                <span className="season-card-title">
                  <b>No path</b>
                  <span className="xsmall muted">
                    {members.length} goal{members.length === 1 ? '' : 's'}
                  </span>
                </span>
              )}
            </div>
            {members.map((m) => (
              <GoalRow key={m.card.goal.id} placed={m} hidePath />
            ))}
            {members.length === 0 && <p className="small muted path-empty">No goals on this path this season.{path ? ' Its ideas wait in the backlog.' : ''}</p>}
          </section>
        ))}
    </div>
  );

  const list = by === 'path' && paths.length ? pathList : (
    <div className="season-list">
      {groups.map(({ group, members }) => (
        <GroupRowsCard key={group.id} group={group} members={members} dnd={dnd} onMove={setMoving} onMoveGroup={() => setMovingGoals({ goals: members.map((m) => m.card.goal), title: group.name, dest: null })} />
      ))}
      {(loose.length > 0 || (dnd.drag && !dnd.drag.group && dnd.drag.goal.group_id)) && <LooseCard title={groups.length ? 'Not in a group' : 'Your goals'} members={loose} dnd={dnd} onMove={setMoving} onNewGroup={(g) => setNaming([g])} />}
      {inSeason.length === 0 && selected === 'next' && (
        <div className="card small" style={{ color: 'var(--ink-2)' }}>
          Nothing in next season yet. Drag a goal or a group onto it on the horizon, use Move on a goal, or make a goal from your backlog for it.
        </div>
      )}
      {others.length > 0 && selected === 'current' && (
        <span className="xsmall muted">
          Also in other seasons: {others.map((o) => `${o.card.goal.title} (${o.plan.name})`).join(', ')}.
        </span>
      )}
    </div>
  );
  const side = season ? (
    <div className="season-side">
      <SeasonStats season={season} members={inSeason} />
      <SeasonStart plan={season} goals={inSeason.map((m) => m.card.goal)} />
      <div className="row-between" style={{ padding: '0 4px' }}>
        <span className="xsmall muted">The season on one page</span>
        <SeasonCardButton plan={season} goals={inSeason.map((m) => m.card.goal)} />
      </div>
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
            Nothing here yet. Goals start in the backlog: write ideas down, order them, and make the top ones goals. Most people carry 3–4 at a time.
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
          {paths.length > 0 && placed.length > 0 && (
            <div className="row-between" style={{ gap: 8 }}>
              <span className="xsmall muted">Group by</span>
              <div className="seg" role="radiogroup" aria-label="Group goals by">
                <button role="radio" aria-checked={by === 'group'} onClick={() => setBy('group')}>
                  Groups
                </button>
                <button role="radio" aria-checked={by === 'path'} onClick={() => setBy('path')}>
                  Paths
                </button>
              </div>
            </div>
          )}
          {list}
          <div className="row-start" style={{ gap: 8, alignItems: 'stretch' }}>
            <div className="grow">
              <IdeaAdd placeholder="Add a goal idea (it starts in your backlog)" after={(t) => toast(`${t} added to your backlog`)} />
            </div>
            <a className="btn" href={href('/goals/new')} style={{ flex: 'none' }}>
              Make a goal
            </a>
          </div>
          <div className="goals-more">
            <a href={href('/goals/completed')}>
              Done{archived ? ' & archived' : ''} <span className="count">{done + archived}</span>
            </a>
            <a href={href('/paths')}>
              Paths <span className="count">{paths.length}</span>
            </a>
          </div>
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
  // A goal that starts later gets its tasks when it starts.
  const noTasks = goals.find((g) => g.type !== 'number' && (view.planForGoal(g) ? view.startFor(g, view.planForGoal(g)!) <= today : true) && view.actionsForGoal(g.id).length === 0);
  if (noTasks) return { title: `Add daily tasks for ${noTasks.title}`, detail: 'Daily tasks on the goal page land on your Today list.', action: 'Add tasks', to: `/goals/${noTasks.id}` };
  const actionIds = new Set(goals.flatMap((g) => view.actionsForGoal(g.id, true).map((a) => a.id)));
  const checkedIn = data.sessions.some((x) => x.action_id && actionIds.has(x.action_id) && x.status !== 'planned' && x.status !== 'moved');
  const started = goals.some((g) => (view.planForGoal(g)?.start_date ?? today) <= today);
  if (!checkedIn && started) return { title: 'Do your first check-in', detail: 'Tick one thing off on Today. That starts your streak.', action: 'Open Today', to: '/today' };
  return null;
}

/** A season's settings: its dates, past seasons, and archiving. */
function BatchMenu({ plan, onClose }: { plan: Plan; onClose: () => void }) {
  const { data, today, commit } = useStore();
  const view = useView();
  const toast = useToast();
  const goals = view.goalsForPlan(plan.id);
  const past = data.plans.filter((p) => p.archived_at || p.end_date < today);
  const [adding, setAdding] = useState<{ goals: Goal[]; title?: string } | null>(null);
  // Goals in another season now, and groups with any goal outside this season.
  const elsewhere = view.activeGoals.filter((g) => currentWindow(data, g.id, today)?.id !== plan.id);
  const groupsOut = data.groups
    .map((gr) => ({ gr, members: view.activeGoals.filter((g) => g.group_id === gr.id) }))
    .filter(({ members }) => members.length > 1 && members.some((g) => currentWindow(data, g.id, today)?.id !== plan.id));
  return (
    <Sheet title={plan.name} onClose={onClose}>
      <span className="small muted" style={{ marginTop: -8 }}>
        Season · {shortDate(plan.start_date)} – {shortDate(plan.end_date)} · {goals.length} goal{goals.length === 1 ? '' : 's'}
      </span>
      <p className="small" style={{ margin: 0, color: 'var(--ink-2)' }}>
        A season is the review calendar: its goals share the 3-month checkpoint, the month reviews and the retrospective. Each goal keeps its own start and finish inside it.
      </p>
      {(elsewhere.length > 0 || groupsOut.length > 0) && (
        <div className="stack-sm">
          <span className="label">Add goals</span>
          <span className="xsmall muted">Moves a goal here from the season it's in now. Its daily tasks, dates and history stay. On the Goals page you can also drag a goal or a group onto this season.</span>
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
                <span className="xsmall muted">Now in {currentWindow(data, g.id, today)?.name ?? 'no season'}</span>
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
            Finished and archived seasons · {past.length}
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
      {adding && <MoveSheet goals={adding.goals} title={adding.title} initial={plan} onClose={() => setAdding(null)} />}
    </Sheet>
  );
}
