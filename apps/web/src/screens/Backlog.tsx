import { useRef, useState, type FormEvent } from 'react';
import { ageInDays, bucketOf, column, ideaReady, type GoalIdea, type IdeaBucket } from '@six/core';
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
import { opsSetWaiting, waitOf, waitValue } from '../data/waiting.ts';

/**
 * The Goals hub's three views of the same goals: Now (what's running, by group or by path),
 * Timeline (their dates) and Later (the backlog, including ideas waiting on something). Completed
 * and Paths aren't tabs: they're a link and a lens from Now.
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
    <nav className="seg goals-switch" aria-label="Now, timeline or later">
      {tab('goals', '/goals', 'Now', goals)}
      {tab('timeline', '/goals/timeline', 'Timeline', null)}
      {tab('backlog', '/goals/backlog', 'Later', later)}
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
        {selected.map((idea, i) => (
          <IdeaRow key={idea.id} idea={idea} index={i} bucket="selected" dnd={dnd} onEdit={() => setEditing(idea)} onDiscard={() => discard(idea)} onUnselect={() => unselect(idea)} />
        ))}
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
        {ideas.map((idea, i) => (
          <IdeaRow key={idea.id} idea={idea} index={i} bucket="backlog" dnd={dnd} onEdit={() => setEditing(idea)} onDiscard={() => discard(idea)} onSelect={() => select(idea)} />
        ))}
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
  const wait = waitOf(data, idea, today);
  const waiting = !!wait && !wait.met;
  const [startAnyway, setStartAnyway] = useState(false);
  const age = ageInDays(idea);
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
        {wait && <WaitBadge info={wait} />}
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
  const wait = waitOf(data, idea, today);
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
      <WaitPicker value={waitsOn} onChange={setWaitsOn} />
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
            const ops = [...opsEditIdea(idea, { title, note, done_means: done }), ...opsSetIdeaPath(idea, pathId || null), ...opsSetWaiting('ideas', idea, waitsOn)];
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
