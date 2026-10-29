import { useState, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent } from 'react';
import { addDays, daysBetween, shortDate, weekStart, type Goal, type GoalGroup, type ISODate, type Milestone, type Plan } from '@six/core';
import { useStore } from '../data/store.tsx';
import { type View } from '../data/derive.ts';
import { useView } from '../data/useView.ts';
import { goalTrack, groupTrack, seasonsOf } from '../data/season.ts';
import { clampDates, dateLimits, opsRestoreDates, opsSetGoalDates } from '../data/dates.ts';
import { href, navigate } from '../router.ts';
import { GoalsSwitch } from './Backlog.tsx';
import { waiters, waitOf } from '../data/waiting.ts';
import { Icon, Sheet, useToast } from '../components/ui.tsx';
import { LoadStrip } from '../components/LoadStrip.tsx';
import { MilestoneSheet } from '../components/MilestoneSheet.tsx';
import { CHECKPOINT_NAME, checkpointsOf, opsRestoreMilestone, opsUpdateMilestone, type Checkpoint } from '../data/dated.ts';

/**
 * The roadmap: every goal of a season on one timeline, from its start to its finish, grouped the
 * way you grouped them. A group's row shows each of its goals' finishes as a
 * milestone (◆). Dates change right here: drag a bar's ends (or
 * the whole bar), or tap it for exact dates. Changes are the goals' own dates, so the goal pages,
 * pace and reviews follow.
 *
 * Dates inside a goal show on its bar: milestones above it (dates you add: tap + Date, or an empty
 * part of a row; drag one to move it, tap it to change it) and the 3-month, month and week goals you've
 * set below it (when each is due). The same dates show on the calendar and the goal's page.
 */

interface GoalRow {
  kind: 'goal';
  goal: Goal;
  plan: Plan;
  start: ISODate;
  end: ISODate;
  /** Share done, 0..100. */
  prog: number;
  status: string;
  done: boolean;
  inGroup: boolean;
}

interface GroupRow {
  kind: 'group';
  group: GoalGroup;
  goals: GoalRow[];
  start: ISODate;
  end: ISODate;
}

type Row = GroupRow | GoalRow;

