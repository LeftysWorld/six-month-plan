import { useEffect, useRef, useState } from 'react';
import { addDays, daysBetween, shortDate, weekStart, type Goal, type ISODate } from '@six/core';
import { useStore } from '../data/store.tsx';
import { useView } from '../data/useView.ts';
import { agenda, comingNext, focusOf, prizesInReach, todayTasks, type AgendaItem, type BesideGoal } from '../data/beside.ts';
import { goalTrack, nextWeekOf } from '../data/season.ts';
import { opsLogReading, opsLogSession } from '../data/ops.ts';
import { href } from '../router.ts';
import { Icon } from './ui.tsx';

export type BesideView = 'agenda' | 'today' | 'focus' | 'prizes' | 'log' | 'next';
const VIEWS: { id: BesideView; label: string; sub: string }[] = [
  { id: 'agenda', label: 'Next 14 days', sub: 'dates and starts' },
  { id: 'today', label: 'Today’s tasks', sub: 'tick them off' },
  { id: 'focus', label: 'Goal focus', sub: 'one goal in depth' },
  { id: 'prizes', label: 'Prizes in reach', sub: 'what it takes' },
  { id: 'log', label: 'Quick log', sub: 'the numbers' },
  { id: 'next', label: 'Coming next', sub: 'starting next week' },
];
const KEY = 'six.beside.view';
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const dow = (d: ISODate) => DOW[new Date(`${d}T00:00:00Z`).getUTCDay()]!;
const rel = (today: ISODate, d: ISODate) => {
  const n = daysBetween(today, d);
  return n <= 0 ? 'today' : n === 1 ? 'tomorrow' : `in ${n} days`;
};

/** Which view the panel shows, remembered on this device. Next 14 days by default. */
export function useBesideView(): [BesideView, (v: BesideView) => void] {
  const [v, setV] = useState<BesideView>(() => {
    try {
      const s = localStorage.getItem(KEY);
      return VIEWS.some((x) => x.id === s) ? (s as BesideView) : 'agenda';
    } catch {
      return 'agenda';
    }
  });
  const set = (x: BesideView) => {
    setV(x);
    try {
      localStorage.setItem(KEY, x);
    } catch {
      // storage blocked: just for now
    }
  };
  return [v, set];
}

/** The panel beside your goals: a menu in its header picks what it shows. */
export function BesidePanel({ goals, view: which, onView, focusId }: { goals: BesideGoal[]; view: BesideView; onView: (v: BesideView) => void; focusId: string | null }) {
  const [menu, setMenu] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!menu) return;
    const off = (e: PointerEvent) => !ref.current?.contains(e.target as Node) && setMenu(false);
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setMenu(false);
    window.addEventListener('pointerdown', off);
    window.addEventListener('keydown', esc);
    return () => {
      window.removeEventListener('pointerdown', off);
      window.removeEventListener('keydown', esc);
    };
  }, [menu]);
  const current = VIEWS.find((v) => v.id === which)!;
  return (
    <section className="beside" aria-label="Beside your goals" ref={ref}>
      <div className="beside-head">
        <button type="button" className="beside-menu" onClick={() => setMenu((m) => !m)} aria-haspopup="listbox" aria-expanded={menu}>
          {current.label}
          <span className="beside-caret" aria-hidden="true">
            <Icon name="chevron" size={15} stroke={2.4} />
          </span>
        </button>
        {which === 'focus' && <span className="xsmall muted">Click a goal</span>}
      </div>
      {menu && (
        <div className="beside-list" role="listbox" aria-label="Show beside your goals">
          {VIEWS.map((v) => (
            <button
              key={v.id}
              type="button"
              role="option"
              aria-selected={v.id === which}
              className={`beside-opt${v.id === which ? ' on' : ''}`}
              onClick={() => {
                onView(v.id);
                setMenu(false);
              }}
            >
              {v.label}
              <small>{v.sub}</small>
            </button>
          ))}
        </div>
      )}
      <div className="beside-body">
        {which === 'agenda' && <Agenda goals={goals} />}
        {which === 'today' && <TodayTasks goals={goals} />}
        {which === 'focus' && <Focus goals={goals} focusId={focusId} />}
        {which === 'prizes' && <Prizes goals={goals} />}
        {which === 'log' && <QuickLog goals={goals} />}
        {which === 'next' && <ComingNext goals={goals} />}
      </div>
    </section>
  );
}

