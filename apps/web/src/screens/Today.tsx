import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { addDays, isoWeekday, minutesLeft, shortDate, weekDates, weekStart, weekdayName, type ISODate, type Session } from '@six/core';
import { useStore } from '../data/store.tsx';
import { fmt, minutesText, useView } from '../data/derive.ts';
import { coachLine } from '../data/coach.ts';
import { checkInStreak, dismissRitual, ritualDue, type Streak } from '../data/habit.ts';
import { parseQuickAdd } from '../data/parse.ts';
import { blankTask, opsAddTask, withOps } from '../data/breakdown.ts';
import { chainFor, opsEnsureStep, stepFor } from '../data/chain.ts';
import { opsAddOneOff, opsEnsureWeek, opsLogSession, opsLogUnplanned, opsMoveSession, opsRestoreSession } from '../data/ops.ts';
import { href } from '../router.ts';
import { Icon, Sheet, WEEKDAY_NAMES, useToast } from '../components/ui.tsx';
import { LogSheet } from './LogSheet.tsx';
import { WorkoutCardPlan } from '../components/Workout.tsx';
import { MeasureSheet } from '../components/MeasureSheet.tsx';
import { useAddFiles } from '../components/Attachments.tsx';
import { lastReading, measureLabel, measureOnToday, opsRecordReading, readingOn } from '../data/connect.ts';
import { CommitmentCard } from '../components/Commitment.tsx';
import { opsAddIdea } from '../data/backlog.ts';
import { currentCommitment } from '../data/insights.ts';

const FULL_DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const fullDay = (d: ISODate) => FULL_DAYS[isoWeekday(d) - 1] ?? '';
const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
const monoDate = (d: ISODate) => `${weekdayName(d).toUpperCase()} · ${Number(d.slice(8))} ${MONTHS[Number(d.slice(5, 7)) - 1]}`;

