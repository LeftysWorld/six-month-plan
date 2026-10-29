import { useRef, useState, type FormEvent, type ReactNode } from 'react';
import { ageInDays, bucketOf, column, ideaReady, shortDate, type GoalGroup, type GoalIdea, type IdeaBucket } from '@six/core';
import { useStore } from '../data/store.tsx';
import { useView } from '../data/useView.ts';
import { opsAddIdea, opsDeleteIdea, opsEditIdea, opsPlaceIdea, opsRestoreIdea, opsSetStatus } from '../data/backlog.ts';
import { useListDrag, type ListDragApi } from '../components/listDrag.ts';
import { GRIP } from './Season.tsx';
import { href } from '../router.ts';
import { opsSetIdeaPath, pathLetter, pathsOf } from '../data/paths.ts';
import { Icon, Sheet, useToast } from '../components/ui.tsx';
import { ExperimentSheet } from '../components/PathExperiments.tsx';
import { StartAnywaySheet, WaitBadge, WaitPicker } from '../components/Waiting.tsx';
import { ideaWait, opsSetWaiting, waitOf, waitValue } from '../data/waiting.ts';
import { groupIdeas } from '../data/groups.ts';
import { groupGradient } from '../data/palette.ts';

/**
 * The Goals hub's three views of the same goals, in the order a goal moves: Backlog (ideas, selected
 * for next, and ideas waiting on something), Now (what's running, by group or by path) and Roadmap
 * (their dates, and ideas planned into a season). Completed and Paths aren't tabs: they're a link and a lens from Now.
 */
export function GoalsSwitch({ current }: { current: 'goals' | 'timeline' | 'backlog' | null }) {
  const { data } = useStore();
  const view = useView();
  const goals = view.activeGoals.length;
  const later = data.ideas.filter((i) => i.status === 'backlog').length;
  const tab = (key: NonNullable<typeof current>, to: string, label: string, count: number | null) => (
    <a href={href(to)} aria-current={current === key ? 'page' : undefined}>
      {label}
      {count != null && <span className="count"> {count}</span>}
    </a>
  );
  return (
    <nav className="seg goals-switch" aria-label="Backlog, now or roadmap">
      {tab('backlog', '/goals/backlog', 'Backlog', later)}
      {tab('goals', '/goals', 'Now', goals)}
      {tab('timeline', '/goals/roadmap', 'Roadmap', null)}
    </nav>
  );
}

/** A one-line "add a goal idea" box. New goals can start here, or be made straight away. */
export function IdeaAdd({ placeholder = 'A goal you might want…', after, pathId = null }: { placeholder?: string; after?: (title: string) => void; pathId?: string | null }) {
  const { data, commit } = useStore();
  const toast = useToast();
  const [title, setTitle] = useState('');
  const input = useRef<HTMLInputElement>(null);
  function add(e: FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    // Same name as a goal you're working on, or an idea already waiting? Say so instead of making a copy.
    const key = title.trim().toLowerCase();
    const goal = data.goals.find((g) => !g.archived_at && !g.completed_at && g.title.trim().toLowerCase() === key);
    const idea = data.ideas.find((i) => i.status === 'backlog' && i.title.trim().toLowerCase() === key);
    if (goal || idea) {
      toast(goal ? `You already have a goal called “${goal.title}”` : `“${idea!.title}” is already in your backlog`);
      return;
    }
    const added = opsAddIdea(data, title);
    commit(pathId ? [...added.ops, { kind: 'update', collection: 'ideas', id: added.idea.id, patch: { path_id: pathId } }] : added.ops);
    if (after) after(title.trim());
    else toast('Added to the backlog');
    setTitle('');
    input.current?.focus();
  }
  return (
    <form className="idea-add" onSubmit={add}>
      <label className="visually-hidden" htmlFor="idea-title">
        New goal idea
      </label>
      <input id="idea-title" ref={input} value={title} onChange={(e) => setTitle(e.target.value)} placeholder={placeholder} autoComplete="off" />
      <button className="btn primary small" type="submit" disabled={!title.trim()}>
        <Icon name="plus" size={16} stroke={2.4} /> Add
      </button>
    </form>
  );
}