function Agenda({ goals }: { goals: BesideGoal[] }) {
  const view = useView();
  const { today, data } = useStore();
  const [day, setDay] = useState<ISODate | null>(null);
  const reviewed = data.reviews.some((r) => r.kind === 'weekly' && r.status === 'done' && r.period_start === weekStart(today));
  const { items, after } = agenda(view, goals, today, 14, reviewed);
  const days = Array.from({ length: 14 }, (_, i) => addDays(today, i));
  const of = (d: ISODate) => items.filter((x) => x.date === d);
  const shown = (day ? [day] : days).filter((d) => of(d).length > 0);
  const mark = (x: AgendaItem) => (x.kind === 'start' ? 'ring' : x.kind === 'review' ? 'sq' : '');
  return (
    <>
      <div className="row-between" style={{ gap: 8 }}>
        <span className="xsmall muted">
          {items.length} thing{items.length === 1 ? '' : 's'} in the next two weeks
        </span>
        {day && (
          <button type="button" className="link-btn xsmall" style={{ padding: 0 }} onClick={() => setDay(null)}>
            Show all 14 days
          </button>
        )}
      </div>
      <div className="cal-strip" aria-hidden="true">
        {days.slice(0, 7).map((d) => (
          <span key={d} className="cal-h">
            {dow(d)}
          </span>
        ))}
      </div>
      <div className="cal-strip" role="group" aria-label="The next 14 days">
        {days.map((d) => {
          const xs = of(d);
          return (
            <button
              key={d}
              type="button"
              className={`cal-day${xs.length ? '' : ' empty'}${d === today ? ' today' : ''}${day === d ? ' sel' : ''}`}
              onClick={() => setDay(day === d ? null : d)}
              aria-pressed={day === d}
              aria-label={`${dow(d)} ${shortDate(d)}: ${xs.length ? `${xs.length} thing${xs.length === 1 ? '' : 's'}` : 'nothing'}`}
            >
              <b>{Number(d.slice(8))}</b>
              <span className="cal-dots">
                {xs.slice(0, 4).map((x, i) => (
                  <i key={i} className={mark(x)} style={{ background: x.color, color: x.color }} />
                ))}
              </span>
            </button>
          );
        })}
      </div>
      <div className="cal-legend">
        <span>
          <i className="dot-date" />
          Date to hit
        </span>
        <span>
          <i className="dot-start" />
          Goal starts
        </span>
        <span>
          <i className="dot-review" />
          Review
        </span>
      </div>
      {shown.length > 0 ? (
        <div className="tl">
          {shown.map((d) => (
            <div key={d}>
              <div className={`tl-day${d === today ? ' today' : ''}`}>
                {d === today ? 'Today · ' : ''}
                {dow(d)} {shortDate(d)} {d !== today && <small>{rel(today, d)}</small>}
              </div>
              {of(d).map((x, i) => {
                const inner = (
                  <>
                    <span className={`tl-node ${mark(x)}`} style={{ background: x.color, ['--c' as string]: x.color }} />
                    <span className="grow">
                      <b>{x.title}</b>
                      <small>{x.kind === 'start' ? 'Moves into In progress' : x.goal ? x.goal.title : 'Saturday, about 10 minutes'}</small>
                    </span>
                    <span className="tl-kind">{x.kind === 'date' ? 'Date' : x.kind === 'start' ? 'Starts' : 'Review'}</span>
                  </>
                );
                return x.goal ? (
                  <a key={i} className="tl-item" href={href(`/goals/${x.goal.id}`)}>
                    {inner}
                  </a>
                ) : (
                  <a key={i} className="tl-item" href={href('/review')}>
                    {inner}
                  </a>
                );
              })}
            </div>
          ))}
        </div>
      ) : (
        <span className="xsmall muted">{day ? `Nothing on ${dow(day)} ${shortDate(day)}.` : 'Nothing dated in the next two weeks.'}</span>
      )}
      <div className="row-between beside-foot">
        <span className="xsmall muted">
          {after ? (
            <>
              Just after: <b style={{ color: 'var(--ink)' }}>{after.title}</b> · {dow(after.date)} {shortDate(after.date)}
            </>
          ) : (
            'Nothing else dated yet.'
          )}
        </span>
        <a href={href('/goals/roadmap')} className="xsmall" style={{ fontWeight: 600, color: 'var(--accent-ink)', whiteSpace: 'nowrap' }}>
          Roadmap ›
        </a>
      </div>
    </>
  );
}