export function Today() {
  const { data, today, commit } = useStore();
  const view = useView();
  const toast = useToast();
  const [open, setOpen] = useState<Session | null>(null);
  const [adding, setAdding] = useState(false);
  // The day being shown. Opens on today; tap a day, page weeks with ‹ ›, or use the arrow keys.
  const [picked, setPicked] = useState<ISODate>(today);
  const [, bump] = useState(0);
  const thisMonday = weekStart(today);
  const monday = weekStart(picked);
  const week = weekDates(monday);
  const day = picked;
  const isToday = day === today;
  const isFuture = day > today;
  const isThisWeek = monday === thisMonday;
  const weekOffset = Math.round((Date.parse(monday) - Date.parse(thisMonday)) / (7 * 86400000));
  const weekName = weekOffset === 0 ? 'This week' : weekOffset === 1 ? 'Next week' : weekOffset === -1 ? 'Last week' : `Week of ${shortDate(monday)}`;
  /**
   * Page to another week. Forward lands on its Monday, back on its Sunday (the day next to where
   * you were), and landing on this week shows today.
   */
  const goWeek = (by: number) => {
    const target = addDays(monday, 7 * by);
    setPicked(target === thisMonday ? today : by > 0 ? target : addDays(target, 6));
  };

  // A future week's tasks are made when you look at it, so you can see what's coming.
  useEffect(() => {
    if (monday <= thisMonday) return;
    const ops = opsEnsureWeek(data, monday);
    if (ops.length > 0) commit(ops);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [monday, thisMonday, data.actions.length, data.schedules.length]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || isTyping(e.target)) return;
      if (e.key === 'ArrowLeft') setPicked(addDays(day, -1));
      if (e.key === 'ArrowRight') setPicked(addDays(day, 1));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [day]);

  const sessions = view.sessionsOn(day);
  const done = sessions.filter((s) => s.status !== 'planned');
  const tray = view.unplacedThisWeek();
  const trayGroups = [...new Map(tray.map((s) => [s.action_id ?? s.id, s])).values()].map((s) => ({
    first: s,
    count: tray.filter((t) => (t.action_id ?? t.id) === (s.action_id ?? s.id)).length,
  }));
  // Times-a-week tasks show on today's list once, until one is done or planned today: a task happens
  // at most once a day, so days you missed earlier in the week can't be made up today.
  const trayToday = isToday ? trayGroups.filter(({ first }) => view.canPlace(first, today)).map((g) => g.first) : [];
  const weekOf = (actionId: string | null) => view.sessionsInWeek(weekStart(today)).filter((x) => x.action_id === actionId && x.origin === 'scheduled');
  const hintFor = (s: Session): string | null => {
    if (!s.action_id || s.date) return null;
    const all = weekOf(s.action_id);
    const done = all.filter((x) => x.status === 'done' || x.status === 'partial' || x.status === 'minimum').length;
    return `${done} of ${all.length} this week`;
  };
  const planned = [...sessions.filter((s) => s.status === 'planned'), ...trayToday].sort(
    (a, b) => Number(b.priority) - Number(a.priority),
  );
  const available = data.profile.available_minutes[isoWeekday(day) - 1] ?? 0;
  // "Any day this week" tasks go on the day you're looking at, unless that day has passed.
  const placeOn = day >= today ? day : today;

  const plan = view.mainPlan;
  const coach = isToday ? coachLine(view, plan, today, sessions) : null;
  const streak = checkInStreak(data.sessions, today);
  const commitment = currentCommitment(data.reviews, today);
  const initial = (data.profile.display_name || 'You').trim().charAt(0).toUpperCase();
  const showMorning = isToday && ritualDue('morning', today);
  const showEvening = isToday && !showMorning && ritualDue('evening', today);

  // A measure task asks for the number; a photo task takes the photo; anything else checks off.
  const [measuring, setMeasuring] = useState<Session | null>(null);
  const photoInput = useRef<HTMLInputElement>(null);
  const photoFor = useRef<Session | null>(null);
  const { addFiles } = useAddFiles();

  async function photoPicked(list: FileList | null) {
    const s = photoFor.current;
    const files = [...(list ?? [])];
    if (photoInput.current) photoInput.current.value = '';
    photoFor.current = null;
    if (!s || files.length === 0) return;
    const added = await addFiles(s, files, { quiet: true });
    if (added === 0) return;
    commit(opsLogSession(s, { status: 'done', on: today }));
    toast(`${s.title}: photo saved`, () => commit(opsRestoreSession(s)));
  }

  function toggle(s: Session) {
    const before = s;
    if (isFuture) {
      toast(`You can check this off on ${weekdayName(day)}`);
      return;
    }
    const kind = view.action(s.action_id)?.kind;
    if (s.status === 'planned' && kind === 'measure') {
      setMeasuring(s);
      return;
    }
    if (s.status === 'planned' && kind === 'photo') {
      photoFor.current = s;
      photoInput.current?.click();
      return;
    }
    if (s.status === 'planned') {
      commit(opsLogSession(s, { status: 'done', on: today }));
      toast(`${s.title} done`, () => commit(opsRestoreSession(before)));
    } else {
      commit(opsLogSession(s, { status: 'planned', actual_minutes: null, actual_count: null }));
      toast(`${s.title} unchecked`, () => commit(opsRestoreSession(before)));
    }
  }

  /** Every task, workouts included, opens the same log sheet. */
  function openSession(s: Session) {
    setOpen(s);
  }

  // Progress segments fill from the left: done, then partly done, then still to do.
  const rank = (x: Session) => (x.status === 'done' ? 0 : x.status === 'partial' || x.status === 'minimum' ? 1 : 2);
  const segs = [...sessions].sort((a, b) => rank(a) - rank(b)).slice(0, 12);

  const weekStrip = (
    <div className="stack-sm" style={{ gap: 6 }}>
    <div className="today-week-nav">
      <button type="button" className="today-week-arrow" onClick={() => goWeek(-1)} aria-label="Previous week">
        <span style={{ transform: 'rotate(180deg)', display: 'inline-flex' }}>
          <Icon name="chevron" size={16} stroke={2.2} />
        </span>
      </button>
      <span className="today-week-name">
        {weekName}
        {!isThisWeek && (
          <button type="button" className="link-btn xsmall" onClick={() => setPicked(today)}>
            Back to today
          </button>
        )}
      </span>
      <button type="button" className="today-week-arrow" onClick={() => goWeek(1)} aria-label="Next week">
        <Icon name="chevron" size={16} stroke={2.2} />
      </button>
    </div>
    <div className="today-week" role="group" aria-label={weekName}>
      {week.map((d) => {
        const list = view.sessionsOn(d);
        const finished = list.filter((s) => s.status !== 'planned').length;
        const selected = d === day;
        return (
          <button
            key={d}
            className={`today-day${selected ? ' selected' : ''}${d === today ? ' is-today' : ''}${d < today ? ' past' : ''}`}
            aria-pressed={selected}
            aria-label={`${weekdayName(d)} ${shortDate(d)}${d === today ? ', today' : ''}: ${finished} of ${list.length} done`}
            onClick={() => setPicked(d)}
          >
            <span className="today-day-name">{weekdayName(d).charAt(0)}</span>
            <b>{Number(d.slice(8))}</b>
            <span className="today-day-dots" aria-hidden="true">
              {list.slice(0, 3).map((s, i) => (
                <span key={s.id} className={i < finished ? 'done' : ''} />
              ))}
            </span>
          </button>
        );
      })}
    </div>
    </div>
  );

  const placeable = trayGroups.filter(({ first }) => view.canPlace(first, placeOn));
  const anyDay = !isToday && isThisWeek && placeable.length > 0 && (
    <div className="stack-sm">
      <div className="label" style={{ margin: '6px 2px 0' }}>
        Any day this week
      </div>
      <div className="card tight stack-sm">
        {placeable.map(({ first, count }) => (
          <div key={first.id} className="row-between">
            <span className="row-start small" style={{ flexWrap: 'nowrap' }}>
              <span className="dot" style={{ background: view.colorFor(first) }} />
              {first.title} ×{count}
            </span>
            <button
              className="btn small"
              onClick={() => {
                commit(opsMoveSession(first, placeOn));
                toast(`${first.title} added to ${placeOn === today ? 'today' : weekdayName(placeOn)}`, () => commit(opsRestoreSession(first)));
              }}
            >
              Do one {placeOn === today ? 'today' : `on ${weekdayName(placeOn)}`}
            </button>
          </div>
        ))}
      </div>
    </div>
  );

  // Nothing committed and nothing on the list yet: point to the backlog (goals start there).
  if (view.activeGoals.length === 0 && sessions.length === 0) {
    return (
      <div className="stack rise">
        <div className="topbar">
          <span className="mono">{monoDate(today)}</span>
          <a className="avatar" href={href('/settings')} aria-label="Settings">
            {initial}
          </a>
        </div>
        <h1 style={{ fontSize: 44 }}>Today</h1>
        <div className="card dark stack-sm">
          <h2>Start in your backlog.</h2>
          <p className="muted small" style={{ margin: 0 }}>
            Write down goals you might want, select the ones that matter most, prepare one, and commit to it. Its daily tasks show up here.
          </p>
          <a className="btn primary" href={href('/goals/backlog')}>
            Open the backlog
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="today-grid rise">
      <div className="stack today-main">
        <div className="topbar">
          <span className="mono">{monoDate(day)}</span>
          <a className="avatar" href={href('/settings')} aria-label="Settings">
            {initial}
          </a>
        </div>

        <div className="row-between" style={{ alignItems: 'flex-end', marginTop: -6 }}>
          <h1 style={{ fontSize: 44 }}>{isToday ? 'Today' : fullDay(day)}</h1>
          {!isToday ? (
            <button className="btn small" onClick={() => setPicked(today)}>
              Back to today
            </button>
          ) : (
            <StreakChip streak={streak} />
          )}
        </div>

        <div className="only-narrow" style={{ marginTop: 6 }}>
          {weekStrip}
        </div>

        <div className="row-between" style={{ alignItems: 'flex-end', marginTop: 14 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 4 }}>
            <span className="hero-num" style={{ fontSize: 88 }}>{isFuture ? sessions.length : done.length}</span>
            {!isFuture && (
              <span className="num" style={{ fontSize: 36, fontWeight: 500, color: 'var(--muted)', letterSpacing: '-0.04em' }}>
                /{sessions.length}
              </span>
            )}
            <span style={{ fontSize: 15, color: 'var(--ink-2)', marginLeft: 8 }}>{isFuture ? 'planned' : 'done'}</span>
          </div>
          <div style={{ textAlign: 'right', display: 'flex', flexDirection: 'column', gap: 2 }}>
            <span className="num" style={{ fontSize: 20 }}>{minutesText(minutesLeft(sessions))}</span>
            <span className="mono" style={{ fontSize: 10.5 }}>left of {minutesText(available)}</span>
          </div>
        </div>
        {segs.length > 0 && (
          <div className="segments" style={{ gridTemplateColumns: `repeat(${segs.length}, minmax(0, 1fr))` }} aria-hidden="true">
            {segs.map((s) => (
              <span key={s.id} className={s.status === 'done' ? 'on' : s.status === 'partial' || s.status === 'minimum' ? 'part' : ''} />
            ))}
          </div>
        )}

        {showMorning && (
          <MorningPlan
            sessions={sessions}
            available={available}
            onDone={() => {
              dismissRitual('morning', today);
              bump((n) => n + 1);
            }}
          />
        )}
        {showEvening && (
          <EveningWrap
            sessions={sessions}
            onDone={() => {
              dismissRitual('evening', today);
              bump((n) => n + 1);
            }}
          />
        )}

        {isToday && commitment && commitment.forWeek === weekStart(today) && (
          <CommitmentCard review={commitment.review} text={commitment.text} forWeek={commitment.forWeek} today={today} compact />
        )}

        {coach && (
          <p className="coach only-narrow">
            <Icon name="sparkle" size={16} />
            <span>{coach}</span>
          </p>
        )}
        {isFuture && <span className="xsmall muted">Coming up. You can check these off on the day.</span>}

        {sessions.length === 0 && planned.length === 0 && (
          <div className="card empty">
            <h3 style={{ marginBottom: 6 }}>Nothing planned {isToday ? 'today' : `on ${fullDay(day)}`}.</h3>
            Add a task, or rest. Rest counts.
          </div>
        )}

        {isToday && <TodayNumbers />}

        {planned.length + done.length > 0 && (
          <div className="task-cards">
            {[...planned, ...done].map((s) => (
              <TaskCard key={s.id} session={s} hint={hintFor(s)} onToggle={() => toggle(s)} onOpen={() => openSession(s)} swipe={!isFuture && s.status === 'planned'} />
            ))}
          </div>
        )}

        {isFuture && (
          <button className="btn ghost" onClick={() => setAdding(true)}>
            <Icon name="plus" size={18} stroke={2.2} /> Add a task on {weekdayName(day)}
          </button>
        )}

        <div className="only-narrow">{anyDay}</div>
      </div>

      <aside className="today-side stack only-wide" aria-label="This week">
        {weekStrip}
        <StreakCard streak={streak} />
        {coach && (
          <p className="coach">
            <Icon name="sparkle" size={16} />
            <span>{coach}</span>
          </p>
        )}
        {anyDay}
        <p className="xsmall muted" style={{ margin: 0 }}>
          Keys: ← → change day · N add · G goals · R review
        </p>
      </aside>

      {open && <LogSheet session={data.sessions.find((s) => s.id === open.id) ?? open} onClose={() => setOpen(null)} />}
      {measuring && <MeasureSheet session={data.sessions.find((s) => s.id === measuring.id) ?? measuring} onClose={() => setMeasuring(null)} />}
      <input ref={photoInput} type="file" accept="image/*" hidden onChange={(e) => void photoPicked(e.target.files)} />
      {adding && <QuickAdd date={placeOn} onClose={() => setAdding(false)} />}
    </div>
  );
}

function isTyping(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable);
}

