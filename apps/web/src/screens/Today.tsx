import { useEffect, useRef, useState, type ReactNode } from 'react';
import { addDays, hourIn, isoWeekday, minutesLeft, shortDate, weekDates, weekStart, weekdayName, type ISODate, type Session } from '@six/core';
import { useStore } from '../data/store.tsx';
import { minutesText } from '../data/derive.ts';
import { useView } from '../data/useView.ts';
import { coachLine } from '../data/coach.ts';
import { checkInStreak, dismissRitual, ritualDue } from '../data/habit.ts';
import { isHabit } from '../data/habits.ts';
import { opsEnsureWeek, opsLogSession, opsMoveSession, opsRestoreSession } from '../data/ops.ts';
import { currentCommitment } from '../data/insights.ts';
import { setShownDay } from '../data/shownDay.ts';
import { href } from '../router.ts';
import { Icon, useToast } from '../components/ui.tsx';
import { CommitmentCard } from '../components/Commitment.tsx';
import { MeasureSheet } from '../components/MeasureSheet.tsx';
import { useAddFiles } from '../components/Attachments.tsx';
import { usePhotoInput } from '../components/usePhotoInput.tsx';
import { LogSheet } from './LogSheet.tsx';
import { DayDates } from './Calendar.tsx';
import { TodayHabits } from './Habits.tsx';
import { StreakCard, StreakChip } from './today/Streak.tsx';
import { EveningWrap, MorningPlan } from './today/Rituals.tsx';
import { TaskCard } from './today/TaskCard.tsx';
import { TodayNumbers } from './today/TodayNumbers.tsx';
import { PrizeCelebration } from '../components/Prize.tsx';
import { SeasonLine } from '../components/SeasonLine.tsx';
import { AddTaskOnDay } from './today/AddTaskOnDay.tsx';
import { WeekAhead } from './today/WeekAhead.tsx';
import { PlanPackNudge } from './PlanPackSheet.tsx';


const FULL_DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const fullDay = (d: ISODate) => FULL_DAYS[isoWeekday(d) - 1] ?? '';
const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
const monoDate = (d: ISODate) => `${weekdayName(d).toUpperCase()} · ${Number(d.slice(8))} ${MONTHS[Number(d.slice(5, 7)) - 1]}`;

/**
 * Today: the list first. The day's tasks and the one button to add one sit at the top; the week
 * strip is how you move between days; everything that supports the list (numbers to log, dates on
 * this day, habits, the morning or evening check, the streak) comes after it or in the side column.
 */
