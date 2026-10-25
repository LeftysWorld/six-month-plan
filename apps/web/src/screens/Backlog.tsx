import { useEffect, useRef, useState, type FormEvent, type PointerEvent as ReactPointerEvent, type ReactElement } from 'react';
import {
  ageInDays,
  column,
  daysBetween,
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
import { commitTarget, opsCommitIdea, opsCommitOwnClock, startPeriods } from '../data/commit.ts';
import { withOps } from '../data/breakdown.ts';
import type { Op } from '../data/model.ts';
import { href, navigate } from '../router.ts';
import { GOAL_COLORS, Icon, Sheet, WEEKDAY_NAMES, useToast } from '../components/ui.tsx';

/** Backlog → Goals → Completed: the flow of a goal, left to right (shown on all three pages). */
export function GoalsSwitch({ current }: { current: 'backlog' | 'goals' | 'completed' }) {
  const { data } = useStore();
  const view = useView();
  const goals = view.activeGoals.length;
  const waiting = data.ideas.filter((i) => i.status === 'backlog' || i.status === 'selected').length;
  const done = data.goals.filter((g) => g.completed_at && !g.archived_at).length;
  const archived = data.goals.filter((g) => g.archived_at).length;
  const tab = (key: typeof current, to: string, label: string, count: number) => (
    <a href={href(to)} aria-current={current === key ? 'page' : undefined}>
      {label} <span className="count">{count}</span>
    </a>
  );
  return (
    <nav className="seg goals-switch" aria-label="Backlog, goals or completed">
      {tab('backlog', '/goals/backlog', 'Backlog', waiting)}
      {tab('goals', '/goals', 'Goals', goals)}
      {tab('completed', '/goals/completed', archived ? 'Done & archived' : 'Completed', done + archived)}
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
    // Same name as a goal you're working on, or an idea already waiting? Say so instead of making a copy.
    const key = title.trim().toLowerCase();
    const goal = data.goals.find((g) => !g.archived_at && !g.completed_at && g.title.trim().toLowerCase() === key);
    const idea = data.ideas.find((i) => (i.status === 'backlog' || i.status === 'selected') && i.title.trim().toLowerCase() === key);
    if (goal || idea) {
      toast(goal ? `You already have a goal called “${goal.title}”` : `“${idea!.title}” is already in your backlog`);
      return;
    }
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

  // ---- Drag and drop: drag a card with a mouse (after a few pixels), or press and hold it on
  // a touch screen (so ordinary scrolling still works), or grab the number to drag at once.
  // While dragging, the window listens: the list re-renders under the pointer.
  const [drag, setDrag] = useState<DragState | null>(null);
  const [selecting, setSelecting] = useState<{ id: string; rank?: number } | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const pendingRef = useRef<{ idea: GoalIdea; x: number; y: number; touch: boolean; timer: number | null } | null>(null);
  const listenersRef = useRef<(() => void) | null>(null);
  const suppressClick = useRef(false);
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
      // Moving into Selected always shows why (and asks for it if it's missing).
      setSelecting({ id: idea.id, rank });
      return;
    }
    commit([{ kind: 'update', collection: 'ideas', id: idea.id, patch: { status: 'backlog', rank, selected_at: null } }]);
    toast(`${idea.title} back in the backlog`, () => commit(opsRestoreIdea(idea)));
  };
  const finish = () => {
    if (pendingRef.current?.timer) window.clearTimeout(pendingRef.current.timer);
    pendingRef.current = null;
    listenersRef.current?.();
    listenersRef.current = null;
  };
  const begin = (idea: GoalIdea, x: number, y: number) => {
    const d: DragState = { id: idea.id, title: idea.title, from: idea.status as Col, x, y, target: targetFor(x, y, idea.id) };
    dragRef.current = d;
    suppressClick.current = true;
    setDrag(d);
    try {
      navigator.vibrate?.(8);
    } catch {
      /* no vibration */
    }
  };
  const dragStart = (e: ReactPointerEvent<HTMLElement>, idea: GoalIdea, immediate = false) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    finish();
    const touch = e.pointerType !== 'mouse';
    const pending = { idea, x: e.clientX, y: e.clientY, touch, timer: null as number | null };
    pendingRef.current = pending;
    suppressClick.current = false;
    if (immediate) begin(idea, e.clientX, e.clientY);
    else if (touch) pending.timer = window.setTimeout(() => pendingRef.current === pending && begin(idea, pending.x, pending.y), 320);
    const move = (ev: PointerEvent) => {
      const p = pendingRef.current;
      if (!dragRef.current && p) {
        const dist = Math.hypot(ev.clientX - p.x, ev.clientY - p.y);
        if (p.touch) {
          if (dist > 10) finish(); // the finger is scrolling, not dragging
          return;
        }
        if (dist < 6) return;
        begin(p.idea, ev.clientX, ev.clientY);
      }
      const d = dragRef.current;
      if (!d) return;
      ev.preventDefault();
      window.getSelection()?.removeAllRanges();
      const edge = 72;
      if (ev.clientY < edge) window.scrollBy(0, -12);
      else if (ev.clientY > window.innerHeight - edge) window.scrollBy(0, 12);
      const next = { ...d, x: ev.clientX, y: ev.clientY, target: targetFor(ev.clientX, ev.clientY, d.id) };
      dragRef.current = next;
      setDrag(next);
    };
    const up = () => {
      const d = dragRef.current;
      dragRef.current = null;
      finish();
      setDrag(null);
      if (d) drop(d);
    };
    const cancel = () => {
      dragRef.current = null;
      finish();
      setDrag(null);
    };
    const touchMove = (ev: TouchEvent) => {
      if (dragRef.current) ev.preventDefault();
    };
    const key = (ev: KeyboardEvent) => ev.key === 'Escape' && cancel();
    const menu = (ev: Event) => pendingRef.current?.touch && ev.preventDefault();
    window.addEventListener('pointermove', move, { passive: false });
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', cancel);
    window.addEventListener('touchmove', touchMove, { passive: false });
    window.addEventListener('keydown', key);
    window.addEventListener('contextmenu', menu);
    listenersRef.current = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', cancel);
      window.removeEventListener('touchmove', touchMove);
      window.removeEventListener('keydown', key);
      window.removeEventListener('contextmenu', menu);
    };
  };
  useEffect(() => () => listenersRef.current?.(), []);
  /** True (once) right after a drag, so the click that ends it doesn't also open the card. */
  const consumeClick = () => {
    const was = suppressClick.current;
    suppressClick.current = false;
    return was;
  };
  const dnd = { drag, dragStart, consumeClick, onSelect: (idea: GoalIdea) => setSelecting({ id: idea.id }) };

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
  const selectingIdea = selecting ? data.ideas.find((i) => i.id === selecting.id && i.status === 'backlog') : undefined;

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
              <b>To commit</b> Prepare its timing, what done looks like, the goals along the way and a daily task.
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
          {backlog.length > 0 && <p className="xsmall muted" style={{ margin: 0 }}>New ideas go to the bottom. Drag a card (press and hold on a phone), or use the arrows.</p>}
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
      {selectingIdea && <SelectSheet idea={selectingIdea} rank={selecting?.rank} onClose={() => setSelecting(null)} />}
    </div>
  );
}