/** The season's goals as roadmap rows: groups (with their goals) first, then goals on their own. */
function buildRows(view: View, season: Plan | null): { rows: Row[]; lo: ISODate; hi: ISODate } {
  const today = view.today;
  if (!season) return { rows: [], lo: today, hi: addDays(today, 182) };
  const plans = view.data.plans.filter((p) => !p.archived_at && p.id === season.id);
  const seen = new Set<string>();
  const goalRows: GoalRow[] = [];
  for (const plan of plans) {
    for (const g of view.goalsForPlan(plan.id, true)) {
      if (g.archived_at || seen.has(g.id)) continue;
      seen.add(g.id);
      const w = view.plannedWindow(g, plan);
      const done = !!g.completed_at;
      const t = goalTrack(view, g, plan);
      goalRows.push({
        kind: 'goal',
        goal: g,
        plan,
        start: w.start,
        end: done && view.dayOf(g.completed_at!) < w.end ? (view.dayOf(g.completed_at!) < w.start ? w.start : view.dayOf(g.completed_at!)) : w.end,
        prog: done ? 100 : t.prog,
        status: done ? `Done ${shortDate(view.dayOf(g.completed_at!))}` : t.status,
        done,
        inGroup: !!g.group_id,
      });
    }
  }
  const byStart = (a: GoalRow, b: GoalRow) => (a.start < b.start ? -1 : a.start > b.start ? 1 : a.end < b.end ? -1 : 1);
  const rows: Row[] = [];
  for (const group of view.data.groups) {
    const members = goalRows.filter((r) => r.goal.group_id === group.id).sort(byStart);
    if (!members.length) continue;
    rows.push({ kind: 'group', group, goals: members, start: members.map((m) => m.start).sort()[0]!, end: members.map((m) => m.end).sort().at(-1)! });
  }
  const loose = goalRows.filter((r) => !r.goal.group_id || !view.data.groups.some((g) => g.id === r.goal.group_id)).sort(byStart);
  rows.push(...loose.map((r) => ({ ...r, inGroup: false })));
  const dates = goalRows.flatMap((r) => [r.start, r.end]);
  const lo = [season.start_date, ...dates].sort()[0]!;
  const hi = [season.end_date, ...dates].sort().at(-1)!;
  return { rows, lo, hi };
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function monthStarts(lo: ISODate, hi: ISODate): ISODate[] {
  const out: ISODate[] = [];
  let [y, m] = lo.split('-').map(Number) as [number, number];
  for (;;) {
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
    const d = `${y}-${String(m).padStart(2, '0')}-01`;
    if (d > hi) return out;
    out.push(d);
  }
}

interface Drag {
  goalId: string;
  mode: 'start' | 'end' | 'move';
  x0: number;
  dayPx: number;
  start0: ISODate;
  end0: ISODate;
  start: ISODate;
  end: ISODate;
  moved: boolean;
}

interface MsDrag {
  id: string;
  x0: number;
  dayPx: number;
  date0: ISODate;
  date: ISODate;
  moved: boolean;
}

type MsSheet = { milestone?: Milestone; goalIds?: string[]; goalId?: string; date?: ISODate };

export function Roadmap() {
  const { data, today, commit } = useStore();
  const view = useView();
  const toast = useToast();
  const seasons = seasonsOf(view);
  const [which, setWhich] = useState<'current' | 'next'>('current');
  const [mode, setMode] = useState<'timeline' | 'list'>('timeline');
  const [closed, setClosed] = useState<Record<string, boolean>>({});
  const [editing, setEditing] = useState<GoalRow | null>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [msDrag, setMsDrag] = useState<MsDrag | null>(null);
  const [msSheet, setMsSheet] = useState<MsSheet | null>(null);
  const [cpSheet, setCpSheet] = useState<{ cp: Checkpoint; goal: Goal } | null>(null);
  const season = which === 'next' ? seasons.next : seasons.current;
  const { rows, lo, hi } = buildRows(view, season);
  const span = Math.max(1, daysBetween(lo, hi));
  const pct = (d: ISODate) => (Math.max(0, Math.min(span, daysBetween(lo, d))) / span) * 100;
  const months = monthStarts(lo, hi);
  const initial = (data.profile.display_name || 'You').trim().charAt(0).toUpperCase();
  const goalCount = rows.reduce((n, r) => n + (r.kind === 'group' ? r.goals.length : 1), 0);
  const waiting = waiters(data, today).filter((w) => !w.info.met);
  // Ideas planned into this season: dashed bars, by group (still ideas until they're made goals).
  const planned = season ? data.ideas.filter((i) => i.status === 'backlog' && i.plan_id === season.id).sort((a, b) => ((a.planned_start ?? '') < (b.planned_start ?? '') ? -1 : 1)) : [];
  const plannedGroups = [...new Set(planned.map((i) => i.group_id).filter((x): x is string => !!x))]
    .map((id) => data.groups.find((g) => g.id === id))
    .filter((g): g is NonNullable<typeof g> => !!g)
    .map((group) => ({ group, ideas: planned.filter((i) => i.group_id === group.id) }));
  const plannedLoose = planned.filter((i) => !i.group_id || !data.groups.some((g) => g.id === i.group_id));
  const hasRows = rows.length > 0 || planned.length > 0;

  function startDrag(e: ReactPointerEvent, r: GoalRow, m: Drag['mode']) {
    if (e.button !== 0) return;
    const track = (e.currentTarget as HTMLElement).closest('.rm-track') as HTMLElement | null;
    if (!track) return;
    e.stopPropagation();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    setDrag({ goalId: r.goal.id, mode: m, x0: e.clientX, dayPx: track.getBoundingClientRect().width / span, start0: r.start, end0: r.end, start: r.start, end: r.end, moved: false });
  }
  function moveDrag(e: ReactPointerEvent, r: GoalRow) {
    if (!drag || drag.goalId !== r.goal.id) return;
    const dx = e.clientX - drag.x0;
    if (!drag.moved && Math.abs(dx) < 4) return;
    const days = Math.round(dx / drag.dayPx);
    const limits = dateLimits(view, r.goal, r.plan);
    let s = drag.start0;
    let en = drag.end0;
    if (drag.mode === 'start') s = addDays(drag.start0, days);
    if (drag.mode === 'end') en = addDays(drag.end0, days);
    if (drag.mode === 'move') {
      // Moving keeps the length; it stops at the edges of what's allowed.
      const len = daysBetween(drag.start0, drag.end0);
      s = addDays(drag.start0, days);
      if (s < limits.minStart) s = limits.minStart;
      if (addDays(s, len) > limits.maxEnd) s = addDays(limits.maxEnd, -len);
      en = addDays(s, len);
    }
    if (limits.endLocked) en = drag.end0;
    // The end you didn't grab holds still: a start dragged past the end stops at the end.
    const c = clampDates(limits, s, en, drag.mode === 'start' ? 'end' : 'start');
    setDrag({ ...drag, start: c.start, end: c.end, moved: true });
  }
  function endDrag(r: GoalRow) {
    const d = drag;
    setDrag(null);
    if (!d || d.goalId !== r.goal.id) return;
    if (!d.moved) {
      setEditing(r);
      return;
    }
    save(r, d.start, d.end, d.mode === 'start' ? 'end' : 'start');
  }
  function save(r: GoalRow, start: ISODate, end: ISODate, hold?: 'start' | 'end') {
    const before = r.goal;
    const res = opsSetGoalDates(view, r.goal, r.plan, { start, end }, today, hold);
    if (!res.ops.length) return;
    commit(res.ops);
    toast(`${r.goal.title}: ${shortDate(res.start)} – ${shortDate(res.end)}${res.clamped ? ' (kept inside its season)' : ''}`, () => commit(opsRestoreDates(before, res.logId)));
  }

  // Milestones: drag to move (a day at a time), tap to change; arrow keys move them too.
  function msDown(e: ReactPointerEvent, m: Milestone) {
    if (e.button !== 0) return;
    const track = (e.currentTarget as HTMLElement).closest('.rm-track') as HTMLElement | null;
    if (!track) return;
    e.stopPropagation();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    setMsDrag({ id: m.id, x0: e.clientX, dayPx: track.getBoundingClientRect().width / span, date0: m.due_date, date: m.due_date, moved: false });
  }
  /** The dates a goal's milestone may sit on: the goal's own run (the roadmap's edges when unknown). */
  function msBounds(m: Milestone): { lo: ISODate; hi: ISODate } {
    const goal = view.goal(m.goal_id);
    const plan = goal ? view.planForGoal(goal) : null;
    if (!goal || !plan) return { lo, hi };
    const w = view.plannedWindow(goal, plan);
    return { lo: w.start, hi: w.end };
  }
  function msMove(e: ReactPointerEvent, m: Milestone) {
    if (!msDrag || msDrag.id !== m.id) return;
    const dx = e.clientX - msDrag.x0;
    if (!msDrag.moved && Math.abs(dx) < 4) return;
    const b = msBounds(m);
    let date = addDays(msDrag.date0, Math.round(dx / msDrag.dayPx));
    if (date < b.lo) date = b.lo;
    if (date > b.hi) date = b.hi;
    setMsDrag({ ...msDrag, date, moved: true });
  }
  function moveMilestone(m: Milestone, date: ISODate) {
    const b = msBounds(m);
    if (date < b.lo || date > b.hi) return toast(`${m.title} stays inside its goal's dates (${shortDate(b.lo)} – ${shortDate(b.hi)})`);
    const ops = opsUpdateMilestone(m, { due_date: date });
    if (!ops.length) return;
    commit(ops);
    toast(`${m.title} moved to ${shortDate(date)}`, () => commit(opsRestoreMilestone(data, m)));
  }
  function msUp(m: Milestone) {
    const d = msDrag;
    setMsDrag(null);
    if (!d || d.id !== m.id) return;
    if (!d.moved) setMsSheet({ milestone: m });
    else moveMilestone(m, d.date);
  }
  /** Tap an empty part of a goal's row to add a date there. */
  function addAt(e: ReactMouseEvent<HTMLDivElement>, goal: Goal) {
    const t = e.target as HTMLElement;
    if (t !== e.currentTarget && !t.classList.contains('rm-grid') && !t.classList.contains('rm-today')) return;
    const box = e.currentTarget.getBoundingClientRect();
    const date = addDays(lo, Math.round(((e.clientX - box.left) / box.width) * span));
    setMsSheet({ goalId: goal.id, goalIds: [goal.id], date });
  }

  const msTicks = (goal: Goal) =>
    view.milestonesOf(goal.id).map((m) => {
      const date = msDrag?.id === m.id && msDrag.moved ? msDrag.date : m.due_date;
      if (date < lo || date > hi) return null;
      const moving = msDrag?.id === m.id && msDrag.moved;
      return (
        <button
          key={m.id}
          type="button"
          className={`rm-ms${m.completed_at ? ' done' : ''}${moving ? ' moving' : ''}`}
          style={{ left: `${pct(date)}%`, ['--c' as string]: goal.color }}
          title={`${m.title} · ${m.completed_at ? 'done · ' : ''}${shortDate(date)}${m.prize?.trim() ? ` · prize: ${m.prize.trim()}` : ''}`}
          aria-label={`${m.title}, ${goal.title}, ${m.completed_at ? 'done, ' : ''}${shortDate(date)}. Drag or use arrow keys to move, Enter to change`}
          onPointerDown={(e) => msDown(e, m)}
          onPointerMove={(e) => msMove(e, m)}
          onPointerUp={() => msUp(m)}
          onPointerCancel={() => setMsDrag(null)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              setMsSheet({ milestone: m });
            }
            if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
              e.preventDefault();
              moveMilestone(m, addDays(m.due_date, e.key === 'ArrowLeft' ? -1 : 1));
            }
          }}
        >
          {moving && <span className="rm-ms-tip">{m.title} · {shortDate(date)}</span>}
        </button>
      );
    });

  const cpMarks = (goal: Goal, plan: Plan) =>
    checkpointsOf(data, goal, weekStart(today), plan.id)
      .filter((cp) => cp.date >= lo && cp.date <= hi)
      .map((cp) => (
        <button
          key={cp.id}
          type="button"
          className={`rm-cp l-${cp.level}${cp.done ? ' done' : ''}`}
          style={{ left: `${pct(cp.date)}%`, ['--c' as string]: goal.color }}
          title={`${CHECKPOINT_NAME[cp.level]} · by ${shortDate(cp.date)}: ${cp.text}`}
          aria-label={`${CHECKPOINT_NAME[cp.level]} for ${goal.title}, by ${shortDate(cp.date)}: ${cp.text}`}
          onClick={(e) => (e.stopPropagation(), setCpSheet({ cp, goal }))}
        />
      ));

  const shown = (r: GoalRow) => (drag?.goalId === r.goal.id && drag.moved ? { start: drag.start, end: drag.end } : { start: r.start, end: r.end });

  const goalLabel = (r: GoalRow) => {
    const w = shown(r);
    return (
      <div className="rm-label">
        <span className="rm-name-row">
          <a href={href(`/goals/${r.goal.id}`)} className="rm-name" title={`Open ${r.goal.title}`}>
            <span className="dot" style={{ background: r.goal.color }} />
            <span className="rm-title">{r.goal.title}</span>
          </a>
          {!r.done && (
            <button type="button" className="rm-add" onClick={() => setMsSheet({ goalId: r.goal.id, goalIds: [r.goal.id] })} aria-label={`Add a date to ${r.goal.title}`} title="Add a date">
              <Icon name="plus" size={12} stroke={2.6} /> Date
            </button>
          )}
        </span>
        <span className="rm-meta">
          {shortDate(w.start)} – {shortDate(w.end)} · <span className={r.status.startsWith('Behind') || /behind/.test(r.status) ? 'warn' : ''}>{r.status}</span>
        </span>
      </div>
    );
  };

  const goalTrackEl = (r: GoalRow) => {
    const w = shown(r);
    const left = pct(w.start);
    const width = Math.max(1.2, pct(w.end) - left);
    const dragging = drag?.goalId === r.goal.id && drag.moved;
    const locked = r.goal.type === 'number';
    return (
      <div className={`rm-track${r.done ? '' : ' addable'}`} onClick={(e) => !r.done && addAt(e, r.goal)} title={r.done ? undefined : 'Tap an empty spot to add a date'}>
        {months.map((m) => (
          <span key={m} className="rm-grid" style={{ left: `${pct(m)}%` }} />
        ))}
        {today >= lo && today <= hi && <span className="rm-today" style={{ left: `${pct(today)}%` }} />}
        <div
          className={`rm-bar${r.done ? ' done' : ''}${dragging ? ' dragging' : ''}`}
          style={{ left: `${left}%`, width: `${width}%`, ['--c' as string]: r.goal.color }}
          role="button"
          tabIndex={0}
          aria-label={`${r.goal.title}: ${shortDate(w.start)} to ${shortDate(w.end)}. Change dates`}
          onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), setEditing(r))}
          onPointerDown={(e) => !r.done && startDrag(e, r, locked ? 'start' : 'move')}
          onPointerMove={(e) => moveDrag(e, r)}
          onPointerUp={() => (r.done ? setEditing(r) : endDrag(r))}
          onPointerCancel={() => setDrag(null)}
        >
          <span className="rm-fill" style={{ width: `${r.prog}%` }} />
          {r.done && <Icon name="check" size={11} stroke={3} />}
          {!r.done && (
            <>
              <span className="rm-handle start" onPointerDown={(e) => startDrag(e, r, 'start')} onPointerMove={(e) => moveDrag(e, r)} onPointerUp={() => endDrag(r)} aria-hidden="true" />
              {!locked && <span className="rm-handle end" onPointerDown={(e) => startDrag(e, r, 'end')} onPointerMove={(e) => moveDrag(e, r)} onPointerUp={() => endDrag(r)} aria-hidden="true" />}
            </>
          )}
        </div>
        {msTicks(r.goal)}
        {cpMarks(r.goal, r.plan)}
        {dragging && (
          <span className="rm-drag-tip" style={{ left: `${Math.min(80, Math.max(0, left))}%` }}>
            {shortDate(w.start)} → {shortDate(w.end)} · {daysBetween(w.start, w.end) + 1} days
          </span>
        )}
      </div>
    );
  };

  const groupTrackEl = (row: GroupRow) => {
    const starts = row.goals.map((g) => shown(g).start).sort();
    const ends = row.goals.map((g) => shown(g).end).sort();
    const left = pct(starts[0]!);
    const width = Math.max(1.2, pct(ends.at(-1)!) - left);
    const r = groupTrack(view, row.group.id);
    return (
      <div className="rm-track">
        {months.map((m) => (
          <span key={m} className="rm-grid" style={{ left: `${pct(m)}%` }} />
        ))}
        {today >= lo && today <= hi && <span className="rm-today" style={{ left: `${pct(today)}%` }} />}
        <span className="rm-span" style={{ left: `${left}%`, width: `${width}%` }}>
          <span className="rm-span-fill" style={{ width: `${r.prog}%` }} />
        </span>
        {row.goals.map((g) => (
          <span
            key={`s-${g.goal.id}`}
            className="rm-start-mark"
            style={{ left: `${pct(shown(g).start)}%`, ['--c' as string]: g.goal.color }}
            title={`${g.goal.title} · starts ${shortDate(shown(g).start)}`}
            role="img"
            aria-label={`${g.goal.title}: starts ${shortDate(shown(g).start)}`}
          />
        ))}
        {row.goals.map((g, i) => (
          <span
            key={g.goal.id}
            className={`rm-diamond${g.done ? ' done' : ''}`}
            // Goals finishing the same day sit side by side instead of on top of each other.
            style={{ left: `calc(${pct(shown(g).end)}% - ${row.goals.slice(0, i).filter((x) => shown(x).end === shown(g).end).length * 9}px)`, ['--c' as string]: g.goal.color }}
            title={`${g.goal.title} · ${g.done ? 'done' : 'finishes'} ${shortDate(shown(g).end)}`}
            role="img"
            aria-label={`${g.goal.title}: ${g.done ? 'done' : 'finishes'} ${shortDate(shown(g).end)}`}
          />
        ))}
        {closed[row.group.id] && row.goals.filter((g) => !g.done).flatMap((g) => msTicks(g.goal))}
      </div>
    );
  };

  /** An idea planned into this season: a dashed bar from its planned dates (the season, if none). */
  const plannedRow = (i: (typeof planned)[number], inGroup: boolean) => {
    const from = i.planned_start ?? season!.start_date;
    const to = i.planned_end ?? season!.end_date;
    const path = i.path_id ? data.paths.find((p) => p.id === i.path_id) : undefined;
    const left = pct(from);
    return (
      <div key={`pi-${i.id}`} className={`rm-row goal planned${inGroup ? ' in-group' : ''}`}>
        <div className="rm-label">
          <a href={href('/goals/backlog')} className="rm-name" title="An idea in your backlog: make it a goal there">
            <span className="dot" style={{ background: 'transparent', border: `1.5px dashed ${path?.color ?? 'var(--muted)'}` }} />
            <span className="rm-title">{i.title}</span>
          </a>
          <span className="rm-meta">
            Idea · {shortDate(from)} – {shortDate(to)}
          </span>
        </div>
        <div className="rm-track">
          {months.map((m) => (
            <span key={m} className="rm-grid" style={{ left: `${pct(m)}%` }} />
          ))}
          {today >= lo && today <= hi && <span className="rm-today" style={{ left: `${pct(today)}%` }} />}
          <span className="rm-plan" style={{ left: `${left}%`, width: `${Math.max(1.2, pct(to) - left)}%`, ['--c' as string]: path?.color ?? 'var(--muted)' }} title={`${i.title}: planned ${shortDate(from)} – ${shortDate(to)}`} />
        </div>
      </div>
    );
  };

  return (
    <div className="stack rise">
      <div className="topbar">
        <span className="mono">
          {goalCount} goal{goalCount === 1 ? '' : 's'}
          {season ? ` · ${shortDate(season.start_date)} – ${shortDate(season.end_date)}` : ''}
        </span>
        <a className="avatar" href={href('/settings')} aria-label="Settings">
          {initial}
        </a>
      </div>
      <h1 style={{ marginTop: -4 }}>Goals</h1>
      <GoalsSwitch current="timeline" />

      <div className="row-between" style={{ gap: 10, flexWrap: 'wrap' }}>
        {seasons.next ? (
          <div className="seg" role="tablist" aria-label="Season">
            <button role="tab" aria-selected={which === 'current'} onClick={() => setWhich('current')}>
              This season
            </button>
            <button role="tab" aria-selected={which === 'next'} onClick={() => setWhich('next')}>
              Next season
            </button>
          </div>
        ) : (
          <span className="small muted">{season ? `${season.name}` : ''}</span>
        )}
        <div className="row-start" style={{ gap: 8 }}>
        {season && hasRows && (
          <button className="btn small" onClick={() => setMsSheet({ goalIds: rows.flatMap((r) => (r.kind === 'group' ? r.goals : [r])).filter((r) => !r.done).map((r) => r.goal.id) })}>
            <Icon name="plus" size={14} stroke={2.4} /> Add a date
          </button>
        )}
        <div className="seg" role="tablist" aria-label="View">
          <button role="tab" aria-selected={mode === 'timeline'} onClick={() => setMode('timeline')}>
            <Icon name="roadmap" size={15} /> Chart
          </button>
          <button role="tab" aria-selected={mode === 'list'} onClick={() => setMode('list')}>
            <Icon name="list" size={15} /> List
          </button>
        </div>
        </div>
      </div>

      {!season && <div className="card small muted">No season yet. Start one on the Goals page, then commit goals from your backlog.</div>}
      {season && !hasRows && <div className="card small muted">Nothing in this season yet. Commit goals from your backlog, or plan backlog ideas into it (in the idea), and they appear here with their dates.</div>}

      {season && hasRows && mode === 'timeline' && (
        <section className="card rm" aria-label="Roadmap">
          <div className="rm-head">
            <div className="rm-label rm-label-head">
              <span className="xsmall muted">Drag a bar or its ends to change dates; tap it for exact dates. Tap an empty spot or + Date to add a date.</span>
            </div>
            <div className="rm-axis">
              {months.map((m) => (
                <span key={m} className="rm-month" style={{ left: `${pct(m)}%` }}>
                  {MONTHS[Number(m.slice(5, 7)) - 1]}
                </span>
              ))}
              {today >= lo && today <= hi && (
                <span className="rm-today-label" style={{ left: `${pct(today)}%` }}>
                  Today
                </span>
              )}
            </div>
          </div>
          <div className="rm-body">
            {rows.map((row) =>
              row.kind === 'group' ? (
                <div key={row.group.id} className="rm-groupblock">
                  <div className="rm-row group">
                    <div className="rm-label">
                      <button type="button" className="rm-name rm-toggle" aria-expanded={!closed[row.group.id]} onClick={() => setClosed({ ...closed, [row.group.id]: !closed[row.group.id] })}>
                        <span className="rm-chevron" style={{ transform: closed[row.group.id] ? 'rotate(0deg)' : 'rotate(90deg)' }}>
                          <Icon name="chevron" size={13} stroke={2.4} />
                        </span>
                        <span className="rm-title">{row.group.name}</span>
                      </button>
                      <span className="rm-meta">
                        {row.goals.filter((g) => g.done).length} of {row.goals.length} done
                      </span>
                    </div>
                    {groupTrackEl(row)}
                  </div>
                  {!closed[row.group.id] &&
                    row.goals.map((g) => (
                      <div key={g.goal.id} className="rm-row goal in-group">
                        {goalLabel(g)}
                        {goalTrackEl(g)}
                      </div>
                    ))}
                </div>
              ) : (
                <div key={row.goal.id} className="rm-row goal">
                  {goalLabel(row)}
                  {goalTrackEl(row)}
                </div>
              ),
            )}
            {plannedGroups.map(({ group, ideas }) => {
              const from = ideas.map((i) => i.planned_start ?? season!.start_date).sort()[0]!;
              const to = ideas.map((i) => i.planned_end ?? season!.end_date).sort().at(-1)!;
              const gw = waitOf(data, group, today);
              return (
                <div key={`pg-${group.id}`} className="rm-groupblock">
                  <div className="rm-row group planned">
                    <div className="rm-label">
                      <a href={href(`/goals/group/${group.id}`)} className="rm-name">
                        <span className="rm-title">{group.name}</span>
                      </a>
                      <span className="rm-meta">
                        {ideas.length} planned idea{ideas.length === 1 ? '' : 's'} · in the backlog{gw && !gw.met ? ` · waits on ${gw.label}` : ''}
                      </span>
                    </div>
                    <div className="rm-track">
                      {months.map((m) => (
                        <span key={m} className="rm-grid" style={{ left: `${pct(m)}%` }} />
                      ))}
                      {today >= lo && today <= hi && <span className="rm-today" style={{ left: `${pct(today)}%` }} />}
                      <span className="rm-plan-span" style={{ left: `${pct(from)}%`, width: `${Math.max(1.2, pct(to) - pct(from))}%` }} />
                    </div>
                  </div>
                  {ideas.map((i) => plannedRow(i, true))}
                </div>
              );
            })}
            {plannedLoose.map((i) => plannedRow(i, false))}
            {which === 'current' &&
              waiting.map((w) => {
                // Not a date: the lane starts where what it waits on is due (or today), dashed.
                const from = w.info.due && w.info.due > today ? w.info.due : today;
                const left = Math.min(92, pct(from));
                return (
                  <div key={`wait-${w.id}`} className="rm-row goal waiting">
                    <div className="rm-label">
                      <span className="rm-name-row">
                        <a href={href(w.kind === 'group' ? `/goals/group/${w.id}` : '/goals/backlog')} className="rm-name">
                          <span className="dot" style={{ background: 'transparent', border: '1.5px dashed var(--muted)' }} />
                          <span className="rm-title">{w.title}</span>
                        </a>
                      </span>
                      <span className="rm-meta">
                        {w.kind === 'group' ? 'Group' : 'Idea'} · waiting{w.info.weeks ? ` ${w.info.weeks} wk` : ''}
                      </span>
                    </div>
                    <div className="rm-track">
                      {months.map((m) => (
                        <span key={m} className="rm-grid" style={{ left: `${pct(m)}%` }} />
                      ))}
                      {today >= lo && today <= hi && <span className="rm-today" style={{ left: `${pct(today)}%` }} />}
                      <span className="rm-wait-from" style={{ left: `${left}%` }} />
                      <span className="rm-wait" style={{ left: `calc(${left}% + 4px)`, right: 0 }} title={`Starts when ${w.info.label} is done${w.info.due ? ` (due ${shortDate(w.info.due)})` : ''}`}>
                        Starts when {w.info.label} is done
                      </span>
                    </div>
                  </div>
                );
              })}
          </div>
          <div className="rm-legend" aria-label="Key">
            {planned.length > 0 && (
              <span>
                <span className="lg-plan" /> Planned idea (not a goal yet)
              </span>
            )}
            {which === 'current' && waiting.length > 0 && (
              <span>
                <span className="lg-wait" /> Waiting on something, not a date
              </span>
            )}
            <span>
              <span className="lg-bar" /> Done so far
            </span>
            <span>
              <span className="lg-start" /> A goal starts
            </span>
            <span>
              <span className="lg-diamond" /> A goal's finish, in its group
            </span>
            <span>
              <span className="lg-ms" /> A date you added (drag to move)
            </span>
            <span>
              <span className="lg-cp" /> 3-month, month or week goal due
            </span>
            <span>
              <svg width="20" height="10" aria-hidden="true">
                <path d="M1 2H7V8H18" fill="none" stroke="var(--muted)" strokeWidth="1.5" />
              </svg>
              Starts after
            </span>
            <span>
              <span className="lg-today" /> Today
            </span>
          </div>
        </section>
      )}

      {season && rows.length > 0 && mode === 'timeline' && <LoadStrip plan={season} lo={lo} hi={hi} />}

      {season && rows.length > 0 && mode === 'list' && (
        <section className="card stack-sm" aria-label="Dates">
          {rows.map((row) =>
            row.kind === 'group' ? (
              <div key={row.group.id} className="rm-list-group">
                <div className="rm-list-head">
                  <b>{row.group.name}</b>
                  <span className="xsmall muted">
                    {shortDate(row.start)} – {shortDate(row.end)}
                  </span>
                </div>
                {row.goals.map((g) => (
                  <ListRow key={g.goal.id} r={g} onEdit={() => setEditing(g)} onDate={(m) => setMsSheet(m ? { milestone: m } : { goalId: g.goal.id, goalIds: [g.goal.id] })} onCheckpoint={(cp) => setCpSheet({ cp, goal: g.goal })} />
                ))}
              </div>
            ) : (
              <ListRow key={row.goal.id} r={row} onEdit={() => setEditing(row)} onDate={(m) => setMsSheet(m ? { milestone: m } : { goalId: row.goal.id, goalIds: [row.goal.id] })} onCheckpoint={(cp) => setCpSheet({ cp, goal: row.goal })} />
            ),
          )}
        </section>
      )}

      {msSheet && <MilestoneSheet {...msSheet} onClose={() => setMsSheet(null)} />}
      {cpSheet && <CheckpointSheet cp={cpSheet.cp} goal={cpSheet.goal} onClose={() => setCpSheet(null)} />}
      {editing && <DatesSheet row={editing} onClose={() => setEditing(null)} onSave={(s, e) => (save(editing, s, e), setEditing(null))} />}
    </div>
  );
}