/** "9-day streak": the check-in streak, with a nudge when yesterday was missed. */
function StreakChip({ streak }: { streak: Streak }) {
  const label = streak.days === 0 ? 'Start a streak' : `${streak.days}-day streak`;
  return (
    <a
      href={href('/review')}
      className={`pill ${streak.checkedInToday ? 'on_track' : streak.missedYesterday ? 'behind' : 'none'}`}
      style={{ textDecoration: 'none', height: 30, padding: '0 12px' }}
      aria-label={`${label}. ${streak.freezes} freeze${streak.freezes === 1 ? '' : 's'} left.${streak.checkedInToday ? ' Checked in today.' : ''}`}
    >
      <Icon name={streak.checkedInToday ? 'check' : 'sparkle'} size={13} stroke={2.6} />
      {streak.missedYesterday && !streak.checkedInToday ? 'Never miss twice' : label}
    </a>
  );
}

function StreakCard({ streak }: { streak: Streak }) {
  return (
    <div className="tile" style={{ gap: 10 }}>
      <div className="row-between">
        <span className="label">Check-ins</span>
        <span className="label">
          {streak.freezes} freeze{streak.freezes === 1 ? '' : 's'}
        </span>
      </div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
        <span className="num" style={{ fontSize: 30, lineHeight: 1 }}>{streak.days}</span>
        <span className="small" style={{ color: 'var(--ink-2)' }}>day{streak.days === 1 ? '' : 's'} running</span>
      </div>
      <StreakDots streak={streak} />
      <span className="xsmall muted">
        {streak.checkedInToday
          ? 'Checked in today. One thing a day keeps it going.'
          : streak.missedYesterday
            ? 'Yesterday was covered by a freeze. Log one thing today: never miss twice.'
            : 'Log any one thing today to keep it going.'}
      </span>
    </div>
  );
}

