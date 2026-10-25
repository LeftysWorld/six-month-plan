import { useEffect, useRef, useState, type FormEvent, type PointerEvent as ReactPointerEvent, type ReactElement } from 'react';
import {
  ageInDays,
  column,
  hasRoom,
  prepGaps,
  quarterRange,
  rankAt,
  readinessGaps,
  shortDate,
  SELECTED_LIMIT,
  type GoalIdea,
  type IdeaStatus,
  type Plan,
  type PrepGap,
} from '@six/core';
import { useStore } from '../data/store.tsx';
import { useView } from '../data/derive.ts';
import { opsAddIdea, opsDeleteIdea, opsEditIdea, opsMoveIdea, opsRestoreIdea, opsSetStatus } from '../data/backlog.ts';
import { opsCommitIdea, startPeriods } from '../data/commit.ts';
import type { Op } from '../data/model.ts';
import { href, navigate } from '../router.ts';
import { GOAL_COLORS, Icon, Sheet, WEEKDAY_NAMES, useToast } from '../components/ui.tsx';

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

/** A one-line "add a goal idea" box. New goals always start in the backlog. */
export function IdeaAdd({ placeholder = 'A goal you might want…', after }: { placeholder?: string; after?: (title: string) => void }) {
  const { data, commit } = useStore();
  const toast = useToast();
  const [title, setTitle] = useState('');
  const input = useRef<HTMLInputElement>(null);
  function add(e: FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    commit(opsAddIdea(data, title).ops);
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

type Col = Extract<IdeaStatus, 'backlog' | 'selected'>;
interface DragState {
  id: string;
  title: string;
  from: Col;
  x: number;
  y: number;
  target: { col: Col; index: number } | null;
}

/**
 * The goal backlog, Kanban style. Every move is yours to make:
 * - Backlog: ideas in order of importance. An idea with a why and what done looks like is
 *   ready; Select (or dragging it into Selected) moves it.
 * - Selected for next commitment (limit 3): Prepare writes its first 3 months, month, week and
 *   daily task; Commit to the next six months makes it a goal.
 */
export function Backlog() {
  const { data, today, commit } = useStore();
  const view = useView();
  const toast = useToast();
  const plan = view.mainPlan;
  const backlog = column(data.ideas, 'backlog');
  const selected = column(data.ideas, 'selected');
  const started = column(data.ideas, 'started');
  const discarded = column(data.ideas, 'discarded');
  const room = hasRoom(data.ideas);
  const initial = (data.profile.display_name || 'You').trim().charAt(0).toUpperCase();
  const checkpoint = plan ? quarterRange(plan, plan.start_date).end : null;
  const nextChance = plan && checkpoint && checkpoint >= today ? `your 3-month checkpoint on ${shortDate(checkpoint)}` : plan ? `your next plan (${shortDate(plan.end_date)})` : 'you start a plan';
  const [askFor, setAskFor] = useState<string | null>(null);
  const [committing, setCommitting] = useState<string | null>(null);

  // ---- Drag and drop (pointer events, so it works with a mouse, a finger or a pen) ----
  // While dragging, the window listens (not the handle): the list re-renders under the pointer,
  // and a handle-level capture would be lost when React moves rows around.
  const [drag, setDrag] = useState<DragState | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const dataRef = useRef(data);
  dataRef.current = data;
  const targetFor = (x: number, y: number, id: string): DragState['target'] => {
    const el = document.elementFromPoint(x, y)?.closest('[data-col]') as HTMLElement | null;
    if (!el) return null;
    const col = el.dataset.col as Col;
    const rows = [...el.querySelectorAll<HTMLElement>('[data-idea-id]')].filter((r) => r.dataset.ideaId !== id);
    const index = rows.findIndex((r) => {
      const rect = r.getBoundingClientRect();
      return y < rect.top + rect.height / 2;
    });
    return { col, index: index === -1 ? rows.length : index };
  };
  const drop = (d: DragState) => {
    const data = dataRef.current;
    const idea = data.ideas.find((i) => i.id === d.id);
    if (!idea || !d.target) return;
    const { col, index } = d.target;
    const rank = rankAt(data.ideas, idea.id, col, index);
    if (col === idea.status) {
      if (rank !== idea.rank) commit([{ kind: 'update', collection: 'ideas', id: idea.id, patch: { rank } }]);
      return;
    }
    if (col === 'selected') {
      if (!hasRoom(data.ideas)) {
        toast(`Selected is full (${SELECTED_LIMIT}). Send one back first.`);
        return;
      }
      if (readinessGaps(idea).length) {
        setAskFor(idea.id);
        toast('Add why it matters and what done looks like, then select it.');
        return;
      }
      commit([{ kind: 'update', collection: 'ideas', id: idea.id, patch: { status: 'selected', rank, selected_at: new Date().toISOString() } }]);
      toast(`${idea.title} selected for next commitment`, () => commit(opsRestoreIdea(idea)));
      return;
    }
    commit([{ kind: 'update', collection: 'ideas', id: idea.id, patch: { status: 'backlog', rank, selected_at: null } }]);
    toast(`${idea.title} back in the backlog`, () => commit(opsRestoreIdea(idea)));
  };
  const dragging = drag != null;
  useEffect(() => {
    if (!dragging) return;
    const move = (e: PointerEvent) => {
      const d = dragRef.current;
      if (!d) return;
      e.preventDefault();
      window.getSelection()?.removeAllRanges();
      const edge = 72;
      if (e.clientY < edge) window.scrollBy(0, -12);
      else if (e.clientY > window.innerHeight - edge) window.scrollBy(0, 12);
      const next = { ...d, x: e.clientX, y: e.clientY, target: targetFor(e.clientX, e.clientY, d.id) };
      dragRef.current = next;
      setDrag(next);
    };
    const up = () => {
      const d = dragRef.current;
      dragRef.current = null;
      setDrag(null);
      if (d) drop(d);
    };
    const cancel = () => {
      dragRef.current = null;
      setDrag(null);
    };
    const key = (e: KeyboardEvent) => e.key === 'Escape' && cancel();
    window.addEventListener('pointermove', move, { passive: false });
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', cancel);
    window.addEventListener('keydown', key);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', cancel);
      window.removeEventListener('keydown', key);
    };
  }, [dragging]); // eslint-disable-line react-hooks/exhaustive-deps
  const dragStart = (e: ReactPointerEvent<HTMLElement>, idea: GoalIdea) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const d: DragState = { id: idea.id, title: idea.title, from: idea.status as Col, x: e.clientX, y: e.clientY, target: null };
    dragRef.current = d;
    setDrag(d);
  };
  const dnd = { drag, dragStart };

  const list = (col: Col, ideas: GoalIdea[]) => {
    const t = drag?.target?.col === col ? drag.target.index : null;
    const rows = ideas.filter((i) => i.id !== drag?.id);
    const out: ReactElement[] = [];
    ideas.forEach((idea) => {
      const visibleIndex = rows.findIndex((r) => r.id === idea.id);
      if (t != null && visibleIndex === t) out.push(<li key="drop" className="drop-line" aria-hidden="true" />);
      out.push(
        <IdeaRow
          key={idea.id}
          idea={idea}
          index={ideas.indexOf(idea)}
          count={ideas.length}
          room={room}
          askFor={askFor}
          clearAsk={() => setAskFor(null)}
          onCommit={() => setCommitting(idea.id)}
          dnd={dnd}
        />,
      );
    });
    if (t != null && t >= rows.length) out.push(<li key="drop" className="drop-line" aria-hidden="true" />);
    return out;
  };

  const committingIdea = committing ? data.ideas.find((i) => i.id === committing && i.status === 'selected') : undefined;

  return (
    <div className={`stack rise${drag ? ' is-dragging' : ''}`}>
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

      <IdeaAdd />

      <div className="backlog-grid">
        <section className={`card stack-sm backlog-selected${drag?.target?.col === 'selected' ? ' drop-target' : ''}`} aria-labelledby="selected-title" data-col="selected">
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
          {selected.length === 0 && !drag ? (
            <p className="small muted" style={{ margin: 0 }}>
              Nothing selected yet. Select a ready idea, or drag it here. Up to {SELECTED_LIMIT}.
            </p>
          ) : (
            <ol className="idea-list">{list('selected', selected)}</ol>
          )}
          <p className="xsmall muted" style={{ margin: 0 }}>
            {room ? `Commit one when a goal wraps up, or at ${nextChance}.` : 'Full. Commit one, or send one back, to make room.'}
          </p>
          <div className="policy">
            <span>
              <b>To enter</b> Why it matters and what done looks like. Up to {SELECTED_LIMIT}.
            </span>
            <span>
              <b>To commit</b> Prepare its 3-month, month and first-week goals and a daily task.
            </span>
          </div>
        </section>

        <section className={`card stack-sm backlog-list${drag?.target?.col === 'backlog' ? ' drop-target' : ''}`} aria-labelledby="backlog-title" data-col="backlog">
          <div className="row-between" style={{ gap: 8 }}>
            <h2 id="backlog-title" className="label" style={{ margin: 0 }}>
              Backlog · most important first
            </h2>
            <span className="xsmall muted">{backlog.length}</span>
          </div>
          {backlog.length === 0 && !drag ? (
            <p className="small muted" style={{ margin: 0 }}>
              Write down goals you might want, one line each. Order them by importance and select the top ones when you have room.
            </p>
          ) : (
            <ol className="idea-list">{list('backlog', backlog)}</ol>
          )}
          {backlog.length > 0 && <p className="xsmall muted" style={{ margin: 0 }}>New ideas go to the bottom. Drag by the number, or use the arrows, to reorder.</p>}
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
                Committed as goals · {started.length}
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

      {drag && (
        <div className="drag-ghost" style={{ left: drag.x, top: drag.y }} aria-hidden="true">
          {drag.title}
        </div>
      )}
      {committingIdea && <CommitSheet idea={committingIdea} onClose={() => setCommitting(null)} />}
    </div>
  );
}

