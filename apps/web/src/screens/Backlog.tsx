import { useRef, useState, type FormEvent } from 'react';
import { ageInDays, column, hasRoom, quarterRange, readinessGaps, shortDate, SELECTED_LIMIT, type GoalIdea } from '@six/core';
import { useStore } from '../data/store.tsx';
import { useView } from '../data/derive.ts';
import { opsAddIdea, opsDeleteIdea, opsEditIdea, opsMoveIdea, opsRestoreIdea, opsSetStatus } from '../data/backlog.ts';
import { withOps } from '../data/breakdown.ts';
import type { Op } from '../data/model.ts';
import { href, navigate } from '../router.ts';
import { Icon, useToast } from '../components/ui.tsx';

/** Backlog → Goals → Completed: the flow of a goal, left to right (shown on all three pages). */
export function GoalsSwitch({ current }: { current: 'backlog' | 'goals' | 'completed' }) {
  const { data } = useStore();
  const view = useView();
  const plan = view.mainPlan;
  const goals = plan ? view.goalsForPlan(plan.id).length : data.goals.filter((g) => !g.archived_at && !g.completed_at).length;
  const waiting = data.ideas.filter((i) => i.status === 'backlog' || i.status === 'selected').length;
  const done = data.goals.filter((g) => g.completed_at && !g.archived_at).length;
  const tab = (key: typeof current, to: string, label: string, count: number) => (
    <a href={href(to)} aria-current={current === key ? 'page' : undefined}>
      {label} <span className="count">{count}</span>
    </a>
  );
  return (
    <nav className="seg goals-switch" aria-label="Backlog, goals or completed">
      {tab('backlog', '/goals/backlog', 'Backlog', waiting)}
      {tab('goals', '/goals', 'Goals', goals)}
      {tab('completed', '/goals/completed', 'Completed', done)}
    </nav>
  );
}

/**
 * The goal backlog, Kanban style:
 * - Backlog: ideas written in a line, in order of importance (most important on top).
 * - Selected for next commitment: the few you'll start next (limit 3), pulled from the top.
 * - Starting one opens the goal setup with its title filled in; it then lives on Goals.
 */