const GAP_WORD = { why: 'why it matters', done: 'what done looks like' } as const;
const PREP_WORD: Record<PrepGap, string> = { goal: 'what done looks like', quarter: '3-month goal', month: 'month goal', week: 'week goal', task: 'daily task', target: 'target', timing: 'timing' };

/** Where a selected idea stands: where it would go if committed today, and what it still needs. */
function prepStatus(idea: GoalIdea, plans: Plan[], today: string) {
  const prepared = !!idea.prep?.prepared_at;
  const target = commitTarget(idea, plans, today);
  if (!target) return { prepared, target: null, missing: ['timing'] as PrepGap[] };
  const horizon = daysBetween(today < target.plan.start_date ? target.plan.start_date : today, target.plan.end_date) + 1;
  const missing = prepGaps(idea.prep, startPeriods(target.plan, today), { doneMeans: idea.done_means ?? '', horizonDays: horizon });
  return { prepared, target, missing, horizon };
}

interface Dnd {
  drag: DragState | null;
  dragStart: (e: ReactPointerEvent<HTMLElement>, idea: GoalIdea, immediate?: boolean) => void;
  consumeClick: () => boolean;
  onSelect: (idea: GoalIdea) => void;
}

/** One idea: its place, title, why and readiness, move up/down, and the next step you choose. */
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
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState(idea.title);
  const [note, setNote] = useState(idea.note);
  const [done, setDone] = useState(idea.done_means ?? '');
  const isSelected = idea.status === 'selected';
  const age = ageInDays(idea);
  const gaps = readinessGaps(idea);
  const status = isSelected ? prepStatus(idea, data.plans, today) : null;
  const canCommit = !!status && status.prepared && status.missing.length === 0 && !!status.target;

  useEffect(() => {
    if (askFor === idea.id) {
      setOpen(true);
      clearAsk();
    }
  }, [askFor, idea.id, clearAsk]);

  const move = (dir: 'up' | 'down' | 'top') => commit(opsMoveIdea(data, idea.id, dir));
  const discard = () => {
    commit(opsSetStatus(data, idea, 'discarded'));
    toast(`Discarded ${idea.title}`, () => commit(opsRestoreIdea(idea)));
  };
  const backToBacklog = () => {
    commit(opsSetStatus(data, idea, 'backlog'));
    toast(`${idea.title} back in the backlog`, () => commit(opsRestoreIdea(idea)));
  };
  const prepare = () => navigate(`/goals/new?idea=${idea.id}`);
  const dragging = dnd.drag?.id === idea.id;
  const timing = status?.target ? (status.target.own ? `Own clock · ${idea.prep?.months ?? 6} months` : status.target.plan.name) : '';

  return (
    <li className={`idea${open ? ' open' : ''}${dragging ? ' dragging' : ''}`} data-idea-id={idea.id}>
      <div className="idea-row">
        <button
          type="button"
          className="idea-rank mono drag-handle"
          aria-label={`Drag ${idea.title} to reorder or move it`}
          title="Drag to reorder or move"
          onPointerDown={(e) => dnd.dragStart(e, idea, true)}
          onMouseDown={(e) => e.preventDefault()}
        >
          <span className="rank-num">{index + 1}</span>
          <span className="grip" aria-hidden="true">
            ⋮⋮
          </span>
        </button>
        <button
          type="button"
          className="idea-text"
          aria-expanded={open}
          onPointerDown={(e) => dnd.dragStart(e, idea)}
          onClick={() => {
            if (dnd.consumeClick()) return;
            setOpen(!open);
          }}
        >
          <span className="idea-title">{idea.title}</span>
          {idea.note && <span className="idea-note">Why: {idea.note}</span>}
          {!isSelected && gaps.length > 0 && <span className="idea-gap">Needs {gaps.map((g) => GAP_WORD[g]).join(' and ')}</span>}
          {!isSelected && gaps.length === 0 && <span className="idea-ready">Ready to select</span>}
          {status && !status.prepared && <span className="idea-gap">Not prepared yet</span>}
          {status && status.prepared && status.missing.length > 0 && <span className="idea-gap">Plan needs {status.missing.map((g) => PREP_WORD[g]).join(', ')}</span>}
          {canCommit && <span className="idea-ready">Ready to commit · {timing}</span>}
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
          canCommit ? (
            <button type="button" className="btn small primary idea-next" onClick={onCommit} aria-label={`Commit ${idea.title}`}>
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
            onClick={() => dnd.onSelect(idea)}
          >
            Select
          </button>
        )}
      </div>
      {isSelected && !open && (
        <div className="idea-sub">
          <button type="button" className="link-btn xsmall" onClick={backToBacklog} aria-label={`Move ${idea.title} back to the backlog`}>
            ← Back to backlog
          </button>
          {status?.prepared && (
            <button type="button" className="link-btn xsmall" onClick={prepare}>
              Edit plan
            </button>
          )}
        </div>
      )}
      {open && (
        <form
          className="idea-edit stack-sm"
          onSubmit={(e) => {
            e.preventDefault();
            commit(opsEditIdea(idea, { title, note, done_means: done }));
            setOpen(false);
          }}
        >
          <label className="field">
            Goal idea
            <input value={title} onChange={(e) => setTitle(e.target.value)} />
          </label>
          <label className="field">
            Why it matters
            <textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Builds on the cardio from the weight goal" rows={2} />
          </label>
          <label className="field">
            What done looks like
            <input value={done} onChange={(e) => setDone(e.target.value)} placeholder="e.g. Finish a half marathon in under 2 hours" />
          </label>
          <span className="xsmall muted">Both are needed to select it. Written down {age === 0 ? 'today' : `${age} day${age === 1 ? '' : 's'} ago`}.</span>
          <div className="btn-row" style={{ flexWrap: 'wrap' }}>
            <button className="btn small primary" type="submit" disabled={!title.trim()}>
              Save
            </button>
            {isSelected && (
              <button className="btn small" type="button" onClick={prepare}>
                {status?.prepared ? 'Edit plan' : 'Prepare'}
              </button>
            )}
            {!isSelected && index > 0 && (
              <button className="btn small" type="button" onClick={() => move('top')}>
                Move to top
              </button>
            )}
            {isSelected && (
              <button className="btn small" type="button" onClick={backToBacklog}>
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

/**
 * Moving an idea into Selected: shows why it matters and what done looks like (asking for
 * whichever is missing), then one deliberate button.
 */
function SelectSheet({ idea, rank, onClose }: { idea: GoalIdea; rank?: number; onClose: () => void }) {
  const { data, commit } = useStore();
  const toast = useToast();
  const [note, setNote] = useState(idea.note);
  const [done, setDone] = useState(idea.done_means ?? '');
  const gaps = readinessGaps({ note, done_means: done });
  const room = hasRoom(data.ideas);
  const go = () => {
    const edits = opsEditIdea(idea, { note, done_means: done });
    const next = edits.length ? withOps(data, edits) : data;
    const fresh = next.ideas.find((i) => i.id === idea.id) ?? idea;
    const move =
      rank != null
        ? ([{ kind: 'update', collection: 'ideas', id: idea.id, patch: { status: 'selected', rank, selected_at: new Date().toISOString() } }] as Op[])
        : opsSetStatus(next, fresh, 'selected');
    commit([...edits, ...move]);
    toast(`${idea.title} selected for next commitment`, () => commit(opsRestoreIdea(idea)));
    onClose();
  };
  return (
    <Sheet title="Select for next commitment" onClose={onClose}>
      <b style={{ fontSize: 18, letterSpacing: '-0.02em', marginTop: -6 }}>{idea.title}</b>
      <span className="small muted" style={{ marginTop: -6 }}>
        Selecting means it's one of the next few things you'll commit to. Here's why.
      </span>
      <label className="field">
        Why it matters
        <textarea autoFocus={!note.trim()} value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Builds on the cardio from the weight goal" rows={2} />
      </label>
      <label className="field">
        What done looks like
        <input autoFocus={!!note.trim() && !done.trim()} value={done} onChange={(e) => setDone(e.target.value)} placeholder="e.g. Finish a half marathon in under 2 hours" />
      </label>
      {gaps.length > 0 && <span className="xsmall" style={{ color: 'var(--amber-ink)' }}>Add {gaps.map((g) => GAP_WORD[g]).join(' and ')} to select it.</span>}
      {!room && <span className="xsmall" style={{ color: 'var(--amber-ink)' }}>Selected is full ({SELECTED_LIMIT}). Send one back first.</span>}
      <div className="btn-row">
        <button type="button" className="btn" onClick={onClose}>
          Not now
        </button>
        <button type="button" className="btn primary" disabled={gaps.length > 0 || !room} onClick={go}>
          Move to Selected
        </button>
      </div>
    </Sheet>
  );
}

/** The commitment itself: what you're committing to, when it runs, and one deliberate button. */
function CommitSheet({ idea, onClose }: { idea: GoalIdea; onClose: () => void }) {
  const { data, today, commit } = useStore();
  const view = useView();
  const toast = useToast();
  const status = prepStatus(idea, data.plans, today);
  const target = status.target;
  if (!target) {
    return (
      <Sheet title="Commit" onClose={onClose}>
        <p className="small" style={{ margin: 0 }}>
          The batch this was prepared for has ended. Prepare it again to pick its own clock or another batch.
        </p>
        <button type="button" className="btn primary" onClick={() => navigate(`/goals/new?idea=${idea.id}`)}>
          Prepare again
        </button>
      </Sheet>
    );
  }
  const { plan, own } = target;
  const prep = idea.prep ?? {};
  const months = prep.months ?? 6;
  const periods = startPeriods(plan, today);
  const short = (status.horizon ?? 999) <= 98;
  const active = view.activeGoals;
  const inBatch = own ? [] : view.goalsForPlan(plan.id);
  const used = new Set(active.map((g) => g.color));
  const color = GOAL_COLORS.find((c) => !used.has(c)) ?? GOAL_COLORS[active.length % GOAL_COLORS.length]!;
  const label = own ? `Commit to the next ${months} months` : `Commit to ${plan.name}`;
  const line = (tag: string, text: string | undefined, by: string) => (
    <div className="commit-line">
      <span className="mono">{tag}</span>
      <span>
        {text}
        <span className="xsmall muted"> · by {shortDate(by)}</span>
      </span>
    </div>
  );
  const task = prep.task;
  const days = task ? (task.days.length === 7 ? 'every day' : task.days.map((d) => WEEKDAY_NAMES[d - 1]).join(' · ')) : '';
  const doCommit = () => {
    const result = own ? opsCommitOwnClock(data, idea, months, today, color) : opsCommitIdea(data, idea, plan, today, color);
    commit(result.ops);
    toast(`Committed: ${idea.title}`);
    onClose();
    navigate(`/goals/${result.goalId}`);
  };
  return (
    <Sheet title={label} onClose={onClose}>
      <div className="stack-sm" style={{ marginTop: -6 }}>
        <span className="small muted">
          {own ? `Its own clock: ${shortDate(plan.start_date)} – ${shortDate(plan.end_date)}, starting today` : `${plan.name} · today – ${shortDate(plan.end_date)} (${Math.max(1, Math.round((status.horizon ?? 0) / 7))} weeks)`}
        </span>
        <div className="row-start" style={{ gap: 10, flexWrap: 'nowrap' }}>
          <span className="dot" style={{ width: 10, height: 10, flex: 'none', background: color }} />
          <b style={{ fontSize: 18, letterSpacing: '-0.02em' }}>{idea.title}</b>
        </div>
        {idea.note && <span className="small muted">Why: {idea.note}</span>}
      </div>
      <div className="card tight stack-sm">
        {line(own ? `${months} MO` : 'GOAL', idea.done_means, plan.end_date)}
        {!short && line('3 MO', prep.quarter, periods.quarter.end)}
        {line('MONTH', prep.month, periods.month.end)}
        {line('WEEK', prep.week, periods.week.end)}
        {(prep.reuse ?? []).map((id) => view.action(id)).filter((a) => !!a && !a.archived_at).map((a) => (
          <div key={a!.id} className="commit-line">
            <span className="mono">SHARED</span>
            <span>
              {a!.title}
              <span className="xsmall muted"> · with {view.goalsForAction(a!.id).map((g) => g.title).join(', ')}</span>
            </span>
          </div>
        ))}
        {(prep.connect ?? []).length > 0 && (
          <div className="commit-line">
            <span className="mono">GROUP</span>
            <span>
              {(prep.connect ?? []).slice(0, 1).map((id) => {
                const g = view.goal(id);
                const gr = g?.group_id ? data.groups.find((x) => x.id === g.group_id) : undefined;
                return gr ? `Joins ${gr.name}` : g ? `New group with ${g.title}` : '';
              })}
            </span>
          </div>
        )}
        {task && task.title.trim() && (
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
      <span className={`xsmall${active.length >= 5 ? '' : ' muted'}`} style={active.length >= 5 ? { color: 'var(--amber-ink)' } : undefined}>
        {own ? '' : `It joins ${inBatch.length} other goal${inBatch.length === 1 ? '' : 's'} in ${plan.name}. `}
        You'd be working on {active.length + 1} goals.{active.length >= 5 ? ' That’s a lot to carry at once: most people keep 3 to 5.' : ''} Its daily task starts on Today right away.
      </span>
      <div className="btn-row">
        <button type="button" className="btn" onClick={onClose}>
          Not yet
        </button>
        <button type="button" className="btn primary" onClick={doCommit}>
          {label}
        </button>
      </div>
    </Sheet>
  );
}