/**
 * The backlog, in two buckets. **Backlog**: every goal you might want, one line each, in the order
 * you'd start them — add fast, order by dragging, tap to fill in why and what done looks like.
 * **Selected for next**: the few you've refined and mean to start when there's room; they're not
 * goals yet. The rule to cross over is simple and visible: an idea needs its why and its done-means.
 * Make it a goal from there. Discarded ideas are kept, folded away.
 */
export function Backlog() {
  const { data, commit } = useStore();
  const view = useView();
  const toast = useToast();
  const [editing, setEditing] = useState<GoalIdea | null>(null);
  const paths = pathsOf(data);
  const [pathFilter, setPathFilter] = useState<string | 'all' | 'none'>('all');
  const byPath = (list: GoalIdea[]) => (pathFilter === 'all' ? list : pathFilter === 'none' ? list.filter((i) => !i.path_id) : list.filter((i) => i.path_id === pathFilter));
  const allIdeas = column(data.ideas, 'backlog');
  const allSelected = column(data.ideas, 'selected');
  const ideas = byPath(allIdeas);
  const selected = byPath(allSelected);
  const discarded = column(data.ideas, 'discarded');
  const initial = (data.profile.display_name || 'You').trim().charAt(0).toUpperCase();
  const running = view.activeGoals.length;

  const dnd = useListDrag((id, drop) => {
    const idea = data.ideas.find((i) => i.id === id);
    if (!idea) return;
    const bucket = drop.bucket as IdeaBucket;
    if (bucket === 'selected' && bucketOf(idea) !== 'selected' && !ideaReady(idea)) {
      toast(`${idea.title} needs its why and what done looks like before it's selected. Tap it to add them.`);
      return;
    }
    // Index is within the full bucket; with a path filter on, map it onto the filtered list's neighbour.
    const full = column(data.ideas, bucket);
    const shown = byPath(full);
    const neighbour = drop.rowId ? full.findIndex((i) => i.id === drop.rowId) : -1;
    const index = drop.rowId ? (drop.side === 'before' ? neighbour : neighbour + 1) : full.length;
    void shown;
    commit(opsPlaceIdea(data, idea, bucket, index));
  });

  function discard(idea: GoalIdea) {
    commit(opsSetStatus(data, idea, 'discarded'));
    toast(`${idea.title} discarded`, () => commit(opsRestoreIdea(idea)));
  }
  function restore(idea: GoalIdea) {
    commit(opsSetStatus(data, idea, 'backlog'));
    toast(`${idea.title} is back in your backlog`, () => commit(opsRestoreIdea(idea)));
  }
  function select(idea: GoalIdea) {
    if (!ideaReady(idea)) {
      setEditing(idea);
      return;
    }
    commit(opsSetStatus(data, idea, 'selected', 'end'));
    toast(`${idea.title} selected for next`, () => commit(opsRestoreIdea(idea)));
  }
  function unselect(idea: GoalIdea) {
    commit(opsSetStatus(data, idea, 'backlog', 'top'));
    toast(`${idea.title} is back in the backlog`, () => commit(opsRestoreIdea(idea)));
  }
  const dragging = dnd.drag ? data.ideas.find((i) => i.id === dnd.drag!.id) : null;

  /** A bucket's ideas with each group's ideas together, where its first one sits; numbers stay the bucket order. */
  function grouped(list: GoalIdea[]): ({ kind: 'idea'; idea: GoalIdea; i: number } | { kind: 'group'; group: GoalGroup; ideas: { idea: GoalIdea; i: number }[] })[] {
    const out: ({ kind: 'idea'; idea: GoalIdea; i: number } | { kind: 'group'; group: GoalGroup; ideas: { idea: GoalIdea; i: number }[] })[] = [];
    const seen = new Set<string>();
    list.forEach((idea, i) => {
      const group = idea.group_id ? data.groups.find((g) => g.id === idea.group_id) : undefined;
      if (!group) return out.push({ kind: 'idea', idea, i });
      if (seen.has(group.id)) return;
      seen.add(group.id);
      out.push({ kind: 'group', group, ideas: list.map((x, j) => ({ idea: x, i: j })).filter((x) => x.idea.group_id === group.id) });
    });
    return out;
  }

  return (
    <div className="stack rise">
      <div className="topbar">
        <span className="mono">
          {allIdeas.length} idea{allIdeas.length === 1 ? '' : 's'} · {allSelected.length} selected · {running} goal{running === 1 ? '' : 's'} running
        </span>
        <a className="avatar" href={href('/settings')} aria-label="Settings">
          {initial}
        </a>
      </div>
      <h1 style={{ marginTop: -4 }}>Goals</h1>
      <GoalsSwitch current="backlog" />

      <IdeaAdd pathId={pathFilter !== 'all' && pathFilter !== 'none' ? pathFilter : null} />

      {paths.length > 0 && (
        <div className="chips" role="radiogroup" aria-label="Show ideas for">
          <button type="button" className="chip" role="radio" aria-checked={pathFilter === 'all'} onClick={() => setPathFilter('all')}>
            All · {allIdeas.length + allSelected.length}
          </button>
          {paths.map((p) => (
            <button key={p.id} type="button" className="chip" role="radio" aria-checked={pathFilter === p.id} onClick={() => setPathFilter(p.id)} style={{ display: 'inline-flex', alignItems: 'center', gap: 7 }}>
              <span className="dot" style={{ width: 7, height: 7, background: p.color }} />
              {pathLetter(data, p)} · {[...allIdeas, ...allSelected].filter((i) => i.path_id === p.id).length}
            </button>
          ))}
          {[...allIdeas, ...allSelected].some((i) => !i.path_id) && (
            <button type="button" className="chip" role="radio" aria-checked={pathFilter === 'none'} onClick={() => setPathFilter('none')}>
              No path · {[...allIdeas, ...allSelected].filter((i) => !i.path_id).length}
            </button>
          )}
        </div>
      )}

      {/* Bucket 2: selected for next */}
      <section className={`card tight stack-sm bucket selected${dnd.drag?.drop?.bucket === 'selected' && !dnd.drag.drop.rowId ? ' drop-on' : ''}`} aria-label="Selected for next" data-bucket-drop="selected">
        <div className="row-between bucket-head">
          <span className="label">Selected for next · {selected.length}</span>
          <span className="xsmall muted">Refined, not started. Make one a goal when there's room.</span>
        </div>
        {selected.length === 0 && (
          <span className="small muted" style={{ padding: '6px 2px 10px' }}>
            {dragging && bucketOf(dragging) !== 'selected' ? (ideaReady(dragging) ? 'Drop here to select it.' : 'Needs its why and done-means first.') : 'Nothing selected yet. Drag a refined idea here, or use Select on it.'}
          </span>
        )}
        {grouped(selected).map((item) =>
          item.kind === 'group' ? (
            <IdeaGroupBlock key={`g-${item.group.id}`} group={item.group} count={item.ideas.length}>
              {item.ideas.map(({ idea, i }) => (
                <IdeaRow key={idea.id} idea={idea} index={i} bucket="selected" dnd={dnd} onEdit={() => setEditing(idea)} onDiscard={() => discard(idea)} onUnselect={() => unselect(idea)} />
              ))}
            </IdeaGroupBlock>
          ) : (
            <IdeaRow key={item.idea.id} idea={item.idea} index={item.i} bucket="selected" dnd={dnd} onEdit={() => setEditing(item.idea)} onDiscard={() => discard(item.idea)} onUnselect={() => unselect(item.idea)} />
          ),
        )}
        {running >= 4 && selected.length > 0 && <span className="xsmall muted" style={{ padding: '4px 2px' }}>You have {running} goals running. Finishing one before starting another usually goes better.</span>}
      </section>

      {/* Bucket 1: the backlog */}
      <section className={`card tight stack-sm bucket${dnd.drag?.drop?.bucket === 'backlog' && !dnd.drag.drop.rowId ? ' drop-on' : ''}`} aria-label="Backlog" data-bucket-drop="backlog">
        <div className="row-between bucket-head">
          <span className="label">Backlog · {ideas.length}</span>
          <span className="xsmall muted">Order by dragging · tap to fill in</span>
        </div>
        {ideas.length === 0 && (
          <span className="small muted" style={{ padding: '6px 2px 10px' }}>
            {pathFilter !== 'all' ? 'Nothing here for this path.' : 'Write down goals you might want, one line each. Order them, then fill in why and what done looks like before selecting one.'}
          </span>
        )}
        {grouped(ideas).map((item) =>
          item.kind === 'group' ? (
            <IdeaGroupBlock key={`g-${item.group.id}`} group={item.group} count={item.ideas.length}>
              {item.ideas.map(({ idea, i }) => (
                <IdeaRow key={idea.id} idea={idea} index={i} bucket="backlog" dnd={dnd} onEdit={() => setEditing(idea)} onDiscard={() => discard(idea)} onSelect={() => select(idea)} />
              ))}
            </IdeaGroupBlock>
          ) : (
            <IdeaRow key={item.idea.id} idea={item.idea} index={item.i} bucket="backlog" dnd={dnd} onEdit={() => setEditing(item.idea)} onDiscard={() => discard(item.idea)} onSelect={() => select(item.idea)} />
          ),
        )}
      </section>

      {discarded.length > 0 && (
        <details>
          <summary className="label" style={{ cursor: 'pointer', minHeight: 32, display: 'flex', alignItems: 'center' }}>
            Discarded · {discarded.length}
          </summary>
          <div className="stack-sm" style={{ marginTop: 6 }}>
            {discarded.map((idea) => (
              <div key={idea.id} className="list-row small" style={{ gap: 8 }}>
                <span className="grow muted" style={{ textDecoration: 'line-through' }}>
                  {idea.title}
                </span>
                <button className="link-btn small" onClick={() => restore(idea)}>
                  Bring back
                </button>
                <button
                  className="link-btn small"
                  onClick={() => {
                    commit(opsDeleteIdea(idea));
                    toast(`Deleted ${idea.title}`, () => commit([{ kind: 'insert', collection: 'ideas', rows: [idea as unknown as { id: string } & Record<string, unknown>] }]));
                  }}
                >
                  Delete
                </button>
              </div>
            ))}
          </div>
        </details>
      )}

      {dnd.drag && dragging && (
        <div className="drag-ghost" style={{ left: dnd.drag.x, top: dnd.drag.y }} aria-hidden="true">
          {dragging.title}
          {dnd.drag.drop && (
            <span className="drag-ghost-hint">
              {dnd.drag.drop.bucket !== bucketOf(dragging) ? (dnd.drag.drop.bucket === 'selected' ? (ideaReady(dragging) ? 'Select for next' : 'Needs why + done-means') : 'Back to the backlog') : dnd.drag.drop.side === 'before' ? 'Move above' : 'Move below'}
            </span>
          )}
        </div>
      )}

      {editing && <IdeaSheet idea={editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

/**
 * A group's ideas in the backlog, under the group's tinted header: its name, what it waits on, the
 * season they're planned for, and a link to the group. Each idea becomes a goal in the group.
 */
function IdeaGroupBlock({ group, count, children }: { group: GoalGroup; count: number; children: ReactNode }) {
  const { data, today } = useStore();
  const ideas = groupIdeas(data, group.id);
  const wait = waitOf(data, group, today);
  const plans = [...new Set(ideas.map((i) => i.plan_id).filter((x): x is string => !!x))].map((id) => data.plans.find((p) => p.id === id)).filter((p): p is NonNullable<typeof p> => !!p);
  const pathIds = [...new Set(ideas.map((i) => i.path_id).filter((x): x is string => !!x))];
  const path = pathIds.length === 1 ? data.paths.find((p) => p.id === pathIds[0] && !p.archived_at) : undefined;
  const goals = data.goals.filter((g) => g.group_id === group.id && !g.archived_at).length;
  return (
    <section className="idea-group" style={{ ['--group-gradient' as string]: groupGradient(group.id, data.goals.filter((g) => g.group_id === group.id).map((g) => g.color).concat(path ? [path.color] : ['#9aa0ae'])) }} aria-label={`Group: ${group.name}`}>
      <a className="idea-group-head" href={href(`/goals/group/${group.id}`)}>
        <span className="grow" style={{ minWidth: 0 }}>
          <b>{group.name}</b>
          <span className="xsmall muted" style={{ display: 'block' }}>
            {count} idea{count === 1 ? '' : 's'} here{goals ? ` · ${goals} goal${goals === 1 ? '' : 's'} running` : ''}
            {path ? ` · ${pathLetter(data, path)}` : ''}
            {plans.length ? ` · planned for ${plans.map((p) => p.name).join(', ')}` : ''}
          </span>
          {wait && <WaitBadge info={wait} />}
        </span>
        <span className="season-open">
          Open <Icon name="chevron" size={14} stroke={2.4} />
        </span>
      </a>
      {children}
    </section>
  );
}

/** One idea: a handle to drag, its place, title and why; then what to do with it for the bucket it's in. */
function IdeaRow({
  idea,
  index,
  bucket,
  dnd,
  onEdit,
  onDiscard,
  onSelect,
  onUnselect,
}: {
  idea: GoalIdea;
  index: number;
  bucket: IdeaBucket;
  dnd: ListDragApi;
  onEdit: () => void;
  onDiscard: () => void;
  onSelect?: () => void;
  onUnselect?: () => void;
}) {
  const { data, today } = useStore();
  const path = idea.path_id ? data.paths.find((p) => p.id === idea.path_id && !p.archived_at) : undefined;
  const wait = ideaWait(data, idea, today);
  const waiting = !!wait && !wait.met;
  const [startAnyway, setStartAnyway] = useState(false);
  const age = ageInDays(idea);
  const plannedFor = idea.plan_id ? data.plans.find((p) => p.id === idea.plan_id) : undefined;
  const ready = ideaReady(idea);
  const lifted = dnd.drag?.id === idea.id;
  const drop = dnd.drag?.drop;
  const insert = drop?.rowId === idea.id ? (drop.side === 'before' ? ' insert-before' : ' insert-after') : '';
  return (
    <div
      className={`idea-row${lifted ? ' lifted' : ''}${insert}`}
      data-row-id={idea.id}
      data-bucket={bucket}
      data-index={index}
      onPointerDown={(e) => {
        if ((e.target as HTMLElement).closest('button, a')) return;
        dnd.start(e, idea.id);
      }}
    >
      <button type="button" className="season-grip idea-grip" aria-label={`Drag ${idea.title} to reorder`} onPointerDown={(e) => (e.stopPropagation(), dnd.start(e, idea.id, true))} onClick={() => dnd.consumeClick()}>
        {GRIP}
      </button>
      <button type="button" className="idea-main" onClick={() => !dnd.consumeClick() && onEdit()} aria-label={`Edit ${idea.title}`}>
        <span className="idea-title">
          <span className="mono" style={{ marginRight: 8 }}>{index + 1}</span>
          {idea.title}
          {path && (
            <span className="path-chip" title={path.name} style={{ marginLeft: 8, verticalAlign: 'middle' }}>
              <i style={{ background: path.color }} />
              {pathLetter(data, path).replace('Plan ', '')}
            </span>
          )}
        </span>
        <span className="xsmall muted">
          {bucket === 'selected' ? (idea.done_means?.trim() ? `Done: ${idea.done_means.trim()}` : idea.note.trim()) : idea.note.trim() ? idea.note.trim() : 'Tap to say why it matters'}
          {bucket === 'backlog' && idea.note.trim() && !idea.done_means?.trim() ? ' · what does done look like?' : ''}
          {age >= 60 ? ` · written down ${age} days ago` : ''}
        </span>
        {plannedFor && (
          <span className="xsmall" style={{ color: 'var(--ink-2)' }}>
            Planned: {plannedFor.name}
            {idea.planned_start ? ` · ${shortDate(idea.planned_start)} – ${shortDate(idea.planned_end ?? plannedFor.end_date)}` : ''}
          </span>
        )}
        {wait && !idea.group_id && <WaitBadge info={wait} />}
      </button>
      <span className="idea-actions">
        {bucket === 'selected' ? (
          <>
            {waiting ? (
              <button type="button" className="btn small" onClick={() => setStartAnyway(true)} title={`Waiting on ${wait!.label}`}>
                Start anyway
              </button>
            ) : (
              <a className="btn small primary" href={href(`/goals/new?idea=${idea.id}`)}>
                Make it a goal
              </a>
            )}
            <button type="button" className="link-btn small" onClick={onUnselect}>
              Back to backlog
            </button>
          </>
        ) : (
          <>
            <button type="button" className={`btn small${ready ? ' primary' : ''}`} onClick={onSelect} title={ready ? 'Move to Selected for next' : 'Add why it matters and what done looks like first'}>
              {ready ? 'Select for next' : 'Fill in to select'}
            </button>
            <button type="button" className="link-btn small" onClick={onDiscard}>
              Discard
            </button>
          </>
        )}
      </span>
      {startAnyway && wait && <StartAnywaySheet idea={idea} info={wait} onClose={() => setStartAnyway(false)} />}
    </div>
  );
}

/** Edit an idea: its name, why it matters, what done looks like. */
function IdeaSheet({ idea, onClose }: { idea: GoalIdea; onClose: () => void }) {
  const { data, commit } = useStore();
  const toast = useToast();
  const paths = pathsOf(data);
  const [pathId, setPathId] = useState(idea.path_id ?? '');
  const [trying, setTrying] = useState(false);
  const [title, setTitle] = useState(idea.title);
  const [note, setNote] = useState(idea.note);
  const [done, setDone] = useState(idea.done_means ?? '');
  const { today } = useStore();
  const [waitsOn, setWaitsOn] = useState(waitValue(idea));
  // Its group (an existing one, or a new one named here) and the season it's planned for.
  const [groupId, setGroupId] = useState<string>(idea.group_id ?? '');
  const [newGroup, setNewGroup] = useState('');
  const seasons = data.plans.filter((p) => !p.archived_at && p.end_date >= today).sort((a, b) => (a.start_date < b.start_date ? -1 : 1));
  const [planId, setPlanId] = useState<string>(idea.plan_id ?? '');
  const planned = seasons.find((p) => p.id === planId);
  const [pStart, setPStart] = useState<string>(idea.planned_start ?? '');
  const [pEnd, setPEnd] = useState<string>(idea.planned_end ?? '');
  const wait = ideaWait(data, idea, today);
  const waiting = !!wait && !wait.met && waitsOn === waitValue(idea);
  const [startAnyway, setStartAnyway] = useState(false);
  return (
    <Sheet title="Goal idea" onClose={onClose}>
      <label className="field">
        Idea
        <input value={title} onChange={(e) => setTitle(e.target.value)} autoFocus />
      </label>
      <label className="field">
        Why it matters
        <textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="One line for the hard days" />
      </label>
      <label className="field">
        What done looks like in six months
        <input value={done} onChange={(e) => setDone(e.target.value)} placeholder="e.g. Three songs recorded start to finish" />
      </label>
      {paths.length > 0 && (
        <label className="field">
          Path
          <select value={pathId} onChange={(e) => setPathId(e.target.value)}>
            <option value="">No path</option>
            {paths.map((p) => (
              <option key={p.id} value={p.id}>
                {pathLetter(data, p)} · {p.name}
              </option>
            ))}
          </select>
        </label>
      )}
      {pathId && paths.find((p) => p.id === pathId) && (
        <div className="row-start" style={{ gap: 8 }}>
          <button type="button" className="btn small" onClick={() => setTrying(true)}>
            Try it small: an experiment
          </button>
          {waiting ? (
            <button type="button" className="btn small" onClick={() => setStartAnyway(true)}>
              Start anyway
            </button>
          ) : (
            <a className="btn small" href={href(`/goals/new?idea=${idea.id}&path=${pathId}`)}>
              Make it a goal
            </a>
          )}
        </div>
      )}
      <label className="field">
        Group
        <select value={groupId} onChange={(e) => setGroupId(e.target.value)}>
          <option value="">No group</option>
          {data.groups.map((g) => (
            <option key={g.id} value={g.id}>
              {g.name}
            </option>
          ))}
          <option value="__new">New group…</option>
        </select>
      </label>
      {groupId === '__new' && <input className="input" aria-label="New group name" value={newGroup} onChange={(e) => setNewGroup(e.target.value)} placeholder="Glamping Site" />}
      <label className="field">
        Planned for
        <select
          value={planId}
          onChange={(e) => {
            setPlanId(e.target.value);
            setPStart('');
            setPEnd('');
          }}
        >
          <option value="">Not planned yet</option>
          {seasons.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}{p.name.includes(shortDate(p.start_date)) ? '' : ` · ${shortDate(p.start_date)} – ${shortDate(p.end_date)}`}
            </option>
          ))}
        </select>
        <span className="xsmall muted" style={{ fontWeight: 400 }}>
          A planned idea shows on that season's Roadmap as a dashed bar. It's still an idea until you make it a goal.
        </span>
      </label>
      {planned && (
        <div className="grid-2">
          <label className="field">
            From
            <input type="date" value={pStart} min={planned.start_date} max={planned.end_date} onChange={(e) => setPStart(e.target.value)} />
          </label>
          <label className="field">
            To
            <input type="date" value={pEnd} min={pStart || planned.start_date} max={planned.end_date} onChange={(e) => setPEnd(e.target.value)} />
          </label>
        </div>
      )}
      {groupId ? null : <WaitPicker value={waitsOn} onChange={setWaitsOn} />}
      {groupId && groupId !== '__new' && <span className="xsmall muted">It waits on whatever its group waits on (set that in the group's Edit).</span>}
      {wait && waitsOn === waitValue(idea) && <WaitBadge info={wait} />}
      {startAnyway && wait && <StartAnywaySheet idea={idea} info={wait} onClose={() => setStartAnyway(false)} />}
      {trying && paths.find((p) => p.id === pathId) && <ExperimentSheet path={paths.find((p) => p.id === pathId)!} title={title} onClose={() => setTrying(false)} />}
      <div className="btn-row">
        <button type="button" className="btn" onClick={onClose}>
          Cancel
        </button>
        <button
          type="button"
          className="btn primary"
          disabled={!title.trim()}
          onClick={() => {
            const ops = [...opsEditIdea(idea, { title, note, done_means: done }), ...opsSetIdeaPath(idea, pathId || null), ...opsSetWaiting('ideas', idea, groupId ? '' : waitsOn)];
            let gid: string | null = groupId || null;
            if (groupId === '__new') {
              gid = newGroup.trim() ? crypto.randomUUID() : null;
              if (gid) ops.push({ kind: 'insert', collection: 'groups', rows: [{ id: gid, name: newGroup.trim(), created_at: new Date().toISOString() }] });
            }
            const planPatch = { group_id: gid, plan_id: planned ? planned.id : null, planned_start: planned && pStart ? pStart : null, planned_end: planned && pEnd ? pEnd : null };
            if ((idea.group_id ?? null) !== planPatch.group_id || (idea.plan_id ?? null) !== planPatch.plan_id || (idea.planned_start ?? null) !== planPatch.planned_start || (idea.planned_end ?? null) !== planPatch.planned_end) {
              ops.push({ kind: 'update', collection: 'ideas', id: idea.id, patch: planPatch });
            }
            if (ops.length) {
              commit(ops);
              toast('Idea saved', () => commit(opsRestoreIdea(idea)));
            }
            onClose();
          }}
        >
          Save
        </button>
      </div>
    </Sheet>
  );
}