function TodayTasks({ goals }: { goals: BesideGoal[] }) {
  const view = useView();
  const { today, commit } = useStore();
  const tasks = todayTasks(view, goals, today);
  const left = tasks.filter((t) => t.session.status !== 'done').length;
  if (tasks.length === 0) return <span className="small muted">Nothing scheduled today for the goals in progress.</span>;
  return (
    <>
      <span className="xsmall muted">
        {left} of {tasks.length} left
      </span>
      {tasks.map(({ session, goal }) => {
        const done = session.status === 'done';
        return (
          <button key={session.id} type="button" className="beside-task" aria-pressed={done} onClick={() => commit(opsLogSession(session, { status: done ? 'planned' : 'done' }))}>
            <span className={`beside-box${done ? ' on' : ''}`}>{done && <Icon name="check" size={12} stroke={3.2} />}</span>
            <span className="grow">
              <span style={{ textDecoration: done ? 'line-through' : undefined, color: done ? 'var(--muted)' : undefined }}>{session.title}</span>
              <small>
                {session.planned_minutes ? `${session.planned_minutes} min · ` : ''}
                {goal.title}
              </small>
            </span>
            <span className="stage-dot" style={{ background: goal.color }} />
          </button>
        );
      })}
      <span className="xsmall muted">Ticking here logs it on Today too.</span>
    </>
  );
}

function Focus({ goals, focusId }: { goals: BesideGoal[]; focusId: string | null }) {
  const view = useView();
  const { today } = useStore();
  const now = goals.filter((g) => g.stage === 'now');
  const g = goals.find((x) => x.goal.id === focusId) ?? now[0] ?? goals[0];
  if (!g) return <span className="small muted">No goals in progress yet.</span>;
  const t = goalTrack(view, g.goal, g.plan);
  const f = focusOf(view, g.goal, today);
  return (
    <>
      <span className="row-start" style={{ gap: 10, flexWrap: 'nowrap' }}>
        <span className="stage-dot" style={{ background: g.goal.color, width: 12, height: 12 }} />
        <b style={{ fontSize: 16, lineHeight: 1.3 }}>{g.goal.title}</b>
      </span>
      {g.goal.why.trim() && <span className="xsmall muted" style={{ fontStyle: 'italic' }}>{g.goal.why}</span>}
      {t.started && (
        <>
          <span className="season-track" style={{ marginLeft: 0 }}>
            <span className="season-fill" style={{ width: `${t.prog}%`, background: g.goal.color }} />
            <span className="season-tick" style={{ left: `${t.exp}%` }} />
          </span>
          <span className="row-between xsmall">
            <b>{t.now}</b>
            <span className="muted">{t.status}</span>
          </span>
        </>
      )}
      <span className="label beside-label">Milestones</span>
      {f.milestones.length === 0 && <span className="xsmall muted">No dates yet.</span>}
      {f.milestones.map((m) => (
        <span key={m.id} className="beside-line">
          <span className={`beside-ring${m.completed_at ? ' on' : ''}`} />
          <span className="grow">{m.title}</span>
          <small>{m.completed_at ? 'done' : shortDate(m.due_date)}</small>
        </span>
      ))}
      <span className="label beside-label">Its tasks</span>
      {f.actions.length === 0 && <span className="xsmall muted">No tasks yet.</span>}
      {f.actions.map(({ action, when }) => (
        <span key={action.id} className="beside-line">
          <span className="grow">{action.title}</span>
          <small>{when}</small>
        </span>
      ))}
      <span className="label beside-label">Recent logs</span>
      {f.logs.length === 0 && <span className="xsmall muted">Nothing logged yet.</span>}
      {f.logs.map((l, i) => (
        <span key={i} className="beside-line">
          <small style={{ width: 52, marginLeft: 0 }}>{shortDate(l.date)}</small>
          <span className="grow">{l.text}</span>
        </span>
      ))}
      <a href={href(`/goals/${g.goal.id}`)} className="small" style={{ fontWeight: 600, color: 'var(--accent-ink)', alignSelf: 'flex-start' }}>
        Open the goal ›
      </a>
    </>
  );
}

function Prizes({ goals }: { goals: BesideGoal[] }) {
  const view = useView();
  const { today } = useStore();
  const { prizes, without } = prizesInReach(view, goals, today);
  return (
    <>
      {prizes.length === 0 && <span className="small muted">No prizes to win yet on the goals in progress.</span>}
      {prizes.map((p) => (
        <a key={p.key} className="beside-prize" href={href(p.goal ? `/goals/${p.goal.id}` : '/goals')}>
          <b>{p.title}</b>
          <span className="small">
            {p.forText}
            {p.dueDate ? ` · by ${shortDate(p.dueDate)} (${rel(today, p.dueDate)})` : ''}
          </span>
          {p.goal && <span className="xsmall muted">{p.goal.title}</span>}
        </a>
      ))}
      {without.length > 0 && (
        <>
          <span className="label beside-label">No prize yet</span>
          {without.map((g: Goal) => (
            <span key={g.id} className="beside-line">
              <span className="stage-dot" style={{ background: g.color }} />
              <span className="grow">{g.title}</span>
              <a href={href(`/goals/${g.id}`)} className="xsmall" style={{ fontWeight: 600, color: 'var(--accent-ink)' }}>
                Name one
              </a>
            </span>
          ))}
        </>
      )}
    </>
  );
}

