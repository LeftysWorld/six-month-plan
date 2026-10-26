import { useState } from 'react';
import { addDays, habitDays, shortDate, weekStart, type Action, type ISODate, type Session } from '@six/core';
import { useStore } from '../data/store.tsx';
import { useView } from '../data/derive.ts';
import { opsLogSession, opsRestoreSession } from '../data/ops.ts';
import { blankHabit, habitSessions, habitWhen, habitsOf, opsCreateHabit, opsEditHabit, opsStopHabit, statsFor } from '../data/habits.ts';
import type { TaskInput } from '../data/breakdown.ts';
import { href } from '../router.ts';
import { Icon, Sheet, WEEKDAY_NAMES, useToast } from '../components/ui.tsx';

/**
 * Habits: things you keep doing for their own sake, not for a goal ("Clean house, every day").
 * Each one has today's check, its streak and best streak, how often it got done over the last
 * 30 days, and a grid of recent weeks. They also show in their own section on Today.
 */

const WEEKS = 15;

/** Today's session of a habit: the one dated today, or an "any day this week" one to put on today. */
export function habitToday(data: { sessions: Session[] }, actionId: string, today: ISODate): Session | null {
  const dated = data.sessions.find((s) => s.action_id === actionId && s.date === today && s.status !== 'moved');
  if (dated) return dated;
  return data.sessions.find((s) => s.action_id === actionId && !s.date && s.week_start === weekStart(today) && s.status === 'planned') ?? null;
}

export function Habits() {
  const { data, today } = useStore();
  const [editing, setEditing] = useState<{ action: Action | null } | null>(null);
  const [showStopped, setShowStopped] = useState(false);
  const all = habitsOf(data, today);
  const running = all.filter((h) => h.running);
  const stopped = all.filter((h) => !h.running);
  const dueToday = running.filter((h) => habitToday(data, h.action.id, today));
  const doneToday = dueToday.filter((h) => {
    const s = habitToday(data, h.action.id, today)!;
    return s.date === today && s.status !== 'planned' && s.status !== 'skipped';
  });
  const initial = (data.profile.display_name || 'You').trim().charAt(0).toUpperCase();
  return (
    <div className="stack rise">
      <div className="topbar">
        <span className="mono">
          {running.length} habit{running.length === 1 ? '' : 's'}
          {dueToday.length ? ` · ${doneToday.length} of ${dueToday.length} done today` : ''}
        </span>
        <a className="avatar" href={href('/settings')} aria-label="Settings">
          {initial}
        </a>
      </div>
      <div className="row-between" style={{ alignItems: 'flex-end', marginTop: -4 }}>
        <h1 style={{ margin: 0 }}>Habits</h1>
        <button className="btn small primary" onClick={() => setEditing({ action: null })}>
          <Icon name="plus" size={15} stroke={2.4} /> New habit
        </button>
      </div>
      <span className="small muted" style={{ marginTop: -6 }}>
        Things you keep doing for their own sake, not for a goal. They also show on Today.
      </span>

      {running.length === 0 && (
        <div className="card stack-sm">
          <span className="small" style={{ color: 'var(--ink-2)' }}>
            No habits yet. Add something you want to keep doing, like “Clean house, every day” or “Call family, twice a week”.
          </span>
          <button className="btn small" style={{ alignSelf: 'flex-start' }} onClick={() => setEditing({ action: null })}>
            Add a habit
          </button>
        </div>
      )}

      <div className="habit-list">
        {running.map((h) => (
          <HabitCard key={h.action.id} action={h.action} when={habitWhen(h.schedule, today)} onEdit={() => setEditing({ action: h.action })} />
        ))}
      </div>

      {stopped.length > 0 && (
        <>
          <button className="link-btn small" style={{ alignSelf: 'flex-start' }} onClick={() => setShowStopped(!showStopped)}>
            {showStopped ? 'Hide' : 'Show'} stopped habits ({stopped.length})
          </button>
          {showStopped && (
            <div className="habit-list">
              {stopped.map((h) => (
                <HabitCard key={h.action.id} action={h.action} when={habitWhen(h.schedule, today)} onEdit={() => setEditing({ action: h.action })} stopped />
              ))}
            </div>
          )}
        </>
      )}

      {editing && <HabitSheet action={editing.action} onClose={() => setEditing(null)} />}
    </div>
  );
}

