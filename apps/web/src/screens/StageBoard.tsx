import { useEffect, useState } from 'react';
import { daysBetween, shortDate, type Goal, type ISODate } from '@six/core';
import { useStore } from '../data/store.tsx';
import { useView } from '../data/useView.ts';
import { goalTrack, nextWeekOf, stageOf, STAGES, type Stage } from '../data/season.ts';
import { pathLetter, pathsOf } from '../data/paths.ts';
import { gradientSlots, groupGradient } from '../data/palette.ts';
import { byOrder } from '../data/order.ts';
import { href } from '../router.ts';
import { Icon } from '../components/ui.tsx';
import type { DragApi } from '../components/goalDrag.ts';
import { GoalRow, type Placed } from './Season.tsx';
import { BesidePanel, useBesideView } from '../components/BesidePanel.tsx';

export type StageFilter = Stage | 'all';

const FILTER_KEY = 'six.goals.stage';
const DAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const weekday = (d: ISODate) => DAY[new Date(`${d}T00:00:00Z`).getUTCDay()]!;

/** The stage filter, remembered on this device. In progress by default. */
export function useStageFilter(): [StageFilter, (f: StageFilter) => void] {
  const [f, setF] = useState<StageFilter>(() => {
    try {
      const v = localStorage.getItem(FILTER_KEY);
      return v === 'later' || v === 'soon' || v === 'now' || v === 'all' ? v : 'now';
    } catch {
      return 'now';
    }
  });
  const set = (v: StageFilter) => {
    setF(v);
    try {
      localStorage.setItem(FILTER_KEY, v);
    } catch {
      // storage blocked: just for now
    }
  };
  return [f, set];
}

/** Whether the window is wide enough for the board's columns. */
export function useWide(min = 760): boolean {
  const query = `(min-width: ${min}px)`;
  const [wide, setWide] = useState(() => (typeof window.matchMedia === 'function' ? window.matchMedia(query).matches : true));
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const m = window.matchMedia(query);
    const on = () => setWide(m.matches);
    on();
    m.addEventListener?.('change', on);
    return () => m.removeEventListener?.('change', on);
  }, [query]);
  return wide;
}

interface Item {
  placed: Placed;
  stage: Stage;
  start: ISODate;
}

interface Row {
  key: string;
  name: string;
  headline: string;
  to: string | null;
  gradient: string;
  drop: string | undefined;
  items: Item[];
}

/**
 * The season's goals as a board: paths (or groups) are rows, and the stages run left to right:
 * Later, Up next, In progress. A goal's stage comes from its own start date.
 */
export function useBoard(placed: Placed[], by: 'path' | 'group') {
  const view = useView();
  const { data, today } = useStore();
  const items: Item[] = placed.map((p) => {
    const start = view.startFor(p.card.goal, p.plan);
    return { placed: p, start, stage: stageOf(start, today) };
  });
  const paths = pathsOf(data);
  const slots = gradientSlots(data);
  const colors = (xs: Item[]) => xs.map((x) => x.placed.card.goal.color);
  let rows: Row[];
  if (by === 'path') {
    rows = paths.map((p) => {
      const mine = items.filter((x) => x.placed.card.goal.path_id === p.id);
      return { key: p.id, name: `${pathLetter(data, p)} · ${p.name}`, headline: p.headline ?? '', to: `/paths/${p.id}`, gradient: groupGradient(p.id, colors(mine), 100, slots.get(p.id)), drop: undefined, items: mine };
    });
    const none = items.filter((x) => !x.placed.card.goal.path_id || !paths.some((p) => p.id === x.placed.card.goal.path_id));
    if (none.length) rows.push({ key: 'no-path', name: 'No path', headline: 'Goals not tied to a path', to: null, gradient: groupGradient('no-path', colors(none), 100, slots.get('no-path')), drop: undefined, items: none });
  } else {
    rows = byOrder(data.groups)
      .map((g) => {
        const mine = items.filter((x) => x.placed.card.goal.group_id === g.id);
        return { key: g.id, name: g.name, headline: '', to: `/goals/group/${g.id}`, gradient: groupGradient(g.id, colors(mine), 100, slots.get(g.id)), drop: `group:${g.id}`, items: mine };
      })
      .filter((r) => r.items.length > 0);
    const loose = items.filter((x) => !x.placed.card.goal.group_id || !data.groups.some((g) => g.id === x.placed.card.goal.group_id));
    if (loose.length) rows.push({ key: 'loose', name: 'Not in a group', headline: '', to: null, gradient: groupGradient('loose', colors(loose), 100), drop: 'loose', items: loose });
  }
  // Within a cell: your own order first (drag to set it), then by start date.
  for (const r of rows) {
    r.items.sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : 0));
    r.items = byOrder(r.items.map((x) => ({ id: x.placed.card.goal.id, sort_order: x.placed.card.goal.sort_order, x }))).map((y) => y.x);
  }
  const counts = { later: 0, soon: 0, now: 0 } as Record<Stage, number>;
  for (const x of items) counts[x.stage]++;
  const week = nextWeekOf(today);
  const nextWeek = items.filter((x) => x.start >= week.start && x.start <= week.end).sort((a, b) => (a.start < b.start ? -1 : 1));
  return { rows, counts, total: items.length, nextWeek, week };
}