function ListRow({ r, onEdit, onDate, onCheckpoint }: { r: GoalRow; onEdit: () => void; onDate: (m: Milestone | null) => void; onCheckpoint: (cp: Checkpoint) => void }) {
  const { data, today } = useStore();
  const view = useView();
  const days = daysBetween(r.start, r.end) + 1;
  // Every date inside the goal, in order: yours and its 3-month, month and week goals.
  const dated = [
    ...view.milestonesOf(r.goal.id).map((m) => ({ key: m.id, date: m.due_date, label: `${m.title}${m.value != null ? ` · ${m.value}${r.goal.unit ? ` ${r.goal.unit}` : ''}` : ''}${m.prize?.trim() ? ` · 🎁 ${m.prize.trim()}` : ''}`, done: !!m.completed_at, open: () => onDate(m), cp: false })),
    ...checkpointsOf(data, r.goal, weekStart(today), r.plan.id).map((cp) => ({ key: cp.id, date: cp.date, label: `${CHECKPOINT_NAME[cp.level]}: ${cp.text}`, done: cp.done, open: () => onCheckpoint(cp), cp: true })),
  ].sort((a, b) => (a.date < b.date ? -1 : 1));
  return (
    <div className="rm-list-item">
    <div className="rm-list-row">
      <span className="dot" style={{ background: r.goal.color }} />
      <a className="grow stack-sm" href={href(`/goals/${r.goal.id}`)} style={{ gap: 1, color: 'var(--ink)', textDecoration: 'none' }}>
        <span className="small strong">{r.goal.title}</span>
        <span className="xsmall muted">
          {shortDate(r.start)} → {shortDate(r.end)} · {days} days · {r.status.toLowerCase()}
        </span>
      </a>
      {!r.done && (
        <button className="btn small" onClick={() => onDate(null)} aria-label={`Add a date to ${r.goal.title}`}>
          + Date
        </button>
      )}
      {!r.done && (
        <button className="btn small" onClick={onEdit}>
          Dates
        </button>
      )}
    </div>
    {dated.length > 0 && (
      <div className="rm-list-dates">
        {dated.map((x) => (
          <button key={x.key} type="button" className={`rm-date-chip${x.done ? ' done' : ''}${x.cp ? ' cp' : ''}`} style={{ ['--c' as string]: r.goal.color }} onClick={x.open}>
            <span className={x.cp ? 'lg-cp' : 'lg-ms'} style={{ borderColor: r.goal.color, background: x.done ? r.goal.color : undefined }} />
            <span className="mono">{shortDate(x.date)}</span> {x.label}
          </button>
        ))}
      </div>
    )}
    </div>
  );
}

