import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { addDays, isoWeekday, minutesLeft, shortDate, weekDates, weekStart, weekdayName, type ISODate, type Session } from '@six/core';
import { useStore } from '../data/store.tsx';
import { minutesText, useView } from '../data/derive.ts';
import { coachLine } from '../data/coach.ts';
import { checkInStreak, dismissRitual, ritualDue, type Streak } from '../data/habit.ts';
import { parseQuickAdd } from '../data/parse.ts';
import { blankTask, opsAddTask, withOps } from '../data/breakdown.ts';
import { chainFor, opsEnsureStep, stepFor } from '../data/chain.ts';
import { PlanForm } from './Plans.tsx';
import { opsAddOneOff, opsLogSession, opsLogUnplanned, opsMoveSession, opsRestoreSession } from '../data/ops.ts';
import { href, navigate } from '../router.ts';
import { Icon, Sheet, WEEKDAY_NAMES, useToast } from '../components/ui.tsx';
import { LogSheet } from './LogSheet.tsx';
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
  // The day being shown. Opens on today; tap any day of this week (or use the arrow keys) to see it.
  const [picked, setPicked] = useState<ISODate>(today);
  const [, bump] = useState(0);
  const week = weekDates(weekStart(today));
  const day = week.includes(picked) ? picked : today;
  const isToday = day === today;
  const isFuture = day > today;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || isTyping(e.target)) return;
      const i = week.indexOf(day);
      if (e.key === 'ArrowLeft' && i > 0) setPicked(week[i - 1]!);
      if (e.key === 'ArrowRight' && i < week.length - 1) setPicked(week[i + 1]!);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [day, week]);

  const sessions = view.sessionsOn(day);
  const done = sessions.filter((s) => s.status !== 'planned');
  const planned = sessions.filter((s) => s.status === 'planned').sort((a, b) => Number(b.priority) - Number(a.priority));
  const next = !isFuture && day >= today ? planned[0] : undefined;
  const later = planned.filter((s) => s !== next);
  const available = data.profile.available_minutes[isoWeekday(day) - 1] ?? 0;
  const tray = view.unplacedThisWeek();
  const trayGroups = [...new Map(tray.map((s) => [s.action_id ?? s.id, s])).values()].map((s) => ({
    first: s,
    count: tray.filter((t) => (t.action_id ?? t.id) === (s.action_id ?? s.id)).length,
  }));
  // "Any day this week" tasks go on the day you're looking at, unless that day has passed.
  const placeOn = day >= today ? day : today;

  const plan = view.mainPlan;
  const coach = isToday ? coachLine(view, plan, today, sessions) : null;
  const streak = checkInStreak(data.sessions, today);
  const commitment = currentCommitment(data.reviews, today);
  const initial = (data.profile.display_name || 'You').trim().charAt(0).toUpperCase();
  const showMorning = isToday && ritualDue('morning', today);
  const showEvening = isToday && !showMorning && ritualDue('evening', today);

  function toggle(s: Session) {
    const before = s;
    if (isFuture) {
      toast(`You can check this off on ${weekdayName(day)}`);
      return;
    }
    if (s.status === 'planned') {
      commit(opsLogSession(s, { status: 'done' }));
      toast(`${s.title} done`, () => commit(opsRestoreSession(before)));
    } else {
      commit(opsLogSession(s, { status: 'planned', actual_minutes: null, actual_count: null }));
      toast(`${s.title} unchecked`, () => commit(opsRestoreSession(before)));
    }
  }

  function openSession(s: Session) {
    const kind = view.action(s.action_id)?.kind;
    if (!isFuture && kind === 'workout') navigate(`/workout/${s.id}`);
    else if (!isFuture && kind === 'study') navigate(`/focus/${s.id}`);
    else setOpen(s);
  }

  /** The play button: a workout opens the workout log; anything else starts the focus timer. */
  function start(s: Session) {
    const kind = view.action(s.action_id)?.kind;
    navigate(kind === 'workout' ? `/workout/${s.id}` : `/focus/${s.id}`);
  }

  // Progress segments fill from the left: done, then partly done, then still to do.
  const rank = (x: Session) => (x.status === 'done' ? 0 : x.status === 'partial' || x.status === 'minimum' ? 1 : 2);
  const segs = [...sessions].sort((a, b) => rank(a) - rank(b)).slice(0, 12);

  const weekStrip = (
    <div className="today-week" role="group" aria-label="This week">
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
  );

  const anyDay = trayGroups.length > 0 && (
    <div className="stack-sm">
      <div className="label" style={{ margin: '6px 2px 0' }}>
        Any day this week
      </div>
      <div className="card tight stack-sm">
        {trayGroups.map(({ first, count }) => (
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

  if (!plan) {
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
          <h2>Start with one plan and one goal.</h2>
          <p className="muted small" style={{ margin: 0 }}>
            Six months from today, what do you want to be true? Add one goal now; add the rest over your first week.
          </p>
        </div>
        <PlanForm />
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

        {next && <UpNext session={next} onStart={() => start(next)} onOpen={() => openSession(next)} />}
        {coach && (
          <p className="coach only-narrow">
            <Icon name="sparkle" size={16} />
            <span>{coach}</span>
          </p>
        )}
        {isFuture && <span className="xsmall muted">Coming up. You can check these off on the day.</span>}

        {sessions.length === 0 && (
          <div className="card empty">
            <h3 style={{ marginBottom: 6 }}>Nothing planned {isToday ? 'today' : `on ${fullDay(day)}`}.</h3>
            Add a task, or rest. Rest counts.
          </div>
        )}

        {later.length > 0 && (
          <TaskGroup title={isFuture ? 'Planned' : isToday ? 'Later today' : 'Not logged'} sessions={later} onToggle={toggle} onOpen={openSession} swipe={!isFuture} />
        )}
        {done.length > 0 && <TaskGroup title={isToday ? 'Done' : 'Logged'} sessions={done} onToggle={toggle} onOpen={openSession} swipe={false} />}

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
              <button className="btn small" onClick={() => { commit(opsMoveSession(s, today)); toast(`${s.title} moved to today`); }}>
                Today
              </button>
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
              <button className="btn small" onClick={() => { commit(opsMoveSession(s, tomorrow)); toast(`${s.title} moved to tomorrow`, () => commit(opsRestoreSession(s))); }}>
                Tomorrow
              </button>
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
  const toast = useToast();
  const open = sessions.filter((s) => s.status === 'planned');
  const tomorrow = addDays(today, 1);
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
              <button className="btn small" onClick={() => { commit(opsMoveSession(s, tomorrow)); toast(`${s.title} moved to tomorrow`, () => commit(opsRestoreSession(s))); }}>
                Tomorrow
              </button>
            </div>
          ))}
          {open.length > 1 && (
            <button
              className="btn small ghost"
              onClick={() => {
                commit(open.flatMap((s) => opsMoveSession(s, tomorrow)));
                toast(`Moved ${open.length} to tomorrow`);
              }}
            >
              Move all {open.length} to tomorrow
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

/** The focus card: the next thing to do, with a big start button. */
function UpNext({ session, onStart, onOpen }: { session: Session; onStart: () => void; onOpen: () => void }) {
  const view = useView();
  const goal = view.goalsForAction(session.action_id)[0];
  const s = session;
  return (
    <div className="up-next-card" style={{ marginTop: 8 }}>
      <button type="button" className="grow stack-sm" onClick={onOpen} aria-label={`${session.title}: details`} style={{ gap: 6, background: 'none', border: 0, padding: 0, textAlign: 'left', color: 'inherit', font: 'inherit', cursor: 'pointer' }}>
        <span className="mono" style={{ color: 'var(--accent-ink)' }}>
          Up next{s.planned_minutes ? ` · ${minutesText(s.planned_minutes)}` : ''}
        </span>
        <span style={{ fontSize: 21, fontWeight: 600, letterSpacing: '-0.03em', lineHeight: 1.15 }}>{s.title}</span>
        {(goal || s.planned_count) && (
          <span className="row-start small" style={{ color: 'var(--ink-2)', gap: 7, flexWrap: 'nowrap' }}>
            {goal && <span className="dot" style={{ width: 7, height: 7, background: goal.color, boxShadow: `0 0 10px ${goal.color}` }} />}
            <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {[s.planned_count ? `${s.planned_count} planned` : null, goal?.title].filter(Boolean).join(' · ')}
            </span>
          </span>
        )}
      </button>
      <button type="button" className="play-btn" aria-label={`Start ${s.title}`} onClick={onStart}>
        <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <path d="M7 4.5v15a1 1 0 0 0 1.5.86l12.5-7.5a1 1 0 0 0 0-1.72L8.5 3.64A1 1 0 0 0 7 4.5z" />
        </svg>
      </button>
    </div>
  );
}

function TaskGroup({
  title,
  sessions,
  onToggle,
  onOpen,
  swipe,
}: {
  title: string;
  sessions: Session[];
  onToggle: (s: Session) => void;
  onOpen: (s: Session) => void;
  swipe: boolean;
}) {
  return (
    <div>
      <div className="row-between" style={{ margin: '14px 2px 2px' }}>
        <span className="label">{title}</span>
        <span className="label">{sessions.length}</span>
      </div>
      <div className="task-list">
        {sessions.map((s) => (
          <TaskRow key={s.id} session={s} onToggle={() => onToggle(s)} onOpen={() => onOpen(s)} swipe={swipe && s.status === 'planned'} />
        ))}
      </div>
    </div>
  );
}

const SWIPE_DONE = 84;

/** One task: tap the ring to check it, tap the row for details, swipe left to finish it. */
function TaskRow({ session, onToggle, onOpen, swipe }: { session: Session; onToggle: () => void; onOpen: () => void; swipe: boolean }) {
  const view = useView();
  const action = view.action(session.action_id);
  const goal = view.goalsForAction(session.action_id)[0];
  const s = session;
  const [dx, setDx] = useState(0);
  const drag = useRef<{ x: number; y: number; on: boolean; moved: boolean } | null>(null);

  const ring =
    s.status === 'done' ? 'done' : s.status === 'partial' || s.status === 'minimum' ? 'part' : s.status === 'skipped' ? 'skip' : '';
  const label =
    s.status === 'planned' ? `Mark ${s.title} done` : `${s.title}, ${s.status === 'minimum' ? 'minimum kept' : s.status}. Tap to undo`;

  let meta: string | null = [action?.cue ? action.cue : null, goal?.title].filter(Boolean).join(' · ') || null;
  if (s.status === 'minimum') meta = `Minimum kept${action?.min_label ? ` · ${action.min_label}` : ''}`;
  if (s.status === 'partial') meta = s.planned_count ? `Partial · ${s.actual_count ?? 0} of ${s.planned_count}` : 'Partial';
  if (s.status === 'skipped') meta = s.obstacles.length ? `Skipped · ${s.obstacles.join(', ')}` : 'Skipped';
  if (s.origin === 'unplanned') meta = 'Logged extra';

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

  return (
    <div className="task-wrap">
      {swipe && dx < 0 && (
        <div className="swipe-action" style={{ opacity: Math.min(1, -dx / SWIPE_DONE) }} aria-hidden="true">
          <Icon name="check" size={16} stroke={2.6} /> Done
        </div>
      )}
      <div
        className={`task${dx ? ' dragging' : ''}`}
        style={{ transform: dx ? `translateX(${dx}px)` : undefined }}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
      >
        <button className="chk" aria-label={label} onClick={onToggle}>
          <span className={`ring ${ring}`}>
            {s.status === 'done' && <Icon name="check" size={14} stroke={3} />}
            {(s.status === 'partial' || s.status === 'minimum') && <Icon name="minus" size={14} stroke={3} />}
          </span>
        </button>
        <button className="body" onClick={() => !dx && onOpen()}>
          <span className="grow">
            <span className={`title ${s.status === 'done' ? 'done' : ''}`} style={{ display: 'block' }}>
              {s.title}
              {s.planned_count && s.status === 'planned' ? ` ×${s.planned_count}` : ''}
            </span>
            {meta && (
              <span className="meta" style={{ color: s.status === 'minimum' || s.status === 'partial' ? 'var(--amber-ink)' : undefined }}>
                {goal && <span className="dot" style={{ width: 6, height: 6, background: goal.color }} />}
                {meta}
              </span>
            )}
          </span>
          <span className="min" style={{ color: s.status === 'done' ? 'var(--accent-ink)' : undefined }}>
            {right}
            {s.status === 'done' ? ' ✓' : ''}
          </span>
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

  const plan = view.mainPlan;
  const goals = plan ? view.goalsForPlan(plan.id) : [];
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
            commit(opsLogUnplanned(data, a, date <= today ? date : today, logMinutes));
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
