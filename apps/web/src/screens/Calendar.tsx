import { useEffect, useRef, useState } from 'react';
import { addDays, isoWeekday, type ISODate } from '@six/core';
import { useStore } from '../data/store.tsx';
import { useView } from '../data/useView.ts';
import { KIND_TEXT, calendarItems, dayTitle, repeatingOn, type CalItem, type CalKind } from '../data/calendar.ts';
import { opsToggleMilestone } from '../data/ops.ts';
import { href, navigate } from '../router.ts';
import { Icon, useToast } from '../components/ui.tsx';
import { MilestoneSheet } from '../components/MilestoneSheet.tsx';

/**
 * The calendar: a month at a glance with what happens on each date (one-day tasks like an exam or a
 * class, one-offs, dates to hit, 3-month/month/week goals due, goals starting or due, the season's
 * checkpoints). Tap a day to open it: the same view as Today, for that date, where its tasks can be
 * added and checked off and its dates changed.
 */

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

const monthOf = (d: ISODate) => d.slice(0, 7);
function shiftMonth(ym: string, by: number): string {
  let [y, m] = ym.split('-').map(Number) as [number, number];
  m += by;
  while (m > 12) {
    m -= 12;
    y += 1;
  }
  while (m < 1) {
    m += 12;
    y -= 1;
  }
  return `${y}-${String(m).padStart(2, '0')}`;
}

/** The month last shown, so coming back from a day lands on the same month. */
let lastMonth: string | null = null;

/** Months to show at first, and how many more load as you near the bottom. */
const FIRST = 4;
const MORE = 3;
const MAX = 36;