export function StreakDots({ streak }: { streak: Streak }) {
  return (
    <div
      style={{ display: 'grid', gridTemplateColumns: 'repeat(7, minmax(0, 1fr))', gap: 4 }}
      role="img"
      aria-label={`Checked in on ${streak.last14.filter((d) => d.state === 'done').length} of the last 14 days`}
    >
      {streak.last14.map((d) => (
        <span
          key={d.date}
          style={{
            aspectRatio: '1',
            borderRadius: 4,
            background: d.state === 'done' ? 'var(--accent)' : d.state === 'frozen' ? 'var(--blue-soft)' : d.state === 'today' ? 'transparent' : 'var(--track)',
            boxShadow: d.state === 'today' ? 'inset 0 0 0 1.5px var(--accent-ink)' : d.state === 'frozen' ? 'inset 0 0 0 1.5px var(--blue)' : undefined,
          }}
        />
      ))}
    </div>
  );
}

/** Morning: yesterday's leftovers, today's load against your time, then "Start my day". */
function MorningPlan({ sessions, available, onDone }: { sessions: Session[]; available: number; onDone: () => void }) {
  const { data, today, commit } = useStore();
  const view = useView();
  const toast = useToast();
  const yesterday = addDays(today, -1);
  const leftovers = data.sessions.filter((s) => s.date === yesterday && s.status === 'planned');
  const planned = sessions.filter((s) => s.status === 'planned');
  const load = planned.reduce((sum, s) => sum + (s.planned_minutes ?? 0), 0);
  const over = load - available;
  const tomorrow = addDays(today, 1);
  return (
    <div className="tile" style={{ gap: 12, borderColor: 'var(--accent-ink)' }}>
      <div className="row-between">
        <span className="label" style={{ color: 'var(--accent-ink)' }}>Plan your day</span>
        <span className="label">1 minute</span>
      </div>
      {leftovers.length > 0 && (
        <div className="stack-sm">
          <span className="small strong">Left from yesterday</span>
          {leftovers.map((s) => (
            <div key={s.id} className="row-between" style={{ gap: 8 }}>
              <span className="small grow" style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{s.title}</span>
              {view.canPlace(s, today) && (
                <button className="btn small" onClick={() => { commit(opsMoveSession(s, today)); toast(`${s.title} moved to today`); }}>
                  Today
                </button>
              )}
              <button className="btn small" onClick={() => { commit(opsLogSession(s, { status: 'skipped' })); toast(`${s.title} skipped`); }}>
                Let go
              </button>
            </div>
          ))}
        </div>
      )}
      {over > 0 ? (
        <div className="stack-sm">
          <span className="small" style={{ color: 'var(--amber-ink)' }}>
            Today has {minutesText(over)} more than your {minutesText(available)}. Move something to tomorrow?
          </span>
          {planned.slice(-3).reverse().map((s) => (
            <div key={s.id} className="row-between" style={{ gap: 8 }}>
              <span className="small grow" style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {s.title} · {minutesText(s.planned_minutes)}
              </span>
              {view.canPlace(s, tomorrow) ? (
                <button className="btn small" onClick={() => { commit(opsMoveSession(s, tomorrow)); toast(`${s.title} moved to tomorrow`, () => commit(opsRestoreSession(s))); }}>
                  Tomorrow
                </button>
              ) : (
                <button className="btn small" onClick={() => { commit(opsLogSession(s, { status: 'skipped' })); toast(`${s.title} skipped today`, () => commit(opsRestoreSession(s))); }}>
                  Skip today
                </button>
              )}
            </div>
          ))}
        </div>
      ) : (
        <span className="small" style={{ color: 'var(--ink-2)' }}>
          {planned.length ? `${planned.length} task${planned.length === 1 ? '' : 's'}, ${minutesText(load)} of your ${minutesText(available)}. It fits.` : 'Nothing planned yet. Add one thing with +.'}
        </span>
      )}
      <button className="btn primary" onClick={onDone}>
        Start my day
      </button>
    </div>
  );
}