/** Later → Up next → In progress, then Whole season after a divider. */
export function StageChips({ filter, onChange, counts, total }: { filter: StageFilter; onChange: (f: StageFilter) => void; counts: Record<Stage, number>; total: number }) {
  return (
    <div className="stage-chips" role="radiogroup" aria-label="Show goals">
      {STAGES.map((s) => (
        <button key={s.id} type="button" role="radio" aria-checked={filter === s.id} className={`stage-chip${filter === s.id ? ' on' : ''}`} onClick={() => onChange(s.id)}>
          <span className="stage-dot" style={{ background: s.color }} />
          {s.label} <i>{counts[s.id]}</i>
        </button>
      ))}
      <span className="stage-div" aria-hidden="true" />
      <button type="button" role="radio" aria-checked={filter === 'all'} className={`stage-chip${filter === 'all' ? ' on' : ''}`} onClick={() => onChange('all')}>
        Whole season <i>{total}</i>
      </button>
    </div>
  );
}

/** A quiet line about the goals that start next week, with a way to see them. */
export function NextWeekLine({ items, week, onShow }: { items: { placed: Placed }[]; week: { start: ISODate; end: ISODate }; onShow: () => void }) {
  if (items.length === 0) return null;
  const names = items.slice(0, 3).map((x) => x.placed.card.goal);
  return (
    <div className="next-week-line" role="status">
      <Icon name="bell" size={16} stroke={2} />
      <span>
        <b>
          Next week, {shortDate(week.start)} – {shortDate(week.end)}:
        </b>{' '}
        {items.length} goal{items.length === 1 ? '' : 's'} start
      </span>
      {names.map((g) => (
        <span key={g.id} className="nwl-name">
          <span className="stage-dot" style={{ background: g.color }} />
          {g.title}
        </span>
      ))}
      {items.length > 3 && <span>+{items.length - 3} more</span>}
      <button type="button" className="nwl-link" onClick={onShow}>
        See them in Up next
      </button>
    </div>
  );
}

function Tally({ items }: { items: Item[] }) {
  return (
    <span className="stage-tally">
      {STAGES.map((s) => (
        <span key={s.id}>
          <span className="stage-dot" style={{ background: s.color, width: 7, height: 7 }} />
          {items.filter((x) => x.stage === s.id).length} {s.label.toLowerCase()}
        </span>
      ))}
    </span>
  );
}

function MiniCard({ item, dnd, showPath, cell }: { item: Item; dnd?: DragApi; showPath: boolean; cell?: string }) {
  const view = useView();
  const { today } = useStore();
  const goal: Goal = item.placed.card.goal;
  const path = showPath && goal.path_id ? view.data.paths.find((p) => p.id === goal.path_id && !p.archived_at) : undefined;
  let sub: string;
  if (item.stage === 'now') {
    const t = goalTrack(view, goal, item.placed.plan);
    sub = `${t.now} · ${t.status}`;
  } else {
    const days = daysBetween(today, item.start);
    sub = days === 1 ? 'Starts tomorrow' : `Starts ${weekday(item.start)} ${shortDate(item.start)}`;
  }
  return (
    <a
      href={href(`/goals/${goal.id}`)}
      className={`stage-card${dnd?.drag && !dnd.drag.group && dnd.drag.goal.id === goal.id ? ' lifted' : ''}${dnd?.drag?.target === `order:${goal.id}:before` ? ' insert-before' : dnd?.drag?.target === `order:${goal.id}:after` ? ' insert-after' : ''}`}
      draggable={false}
      data-row={goal.id}
      data-container={cell ?? goal.group_id ?? 'loose'}
      onPointerDown={(e) => dnd?.start(e, { goal, group: null, goals: [goal], container: cell })}
      onClick={(e) => dnd?.consumeClick() && e.preventDefault()}
    >
      <span className="stage-dot" style={{ background: goal.color, width: 9, height: 9, marginTop: 5 }} />
      <span className="grow">
        <b>{goal.title}</b>
        <small>
          {sub}
          {path ? ` · ${pathLetter(view.data, path)}` : ''}
        </small>
      </span>
    </a>
  );
}