function HabitCard({ action, when, onEdit, stopped = false }: { action: Action; when: string; onEdit: () => void; stopped?: boolean }) {
  const { data, today, commit } = useStore();
  const toast = useToast();
  const stats = statsFor(data, action.id, today);
  const session = stopped ? null : habitToday(data, action.id, today);
  const doneToday = !!session && session.date === today && session.status !== 'planned' && session.status !== 'skipped';
  // The grid: whole weeks, Monday first, ending this week.
  const end = addDays(weekStart(today), 6);
  const start = addDays(weekStart(today), -7 * (WEEKS - 1));
  const days = habitDays(habitSessions(data, action.id), start, end, today);
  const weeks = Array.from({ length: WEEKS }, (_, w) => days.slice(w * 7, w * 7 + 7));
  const unit = stats.unit === 'week' ? 'week' : 'day';

  function toggle() {
    if (!session) return;
    if (doneToday) {
      commit(opsRestoreSession({ ...session, status: 'planned', logged_at: null, actual_minutes: null, actual_count: null }));
      toast(`${action.title} unchecked`);
      return;
    }
    const before = session;
    commit(opsLogSession(session, { status: 'done', on: today }));
    toast(`${action.title} done${stats.streak ? ` · ${stats.streak + (stats.unit === 'day' ? 1 : 0)}-${unit} streak` : ''}`, () => commit(opsRestoreSession(before)));
  }

  return (
    <section className={`card habit-card${stopped ? ' stopped' : ''}`} aria-label={action.title}>
      <div className="habit-top">
        <button type="button" className="habit-name" onClick={onEdit} aria-label={`Edit ${action.title}`}>
          <b>{action.title}</b>
          <span className="xsmall muted">{when}</span>
        </button>
        {session ? (
          <button type="button" className={`habit-check${doneToday ? ' on' : ''}`} onClick={toggle} aria-pressed={doneToday} aria-label={doneToday ? `${action.title} done today, tap to undo` : `Mark ${action.title} done today`}>
            <span className={`ring ${doneToday ? 'done' : ''}`}>{doneToday && <Icon name="check" size={13} stroke={3.2} />}</span>
            <span className="xsmall">{doneToday ? 'Done today' : 'Today'}</span>
          </button>
        ) : (
          !stopped && <span className="xsmall muted">Not due today</span>
        )}
      </div>
      <div className="habit-stats">
        <span>
          <b className="num">{stats.streak}</b> {unit}
          {stats.streak === 1 ? '' : 's'} streak
        </span>
        <span>
          <b className="num">{stats.best}</b> best
        </span>
        <span>
          <b className="num">{stats.rate == null ? '–' : `${Math.round(stats.rate * 100)}%`}</b> last 30 days
        </span>
      </div>
      <div className="habit-grid" role="img" aria-label={`${action.title}: last ${WEEKS} weeks`}>
        {weeks.map((w, i) => (
          <span key={i} className="habit-week">
            {w.map((d) => (
              <span key={d.date} className={`hd ${d.state}${d.date === today ? ' today' : ''}${d.date > today ? ' future' : ''}`} title={`${shortDate(d.date)} · ${d.state === 'none' ? 'not due' : d.state === 'part' ? 'partly' : d.state}`} />
            ))}
          </span>
        ))}
      </div>
    </section>
  );
}