/** Evening: tick what you did, roll the rest to tomorrow, done. */
function EveningWrap({ sessions, onDone }: { sessions: Session[]; onDone: () => void }) {
  const { today, commit } = useStore();
  const view = useView();
  const toast = useToast();
  const open = sessions.filter((s) => s.status === 'planned');
  const tomorrow = addDays(today, 1);
  // Only tasks that aren't already on tomorrow can roll over; the rest are simply missed today.
  const movable = open.filter((s) => view.canPlace(s, tomorrow));
  return (
    <div className="tile" style={{ gap: 12 }}>
      <div className="row-between">
        <span className="label" style={{ color: 'var(--accent-ink)' }}>Wrap up today</span>
        <span className="label">{open.length} open</span>
      </div>
      {open.length === 0 ? (
        <span className="small" style={{ color: 'var(--ink-2)' }}>Everything is logged. Good day.</span>
      ) : (
        <div className="stack-sm">
          {open.map((s) => (
            <div key={s.id} className="row-between" style={{ gap: 8 }}>
              <span className="small grow" style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{s.title}</span>
              <button className="btn small" onClick={() => { commit(opsLogSession(s, { status: 'done' })); toast(`${s.title} done`, () => commit(opsRestoreSession(s))); }}>
                Did it
              </button>
              {movable.includes(s) ? (
                <button className="btn small" onClick={() => { commit(opsMoveSession(s, tomorrow)); toast(`${s.title} moved to tomorrow`, () => commit(opsRestoreSession(s))); }}>
                  Tomorrow
                </button>
              ) : (
                <button className="btn small" onClick={() => { commit(opsLogSession(s, { status: 'skipped' })); toast(`${s.title} skipped today`, () => commit(opsRestoreSession(s))); }}>
                  Skip
                </button>
              )}
            </div>
          ))}
          {movable.length > 1 && (
            <button
              className="btn small ghost"
              onClick={() => {
                commit(movable.flatMap((s) => opsMoveSession(s, tomorrow)));
                toast(`Moved ${movable.length} to tomorrow`);
              }}
            >
              Move {movable.length === open.length ? `all ${open.length}` : `the ${movable.length} that can go`} to tomorrow
            </button>
          )}
        </div>
      )}
      <button className="btn primary" onClick={onDone}>
        Done for today
      </button>
    </div>
  );
}

const SWIPE_DONE = 84;