export function Calendar() {
  const { data, today } = useStore();
  const view = useView();
  const home = lastMonth ?? monthOf(today);
  // The months on the page: from `start`, `count` of them, one under the other.
  const [start, setStart] = useState(home);
  const [count, setCount] = useState(FIRST);
  // The month in view (the bar names it; the arrows move from it).
  const [month, setMonthState] = useState(home);
  const setMonth = (m: string) => {
    lastMonth = m;
    setMonthState(m);
  };
  const [repeating, setRepeating] = useState(false);
  const months = Array.from({ length: count }, (_, i) => shiftMonth(start, i));
  const rangeStart = `${months[0]}-01`;
  const rangeEnd = addDays(`${shiftMonth(months.at(-1)!, 1)}-01`, -1);
  const items = calendarItems(view, rangeStart, rangeEnd);
  const [y, m] = month.split('-').map(Number) as [number, number];
  const initial = (data.profile.display_name || 'You').trim().charAt(0).toUpperCase();
  const upcoming = [...items.entries()].filter(([d]) => d >= today && monthOf(d) === month).reduce((n, [, l]) => n + l.filter((x) => !x.done && x.kind !== 'season').length, 0);

  const refs = useRef(new Map<string, HTMLElement>());
  const bottom = useRef<HTMLDivElement>(null);
  const pendingScroll = useRef<string | null>(home);
  // While a jump from the arrows is still scrolling, the bar keeps the month you picked.
  const holdUntil = useRef(0);

  // Scroll a month's heading to just under the pinned bar.
  const scrollTo = (ym: string, smooth = true) => {
    const el = refs.current.get(ym);
    if (!el) return false;
    const bar = document.querySelector('.cal-sticky') as HTMLElement | null;
    const top = el.getBoundingClientRect().top + window.scrollY - (bar?.offsetHeight ?? 0) - 8;
    // Glide for a month or two; jump for long trips (a smooth scroll across a year takes too long).
    const far = Math.abs(top - window.scrollY) > window.innerHeight * 2.5;
    window.scrollTo({ top, behavior: smooth && !far ? 'smooth' : 'auto' });
    return true;
  };
  const go = (ym: string) => {
    holdUntil.current = Date.now() + 900;
    if (ym < start) {
      // Earlier than the first month on the page: add the months before it.
      setStart(ym);
      setCount((c) => c + monthsBetween(ym, start));
      pendingScroll.current = ym;
    } else if (ym > months.at(-1)!) {
      setCount((c) => Math.min(MAX, c + monthsBetween(months.at(-1)!, ym)));
      pendingScroll.current = ym;
    } else scrollTo(ym);
    setMonth(ym);
  };
  // After months are added, land on the one asked for.
  useEffect(() => {
    const want = pendingScroll.current;
    if (!want) return;
    pendingScroll.current = null;
    // The first month on the page needs no scroll (the page opens at the top); others glide into view.
    if (want === start && want === home) return;
    requestAnimationFrame(() => scrollTo(want));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [start, count]);
  // The month in view follows the scroll.
  useEffect(() => {
    if (typeof IntersectionObserver === 'undefined') return;
    // Entries only report changes, so keep every month that's on screen and name the earliest.
    const onScreen = new Set<string>();
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          const ym = (e.target as HTMLElement).dataset.month!;
          if (e.isIntersecting) onScreen.add(ym);
          else onScreen.delete(ym);
        }
        const first = [...onScreen].sort()[0];
        if (first && Date.now() > holdUntil.current) setMonth(first);
      },
      { rootMargin: '-140px 0px -55% 0px' },
    );
    refs.current.forEach((el) => io.observe(el));
    return () => io.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [start, count]);
  // Near the bottom: load the next few months.
  useEffect(() => {
    const el = bottom.current;
    if (!el || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver((entries) => entries.some((e) => e.isIntersecting) && setCount((c) => Math.min(MAX, c + MORE)), { rootMargin: '600px 0px' });
    io.observe(el);
    return () => io.disconnect();
  }, [count]);

  return (
    <div className="stack rise">
      <div className="topbar">
        <span className="mono">
          {upcoming} coming up in {MONTHS[m - 1]}
        </span>
        <a className="avatar" href={href('/settings')} aria-label="Settings">
          {initial}
        </a>
      </div>
      <h1 style={{ marginTop: -4 }}>Calendar</h1>

      <section className="card cal cal-scroll" aria-label="Calendar">
        <div className="cal-sticky">
          <div className="cal-bar">
            <div className="row-start" style={{ gap: 4, flexWrap: 'nowrap' }}>
              <button className="icon-btn" aria-label="Previous month" onClick={() => go(shiftMonth(month, -1))}>
                <Icon name="back" size={16} stroke={2.4} />
              </button>
              <b className="cal-month" aria-live="polite">
                {MONTHS[m - 1]} {y}
              </b>
              <button className="icon-btn" aria-label="Next month" onClick={() => go(shiftMonth(month, 1))}>
                <Icon name="chevron" size={16} stroke={2.4} />
              </button>
            </div>
            <div className="row-start" style={{ gap: 6 }}>
              <button className={`chip cal-chip`} aria-pressed={repeating} onClick={() => setRepeating(!repeating)} title="Show how many repeating tasks run each day">
                Repeating
              </button>
              {monthOf(today) !== month && (
                <button className="btn small" onClick={() => go(monthOf(today))}>
                  This month
                </button>
              )}
            </div>
          </div>
          <div className="cal-grid cal-dows" aria-hidden="true">
            {DAYS.map((d) => (
              <span key={d} className="cal-dow">
                {d}
              </span>
            ))}
          </div>
        </div>
        <span className="xsmall muted cal-hint">Tap a day to open it. Scroll for the months ahead.</span>
        {months.map((ym) => {
          const [yy, mm] = ym.split('-').map(Number) as [number, number];
          const first = `${ym}-01`;
          const lead = isoWeekday(first) - 1;
          const days = Number(addDays(`${shiftMonth(ym, 1)}-01`, -1).slice(8));
          const cells: (ISODate | null)[] = [...Array.from({ length: lead }, () => null), ...Array.from({ length: days }, (_, i) => addDays(first, i))];
          while (cells.length % 7) cells.push(null);
          return (
            <div
              key={ym}
              className="cal-month-block"
              data-month={ym}
              ref={(el) => {
                if (el) refs.current.set(ym, el);
                else refs.current.delete(ym);
              }}
            >
              <h2 className={`cal-month-title${ym === monthOf(today) ? ' now' : ''}`}>
                {MONTHS[mm - 1]} <span>{yy}</span>
              </h2>
              <div className="cal-grid" role="grid" aria-label={`${MONTHS[mm - 1]} ${yy}`}>
                {cells.map((d, i) => {
                  if (!d) return <span key={`b${i}`} className="cal-cell blank" aria-hidden="true" />;
                  const list = items.get(d) ?? [];
                  const rep = repeating ? repeatingOn(data, d) : null;
                  return (
                    <button
                      key={d}
                      type="button"
                      role="gridcell"
                      className={`cal-cell${d === today ? ' today' : ''}${d < today ? ' past' : ''}`}
                      aria-label={`Open ${dayTitle(d)}${list.length ? `: ${list.map((x) => x.title).join(', ')}` : ''}`}
                      onClick={() => {
                        lastMonth = ym;
                        navigate(d === today ? '/today' : `/today/${d}`);
                      }}
                    >
                      <span className="cal-num-row">
                        <span className="cal-num">{Number(d.slice(8))}</span>
                        {d === today && <span className="cal-today-tag">Today</span>}
                      </span>
                      <span className="cal-items">
                        {list.slice(0, 3).map((x) => (
                          <span key={x.id} className={`cal-pill k-${x.kind}${x.done ? ' done' : ''}`} style={{ ['--c' as string]: x.color }}>
                            <KindMark kind={x.kind} />
                            <span className="cal-pill-text">{x.title}</span>
                          </span>
                        ))}
                        {list.length > 3 && <span className="cal-more">+{list.length - 3}</span>}
                      </span>
                      <span className="cal-dots" aria-hidden="true">
                        {list.slice(0, 4).map((x) => (
                          <span key={x.id} className={`cal-dot k-${x.kind}${x.done ? ' done' : ''}`} style={{ ['--c' as string]: x.color }} />
                        ))}
                      </span>
                      {rep && rep.goals + rep.habits > 0 && <span className="cal-rep">{rep.goals + rep.habits} repeating</span>}
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
        <div ref={bottom} className="cal-more-months">
          {count < MAX ? (
            <button type="button" className="link-btn small" onClick={() => setCount((c) => Math.min(MAX, c + MORE))}>
              Show more months
            </button>
          ) : (
            <span className="xsmall muted">That’s three years out.</span>
          )}
        </div>
        <div className="cal-legend" aria-label="Key">
          {(['task', 'milestone', 'checkpoint', 'start', 'finish', 'season'] as CalKind[]).map((k) => (
            <span key={k}>
              <KindMark kind={k} /> {k === 'task' ? 'One day' : k === 'start' ? 'Goal starts' : k === 'finish' ? 'Goal due' : k === 'season' ? 'Season' : k === 'checkpoint' ? '3-month, month, week goal' : 'Date to hit'}
            </span>
          ))}
        </div>
      </section>
    </div>
  );
}

/** How many months from one to another (both YYYY-MM). */
function monthsBetween(a: string, b: string): number {
  const [ay, am] = a.split('-').map(Number) as [number, number];
  const [by, bm] = b.split('-').map(Number) as [number, number];
  return (by - ay) * 12 + (bm - am);
}

/** A small mark for each kind: a square for a one-day task, a ring for a date to hit, a bar end for a goal's start or due date. */
export function KindMark({ kind }: { kind: CalKind }) {
  return <span className={`kmark k-${kind}`} aria-hidden="true" />;
}

/**
 * "On this day" on a day's page: the dates that fall on it, besides its tasks (those are the task
 * cards): dates to hit (tick them off, tap to change), 3-month/month/week goals due, goals starting
 * or due, the season's dates. "+ Date to hit" adds one for a goal on this day.
 */
export function DayDates({ day }: { day: ISODate }) {
  const { data, today, commit } = useStore();
  const view = useView();
  const toast = useToast();
  const [editing, setEditing] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const list: CalItem[] = (calendarItems(view, day, day).get(day) ?? []).filter((x) => x.kind !== 'task' && x.kind !== 'oneoff');
  const ms = editing ? data.milestones.find((x) => x.id === editing) : undefined;
  const goals = view.activeGoals;
  if (list.length === 0 && day === today) {
    return adding ? <MilestoneSheet date={day} onClose={() => setAdding(false)} /> : null;
  }
  return (
    <section className="card stack-sm day-dates" aria-label="On this day">
      <div className="row-between">
        <span className="label">On this day</span>
        {goals.length > 0 && (
          <button type="button" className="link-btn small" onClick={() => setAdding(true)}>
            + Date to hit
          </button>
        )}
      </div>
      {list.length === 0 && <span className="small muted">No dates on this day.</span>}
      {list.map((x) => (
        <div key={x.id} className="cal-row">
          {x.milestoneId ? (
            <button
              type="button"
              className={`ring ${x.done ? 'done' : ''}`}
              onClick={() => {
                const m = data.milestones.find((y) => y.id === x.milestoneId);
                if (!m) return;
                commit(opsToggleMilestone(m));
                toast(m.completed_at ? `${m.title} reopened` : `${m.title} done`, () => commit([{ kind: 'update', collection: 'milestones', id: m.id, patch: { completed_at: m.completed_at } }]));
              }}
              aria-label={x.done ? `${x.title} done, tap to reopen` : `Mark ${x.title} done`}
              style={{ flex: 'none', cursor: 'pointer' }}
            >
              {x.done && <Icon name="check" size={12} stroke={3.2} />}
            </button>
          ) : (
            <span className="cal-row-mark" style={{ ['--c' as string]: x.color }}>
              <KindMark kind={x.kind} />
            </span>
          )}
          {x.milestoneId ? (
            <button type="button" className="grow stack-sm cal-row-btn" onClick={() => setEditing(x.milestoneId!)} aria-label={`Change ${x.title}`} style={{ gap: 1, minWidth: 0 }}>
              <span className="small strong" style={{ textDecoration: x.done ? 'line-through' : undefined, color: x.done ? 'var(--muted)' : undefined }}>
                {x.title}
              </span>
              <span className="xsmall muted">
                {KIND_TEXT[x.kind]} · {x.sub} · tap to change
              </span>
            </button>
          ) : (
            <a className="grow stack-sm" href={x.to ? href(x.to) : undefined} style={{ gap: 1, color: 'var(--ink)', textDecoration: 'none', minWidth: 0 }}>
              <span className="small strong" style={{ textDecoration: x.done ? 'line-through' : undefined, color: x.done ? 'var(--muted)' : undefined }}>
                {x.title}
              </span>
              <span className="xsmall muted">
                {KIND_TEXT[x.kind]} · {x.sub}
              </span>
            </a>
          )}
        </div>
      ))}
      {ms && <MilestoneSheet milestone={ms} onClose={() => setEditing(null)} />}
      {adding && <MilestoneSheet date={day} onClose={() => setAdding(false)} />}
    </section>
  );
}
