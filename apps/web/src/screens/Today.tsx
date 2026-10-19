import { useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { isoWeekday, minutesLeft, shortDate, weekDates, weekStart, weekdayName, type ISODate, type Session } from '@six/core';
import { useStore } from '../data/store.tsx';
import { minutesText, useView } from '../data/derive.ts';
import { coachLine } from '../data/coach.ts';
import { opsAddOneOff, opsLogSession, opsLogUnplanned, opsMoveSession, opsRestoreSession } from '../data/ops.ts';
import { href, navigate } from '../router.ts';
import { Icon, Sheet, useToast } from '../components/ui.tsx';
import { LogSheet } from './LogSheet.tsx';

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
  // The day being shown. Opens on today; tap any day of this week to see it.
  const [picked, setPicked] = useState<ISODate>(today);
  const week = weekDates(weekStart(today));
  const day = week.includes(picked) ? picked : today;
  const isToday = day === today;
  const isFuture = day > today;

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
  // Flexible sessions go on the day you're looking at, unless that day has passed.
  const placeOn = day >= today ? day : today;

  const plan = view.mainPlan;
  const horizons = plan && plan.start_date <= today ? view.horizons(plan) : [];
  const judged = horizons.filter((h) => h.key !== 'today' && h.progress.label !== 'none');
  const onPace = judged.filter((h) => h.progress.label !== 'behind').length;
  const chip = judged.length === 0 ? null : onPace === judged.length ? 'On track' : onPace >= judged.length / 2 ? 'Mostly on track' : 'Behind · fixable';
  const coach = isToday ? coachLine(view, plan, today, sessions) : null;
  const initial = (data.profile.display_name || 'You').trim().charAt(0).toUpperCase();

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
    else if (!isFuture && kind === 'study') navigate(`/study/${s.id}`);
    else setOpen(s);
  }

  // Progress segments fill from the left: done, then partly done, then still to do.
  const rank = (x: Session) => (x.status === 'done' ? 0 : x.status === 'partial' || x.status === 'minimum' ? 1 : 2);
  const segs = [...sessions].sort((a, b) => rank(a) - rank(b)).slice(0, 12);

  return (
    <div className="stack rise">
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
          chip && (
            <a href={href('/')} className={`pill ${chip.startsWith('Behind') ? 'behind' : 'on_track'}`} style={{ textDecoration: 'none', height: 30, padding: '0 12px' }}>
              <span className="dot" style={{ width: 6, height: 6, background: 'currentColor' }} />
              {chip}
            </a>
          )
        )}
      </div>

      <div className="today-week" role="group" aria-label="This week" style={{ marginTop: 6 }}>
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

      {next && <UpNext session={next} onStart={() => openSession(next)} />}
      {coach && (
        <p className="coach">
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

      {trayGroups.length > 0 && (
        <>
          <div className="section-label">Not placed yet this week</div>
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
        </>
      )}

      {open && <LogSheet session={data.sessions.find((s) => s.id === open.id) ?? open} onClose={() => setOpen(null)} />}
      {adding && <QuickAdd date={placeOn} onClose={() => setAdding(false)} />}
    </div>
  );
}

/** The focus card: the next thing to do, with a big start button. */
function UpNext({ session, onStart }: { session: Session; onStart: () => void }) {
  const view = useView();
  const goal = view.goalsForAction(session.action_id)[0];
  const s = session;
  return (
    <div className="up-next-card" style={{ marginTop: 8 }}>
      <div className="grow stack-sm" style={{ gap: 6 }}>
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
      </div>
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

  let meta: string | null = goal?.title ?? null;
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
  const dayWord = date === today ? 'today' : weekdayName(date);
  const toast = useToast();
  const [tab, setTab] = useState<'task' | 'log'>('task');
  const [title, setTitle] = useState('');
  const [minutes, setMinutes] = useState(15);
  const [priority, setPriority] = useState(false);
  const actions = data.actions.filter((a) => !a.archived_at);
  const [actionId, setActionId] = useState(actions[0]?.id ?? '');
  const [logMinutes, setLogMinutes] = useState(20);

  return (
    <Sheet title="Add" onClose={onClose}>
      <div className="seg" role="tablist">
        <button role="tab" aria-selected={tab === 'task'} onClick={() => setTab('task')}>
          New task for {dayWord}
        </button>
        <button role="tab" aria-selected={tab === 'log'} onClick={() => setTab('log')} disabled={actions.length === 0}>
          Log something extra
        </button>
      </div>
      {tab === 'task' ? (
        <form
          className="stack"
          onSubmit={(e) => {
            e.preventDefault();
            if (!title.trim()) return;
            commit(opsAddOneOff({ title, minutes, priority, date }));
            toast(`Added ${title.trim()}`);
            onClose();
          }}
        >
          <label className="field">
            Task
            <input autoFocus value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Book PMP exam date" />
          </label>
          <label className="field">
            Minutes
            <input type="number" min={0} value={minutes} onChange={(e) => setMinutes(Number(e.target.value))} />
          </label>
          <label className="row-start small">
            <input type="checkbox" checked={priority} onChange={(e) => setPriority(e.target.checked)} style={{ width: 20, height: 20 }} />
            Priority
          </label>
          <button className="btn primary" type="submit">
            Add to {dayWord}
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