export function Backlog() {
  const { data, today, commit } = useStore();
  const view = useView();
  const toast = useToast();
  const [title, setTitle] = useState('');
  const input = useRef<HTMLInputElement>(null);
  const plan = view.mainPlan;
  const backlog = column(data.ideas, 'backlog');
  const selected = column(data.ideas, 'selected');
  const started = column(data.ideas, 'started');
  const discarded = column(data.ideas, 'discarded');
  const room = hasRoom(data.ideas);
  const initial = (data.profile.display_name || 'You').trim().charAt(0).toUpperCase();
  const checkpoint = plan ? quarterRange(plan, plan.start_date).end : null;
  const nextChance = plan && checkpoint && checkpoint >= today ? `your 3-month checkpoint on ${shortDate(checkpoint)}` : plan ? `your next plan (${shortDate(plan.end_date)})` : 'you start a plan';

  function add(e: FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    commit(opsAddIdea(data, title).ops);
    toast(`Added to the backlog`);
    setTitle('');
    input.current?.focus();
  }

  return (
    <div className="stack rise">
      <div className="topbar">
        <span className="mono">
          {backlog.length} idea{backlog.length === 1 ? '' : 's'} · {selected.length}/{SELECTED_LIMIT} selected
        </span>
        <a className="avatar" href={href('/settings')} aria-label="Settings">
          {initial}
        </a>
      </div>
      <h1 style={{ marginTop: -4 }}>Backlog</h1>
      <GoalsSwitch current="backlog" />

      <form className="idea-add" onSubmit={add}>
        <label className="visually-hidden" htmlFor="idea-title">
          New goal idea
        </label>
        <input id="idea-title" ref={input} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="A goal you might want…" autoComplete="off" />
        <button className="btn primary small" type="submit" disabled={!title.trim()}>
          <Icon name="plus" size={16} stroke={2.4} /> Add
        </button>
      </form>

      <div className="backlog-grid">
        <section className="card stack-sm backlog-selected" aria-labelledby="selected-title">
          <div className="row-between" style={{ gap: 8 }}>
            <h2 id="selected-title" className="label" style={{ color: 'var(--accent-ink)', margin: 0 }}>
              Selected for next commitment
            </h2>
            <span className={`xsmall ${room ? 'muted' : ''}`} style={room ? undefined : { color: 'var(--amber-ink)', fontWeight: 600 }}>
              {selected.length} of {SELECTED_LIMIT}
              {room ? '' : ' · full'}
            </span>
          </div>
          <div className="wip" aria-hidden="true">
            {Array.from({ length: SELECTED_LIMIT }, (_, i) => (
              <span key={i} className={i < selected.length ? 'on' : ''} />
            ))}
          </div>
          {selected.length === 0 ? (
            <p className="small muted" style={{ margin: 0 }}>
              Nothing selected yet. Pick the ideas you'd start next, up to {SELECTED_LIMIT}.
            </p>
          ) : (
            <ol className="idea-list">
              {selected.map((idea, i) => (
                <IdeaRow key={idea.id} idea={idea} index={i} count={selected.length} room={room} planId={plan?.id ?? null} />
              ))}
            </ol>
          )}
          <p className="xsmall muted" style={{ margin: 0 }}>
            {room ? `Start one when a goal wraps up, or at ${nextChance}.` : 'Full. Start one, or send one back, to make room.'}
          </p>
          <div className="policy">
            <span>
              <b>To enter</b> Why it matters and what done looks like. Up to {SELECTED_LIMIT}.
            </span>
            <span>
              <b>To start</b> Its 3-month, month and first-week goals and a daily task, set in goal setup.
            </span>
          </div>
        </section>

        <section className="card stack-sm backlog-list" aria-labelledby="backlog-title">
          <div className="row-between" style={{ gap: 8 }}>
            <h2 id="backlog-title" className="label" style={{ margin: 0 }}>
              Backlog · most important first
            </h2>
            <span className="xsmall muted">{backlog.length}</span>
          </div>
          {backlog.length === 0 ? (
            <p className="small muted" style={{ margin: 0 }}>
              Write down goals you might want, one line each. Order them by importance and pull the top ones into Selected when you have room.
            </p>
          ) : (
            <ol className="idea-list">
              {backlog.map((idea, i) => (
                <IdeaRow key={idea.id} idea={idea} index={i} count={backlog.length} room={room} planId={plan?.id ?? null} />
              ))}
            </ol>
          )}
          {backlog.length > 0 && <p className="xsmall muted" style={{ margin: 0 }}>New ideas go to the bottom. Move the important ones up.</p>}
          {backlog.length > 12 && (
            <p className="xsmall" style={{ margin: 0, color: 'var(--amber-ink)' }}>
              A long backlog goes stale. Discard what you wouldn't start in the next six months.
            </p>
          )}
        </section>
      </div>

      {(started.length > 0 || discarded.length > 0) && (
        <div className="stack-sm">
          {started.length > 0 && (
            <details className="card tight">
              <summary className="label" style={{ cursor: 'pointer', minHeight: 32, display: 'flex', alignItems: 'center' }}>
                Started as goals · {started.length}
              </summary>
              {started.map((idea) => {
                const goal = idea.goal_id ? view.goal(idea.goal_id) : undefined;
                return (
                  <div key={idea.id} className="list-row small" style={{ gap: 10 }}>
                    <span className="dot" style={{ background: goal?.color ?? 'var(--muted)' }} />
                    <span className="grow">{idea.title}</span>
                    {goal ? (
                      <a className="link-btn small" href={href(`/goals/${goal.id}`)}>
                        Open goal
                      </a>
                    ) : (
                      <span className="xsmall muted">{idea.started_at ? shortDate(idea.started_at.slice(0, 10)) : ''}</span>
                    )}
                  </div>
                );
              })}
            </details>
          )}
          {discarded.length > 0 && (
            <details className="card tight">
              <summary className="label" style={{ cursor: 'pointer', minHeight: 32, display: 'flex', alignItems: 'center' }}>
                Discarded · {discarded.length}
              </summary>
              {discarded.map((idea) => (
                <div key={idea.id} className="list-row small" style={{ gap: 10 }}>
                  <span className="grow muted">{idea.title}</span>
                  <button type="button" className="link-btn small" onClick={() => commit(opsSetStatus(data, idea, 'backlog'))}>
                    Restore
                  </button>
                  <button
                    type="button"
                    className="link-btn small"
                    style={{ color: 'var(--danger, var(--amber-ink))' }}
                    onClick={() => {
                      commit(opsDeleteIdea(idea));
                      toast(`Deleted ${idea.title}`, () => commit([{ kind: 'insert', collection: 'ideas', rows: [idea as unknown as { id: string } & Record<string, unknown>] }]));
                    }}
                  >
                    Delete
                  </button>
                </div>
              ))}
            </details>
          )}
        </div>
      )}
    </div>
  );
}

const GAP_WORD = { why: 'why it matters', done: 'what done looks like' } as const;