/** Add or change a habit: what, which days (or how many times a week), from when, until when. */
function HabitSheet({ action, onClose }: { action: Action | null; onClose: () => void }) {
  const { data, today, commit } = useStore();
  const view = useView();
  const toast = useToast();
  const existing = action ? data.schedules.filter((s) => s.action_id === action.id).sort((a, b) => (a.effective_from < b.effective_from ? 1 : -1))[0] : undefined;
  const [v, setV] = useState<TaskInput>(() =>
    action
      ? {
          ...blankHabit(today),
          title: action.title,
          kind: action.kind,
          minutes: action.planned_minutes,
          cue: action.cue ?? '',
          when: existing?.rule === 'per_week' ? 'per_week' : 'days',
          days: existing?.rule === 'days' ? existing.days : [1, 2, 3, 4, 5, 6, 7],
          perWeek: existing?.per_week ?? 3,
          through: existing?.effective_to ?? null,
          start: existing && existing.effective_from > today ? existing.effective_from : null,
        }
      : blankHabit(today),
  );
  const [ends, setEnds] = useState(!!v.through);
  const set = (p: Partial<TaskInput>) => setV({ ...v, ...p });
  const valid = v.title.trim() && (v.when !== 'days' || v.days.length > 0) && (!ends || (v.through && v.through >= (v.start ?? today)));
  void view;
  return (
    <Sheet title={action ? 'Edit habit' : 'New habit'} onClose={onClose}>
      <label className="field">
        Habit
        <input autoFocus={!action} value={v.title} onChange={(e) => set({ title: e.target.value })} placeholder="e.g. Clean house" />
      </label>
      <div className="stack-sm">
        <div className="seg" role="tablist" aria-label="How often">
          <button role="tab" aria-selected={v.when === 'days'} onClick={() => set({ when: 'days' })}>
            Set days
          </button>
          <button role="tab" aria-selected={v.when === 'per_week'} onClick={() => set({ when: 'per_week' })}>
            Times a week
          </button>
        </div>
        {v.when === 'days' ? (
          <div className="chips" role="group" aria-label="Days">
            {WEEKDAY_NAMES.map((d, i) => {
              const n = i + 1;
              const on = v.days.includes(n);
              return (
                <button key={d} type="button" className="chip" aria-pressed={on} onClick={() => set({ days: on ? v.days.filter((x) => x !== n) : [...v.days, n].sort() })}>
                  {d}
                </button>
              );
            })}
            <button type="button" className="chip" onClick={() => set({ days: [1, 2, 3, 4, 5, 6, 7] })}>
              Every day
            </button>
          </div>
        ) : (
          <label className="field">
            Times a week (on any days)
            <input type="number" min={1} max={14} value={v.perWeek} onChange={(e) => set({ perWeek: Math.min(14, Math.max(1, Number(e.target.value))) })} />
          </label>
        )}
      </div>
      <div className="grid-2">
        <label className="field">
          Starts
          <input type="date" min={today} value={v.start ?? today} onChange={(e) => set({ start: e.target.value && e.target.value > today ? e.target.value : null })} />
        </label>
        <label className="field">
          About how long (min)
          <input type="number" min={0} step={5} value={v.minutes} onChange={(e) => set({ minutes: Math.max(0, Number(e.target.value)) })} />
        </label>
      </div>
      <label className="check-row small">
        <input type="checkbox" checked={ends} onChange={(e) => (setEnds(e.target.checked), set({ through: e.target.checked ? addDays(v.start ?? today, 29) : null }))} />
        <span>It ends on a date</span>
      </label>
      {ends && (
        <label className="field">
          Last day
          <input type="date" min={v.start ?? today} value={v.through ?? ''} onChange={(e) => set({ through: e.target.value || null })} />
        </label>
      )}
      <label className="field">
        When or where (optional)
        <input value={v.cue} onChange={(e) => set({ cue: e.target.value })} placeholder="e.g. After dinner" />
      </label>
      {action && <span className="xsmall muted">Changes apply from today; past days keep their record.</span>}
      <button
        className="btn primary"
        disabled={!valid}
        onClick={() => {
          const input = { ...v, through: ends ? v.through : null };
          if (action) commit(opsEditHabit(data, action, input, today));
          else commit(opsCreateHabit(data, input, today).ops);
          toast(action ? 'Habit saved' : `${v.title.trim()} added. It shows on Today.`);
          onClose();
        }}
      >
        {action ? 'Save habit' : 'Add habit'}
      </button>
      {action && (
        <button
          className="link-btn small"
          style={{ color: 'var(--danger)', alignSelf: 'flex-start' }}
          onClick={() => {
            commit(opsStopHabit(data, action, today));
            toast(`${action.title} stopped. Its history stays.`);
            onClose();
          }}
        >
          Stop this habit
        </button>
      )}
    </Sheet>
  );
}

/** Today's habits as a compact section on Today: check them off right there, or open the Habits tab. */
export function TodayHabits({ day }: { day: ISODate }) {
  const { data, today, commit } = useStore();
  const toast = useToast();
  const running = habitsOf(data, today).filter((h) => h.running);
  if (!running.length) return null;
  const rows = running.map((h) => ({ h, session: day === today ? habitToday(data, h.action.id, today) : data.sessions.find((s) => s.action_id === h.action.id && s.date === day && s.status !== 'moved') ?? null })).filter((r) => r.session);
  return (
    <section className="card today-habits" aria-label="Habits">
      <div className="row-between">
        <span className="label">Habits</span>
        <a className="link-btn small" href={href('/habits')} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          All habits <Icon name="chevron" size={13} stroke={2.4} />
        </a>
      </div>
      {rows.length === 0 && <span className="small muted">No habits due {day === today ? 'today' : 'this day'}.</span>}
      {rows.map(({ h, session }) => {
        const s = session!;
        const done = s.date === day && s.status !== 'planned' && s.status !== 'skipped';
        const stats = statsFor(data, h.action.id, today);
        return (
          <div key={h.action.id} className="today-habit">
            <button
              type="button"
              className={`ring ${done ? 'done' : ''}`}
              disabled={day > today}
              aria-label={done ? `${h.action.title} done, tap to undo` : `Mark ${h.action.title} done`}
              onClick={() => {
                if (done) {
                  commit(opsRestoreSession({ ...s, status: 'planned', logged_at: null, actual_minutes: null, actual_count: null }));
                  return;
                }
                commit(opsLogSession(s, { status: 'done', on: day }));
                toast(`${h.action.title} done`, () => commit(opsRestoreSession(s)));
              }}
            >
              {done && <Icon name="check" size={12} stroke={3.2} />}
            </button>
            <span className="grow small" style={{ textDecoration: done ? 'line-through' : undefined, color: done ? 'var(--muted)' : undefined }}>
              {h.action.title}
            </span>
            {stats.streak > 0 && (
              <span className="xsmall muted">
                {stats.streak} {stats.unit === 'week' ? 'wk' : 'day'} streak
              </span>
            )}
          </div>
        );
      })}
    </section>
  );
}