function Empty({ items, filter, onChange }: { items: Item[]; filter: StageFilter; onChange: (f: StageFilter) => void }) {
  const words: Record<StageFilter, string> = { later: 'later', soon: 'up next', now: 'in progress', all: 'this season' };
  const others = STAGES.filter((s) => s.id !== filter).map((s) => ({ s, n: items.filter((x) => x.stage === s.id).length })).filter((x) => x.n > 0);
  return (
    <div className="stage-empty">
      <span>{items.length === 0 ? 'No goals this season.' : `Nothing ${words[filter]} here.`}</span>
      {others.length > 0 && (
        <span className="row-start" style={{ gap: 14 }}>
          {others.map(({ s, n }) => (
            <button key={s.id} type="button" className="link-btn small" onClick={() => onChange(s.id)}>
              {n} {s.label.toLowerCase()} ›
            </button>
          ))}
        </span>
      )}
    </div>
  );
}

/** The board itself: columns on a wide screen, rows of cards on a phone. */
export function StageBoard({ placed, by, filter, onChange, dnd }: { placed: Placed[]; by: 'path' | 'group'; filter: StageFilter; onChange: (f: StageFilter) => void; dnd?: DragApi }) {
  const wide = useWide();
  const { rows } = useBoard(placed, by);
  const [besideView, setBesideView] = useBesideView();
  const [focusId, setFocus] = useState<string | null>(null);
  const [folded, setFolded] = useState<Set<string>>(() => new Set());
  const toggleFold = (key: string) =>
    setFolded((f) => {
      const n = new Set(f);
      if (n.has(key)) n.delete(key);
      else n.add(key);
      return n;
    });
  const showPath = by === 'group';
  // Whole season: the board, three even columns.
  const cols = `minmax(150px, 210px) ${STAGES.map(() => 'minmax(0, 1fr)').join(' ')}`;
  if (rows.length === 0) return null;

  // One stage picked: only its goals, in the detailed rows, one column of group sections with
  // gradient headers; beside it, the panel (Next 14 days by default). Narrow windows stack them.
  if (filter !== 'all') {
    const label = STAGES.find((s) => s.id === filter)!.label.toLowerCase();
    const shownRows = rows.map((r) => ({ r, mine: r.items.filter((x) => x.stage === filter) })).filter((x) => x.mine.length > 0);
    const hidden = rows.filter((r) => !r.items.some((x) => x.stage === filter));
    const beside = rows.flatMap((r) => r.items).map((x) => ({ goal: x.placed.card.goal, plan: x.placed.plan, start: x.start, stage: x.stage }));
    const uniq = beside.filter((x, i) => beside.findIndex((y) => y.goal.id === x.goal.id) === i);
    return (
      <div className="stage-reading">
        <div className="stage-reading-main">
          {shownRows.length === 0 && (
            <div className="stage-empty">
              <span>Nothing {label} this season.</span>
              <button type="button" className="link-btn small" style={{ alignSelf: 'flex-start' }} onClick={() => onChange('all')}>
                See the whole season ›
              </button>
            </div>
          )}
          {shownRows.map(({ r, mine }) => {
            const over = !!r.drop && dnd?.drag?.target === r.drop;
            const shut = folded.has(r.key);
            return (
              <section key={r.key} className={`season-card group-card${over ? ' drop-on' : ''}`} style={{ ['--group-gradient' as string]: r.gradient }} data-drop={r.drop} aria-label={r.name}>
                <div className="season-card-head group-head stage-sechead">
                  <button type="button" className="stage-fold" onClick={() => toggleFold(r.key)} aria-expanded={!shut}>
                    <b>{r.name}</b>
                    <span className="xsmall muted">
                      {mine.length} {label}
                      {r.items.length > mine.length ? ` · ${r.items.length - mine.length} more this season` : ''}
                    </span>
                  </button>
                  {r.to && (
                    <a href={href(r.to)} className="season-open">
                      Open <Icon name="chevron" size={14} stroke={2.4} />
                    </a>
                  )}
                  <button type="button" className="stage-fold-btn" onClick={() => toggleFold(r.key)} aria-label={shut ? `Show ${r.name}` : `Hide ${r.name}`}>
                    <span style={{ display: 'inline-flex', transform: shut ? 'none' : 'rotate(90deg)', transition: 'transform 0.2s' }}>
                      <Icon name="chevron" size={16} stroke={2.4} />
                    </span>
                  </button>
                </div>
                {!shut &&
                  mine.map((x) => (
                    <GoalRow key={x.placed.card.goal.id} placed={x.placed} dnd={dnd} hidePath={!showPath} onSelect={besideView === 'focus' ? (g) => setFocus(g.id) : undefined} selected={besideView === 'focus' && focusId === x.placed.card.goal.id} />
                  ))}
              </section>
            );
          })}
          {hidden.length > 0 && shownRows.length > 0 && (
            <span className="xsmall muted" style={{ padding: '0 4px' }}>
              Nothing {label} in {hidden.map((r) => r.name).join(', ')}.{' '}
              <button type="button" className="link-btn xsmall" style={{ padding: 0 }} onClick={() => onChange('all')}>
                See the whole season
              </button>
            </span>
          )}
        </div>
        <aside className="stage-reading-side">
          <BesidePanel goals={uniq} view={besideView} onView={setBesideView} focusId={focusId ?? shownRows[0]?.mine[0]?.placed.card.goal.id ?? null} />
        </aside>
      </div>
    );
  }

  if (wide) {
    return (
      <div className="stage-board">
        <div className="stage-board-in">
          <div className="sb-head" style={{ gridTemplateColumns: cols }}>
            <span className="sb-h sb-h-first">{by === 'path' ? 'Path' : 'Group'}</span>
            {STAGES.map((s, i) => (
              <button key={s.id} type="button" className="sb-h" onClick={() => onChange(s.id)} title={`Only ${s.label.toLowerCase()}, in more detail`}>
                <span className="stage-dot" style={{ background: s.color }} />
                {s.label}
                {i < STAGES.length - 1 && (
                  <span className="sb-arrow" aria-hidden="true">
                    →
                  </span>
                )}
              </button>
            ))}
          </div>
          {rows.map((r) => {
            const over = !!r.drop && dnd?.drag?.target === r.drop;
            return (
              <div key={r.key} className={`sb-row${over ? ' drop-on' : ''}`} style={{ gridTemplateColumns: cols }} data-drop={r.drop}>
                <div className="sb-rowhead">
                  <span className="sb-mark" style={{ background: r.gradient }} aria-hidden="true" />
                  {r.to ? (
                    <a href={href(r.to)} className="sb-name">
                      {r.name}
                    </a>
                  ) : (
                    <span className="sb-name">{r.name}</span>
                  )}
                  {r.headline && <span className="xsmall muted">{r.headline}</span>}
                  <Tally items={r.items} />
                </div>
                {STAGES.map((s) => {
                  const mine = r.items.filter((x) => x.stage === s.id);
                  return (
                    <div key={s.id} className={`sb-cell sb-${s.id}`}>
                      {mine.length ? mine.map((x) => <MiniCard key={x.placed.card.goal.id} item={x} dnd={dnd} showPath={showPath} cell={`cell:${r.key}:${s.id}`} />) : <span className="sb-dash">—</span>}
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  return (
    <div className="season-list">
      {rows.map((r) => {
        const shown = filter === 'all' ? r.items : r.items.filter((x) => x.stage === filter);
        const over = !!r.drop && dnd?.drag?.target === r.drop;
        return (
          <section key={r.key} className={`season-card group-card${over ? ' drop-on' : ''}`} style={{ ['--group-gradient' as string]: r.gradient }} data-drop={r.drop} aria-label={r.name}>
            <div className="season-card-head group-head stage-rowhead">
              <span className="row-between" style={{ gap: 10 }}>
                <b>{r.name}</b>
                {r.to && (
                  <a href={href(r.to)} className="season-open">
                    Open <Icon name="chevron" size={14} stroke={2.4} />
                  </a>
                )}
              </span>
              <Tally items={r.items} />
            </div>
            {filter === 'all' ? (
              <div className="stage-swipe">
                {STAGES.map((s) => {
                  const mine = r.items.filter((x) => x.stage === s.id);
                  return (
                    <div key={s.id} className="stage-col">
                      <span className="stage-col-h">
                        <span className="stage-dot" style={{ background: s.color }} />
                        {s.label} · {mine.length}
                      </span>
                      {mine.map((x) => (
                        <MiniCard key={x.placed.card.goal.id} item={x} dnd={dnd} showPath={showPath} cell={`cell:${r.key}:${s.id}`} />
                      ))}
                      {mine.length === 0 && <span className="sb-dash">Nothing here</span>}
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="stage-list">
                {shown.map((x) => (
                  <MiniCard key={x.placed.card.goal.id} item={x} dnd={dnd} showPath={showPath} />
                ))}
                {shown.length === 0 && <Empty items={r.items} filter={filter} onChange={onChange} />}
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}