const GAP_WORD = { why: 'why it matters', done: 'what done looks like' } as const;
const PREP_WORD: Record<PrepGap, string> = { quarter: '3-month goal', month: 'month goal', week: 'week goal', task: 'daily task', target: 'target' };

/** The plan a selected idea is prepared for (or would be): the one it was prepared for, else the main plan. */
function prepPlan(idea: GoalIdea, plans: Plan[], fallback: Plan | null, today: string): Plan | null {
  const p = idea.prep?.plan_id ? plans.find((x) => x.id === idea.prep!.plan_id && !x.archived_at && x.end_date >= today) : undefined;
  return p ?? fallback;
}

interface Dnd {
  drag: DragState | null;
  dragStart: (e: ReactPointerEvent<HTMLElement>, idea: GoalIdea) => void;
}

/** One idea: its place (drag handle), title, why, readiness, move up/down, and the next step you choose. */
function IdeaRow({
  idea,
  index,
  count,
  room,
  askFor,
  clearAsk,
  onCommit,
  dnd,
}: {
  idea: GoalIdea;
  index: number;
  count: number;
  room: boolean;
  askFor: string | null;
  clearAsk: () => void;
  onCommit: () => void;
  dnd: Dnd;
}) {
  const { data, today, commit } = useStore();
  const view = useView();
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
  const plan = isSelected ? prepPlan(idea, data.plans, view.mainPlan, today) : null;
  const prepared = !!idea.prep?.prepared_at;
  const prepMissing = plan ? prepGaps(idea.prep, startPeriods(plan, today)) : [];
  const staleOnly = prepared && prepMissing.length > 0 && prepMissing.every((g) => g !== 'task' && g !== 'target' && !!idea.prep?.[g]?.trim());

  useEffect(() => {
    if (askFor === idea.id) {
      setOpen(true);
      setAsked(true);
      clearAsk();
    }
  }, [askFor, idea.id, clearAsk]);

  const move = (dir: 'up' | 'down' | 'top') => commit(opsMoveIdea(data, idea.id, dir));
  const discard = () => {
    commit(opsSetStatus(data, idea, 'discarded'));
    toast(`Discarded ${idea.title}`, () => commit(opsRestoreIdea(idea)));
  };
  const select = () => {
    if (gaps.length) {
      setOpen(true);
      setAsked(true);
      return;
    }
    commit(opsSetStatus(data, idea, 'selected'));
    toast(`${idea.title} selected for next commitment`, () => commit(opsRestoreIdea(idea)));
  };
  const prepare = () => navigate(`/goals/new?idea=${idea.id}`);
  const dragging = dnd.drag?.id === idea.id;

  return (
    <li className={`idea${open ? ' open' : ''}${dragging ? ' dragging' : ''}`} data-idea-id={idea.id}>
      <div className="idea-row">
        <button
          type="button"
          className="idea-rank mono drag-handle"
          aria-label={`Drag ${idea.title} to reorder or move it`}
          title="Drag to reorder or move"
          onPointerDown={(e) => dnd.dragStart(e, idea)}
          onMouseDown={(e) => e.preventDefault()}
        >
          <span className="rank-num">{index + 1}</span>
          <span className="grip" aria-hidden="true">
            ⋮⋮
          </span>
        </button>
        <button type="button" className="idea-text" aria-expanded={open} onClick={() => setOpen(!open)}>
          <span className="idea-title">{idea.title}</span>
          {idea.note && <span className="idea-note">{idea.note}</span>}
          {!isSelected && gaps.length > 0 && <span className="idea-gap">Needs {gaps.map((g) => GAP_WORD[g]).join(' and ')}</span>}
          {!isSelected && gaps.length === 0 && <span className="idea-ready">Ready to select</span>}
          {isSelected && !prepared && <span className="idea-gap">Not prepared yet</span>}
          {isSelected && prepared && prepMissing.length > 0 && (
            <span className="idea-gap">{staleOnly ? `Check the ${prepMissing.map((g) => PREP_WORD[g]).join(' and ')} (written earlier)` : `Plan: needs ${prepMissing.map((g) => PREP_WORD[g]).join(', ')}`}</span>
          )}
          {isSelected && prepared && prepMissing.length === 0 && (
            <span className="idea-ready">Ready to commit{plan && data.plans.filter((p) => !p.archived_at && p.end_date >= today).length > 1 ? ` · ${plan.name}` : ''}</span>
          )}
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
          prepared && prepMissing.length === 0 && plan ? (
            <button type="button" className="btn small primary idea-next" onClick={onCommit} aria-label={`Commit ${idea.title} to the next six months`}>
              Commit
            </button>
          ) : (
            <button type="button" className="btn small idea-next" onClick={prepare} aria-label={`Prepare ${idea.title}`}>
              Prepare
            </button>
          )
        ) : (
          <button
            type="button"
            className="btn small idea-next"
            disabled={!room}
            title={room ? undefined : `Selected is full (${SELECTED_LIMIT})`}
            aria-label={room ? `Select ${idea.title} for next commitment` : `Select ${idea.title}: selected is full`}
            onClick={select}
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
              {draftGaps.length ? `To select it, add ${draftGaps.map((g) => GAP_WORD[g]).join(' and ')}, save, then press Select.` : 'Save, then press Select to move it.'}
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
            <button className="btn small primary" type="submit" disabled={!title.trim()}>
              Save
            </button>
            {isSelected && (
              <button className="btn small" type="button" onClick={prepare}>
                {prepared ? 'Edit plan' : 'Prepare'}
              </button>
            )}
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

/** The commitment itself: what you're committing to, and one deliberate button. */
function CommitSheet({ idea, onClose }: { idea: GoalIdea; onClose: () => void }) {
  const { data, today, commit } = useStore();
  const view = useView();
  const toast = useToast();
  const plan = prepPlan(idea, data.plans, view.mainPlan, today);
  if (!plan) {
    return (
      <Sheet title="Commit to the next six months" onClose={onClose}>
        <p className="small" style={{ margin: 0 }}>
          Goals live in a plan. Create your six-month plan first, then commit this idea to it.
        </p>
        <a className="btn primary" href={href('/goals')}>
          Create a plan
        </a>
      </Sheet>
    );
  }
  const prep = idea.prep ?? {};
  const periods = startPeriods(plan, today);
  const goals = view.goalsForPlan(plan.id);
  const used = new Set(goals.map((g) => g.color));
  const color = GOAL_COLORS.find((c) => !used.has(c)) ?? GOAL_COLORS[goals.length % GOAL_COLORS.length]!;
  const line = (label: string, text: string | undefined, by: string) => (
    <div className="commit-line">
      <span className="mono">{label}</span>
      <span>
        {text}
        <span className="xsmall muted"> · by {shortDate(by)}</span>
      </span>
    </div>
  );
  const task = prep.task;
  const days = task ? (task.days.length === 7 ? 'every day' : task.days.map((d) => WEEKDAY_NAMES[d - 1]).join(' · ')) : '';
  const doCommit = () => {
    const { ops, goalId } = opsCommitIdea(data, idea, plan, today, color);
    commit(ops as Op[]);
    toast(`Committed: ${idea.title}`);
    onClose();
    navigate(`/goals/${goalId}`);
  };
  return (
    <Sheet title="Commit to the next six months" onClose={onClose}>
      <div className="stack-sm" style={{ marginTop: -6 }}>
        <span className="small muted">
          {plan.name} · {shortDate(plan.start_date)} – {shortDate(plan.end_date)}
        </span>
        <div className="row-start" style={{ gap: 10, flexWrap: 'nowrap' }}>
          <span className="dot" style={{ width: 10, height: 10, flex: 'none', background: color }} />
          <b style={{ fontSize: 18, letterSpacing: '-0.02em' }}>{idea.title}</b>
        </div>
        {idea.done_means && <span className="small">Done means: {idea.done_means}</span>}
        {idea.note && <span className="small muted">Why: {idea.note}</span>}
      </div>
      <div className="card tight stack-sm">
        {line('3 MO', prep.quarter, periods.quarter.end)}
        {line('MONTH', prep.month, periods.month.end)}
        {line('WEEK', prep.week, periods.week.end)}
        {task && (
          <div className="commit-line">
            <span className="mono">DAILY</span>
            <span>
              {task.title}
              <span className="xsmall muted">
                {' '}
                · {days} · {task.minutes} min
              </span>
            </span>
          </div>
        )}
      </div>
      <span className={`xsmall${goals.length >= 5 ? '' : ' muted'}`} style={goals.length >= 5 ? { color: 'var(--amber-ink)' } : undefined}>
        This makes it goal {goals.length + 1} in {plan.name}.{goals.length >= 5 ? ' That’s a lot to carry at once: most people keep 3 to 5.' : ''} Its daily task starts on Today right away.
      </span>
      <div className="btn-row">
        <button type="button" className="btn" onClick={onClose}>
          Not yet
        </button>
        <button type="button" className="btn primary" onClick={doCommit}>
          Commit to the next six months
        </button>
      </div>
    </Sheet>
  );
}