/** One task card: tap the round button to check it off, tap the card for the log sheet, swipe left to finish it. */
function TaskCard({ session, hint, onToggle, onOpen, swipe }: { session: Session; hint?: string | null; onToggle: () => void; onOpen: () => void; swipe: boolean }) {
  const view = useView();
  const { data } = useStore();
  const action = view.action(session.action_id);
  const goals = view.goalsForAction(session.action_id).filter((g) => !g.archived_at && !g.completed_at);
  const goal = goals[0];
  const s = session;
  const [dx, setDx] = useState(0);
  const drag = useRef<{ x: number; y: number; on: boolean; moved: boolean } | null>(null);

  const ring =
    s.status === 'done' ? 'done' : s.status === 'partial' || s.status === 'minimum' ? 'part' : s.status === 'skipped' ? 'skip' : '';
  const label =
    s.status === 'planned' ? `Mark ${s.title} done` : `${s.title}, ${s.status === 'minimum' ? 'minimum kept' : s.status}. Tap to undo`;

  let meta: string | null = [action?.cue ? action.cue : null, goals.map((g) => g.title).join(' + ') || null].filter(Boolean).join(' · ') || null;
  if (s.status === 'minimum') meta = `Minimum kept${action?.min_label ? ` · ${action.min_label}` : ''}`;
  if (s.status === 'partial') meta = s.planned_count ? `Partial · ${s.actual_count ?? 0} of ${s.planned_count}` : 'Partial';
  if (s.status === 'skipped') meta = s.obstacles.length ? `Skipped · ${s.obstacles.join(', ')}` : 'Skipped';
  if (s.origin === 'unplanned') meta = 'Logged extra';
  if (hint && s.status === 'planned') meta = [hint, meta].filter(Boolean).join(' · ');
  const fileCount = data.attachments.filter((a) => a.session_id === s.id).length;
  if (fileCount > 0) meta = [meta, fileCount === 1 ? '1 file' : `${fileCount} files`].filter(Boolean).join(' · ');

  const right =
    s.status === 'done' || s.status === 'partial' || s.status === 'minimum'
      ? s.actual_minutes != null
        ? `${s.actual_minutes}m`
        : ''
      : s.planned_count
        ? `${s.planned_count} · ${minutesText(s.planned_minutes)}`
        : s.planned_minutes
          ? minutesText(s.planned_minutes)
          : '';

  const onDown = (e: ReactPointerEvent) => {
    if (!swipe || e.pointerType === 'mouse') return;
    drag.current = { x: e.clientX, y: e.clientY, on: false, moved: false };
  };
  const onMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d) return;
    const mx = e.clientX - d.x;
    const my = e.clientY - d.y;
    if (!d.on) {
      if (Math.abs(mx) < 10 || Math.abs(mx) < Math.abs(my)) return;
      d.on = true;
      e.currentTarget.setPointerCapture(e.pointerId);
    }
    d.moved = true;
    setDx(Math.max(-120, Math.min(0, mx)));
  };
  const onUp = () => {
    const d = drag.current;
    drag.current = null;
    if (d?.on && dx <= -SWIPE_DONE) onToggle();
    setDx(0);
  };

  const logged = s.status === 'done' || s.status === 'partial' || s.status === 'minimum';
  // A measure task shows the number it saved that day.
  const reading = action?.kind === 'measure' && logged ? readingOn(data, action.measurement_type_id, s.date) : null;
  const unit = reading != null ? data.measurementTypes.find((t) => t.id === action?.measurement_type_id)?.unit ?? '' : '';
  const topLine = reading != null ? `${fmt(reading)}${unit ? ` ${unit}` : ''}` : right;

  return (
    <div className="task-card-wrap">
      {swipe && dx < 0 && (
        <div className="swipe-action" style={{ opacity: Math.min(1, -dx / SWIPE_DONE) }} aria-hidden="true">
          <Icon name="check" size={16} stroke={2.6} /> Done
        </div>
      )}
      <div
        className={`up-next-card task-card${dx ? ' dragging' : ''}${s.status !== 'planned' ? ' logged' : ''}`}
        style={{ transform: dx ? `translateX(${dx}px)` : undefined }}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
      >
        <button type="button" className="task-card-body" onClick={() => !dx && onOpen()} aria-label={`${s.title}: details`}>
          {topLine && (
            <span className="mono" style={{ color: logged ? 'var(--accent-ink)' : 'var(--ink-2)' }}>
              {topLine}
            </span>
          )}
          <span className={`task-card-title${s.status === 'done' ? ' done' : ''}`}>
            {s.title}
            {s.planned_count && s.status === 'planned' ? ` ×${s.planned_count}` : ''}
          </span>
          {meta && (
            <span className="task-card-meta" style={{ color: s.status === 'minimum' || s.status === 'partial' ? 'var(--amber-ink)' : undefined }}>
              {goals.map((g) => (
                <span key={g.id} className="dot" style={{ width: 7, height: 7, background: g.color, boxShadow: `0 0 10px ${g.color}`, marginRight: goals.length > 1 ? -3 : 0 }} />
              ))}
              <span style={{ marginLeft: goals.length > 1 ? 3 : 0 }}>{meta}</span>
            </span>
          )}
          {action?.kind === 'workout' && action.workout_plan?.length ? <WorkoutCardPlan session={s} plan={action.workout_plan} /> : null}
        </button>
        <button type="button" className={`tick-btn ${ring}`} aria-label={label} onClick={onToggle}>
          {s.status === 'done' || s.status === 'planned' ? <Icon name="check" size={22} stroke={2.6} /> : s.status === 'skipped' ? <Icon name="x" size={20} stroke={2.4} /> : <Icon name="minus" size={22} stroke={2.6} />}
        </button>
      </div>
    </div>
  );
}

