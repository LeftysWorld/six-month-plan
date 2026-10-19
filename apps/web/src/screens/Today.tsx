import { useState } from 'react';
import { isoWeekday, longDate, minutesLeft, shortDate, weekDates, weekStart, weekdayName, type ISODate, type Session } from '@six/core';
import { useStore } from '../data/store.tsx';
import { minutesText, useView } from '../data/derive.ts';
import { opsAddOneOff, opsLogSession, opsLogUnplanned, opsMoveSession, opsRestoreSession } from '../data/ops.ts';
import { href, navigate } from '../router.ts';
import { Icon, Sheet, useToast } from '../components/ui.tsx';
import { LogSheet } from './LogSheet.tsx';

const FULL_DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const fullDay = (d: ISODate) => FULL_DAYS[isoWeekday(d) - 1] ?? '';

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
  const available = data.profile.available_minutes[isoWeekday(day) - 1] ?? 0;
  const priorities = sessions.filter((s) => s.priority);
  const routines = sessions.filter((s) => !s.priority && s.action_id);
  const other = sessions.filter((s) => !s.priority && !s.action_id);
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
  const chip =
    judged.length === 0 ? null : onPace === judged.length ? 'On track' : onPace >= judged.length / 2 ? 'Mostly on track' : 'Behind';

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

  const group = (title: string, list: Session[]) =>
    list.length > 0 && (
      <>
        <div className="section-label">{title}</div>
        {list.map((s) => (
          <TaskRow key={s.id} session={s} onToggle={() => toggle(s)} onOpen={() => openSession(s)} />
        ))}
      </>
    );

  return (
    <div className="stack-sm">
      <div className="row-between">
        <span className="small muted">{longDate(day)}</span>
        {chip && (
          <a
            href={href('/')}
            className="pill on_track"
            style={{ textDecoration: 'none', minHeight: 30, padding: '0 10px', background: chip === 'Behind' ? 'var(--amber-soft)' : undefined, color: chip === 'Behind' ? 'var(--amber-ink)' : undefined }}
          >
            <span className="dot" style={{ width: 7, height: 7, background: chip === 'Behind' ? 'var(--amber)' : 'var(--accent)' }} />
            {chip}
          </a>
        )}
      </div>
      <div className="row-between">
        <h1 style={{ fontSize: 34 }}>{isToday ? 'Today' : fullDay(day)}</h1>
        {!isToday && (
          <button className="btn small" onClick={() => setPicked(today)}>
            Back to today
          </button>
        )}
      </div>

      <div className="section-label">This week</div>
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
              <span className="today-day-name">{weekdayName(d).slice(0, 3)}</span>
              <b>{Number(d.slice(8))}</b>
              <span className="today-day-count">{list.length === 0 ? '–' : d > today ? `${list.length}` : `${finished}/${list.length}`}</span>
            </button>
          );
        })}
      </div>

      <div className="card tight stack-sm">
        <div className="row-between small">
          <span className="strong">
            {isFuture ? `${sessions.length} planned` : `${done.length} of ${sessions.length} done`}
          </span>
          <span className="muted">
            {minutesText(minutesLeft(sessions))} left · {minutesText(available)} available
          </span>
        </div>
        <div className="bar">
          <div className="fill" style={{ width: `${sessions.length && !isFuture ? (done.length / sessions.length) * 100 : 0}%` }} />
        </div>
        {isFuture && <span className="xsmall muted">Coming up. You can check these off on the day.</span>}
      </div>

      {sessions.length === 0 && (
        <div className="card empty">
          <h3 style={{ color: 'var(--ink)', marginBottom: 6 }}>Nothing planned {isToday ? 'today' : `on ${weekdayName(day)}`}.</h3>
          Add a task, or rest. Rest counts.
        </div>
      )}
      {group('Priorities', priorities)}
      {group('Routines', routines)}
      {group('Other', other)}

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

      <button className="fab" aria-label="Add a task or log something unplanned" onClick={() => setAdding(true)}>
        <Icon name="plus" size={24} stroke={2.4} />
      </button>
      {open && <LogSheet session={data.sessions.find((s) => s.id === open.id) ?? open} onClose={() => setOpen(null)} />}
      {adding && <QuickAdd date={placeOn} onClose={() => setAdding(false)} />}
    </div>
  );
}

function TaskRow({ session, onToggle, onOpen }: { session: Session; onToggle: () => void; onOpen: () => void }) {
  const view = useView();
  const action = view.action(session.action_id);
  const goal = view.goalsForAction(session.action_id)[0];
  const s = session;
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
        ? `${s.actual_minutes} min`
        : ''
      : s.planned_count
        ? `${s.planned_count} · ${minutesText(s.planned_minutes)}`
        : s.planned_minutes
          ? minutesText(s.planned_minutes)
          : '';

  return (
    <div className="task">
      <button className="chk" aria-label={label} onClick={onToggle}>
        <span className={`ring ${ring}`}>
          {s.status === 'done' && <Icon name="check" size={13} stroke={3.2} />}
          {(s.status === 'partial' || s.status === 'minimum') && <Icon name="minus" size={13} stroke={3.2} />}
        </span>
      </button>
      <button className="body" onClick={onOpen}>
        <span className="grow">
          <span className={`title ${s.status === 'done' ? 'done' : ''}`} style={{ display: 'block' }}>
            {s.title}
            {s.planned_count && s.status === 'planned' ? ` ×${s.planned_count}` : ''}
          </span>
          {meta && (
            <span className="meta" style={{ color: s.status === 'minimum' || s.status === 'partial' ? 'var(--amber-ink)' : undefined }}>
              {goal && s.status === 'planned' && <span className="dot" style={{ background: goal.color }} />}
              {meta}
            </span>
          )}
        </span>
        <span className="min" style={{ color: s.status === 'done' ? 'var(--accent-ink)' : undefined, fontWeight: s.status === 'done' ? 600 : 400 }}>
          {right}
        </span>
      </button>
    </div>
  );
}

function QuickAdd({ date, onClose }: { date: ISODate; onClose: () => void }) {
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
            commit(opsLogUnplanned(data, a, today, logMinutes));
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