function QuickLog({ goals }: { goals: BesideGoal[] }) {
  const view = useView();
  const { today, data, commit } = useStore();
  const now = goals.filter((g) => g.stage === 'now');
  const [vals, setVals] = useState<Record<string, string>>({});
  const readings = now.flatMap((g) => view.measurementTypesForGoal(g.goal.id).map((t) => ({ g, t, last: view.measurementsFor(t.id).slice(-1)[0] ?? null })));
  const tasks = todayTasks(view, goals, today).filter(({ action }) => action && (action.kind === 'count' || action.kind === 'minutes'));
  if (readings.length === 0 && tasks.length === 0) return <span className="small muted">Nothing to log today for the goals in progress.</span>;
  return (
    <>
      {readings.map(({ g, t, last }) => (
        <form
          key={t.id}
          className="beside-log"
          onSubmit={(e) => {
            e.preventDefault();
            const v = Number(vals[t.id]);
            if (!vals[t.id] || Number.isNaN(v)) return;
            commit(opsLogReading(data, t.id, v, today));
            setVals({ ...vals, [t.id]: '' });
          }}
        >
          <span className="stage-dot" style={{ background: g.goal.color }} />
          <label className="grow" htmlFor={`ql-${t.id}`}>
            {t.name}
            <small>{last ? `${last.value}${t.unit ? ` ${t.unit}` : ''} · ${last.measured_on === today ? 'today' : shortDate(last.measured_on)}` : 'No reading yet'}</small>
          </label>
          <input id={`ql-${t.id}`} className="beside-input" inputMode="decimal" placeholder={t.unit || 'value'} value={vals[t.id] ?? ''} onChange={(e) => setVals({ ...vals, [t.id]: e.target.value })} />
          <button type="submit" className="btn small">
            Save
          </button>
        </form>
      ))}
      {tasks.map(({ session, action, goal }) => {
        const count = action!.kind === 'count';
        const have = count ? session.actual_count ?? 0 : session.actual_minutes ?? 0;
        const goalN = count ? session.planned_count ?? 0 : session.planned_minutes;
        const bump = (n: number) => {
          const next = have + n;
          commit(opsLogSession(session, { status: goalN && next >= goalN ? 'done' : 'partial', ...(count ? { actual_count: next } : { actual_minutes: next }) }));
        };
        return (
          <div key={session.id} className="beside-log">
            <span className="stage-dot" style={{ background: goal.color }} />
            <span className="grow">
              {session.title}
              <small>
                {have}
                {goalN ? ` of ${goalN}` : ''} {count ? '' : 'min'} today
              </small>
            </span>
            <button type="button" className="btn small" onClick={() => bump(count ? 1 : 5)}>
              +{count ? 1 : 5}
            </button>
            <button type="button" className="btn small" onClick={() => bump(count ? 5 : 15)}>
              +{count ? 5 : 15}
            </button>
          </div>
        );
      })}
      <span className="xsmall muted">The goals on the left update as you log.</span>
    </>
  );
}

function ComingNext({ goals }: { goals: BesideGoal[] }) {
  const view = useView();
  const { today } = useStore();
  const week = nextWeekOf(today);
  const next = comingNext(view, goals, week);
  const nowN = goals.filter((g) => g.stage === 'now').length;
  if (next.length === 0) return <span className="small muted">Nothing starts next week.</span>;
  return (
    <>
      <span className="xsmall muted">
        Starting {shortDate(week.start)} – {shortDate(week.end)}
      </span>
      {next.map((x) => (
        <a key={x.goal.id} className="beside-next" href={href(`/goals/${x.goal.id}`)}>
          <b>{x.goal.title}</b>
          <small>
            Starts {dow(x.start)} {shortDate(x.start)}
            {x.task ? ` · first: ${x.task.title}` : x.first ? ` · first: ${x.first.title}` : ''}
          </small>
        </a>
      ))}
      <span className="small" style={{ color: 'var(--ink-2)' }}>
        By {dow(week.end)} you’ll have <b>{nowN + next.length}</b> goals in progress.{nowN + next.length > 6 ? ' That’s a lot at once: pick which start now and which wait.' : ''}
      </span>
    </>
  );
}