export function QuickAdd({ date, onClose }: { date: ISODate; onClose: () => void }) {
  const { data, today, commit } = useStore();
  const view = useView();
  const toast = useToast();
  const [tab, setTab] = useState<'task' | 'log' | 'idea'>('task');
  const [idea, setIdea] = useState('');
  const [text, setText] = useState('');
  const [minutesEdit, setMinutesEdit] = useState<number | null>(null);
  const [priorityEdit, setPriority] = useState(false);
  const [goalPick, setGoalPick] = useState<string | null>(null);
  const actions = data.actions.filter((a) => !a.archived_at);
  const [actionId, setActionId] = useState(actions[0]?.id ?? '');
  const [logMinutes, setLogMinutes] = useState(20);

  const goals = view.activeGoals;
  const parsed = parseQuickAdd(text, today);
  const target = parsed.date ?? date;
  const dayWord = target === today ? 'today' : weekdayName(target);
  const tagged = parsed.goalTag ? goals.find((g) => g.title.toLowerCase().includes(parsed.goalTag!)) : undefined;
  const goal = goals.find((g) => g.id === goalPick) ?? tagged ?? null;
  const minutes = minutesEdit ?? parsed.minutes ?? 15;
  const priority = priorityEdit || parsed.priority;
  const repeats = parsed.days.length > 0;
  const canAdd = parsed.title.length > 0 && (!repeats || !!goal);
  const preview = [
    repeats ? (parsed.days.length === 7 ? 'Every day' : parsed.days.map((d) => WEEKDAY_NAMES[d - 1]).join(' · ')) : target === today ? 'Today' : `${weekdayName(target)} ${shortDate(target)}`,
    `${minutes} min`,
    priority ? 'Priority' : null,
    goal ? goal.title : null,
  ].filter(Boolean);

  function add() {
    if (!canAdd) return;
    const plan = goal ? view.planForGoal(goal) : null;
    if (goal && plan) {
      const chain = chainFor(data, goal, plan, target < plan.start_date ? plan.start_date : target);
      const week = stepFor(goal, plan, chain, 'week');
      const ensure = opsEnsureStep(data, week);
      const input = repeats
        ? { ...blankTask(week, today), title: parsed.title, minutes, priority, when: 'days' as const, days: parsed.days, through: null }
        : { ...blankTask(week, today), title: parsed.title, minutes, priority, when: 'once' as const, date: target };
      commit([...ensure, ...opsAddTask(withOps(data, ensure), goal, week, input, today)]);
    } else {
      commit(opsAddOneOff({ title: parsed.title, minutes, priority, date: target }));
    }
    toast(`Added ${parsed.title}${repeats ? ' (repeats)' : ''}`);
    onClose();
  }

  return (
    <Sheet title="Add" onClose={onClose}>
      <div className="seg" role="tablist">
        <button role="tab" aria-selected={tab === 'task'} onClick={() => setTab('task')}>
          New task
        </button>
        <button role="tab" aria-selected={tab === 'log'} onClick={() => setTab('log')} disabled={actions.length === 0}>
          Log extra
        </button>
        <button role="tab" aria-selected={tab === 'idea'} onClick={() => setTab('idea')}>
          Goal idea
        </button>
      </div>
      {tab === 'idea' ? (
        <form
          className="stack"
          onSubmit={(e) => {
            e.preventDefault();
            if (!idea.trim()) return;
            commit(opsAddIdea(data, idea).ops);
            toast('Added to your goal backlog');
            onClose();
          }}
        >
          <label className="field">
            Goal idea
            <input autoFocus value={idea} onChange={(e) => setIdea(e.target.value)} placeholder="e.g. Run a half marathon" />
          </label>
          <span className="xsmall muted" style={{ marginTop: -8 }}>
            It goes to the bottom of your backlog. Order it and select it from Goals › Backlog.
          </span>
          <button className="btn primary" type="submit" disabled={!idea.trim()}>
            Add to backlog
          </button>
        </form>
      ) : tab === 'task' ? (
        <form
          className="stack"
          onSubmit={(e) => {
            e.preventDefault();
            add();
          }}
        >
          <label className="field">
            Task
            <input autoFocus value={text} onChange={(e) => setText(e.target.value)} placeholder="e.g. guitar 20m mon wed fri #guitar" aria-describedby="quick-add-hint" />
          </label>
          <span id="quick-add-hint" className="xsmall muted" style={{ marginTop: -8 }}>
            Type it the way you'd say it: "tomorrow", "fri", "mon wed fri", "daily", "20m", "1h", "!" for priority, "#goal".
          </span>
          {parsed.title && (
            <div className="row-start" style={{ gap: 6 }}>
              {preview.map((p) => (
                <span key={p} className="pill none">
                  {p}
                </span>
              ))}
            </div>
          )}
          <div className="grid-2">
            <label className="field">
              For goal
              <select value={goal?.id ?? ''} onChange={(e) => setGoalPick(e.target.value || null)}>
                <option value="">{repeats ? 'Pick a goal' : 'No goal (one-off)'}</option>
                {goals.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.title}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              Minutes
              <input type="number" min={0} value={minutes} onChange={(e) => setMinutesEdit(Number(e.target.value))} />
            </label>
          </div>
          {repeats && !goal && <span className="xsmall" style={{ color: 'var(--amber-ink)' }}>A repeating task belongs to a goal. Pick one, or add #goal.</span>}
          <label className="row-start small">
            <input type="checkbox" checked={priority} onChange={(e) => setPriority(e.target.checked)} style={{ width: 20, height: 20 }} />
            Priority
          </label>
          <button className="btn primary" type="submit" disabled={!canAdd}>
            {repeats ? 'Add repeating task' : `Add to ${dayWord}`}
          </button>
        </form>
      ) : (
        <form
          className="stack"
          onSubmit={(e) => {
            e.preventDefault();
            const a = actions.find((x) => x.id === actionId);
            if (!a) return;
            const on = date <= today ? date : today;
            // A task happens at most once a day: use the session already on that day, or one of this
            // week's "any day" sessions, before adding an extra one.
            const sameDay = data.sessions.find((x) => x.action_id === a.id && x.date === on && x.status !== 'moved');
            if (sameDay && sameDay.status !== 'planned') {
              toast(`${a.title} is already logged ${on === today ? 'today' : `on ${weekdayName(on)}`}`);
              return;
            }
            const anyDay = sameDay ? undefined : data.sessions.find((x) => x.action_id === a.id && !x.date && x.week_start === weekStart(on) && x.status === 'planned');
            const target = sameDay ?? anyDay;
            if (target) commit(opsLogSession(target, { status: 'done', actual_minutes: logMinutes, on }));
            else commit(opsLogUnplanned(data, a, on, logMinutes));
            toast(`Logged ${a.title}`);
            onClose();
          }}
        >
          <label className="field">
            What did you do?
            <select value={actionId} onChange={(e) => setActionId(e.target.value)}>
              {actions.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.title}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            Minutes
            <input type="number" min={0} value={logMinutes} onChange={(e) => setLogMinutes(Number(e.target.value))} />
          </label>
          <button className="btn primary" type="submit">
            Log it
          </button>
        </form>
      )}
    </Sheet>
  );
}

/**
 * Today's numbers: the measurements you've set to show on Today (a goal's main number by default),
 * logged right here so you never have to open each goal. Stopped measurements never show. One
 * that already has a "Log a number" task today is left to that task.
 */
function TodayNumbers() {
  const { data, today, commit } = useStore();
  const toast = useToast();
  const [values, setValues] = useState<Record<string, string>>({});
  const [changing, setChanging] = useState<Record<string, boolean>>({});

  const liveGoals = data.goals.filter((g) => !g.archived_at && !g.completed_at);
  const taskTypes = new Set(
    data.sessions
      .filter((s) => s.date === today && s.status !== 'skipped')
      .map((s) => data.actions.find((a) => a.id === s.action_id))
      .filter((a) => a?.kind === 'measure' && a.measurement_type_id)
      .map((a) => a!.measurement_type_id!),
  );
  const rows = data.measurementTypes
    .filter((t) => measureOnToday(data, t.id) && !taskTypes.has(t.id))
    .map((t) => ({ type: t, goal: liveGoals.find((g) => g.id === t.goal_id || g.measurement_type_id === t.id) }))
    .filter((r): r is { type: typeof r.type; goal: NonNullable<typeof r.goal> } => !!r.goal)
    .sort((a, b) => Number(b.goal.measurement_type_id === b.type.id) - Number(a.goal.measurement_type_id === a.type.id));
  if (rows.length === 0) return null;

  function save(typeId: string, name: string, unit: string) {
    const raw = (values[typeId] ?? '').trim();
    const v = Number(raw);
    if (raw === '' || !Number.isFinite(v)) return;
    const { ops, undo } = opsRecordReading(data, typeId, v, today);
    commit(ops);
    toast(`${name}: ${fmt(v)} ${unit}`.trim(), () => commit(undo));
    setValues({ ...values, [typeId]: '' });
    setChanging({ ...changing, [typeId]: false });
  }

  return (
    <section className="card tight stack-sm today-numbers" aria-label="Today's numbers">
      <span className="label">Today’s numbers</span>
      {rows.map(({ type, goal }) => {
        const logged = readingOn(data, type.id, today);
        const last = lastReading(data, type.id);
        const editing = logged == null || changing[type.id];
        return (
          <form
            key={type.id}
            className="today-number"
            onSubmit={(e) => {
              e.preventDefault();
              save(type.id, type.name, type.unit);
            }}
          >
            <span className="dot" style={{ background: goal.color }} />
            <span className="grow" style={{ minWidth: 0 }}>
              <span className="today-number-name">{measureLabel(type)}</span>
              <span className="xsmall muted today-number-goal">{goal.title}</span>
            </span>
            {editing ? (
              <>
                <input
                  className="input"
                  type="number"
                  inputMode="decimal"
                  step="any"
                  aria-label={`${type.name} today${type.unit ? ` (${type.unit})` : ''}`}
                  placeholder={last ? fmt(last.value) : ''}
                  value={values[type.id] ?? ''}
                  onChange={(e) => setValues({ ...values, [type.id]: e.target.value })}
                />
                <span className="small muted">{type.unit}</span>
                <button className="btn small primary" type="submit" disabled={(values[type.id] ?? '').trim() === ''}>
                  Save
                </button>
              </>
            ) : (
              <>
                <span className="num">
                  <Icon name="check" size={13} stroke={3} /> {fmt(logged!)} {type.unit}
                </span>
                <button type="button" className="link-btn xsmall" onClick={() => setChanging({ ...changing, [type.id]: true })}>
                  Change
                </button>
              </>
            )}
          </form>
        );
      })}
    </section>
  );
}