export function Today({ date }: { date?: ISODate } = {}) {
  const { data, today, commit } = useStore();
  const view = useView();
  const toast = useToast();
  const [open, setOpen] = useState<Session | null>(null);
  // The day being shown. Opens on today; tap a day, page weeks with ‹ ›, or use the arrow keys.
  const [picked, setPicked] = useState<ISODate>(date ?? today);
  const [, bump] = useState(0);
  // Midnight: a page left open on "today" follows the new day (a day picked on purpose stays).
  const lastToday = useRef(today);
  useEffect(() => {
    if (lastToday.current !== today) {
      if (!date && picked === lastToday.current) setPicked(today);
      lastToday.current = today;
    }
  }, [today, date, picked]);
  const thisMonday = weekStart(today);
  const monday = weekStart(picked);
  const week = weekDates(monday);
  const day = picked;
  const isToday = day === today;
  const isFuture = day > today;
  const isThisWeek = monday === thisMonday;
  const weekOffset = Math.round((Date.parse(monday) - Date.parse(thisMonday)) / (7 * 86400000));
  const weekName = weekOffset === 0 ? 'This week' : weekOffset === 1 ? 'Next week' : weekOffset === -1 ? 'Last week' : `Week of ${shortDate(monday)}`;

  // The dock's + adds to the day on screen.
  useEffect(() => {
    setShownDay(isToday ? null : day);
    return () => setShownDay(null);
  }, [day, isToday]);

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
      if (document.querySelector('.sheet')) return;
      if (e.key === 'ArrowLeft') setPicked(addDays(day, -1));
      if (e.key === 'ArrowRight') setPicked(addDays(day, 1));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [day]);

  // On today, photo tasks (a progress photo) sit with your numbers instead of as task cards.
  const allSessions = view.sessionsOn(day);
  const isCheckInPhoto = (s: Session) => day === today && view.action(s.action_id)?.kind === 'photo';
  // Habits have their own section below, so they don't count toward the task total.
  const sessions = allSessions.filter((s) => !isCheckInPhoto(s) && !isHabit(data, s.action_id));
  const photoSessions = allSessions.filter(isCheckInPhoto);
  const done = sessions.filter((s) => s.status !== 'planned');
  const tray = view.unplacedThisWeek().filter((s) => !isHabit(data, s.action_id));
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
    const finished = all.filter((x) => x.status === 'done' || x.status === 'partial' || x.status === 'minimum').length;
    return `${finished} of ${all.length} this week`;
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
  const hour = hourIn(data.profile.timezone);
  const showMorning = isToday && ritualDue('morning', today, hour);
  const showEvening = isToday && !showMorning && ritualDue('evening', today, hour);

  // A measure task asks for the number; a photo task takes the photo; anything else checks off.
  const [measuring, setMeasuring] = useState<Session | null>(null);
  const { addFiles } = useAddFiles();
  const photo = usePhotoInput(async (s, files) => {
    const added = await addFiles(s, files, { quiet: true });
    if (added === 0) return;
    commit(opsLogSession(s, { status: 'done', on: today }));
    toast(`${s.title}: photo saved`, () => commit(opsRestoreSession(s)));
  });

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
      photo.pick(s);
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

  // Progress segments fill from the left: done, then partly done, then still to do.
  const rank = (x: Session) => (x.status === 'done' ? 0 : x.status === 'partial' || x.status === 'minimum' ? 1 : 2);
  const segs = [...sessions].sort((a, b) => rank(a) - rank(b)).slice(0, 12);
  const left = minutesLeft(sessions);

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

  // One line of numbers instead of a dashboard: done of total, and the time still planned.
  const summary = (
    <div className="today-summary" aria-label={isFuture ? `${sessions.length} planned` : `${done.length} of ${sessions.length} done`}>
      <span className="today-summary-count">
        <span className="num" style={{ fontSize: 30 }}>{isFuture ? sessions.length : done.length}</span>
        {!isFuture && <span className="muted">/{sessions.length}</span>}
        <span className="small" style={{ color: 'var(--ink-2)', marginLeft: 6 }}>{isFuture ? 'planned' : 'done'}</span>
      </span>
      {sessions.length > 0 && (
        <span className="small muted">
          {isFuture ? `${minutesText(left)} planned` : left > 0 ? `${minutesText(left)} left` : 'All logged'}
          {available ? ` · ${minutesText(available)} available` : ''}
        </span>
      )}
    </div>
  );

  // The morning or evening check, folded to one line until you want it.
  const ritual = showMorning ? (
    <RitualFold label="Plan your day" sub="1 minute" accent>
      <MorningPlan
        sessions={sessions}
        available={available}
        onDone={() => {
          dismissRitual('morning', today);
          bump((n) => n + 1);
        }}
      />
    </RitualFold>
  ) : showEvening ? (
    <RitualFold label="Wrap up today" sub={`${planned.length} open`}>
      <EveningWrap
        sessions={sessions}
        onDone={() => {
          dismissRitual('evening', today);
          bump((n) => n + 1);
        }}
      />
    </RitualFold>
  ) : null;

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
          <span className="row-start" style={{ gap: 10 }}>
            {date && (
              <a className="link-btn small" href={href('/calendar')} style={{ padding: 0 }}>
                ‹ Calendar
              </a>
            )}
            <span className="mono">{monoDate(day)}</span>
          </span>
          <a className="avatar" href={href('/settings')} aria-label="Settings">
            {initial}
          </a>
        </div>

        <div className="row-between" style={{ alignItems: 'flex-end', marginTop: -6 }}>
          <h1 style={{ fontSize: 40 }}>{isToday ? 'Today' : fullDay(day)}</h1>
          {!isToday ? (
            <button className="btn small" onClick={() => setPicked(today)}>
              Back to today
            </button>
          ) : (
            <StreakChip streak={streak} />
          )}
        </div>

        {isToday && plan && (
          <SeasonLine plan={plan} today={today} />
        )}

        <div className="only-narrow" style={{ marginTop: 2 }}>
          {weekStrip}
        </div>

        {isToday && <PrizeCelebration />}
        {isToday && <PlanPackNudge />}

        {summary}
        {segs.length > 0 && (
          <div className="segments" style={{ gridTemplateColumns: `repeat(${segs.length}, minmax(0, 1fr))` }} aria-hidden="true">
            {segs.map((s) => (
              <span key={s.id} className={s.status === 'done' ? 'on' : s.status === 'partial' || s.status === 'minimum' ? 'part' : ''} />
            ))}
          </div>
        )}
        {coach && (
          <p className="coach">
            <Icon name="sparkle" size={16} />
            <span>{coach}</span>
          </p>
        )}
        {isFuture && <span className="xsmall muted">Coming up. You can check these off on the day.</span>}

        {/* Today's numbers and photos come first: a weigh-in or a progress photo is the quickest check-in of the day. */}
        {isToday && <TodayNumbers photoSessions={photoSessions} />}

        {/* The list. */}
        {sessions.length === 0 && planned.length === 0 && (
          <div className="card empty">
            <h3 style={{ marginBottom: 6 }}>Nothing planned {isToday ? 'today' : `on ${fullDay(day)}`}.</h3>
            Add a task, or rest. Rest counts.
          </div>
        )}
        {planned.length + done.length > 0 && (
          <div className="task-cards">
            {[...planned, ...done].map((s) => (
              <TaskCard key={s.id} session={s} hint={hintFor(s)} onToggle={() => toggle(s)} onOpen={() => setOpen(s)} swipe={!isFuture && s.status === 'planned'} />
            ))}
          </div>
        )}
        {(isToday || isFuture) && <AddTaskOnDay day={day} label={isToday ? 'Add a task' : `Add a task on ${weekdayName(day)}`} />}

        {/* What supports the list. On a phone the week's goals sit here; on a computer they sit in the right column under the streak. */}
        {ritual}
        <DayDates day={day} />
        <TodayHabits day={day} />
        {isToday && <div className="only-narrow"><WeekAhead /></div>}
        {isToday && commitment && commitment.forWeek === weekStart(today) && (
          <CommitmentCard review={commitment.review} text={commitment.text} forWeek={commitment.forWeek} today={today} compact />
        )}
        <div className="only-narrow">{anyDay}</div>
      </div>

      <aside className="today-side stack only-wide" aria-label="This week">
        {weekStrip}
        <StreakCard streak={streak} />
        {isToday && <WeekAhead />}
        {anyDay}
        <p className="xsmall muted" style={{ margin: 0 }}>
          Keys: ← → change day · N add · G goals · R review
        </p>
      </aside>

      {open && <LogSheet session={data.sessions.find((s) => s.id === open.id) ?? open} onClose={() => setOpen(null)} />}
      {measuring && <MeasureSheet session={data.sessions.find((s) => s.id === measuring.id) ?? measuring} onClose={() => setMeasuring(null)} />}
      {photo.input}
    </div>
  );
}

/** A morning or evening check folded to one line; tap to open it. */
function RitualFold({ label, sub, accent = false, children }: { label: string; sub: string; accent?: boolean; children: ReactNode }) {
  const [openFold, setOpenFold] = useState(false);
  if (openFold) return <>{children}</>;
  return (
    <button type="button" className="ritual-fold" onClick={() => setOpenFold(true)} style={accent ? { borderColor: 'var(--accent-ink)' } : undefined}>
      <span className="label" style={accent ? { color: 'var(--accent-ink)' } : undefined}>
        {label}
      </span>
      <span className="xsmall muted">{sub}</span>
      <Icon name="chevron" size={14} stroke={2.2} />
    </button>
  );
}

function isTyping(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable);
}
