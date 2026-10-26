import { useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { addDays, daysBetween, shortDate, type Goal, type GoalGroup, type ISODate, type Plan } from '@six/core';
import { useStore } from '../data/store.tsx';
import { useView, type View } from '../data/derive.ts';
import { goalTrack, groupTrack, seasonsOf } from '../data/season.ts';
import { afterChoices, clampDates, dateLimits, opsRestoreDates, opsSetGoalDates } from '../data/dates.ts';
import { href, navigate } from '../router.ts';
import { Icon, Sheet, useToast } from '../components/ui.tsx';

/**
 * The roadmap: every goal of a season on one timeline, from its start to its finish, grouped the
 * way you grouped them. A group's row shows its outcome with each of its goals' finishes as a
 * milestone (◆); "starts after" shows as an arrow. Dates change right here: drag a bar's ends (or
 * the whole bar), or tap it for exact dates. Changes are the goals' own dates, so the goal pages,
 * pace and reviews follow.
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
  waiting: string | null;
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
  // The season's batch plus own clocks that run inside it.
  const plans = view.data.plans.filter((p) => !p.archived_at && (p.id === season.id || (p.solo && p.start_date <= season.end_date && p.end_date >= season.start_date)));
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
        end: done && g.completed_at!.slice(0, 10) < w.end ? (g.completed_at!.slice(0, 10) < w.start ? w.start : g.completed_at!.slice(0, 10)) : w.end,
        prog: done ? 100 : t.prog,
        status: done ? `Done ${shortDate(g.completed_at!.slice(0, 10))}` : t.status,
        waiting: t.waiting ?? null,
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
  const season = which === 'next' ? seasons.next : seasons.current;
  const { rows, lo, hi } = buildRows(view, season);
  const span = Math.max(1, daysBetween(lo, hi));
  const pct = (d: ISODate) => (Math.max(0, Math.min(span, daysBetween(lo, d))) / span) * 100;
  const months = monthStarts(lo, hi);
  const initial = (data.profile.display_name || 'You').trim().charAt(0).toUpperCase();
  const goalCount = rows.reduce((n, r) => n + (r.kind === 'group' ? r.goals.length : 1), 0);

  // Bars are measured after layout to draw "starts after" arrows between them, at any width.
  const body = useRef<HTMLDivElement>(null);
  const bars = useRef(new Map<string, HTMLDivElement>());
  const [arrows, setArrows] = useState<{ id: string; d: string; late: boolean }[]>([]);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const visibleIds = new Set(rows.flatMap((r) => (r.kind === 'group' ? (closed[r.group.id] ? [] : r.goals.map((g) => g.goal.id)) : [r.goal.id])));
  const links = rows
    .flatMap((r) => (r.kind === 'group' ? r.goals : [r]))
    .filter((r) => r.goal.after_goal_id && visibleIds.has(r.goal.id) && visibleIds.has(r.goal.after_goal_id))
    .map((r) => ({ from: r.goal.after_goal_id!, to: r.goal.id }));
  const linkKey = links.map((l) => `${l.from}>${l.to}`).join(',');
  useLayoutEffect(() => {
    const el = body.current;
    if (!el) return;
    const measure = () => {
      const box = el.getBoundingClientRect();
      setSize({ w: box.width, h: box.height });
      const next: { id: string; d: string; late: boolean }[] = [];
      for (const l of links) {
        const a = bars.current.get(l.from)?.getBoundingClientRect();
        const b = bars.current.get(l.to)?.getBoundingClientRect();
        if (!a || !b) continue;
        const x1 = a.right - box.left;
        const y1 = a.top + a.height / 2 - box.top;
        const x2 = b.left - box.left;
        const y2 = b.top + b.height / 2 - box.top;
        const late = x2 < x1 - 1;
        const elbow = late ? x1 : Math.min(x1 + 8, x2 - 6);
        next.push({ id: `${l.from}>${l.to}`, late, d: late ? `M${x1},${y1 + a.height / 2} V${b.top - box.top - 2}` : `M${x1},${y1} H${elbow} V${y2} H${x2 - 2}` });
      }
      setArrows(next);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
    // Re-measure when rows, collapsed groups or a drag change the bars.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [linkKey, data, which, mode, closed, drag?.start, drag?.end]);

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
    const c = clampDates(limits, s, en);
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
    save(r, d.start, d.end);
  }
  function save(r: GoalRow, start: ISODate, end: ISODate, after?: string | null) {
    const before = r.goal;
    const res = opsSetGoalDates(view, r.goal, r.plan, { start, end }, today);
    const ops = [...res.ops];
    if (after !== undefined && (after || null) !== (r.goal.after_goal_id ?? null)) ops.push({ kind: 'update', collection: 'goals', id: r.goal.id, patch: { after_goal_id: after || null } });
    if (!ops.length) return;
    commit(ops);
    toast(`${r.goal.title}: ${shortDate(res.start)} – ${shortDate(res.end)}${res.clamped ? ' (kept inside its window)' : ''}`, () => commit([...opsRestoreDates(before), { kind: 'update', collection: 'goals', id: before.id, patch: { after_goal_id: before.after_goal_id ?? null } }]));
  }

  const shown = (r: GoalRow) => (drag?.goalId === r.goal.id && drag.moved ? { start: drag.start, end: drag.end } : { start: r.start, end: r.end });

  const goalLabel = (r: GoalRow) => {
    const w = shown(r);
    return (
      <div className="rm-label">
        <a href={href(`/goals/${r.goal.id}`)} className="rm-name" title={`Open ${r.goal.title}`}>
          <span className="dot" style={{ background: r.goal.color, opacity: r.waiting ? 0.45 : 1 }} />
          <span className="rm-title">{r.goal.title}</span>
        </a>
        <span className="rm-meta">
          {shortDate(w.start)} – {shortDate(w.end)} · <span className={r.status.startsWith('Behind') || /behind/.test(r.status) ? 'warn' : ''}>{r.waiting ? `Up next · after ${r.waiting}` : r.status}</span>
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
      <div className="rm-track">
        {months.map((m) => (
          <span key={m} className="rm-grid" style={{ left: `${pct(m)}%` }} />
        ))}
        {today >= lo && today <= hi && <span className="rm-today" style={{ left: `${pct(today)}%` }} />}
        <div
          ref={(el) => {
            if (el) bars.current.set(r.goal.id, el);
            else bars.current.delete(r.goal.id);
          }}
          className={`rm-bar${r.waiting ? ' waiting' : ''}${r.done ? ' done' : ''}${dragging ? ' dragging' : ''}`}
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
      <h1 style={{ marginTop: -4 }}>Roadmap</h1>

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
        <div className="seg" role="tablist" aria-label="View">
          <button role="tab" aria-selected={mode === 'timeline'} onClick={() => setMode('timeline')}>
            <Icon name="roadmap" size={15} /> Timeline
          </button>
          <button role="tab" aria-selected={mode === 'list'} onClick={() => setMode('list')}>
            <Icon name="list" size={15} /> List
          </button>
        </div>
      </div>

      {!season && <div className="card small muted">No season yet. Start one on the Goals page, then commit goals from your backlog.</div>}
      {season && rows.length === 0 && <div className="card small muted">Nothing in this season yet. Commit goals from your backlog and they appear here with their dates.</div>}

      {season && rows.length > 0 && mode === 'timeline' && (
        <section className="card rm" aria-label="Timeline">
          <div className="rm-head">
            <div className="rm-label rm-label-head">
              <span className="xsmall muted">Drag a bar or its ends to change dates. Tap it for exact dates.</span>
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
          <div className="rm-body" ref={body}>
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
                        {row.group.outcome?.trim() ? `${row.group.outcome} · ` : ''}
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
            <svg className="rm-arrows" width={size.w} height={size.h} aria-hidden="true">
              <defs>
                <marker id="rm-arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto">
                  <path d="M0 0L8 4L0 8z" fill="var(--muted)" />
                </marker>
                <marker id="rm-arrow-late" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto">
                  <path d="M0 0L8 4L0 8z" fill="var(--amber)" />
                </marker>
              </defs>
              {arrows.map((a) => (
                <path key={a.id} d={a.d} fill="none" stroke={a.late ? 'var(--amber)' : 'var(--muted)'} strokeWidth={1.5} markerEnd={`url(#${a.late ? 'rm-arrow-late' : 'rm-arrow'})`} />
              ))}
            </svg>
          </div>
          <div className="rm-legend" aria-label="Key">
            <span>
              <span className="lg-bar" /> Done so far
            </span>
            <span>
              <span className="lg-bar next" /> Up next
            </span>
            <span>
              <span className="lg-diamond" /> A goal's finish, in its group
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

      {season && rows.length > 0 && mode === 'list' && (
        <section className="card stack-sm" aria-label="Dates">
          {rows.map((row) =>
            row.kind === 'group' ? (
              <div key={row.group.id} className="rm-list-group">
                <div className="rm-list-head">
                  <b>{row.group.name}</b>
                  <span className="xsmall muted">
                    {row.group.outcome?.trim() ? `${row.group.outcome} · ` : ''}
                    {shortDate(row.start)} – {shortDate(row.end)}
                  </span>
                </div>
                {row.goals.map((g) => (
                  <ListRow key={g.goal.id} r={g} onEdit={() => setEditing(g)} />
                ))}
              </div>
            ) : (
              <ListRow key={row.goal.id} r={row} onEdit={() => setEditing(row)} />
            ),
          )}
        </section>
      )}

      {editing && <DatesSheet row={editing} onClose={() => setEditing(null)} onSave={(s, e, after) => (save(editing, s, e, after), setEditing(null))} />}
    </div>
  );
}

function ListRow({ r, onEdit }: { r: GoalRow; onEdit: () => void }) {
  const days = daysBetween(r.start, r.end) + 1;
  return (
    <div className="rm-list-row">
      <span className="dot" style={{ background: r.goal.color, opacity: r.waiting ? 0.45 : 1 }} />
      <a className="grow stack-sm" href={href(`/goals/${r.goal.id}`)} style={{ gap: 1, color: 'var(--ink)', textDecoration: 'none' }}>
        <span className="small strong">{r.goal.title}</span>
        <span className="xsmall muted">
          {shortDate(r.start)} → {shortDate(r.end)} · {days} days · {r.waiting ? `up next, after ${r.waiting}` : r.status.toLowerCase()}
        </span>
      </a>
      {!r.done && (
        <button className="btn small" onClick={onEdit}>
          Dates
        </button>
      )}
    </div>
  );
}

/** Exact dates for one goal: start, finish, and what it starts after, inside its window. */
function DatesSheet({ row, onClose, onSave }: { row: GoalRow; onClose: () => void; onSave: (start: ISODate, end: ISODate, after: string | null) => void }) {
  const view = useView();
  const goal = view.goal(row.goal.id) ?? row.goal;
  const limits = dateLimits(view, goal, row.plan);
  const [start, setStart] = useState(row.start);
  const [end, setEnd] = useState(row.end);
  const [after, setAfter] = useState(goal.after_goal_id ?? '');
  const choices = afterChoices(view.goalsForPlan(row.plan.id), goal);
  const pickedAfter = after ? view.goal(after) : undefined;
  const afterPlan = pickedAfter ? view.planForGoal(pickedAfter) : null;
  const afterEnd = pickedAfter && afterPlan && !pickedAfter.completed_at ? view.endFor(pickedAfter, afterPlan) : null;
  const minStart = afterEnd && addDays(afterEnd, 1) > row.plan.start_date ? addDays(afterEnd, 1) : row.plan.start_date;
  const tooEarly = start < minStart;
  const bad = end < start || start > limits.maxEnd || end > limits.maxEnd;
  const windowName = row.plan.solo ? 'its own clock' : row.plan.name;
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
      {choices.length > 0 && (
        <label className="field">
          Starts after
          <select value={after} onChange={(e) => setAfter(e.target.value)}>
            <option value="">Nothing, it runs on its own dates</option>
            {choices.map((g) => (
              <option key={g.id} value={g.id}>
                {g.title}
              </option>
            ))}
          </select>
        </label>
      )}
      {tooEarly && afterEnd && (
        <span className="xsmall" style={{ color: 'var(--amber-ink)' }}>
          {pickedAfter!.title} is due to end {shortDate(afterEnd)}, so this starts {shortDate(minStart)} at the earliest.
        </span>
      )}
      {bad && <span className="xsmall" style={{ color: 'var(--danger)' }}>The finish has to be on or after the start, inside {windowName}.</span>}
      <div className="btn-row">
        <button className="btn primary" disabled={bad} onClick={() => onSave(tooEarly ? minStart : start, end < (tooEarly ? minStart : start) ? (tooEarly ? minStart : start) : end, after || null)}>
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
