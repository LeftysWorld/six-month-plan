import { useRef, useState, type FormEvent } from 'react';
import { ageInDays, column, type GoalIdea } from '@six/core';
import { useStore } from '../data/store.tsx';
import { useView } from '../data/useView.ts';
import { opsAddIdea, opsDeleteIdea, opsEditIdea, opsMoveIdea, opsRestoreIdea, opsSetStatus } from '../data/backlog.ts';
import { href } from '../router.ts';
import { opsSetIdeaPath, pathLetter, pathsOf } from '../data/paths.ts';
import { Icon, Sheet, useToast } from '../components/ui.tsx';
import { ExperimentSheet } from '../components/PathExperiments.tsx';

/** Backlog → Goals → Completed: the flow of a goal, left to right (shown on all three pages). */
export function GoalsSwitch({ current }: { current: 'paths' | 'backlog' | 'goals' | 'completed' }) {
  const { data } = useStore();
  const view = useView();
  const goals = view.activeGoals.length;
  const waiting = data.ideas.filter((i) => i.status === 'backlog').length;
  const done = data.goals.filter((g) => g.completed_at && !g.archived_at).length;
  const archived = data.goals.filter((g) => g.archived_at).length;
  const paths = data.paths.filter((p) => !p.archived_at).length;
  const tab = (key: typeof current, to: string, label: string, count: number) => (
    <a href={href(to)} aria-current={current === key ? 'page' : undefined}>
      {label} <span className="count">{count}</span>
    </a>
  );
  return (
    <nav className="seg goals-switch" aria-label="Paths, backlog, goals or completed">
      {tab('paths', '/paths', 'Paths', paths)}
      {tab('backlog', '/goals/backlog', 'Backlog', waiting)}
      {tab('goals', '/goals', 'Goals', goals)}
      {tab('completed', '/goals/completed', archived ? 'Done & archived' : 'Completed', done + archived)}
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
 * The backlog: one list of goal ideas in the order you'd start them. Write them down, order them,
 * and when there's room, make the top one a goal. Discarded ideas are kept, folded away.
 */
export function Backlog() {
  const { data, commit } = useStore();
  const view = useView();
  const toast = useToast();
  const [editing, setEditing] = useState<GoalIdea | null>(null);
  const paths = pathsOf(data);
  const [pathFilter, setPathFilter] = useState<string | 'all' | 'none'>('all');
  const allIdeas = column(data.ideas, 'backlog');
  const ideas = pathFilter === 'all' ? allIdeas : pathFilter === 'none' ? allIdeas.filter((i) => !i.path_id) : allIdeas.filter((i) => i.path_id === pathFilter);
  const discarded = column(data.ideas, 'discarded');
  const initial = (data.profile.display_name || 'You').trim().charAt(0).toUpperCase();
  const running = view.activeGoals.length;

  function discard(idea: GoalIdea) {
    commit(opsSetStatus(data, idea, 'discarded'));
    toast(`${idea.title} discarded`, () => commit(opsRestoreIdea(idea)));
  }
  function restore(idea: GoalIdea) {
    commit(opsSetStatus(data, idea, 'backlog'));
    toast(`${idea.title} is back in your backlog`, () => commit(opsRestoreIdea(idea)));
  }

  return (
    <div className="stack rise">
      <div className="topbar">
        <span className="mono">
          {ideas.length} idea{ideas.length === 1 ? '' : 's'} · {running} goal{running === 1 ? '' : 's'} running
        </span>
        <a className="avatar" href={href('/settings')} aria-label="Settings">
          {initial}
        </a>
      </div>
      <h1 style={{ marginTop: -4 }}>Backlog</h1>
      <GoalsSwitch current="backlog" />

      <IdeaAdd pathId={pathFilter !== 'all' && pathFilter !== 'none' ? pathFilter : null} />

      {paths.length > 0 && (
        <div className="chips" role="radiogroup" aria-label="Show ideas for">
          <button type="button" className="chip" role="radio" aria-checked={pathFilter === 'all'} onClick={() => setPathFilter('all')}>
            All · {allIdeas.length}
          </button>
          {paths.map((p) => (
            <button key={p.id} type="button" className="chip" role="radio" aria-checked={pathFilter === p.id} onClick={() => setPathFilter(p.id)} style={{ display: 'inline-flex', alignItems: 'center', gap: 7 }}>
              <span className="dot" style={{ width: 7, height: 7, background: p.color }} />
              {pathLetter(data, p)} · {allIdeas.filter((i) => i.path_id === p.id).length}
            </button>
          ))}
          {allIdeas.some((i) => !i.path_id) && (
            <button type="button" className="chip" role="radio" aria-checked={pathFilter === 'none'} onClick={() => setPathFilter('none')}>
              No path · {allIdeas.filter((i) => !i.path_id).length}
            </button>
          )}
        </div>
      )}

      {ideas.length === 0 ? (
        <div className="card empty">
          <h3 style={{ marginBottom: 6 }}>Nothing waiting{pathFilter !== 'all' ? ' here' : ''}.</h3>
          Write down goals you might want, one line each. Order them; make the top one a goal when you have room (most people carry 3–4 at a time).
        </div>
      ) : (
        <section className="card tight stack-sm" aria-label="Ideas in order">
          {ideas.map((idea, i) => (
            <IdeaRow key={idea.id} idea={idea} index={i} count={ideas.length} onEdit={() => setEditing(idea)} onDiscard={() => discard(idea)} />
          ))}
          {running >= 4 && <span className="xsmall muted" style={{ padding: '4px 2px' }}>You have {running} goals running. Finishing one before starting another usually goes better.</span>}
        </section>
      )}

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

      {editing && <IdeaSheet idea={editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

/** One idea: its place, title, why, and what to do with it: make it a goal, edit, move, discard. */
function IdeaRow({ idea, index, count, onEdit, onDiscard }: { idea: GoalIdea; index: number; count: number; onEdit: () => void; onDiscard: () => void }) {
  const { data, commit } = useStore();
  const path = idea.path_id ? data.paths.find((p) => p.id === idea.path_id && !p.archived_at) : undefined;
  const move = (dir: 'up' | 'down' | 'top') => commit(opsMoveIdea(data, idea.id, dir));
  const age = ageInDays(idea);
  return (
    <div className="idea-row">
      <span className="idea-moves" aria-label="Reorder">
        <button type="button" className="icon-btn" aria-label={`Move ${idea.title} up`} disabled={index === 0} onClick={() => move('up')}>
          <Icon name="chevron" size={14} stroke={2.4} />
        </button>
        <button type="button" className="icon-btn down" aria-label={`Move ${idea.title} down`} disabled={index === count - 1} onClick={() => move('down')}>
          <Icon name="chevron" size={14} stroke={2.4} />
        </button>
      </span>
      <button type="button" className="idea-main" onClick={onEdit} aria-label={`Edit ${idea.title}`}>
        <span className="idea-title">
          <span className="mono" style={{ marginRight: 8 }}>{index + 1}</span>
          {idea.title}
          {path && <span className="dot" title={`${pathLetter(data, path)} · ${path.name}`} style={{ width: 7, height: 7, background: path.color, marginLeft: 8, verticalAlign: 'middle' }} />}
        </span>
        <span className="xsmall muted">
          {idea.note.trim() ? idea.note.trim() : 'Tap to say why it matters'}
          {age >= 60 ? ` · written down ${age} days ago` : ''}
        </span>
      </button>
      <span className="idea-actions">
        <a className="btn small primary" href={href(`/goals/new?idea=${idea.id}`)}>
          Make it a goal
        </a>
        <button type="button" className="link-btn small" onClick={onDiscard}>
          Discard
        </button>
      </span>
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
          <a className="btn small" href={href(`/goals/new?idea=${idea.id}&path=${pathId}`)}>
            Make it a goal
          </a>
        </div>
      )}
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
            const ops = [...opsEditIdea(idea, { title, note, done_means: done }), ...opsSetIdeaPath(idea, pathId || null)];
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