/** A 3-month, month or week goal: what it says and when it's due. Its text is changed on the goal's page. */
function CheckpointSheet({ cp, goal, onClose }: { cp: Checkpoint; goal: Goal; onClose: () => void }) {
  return (
    <Sheet title={CHECKPOINT_NAME[cp.level]} onClose={onClose}>
      <span className="row-start small muted" style={{ gap: 6, marginTop: -8 }}>
        <span className="dot" style={{ background: goal.color }} /> {goal.title} · due {shortDate(cp.date)}
        {cp.done ? ' · done' : ''}
      </span>
      <p style={{ margin: 0, fontSize: 17 }}>{cp.text}</p>
      <span className="xsmall muted">Its date is the end of its week. Change what it says on the goal's page, under The plan.</span>
      <div className="btn-row">
        <button
          className="btn primary"
          onClick={() => {
            onClose();
            navigate(`/goals/${goal.id}`);
          }}
        >
          Open goal
        </button>
      </div>
    </Sheet>
  );
}

/** Exact dates for one goal: start and finish, inside its season. */
function DatesSheet({ row, onClose, onSave }: { row: GoalRow; onClose: () => void; onSave: (start: ISODate, end: ISODate) => void }) {
  const view = useView();
  const goal = view.goal(row.goal.id) ?? row.goal;
  const limits = dateLimits(view, goal, row.plan);
  const [start, setStart] = useState(row.start);
  const [end, setEnd] = useState(row.end);
  const bad = end < start || start < limits.minStart || start > limits.maxEnd || end > limits.maxEnd;
  const windowName = row.plan.name;
  return (
    <Sheet title={goal.title} onClose={onClose}>
      <span className="xsmall muted" style={{ marginTop: -8 }}>
        Inside {windowName}: {shortDate(row.plan.start_date)} – {shortDate(row.plan.end_date)}
      </span>
      <div className="grid-2">
        <label className="field">
          Starts
          <input type="date" value={start} min={row.plan.start_date} max={limits.maxEnd} onChange={(e) => setStart(e.target.value)} />
        </label>
        <label className="field">
          Finishes
          <input type="date" value={end} min={start} max={limits.maxEnd} disabled={limits.endLocked} onChange={(e) => setEnd(e.target.value)} />
        </label>
      </div>
      {limits.endLocked && (
        <span className="xsmall muted row-start" style={{ gap: 6 }}>
          <Icon name="lock" size={12} stroke={2.2} /> A number goal finishes where its path does. Change the target on its page.
        </span>
      )}
      {bad && <span className="xsmall" style={{ color: 'var(--danger)' }}>The finish has to be on or after the start, inside {windowName}.</span>}
      <div className="btn-row">
        <button className="btn primary" disabled={bad} onClick={() => onSave(start, end < start ? start : end)}>
          Save dates
        </button>
        <button
          className="btn"
          onClick={() => {
            onClose();
            navigate(`/goals/${goal.id}`);
          }}
        >
          Open goal
        </button>
      </div>
    </Sheet>
  );
}