/** One idea: its place, title and why, move up/down, and the next step (select, or start as a goal). */
function IdeaRow({ idea, index, count, room, planId }: { idea: GoalIdea; index: number; count: number; room: boolean; planId: string | null }) {
  const { data, commit } = useStore();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [asked, setAsked] = useState(false);
  const [title, setTitle] = useState(idea.title);
  const [note, setNote] = useState(idea.note);
  const [done, setDone] = useState(idea.done_means ?? '');
  const isSelected = idea.status === 'selected';
  const age = ageInDays(idea);
  const gaps = readinessGaps(idea);
  const draftGaps = readinessGaps({ note, done_means: done });

  const move = (dir: 'up' | 'down' | 'top') => commit(opsMoveIdea(data, idea.id, dir));
  const discard = () => {
    commit(opsSetStatus(data, idea, 'discarded'));
    toast(`Discarded ${idea.title}`, () => commit(opsRestoreIdea(idea)));
  };
  const select = (edits: Op[] = []) => {
    const next = edits.length ? withOps(data, edits) : data;
    const fresh = next.ideas.find((i) => i.id === idea.id) ?? idea;
    commit([...edits, ...opsSetStatus(next, fresh, 'selected')]);
    toast(`${idea.title} selected for next commitment`, () => commit(opsRestoreIdea(idea)));
  };
  // Selecting an idea that isn't ready opens it, asking for what's missing (the entry policy).
  const trySelect = () => {
    if (gaps.length) {
      setOpen(true);
      setAsked(true);
      return;
    }
    select();
  };

  return (
    <li className={`idea${open ? ' open' : ''}`}>
      <div className="idea-row">
        <span className="idea-rank mono" aria-hidden="true">
          {index + 1}
        </span>
        <button type="button" className="idea-text" aria-expanded={open} onClick={() => setOpen(!open)}>
          <span className="idea-title">{idea.title}</span>
          {idea.note && <span className="idea-note">{idea.note}</span>}
          {!isSelected && gaps.length > 0 && <span className="idea-gap">Needs {gaps.map((g) => GAP_WORD[g]).join(' and ')}</span>}
          {!isSelected && gaps.length === 0 && <span className="idea-ready">Ready to select</span>}
          {!isSelected && age >= 60 && <span className="idea-note" style={{ color: 'var(--amber-ink)' }}>Waiting {Math.round(age / 7)} weeks</span>}
        </button>
        <span className="idea-moves">
          <button type="button" className="icon-btn" aria-label={`Move ${idea.title} up`} disabled={index === 0} onClick={() => move('up')}>
            <Icon name="up" size={16} stroke={2.2} />
          </button>
          <button type="button" className="icon-btn down" aria-label={`Move ${idea.title} down`} disabled={index === count - 1} onClick={() => move('down')}>
            <Icon name="up" size={16} stroke={2.2} />
          </button>
        </span>
        {isSelected ? (
          <button type="button" className="btn small primary idea-next" onClick={() => navigate(`/goals/new?idea=${idea.id}${planId ? `&plan=${planId}` : ''}`)} aria-label={`Start ${idea.title} as a goal`}>
            Start
          </button>
        ) : (
          <button
            type="button"
            className="btn small idea-next"
            disabled={!room}
            title={room ? undefined : `Selected is full (${SELECTED_LIMIT})`}
            aria-label={room ? `Select ${idea.title} for next commitment` : `Select ${idea.title}: selected is full`}
            onClick={trySelect}
          >
            Select
          </button>
        )}
      </div>
      {open && (
        <form
          className="idea-edit stack-sm"
          onSubmit={(e) => {
            e.preventDefault();
            commit(opsEditIdea(idea, { title, note, done_means: done }));
            setOpen(false);
            setAsked(false);
          }}
        >
          {asked && gaps.length > 0 && (
            <span className="small" style={{ color: 'var(--amber-ink)' }}>
              To select it, add {draftGaps.length ? draftGaps.map((g) => GAP_WORD[g]).join(' and ') : 'nothing more: it’s ready'}.
            </span>
          )}
          <label className="field">
            Goal idea
            <input value={title} onChange={(e) => setTitle(e.target.value)} />
          </label>
          <label className="field">
            Why it matters
            <textarea autoFocus={asked && !note.trim()} value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Builds on the cardio from the weight goal" rows={2} />
          </label>
          <label className="field">
            What done looks like in six months
            <input autoFocus={asked && !!note.trim() && !done.trim()} value={done} onChange={(e) => setDone(e.target.value)} placeholder="e.g. Finish a half marathon in under 2 hours" />
          </label>
          <span className="xsmall muted">Both are needed to select it. Written down {age === 0 ? 'today' : `${age} day${age === 1 ? '' : 's'} ago`}.</span>
          <div className="btn-row" style={{ flexWrap: 'wrap' }}>
            {!isSelected && (
              <button
                className="btn small primary"
                type="button"
                disabled={draftGaps.length > 0 || !room || !title.trim()}
                title={!room ? `Selected is full (${SELECTED_LIMIT})` : draftGaps.length ? `Add ${draftGaps.map((g) => GAP_WORD[g]).join(' and ')}` : undefined}
                onClick={() => {
                  select(opsEditIdea(idea, { title, note, done_means: done }));
                  setOpen(false);
                  setAsked(false);
                }}
              >
                Save and select
              </button>
            )}
            <button className={`btn small${isSelected ? ' primary' : ''}`} type="submit" disabled={!title.trim()}>
              Save
            </button>
            {!isSelected && index > 0 && (
              <button className="btn small" type="button" onClick={() => move('top')}>
                Move to top
              </button>
            )}
            {isSelected && (
              <button className="btn small" type="button" onClick={() => commit(opsSetStatus(data, idea, 'backlog'))}>
                Back to backlog
              </button>
            )}
            <button className="btn small danger" type="button" onClick={discard}>
              Discard
            </button>
          </div>
        </form>
      )}
    </li>
  );
}
