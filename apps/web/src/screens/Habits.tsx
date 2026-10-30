import { useState } from 'react';
import { addDays, habitDays, shortDate, weekStart, type Action, type ISODate, type Session } from '@six/core';
import { useStore } from '../data/store.tsx';
import { opsLogSession, opsRestoreSession } from '../data/ops.ts';
import { blankHabit, habitSessions, habitWhen, habitsOf, keptAndStopped, opsCreateHabit, opsEditHabit, opsPauseHabit, opsSmallToday, opsStopHabit, opsTapDay, readyToGraduate, slippingHabits, statsFor, trackRecord, usualRate, weekCells, weekKept, type CellState } from '../data/habits.ts';
import { invertOps } from '../data/planPack.ts';
import type { Op } from '../data/model.ts';
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

const LATER_KEY = 'six.habits.graduateLater';
const DOW = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const STATE_WORD: Record<CellState, string> = { done: 'done', small: 'small version', part: 'partly', missed: 'missed', skipped: 'skipped', planned: 'due', none: 'not a habit day', future: 'later this week' };

export function Habits() {
  const { data, today, commit } = useStore();
  const toast = useToast();
  const [editing, setEditing] = useState<{ action: Action | null } | null>(null);
  const [detail, setDetail] = useState<Action | null>(null);
  const [weekOff, setWeekOff] = useState(0);
  const [showStopped, setShowStopped] = useState(false);
  const [later, setLater] = useState<string[]>(() => {
    try {
      return JSON.parse(localStorage.getItem(LATER_KEY) ?? '[]') as string[];
    } catch {
      return [];
    }
  });
  const all = habitsOf(data, today);
  const running = all.filter((h) => h.running);
  const { kept, stopped } = keptAndStopped(data, today);
  const dueToday = running.filter((h) => habitToday(data, h.action.id, today));
  const doneToday = dueToday.filter((h) => {
    const s = habitToday(data, h.action.id, today)!;
    return s.date === today && s.status !== 'planned' && s.status !== 'skipped';
  });
  const monday = addDays(weekStart(today), -7 * weekOff);
  const days = Array.from({ length: 7 }, (_, i) => addDays(monday, i));
  // The worst two; the rest are named in a line.
  // Real slips first (a usual pace to fall from), biggest drop first; habits with no record yet after.
  const gap = (x: { kept: number; due: number; usual: number | null }) => (x.usual == null ? 1 : x.kept / Math.max(1, x.due) - x.usual);
  const allSlipping = weekOff === 0 ? slippingHabits(data, today).sort((a, b) => gap(a) - gap(b)) : [];
  const slipping = allSlipping.slice(0, 2);
  const graduates = running.filter((h) => !later.includes(h.action.id) && readyToGraduate(data, h.action.id, today));
  const initial = (data.profile.display_name || 'You').trim().charAt(0).toUpperCase();

  const withUndo = (ops: Op[], text: string) => {
    const undo = invertOps(data, ops);
    commit(ops);
    toast(text, () => commit(undo));
  };
  const keepLater = (id: string) => {
    const next = [...later, id];
    setLater(next);
    try {
      localStorage.setItem(LATER_KEY, JSON.stringify(next));
    } catch {
      // storage blocked: just for now
    }
  };
  const graduate = (action: Action) => withUndo(opsStopHabit(data, action, today), `${action.title} is automatic now. It moved to Kept.`);
  const pause = (action: Action) => withUndo(opsPauseHabit(data, action, today), `${action.title} paused. It’s back ${shortDate(addDays(today, 7))}.`);
  const tap = (action: Action, date: ISODate) => {
    const ops = opsTapDay(data, action, date, today);
    if (ops.length) commit(ops);
  };

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

      {running.length === 0 && (
        <div className="card stack-sm">
          <span className="small" style={{ color: 'var(--ink-2)' }}>
            No habits yet. Add something you want to keep doing for its own sake, like “Guitar, 4 times a week” or “Call family on Sundays”.
          </span>
          <button className="btn small" style={{ alignSelf: 'flex-start' }} onClick={() => setEditing({ action: null })}>
            Add a habit
          </button>
        </div>
      )}

      {slipping.length > 0 && (
        <section className="card habit-alert slipping" aria-label="Slipping">
          <span className="label">Slipping</span>
          {slipping.map(({ action, why }) => {
            const small = action.min_label?.trim();
            const todayCell = weekCells(data, action.id, weekStart(today), today).find((c) => c.date === today)!;
            const doneNow = todayCell.state === 'done' || todayCell.state === 'small';
            return (
              <div key={action.id} className="habit-alert-row">
                <span className="grow">
                  <b>{action.title}</b>
                  <span className="xsmall muted">{why}</span>
                </span>
                <span className="row-start" style={{ gap: 6 }}>
                  {!doneNow && (
                    <button className="btn small primary" onClick={() => withUndo(small ? opsSmallToday(data, action, today) : opsTapDay(data, action, today, today), small ? `${action.title}: the small version counts.` : `${action.title} done today`)}>
                      {small ? `Small version: ${small}` : 'Do it today'}
                    </button>
                  )}
                  <button className="link-btn small" onClick={() => setEditing({ action })}>
                    Fewer days
                  </button>
                  <button className="link-btn small" onClick={() => pause(action)}>
                    Pause a week
                  </button>
                </span>
              </div>
            );
          })}
          {allSlipping.length > slipping.length && (
            <span className="xsmall" style={{ color: 'var(--amber-ink)' }}>
              + {allSlipping.length - slipping.length} more slipping: {allSlipping.slice(2).map((x) => x.action.title).join(', ')}
            </span>
          )}
        </section>
      )}

      {graduates.map(({ action }) => {
        const r = trackRecord(data, action.id, today);
        return (
          <section key={action.id} className="card habit-alert graduate" aria-label={`${action.title} has stuck`}>
            <span className="grow">
              <b>{action.title} has stuck.</b>
              <span className="xsmall muted">
                {Math.floor(r.days / 7)} weeks, {Math.round((r.rate8 ?? 0) * 100)}% kept. Make it automatic: stop tracking it, and it moves to Kept.
              </span>
            </span>
            <span className="row-start" style={{ gap: 6 }}>
              <button className="btn small primary" onClick={() => graduate(action)}>
                Make it automatic
              </button>
              <button className="btn small" onClick={() => keepLater(action.id)}>
                Keep tracking
              </button>
            </span>
          </section>
        );
      })}

      {running.length > 0 && (
        <section className="card habit-week-card" aria-label="Your habits this week">
          <div className="hw-bar">
            <div className="row-start" style={{ gap: 4, flexWrap: 'nowrap' }}>
              <button className="icon-btn" aria-label="Previous week" onClick={() => setWeekOff(weekOff + 1)}>
                <Icon name="back" size={16} stroke={2.4} />
              </button>
              <b className="hw-title">
                {weekOff === 0 ? 'This week' : weekOff === 1 ? 'Last week' : `${weekOff} weeks ago`}
                <span className="xsmall muted">
                  {' '}
                  · {shortDate(monday)} – {shortDate(addDays(monday, 6))}
                </span>
              </b>
              <button className="icon-btn" aria-label="Next week" disabled={weekOff === 0} onClick={() => setWeekOff(Math.max(0, weekOff - 1))}>
                <Icon name="chevron" size={16} stroke={2.4} />
              </button>
            </div>
            <span className="xsmall muted">Tap a day: done, then the small version, then clear.</span>
          </div>
          <div className="hw-grid" role="grid" aria-label="Habits by day">
            <div className="hw-row hw-head" role="row">
              <span className="hw-name" />
              {days.map((d, i) => (
                <span key={d} className={`hw-day${d === today ? ' today' : ''}`} role="columnheader">
                  {DOW[i]}
                  <b>{Number(d.slice(8))}</b>
                </span>
              ))}
              <span className="hw-sum">Week</span>
            </div>
            {running.map(({ action, schedule }) => {
              const cells = weekCells(data, action.id, monday, today);
              const w = weekKept(data, action.id, monday, today);
              const usual = usualRate(data, action.id, today);
              return (
                <div key={action.id} className="hw-row" role="row">
                  <button type="button" className="hw-name" onClick={() => setDetail(action)} aria-label={`${action.title}: details`}>
                    <b>{action.title}</b>
                    <span className="xsmall muted">{habitWhen(schedule, today)}</span>
                  </button>
                  {cells.map((c, i) => (
                    <button
                      key={c.date}
                      type="button"
                      role="gridcell"
                      className={`hw-cell s-${c.state}${c.date === today ? ' today' : ''}`}
                      disabled={!c.open}
                      onClick={() => tap(action, c.date)}
                      aria-label={`${action.title}, ${DOW[i]} ${shortDate(c.date)}: ${STATE_WORD[c.state]}`}
                    >
                      <span className="hw-mark" aria-hidden="true" />
                    </button>
                  ))}
                  <span className="hw-sum">
                    <b>
                      {w.kept}
                      <small> of {Math.max(w.planned, w.kept)}</small>
                    </b>
                    <span className="hw-trend" title={usual == null ? 'No record yet' : `Last 4 weeks: ${Math.round(usual * 100)}% kept`}>
                      <i style={{ width: `${Math.round((usual ?? 0) * 100)}%` }} />
                    </span>
                  </span>
                </div>
              );
            })}
          </div>
          <div className="hw-legend" aria-label="Key">
            <span>
              <i className="hw-mark k-done" /> Done
            </span>
            <span>
              <i className="hw-mark k-small" /> Small version
            </span>
            <span>
              <i className="hw-mark k-missed" /> Missed
            </span>
            <span>
              <i className="hw-mark k-none" /> Not a habit day
            </span>
            <span>Bar: last 4 weeks</span>
          </div>
        </section>
      )}

      {kept.length > 0 && (
        <section className="card stack-sm" aria-label="Kept">
          <span className="label">Kept · automatic now</span>
          <div className="row-start" style={{ gap: 8 }}>
            {kept.map((a) => (
              <button key={a.id} type="button" className="chip habit-kept" onClick={() => setDetail(a)}>
                <Icon name="check" size={13} stroke={2.6} /> {a.title}
              </button>
            ))}
          </div>
        </section>
      )}

      {stopped.length > 0 && (
        <>
          <button className="link-btn small" style={{ alignSelf: 'flex-start' }} onClick={() => setShowStopped(!showStopped)}>
            {showStopped ? 'Hide' : 'Show'} stopped habits ({stopped.length})
          </button>
          {showStopped && (
            <div className="row-start" style={{ gap: 8 }}>
              {stopped.map((a) => (
                <button key={a.id} type="button" className="chip" onClick={() => setDetail(a)}>
                  {a.title}
                </button>
              ))}
            </div>
          )}
        </>
      )}

      {detail && (
        <HabitDetail
          action={detail}
          onClose={() => setDetail(null)}
          onEdit={() => {
            setEditing({ action: detail });
            setDetail(null);
          }}
          onPause={() => {
            pause(detail);
            setDetail(null);
          }}
          onGraduate={() => {
            graduate(detail);
            setDetail(null);
          }}
        />
      )}
      {editing && <HabitSheet action={editing.action} onClose={() => setEditing(null)} />}
    </div>
  );
}

/** One habit in depth: today, the streaks, the last 15 weeks, its small version and cue, and what to do with it. */
function HabitDetail({ action, onClose, onEdit, onPause, onGraduate }: { action: Action; onClose: () => void; onEdit: () => void; onPause: () => void; onGraduate: () => void }) {
  const { data, today } = useStore();
  const h = habitsOf(data, today).find((x) => x.action.id === action.id);
  const running = !!h?.running;
  return (
    <Sheet title={action.title} onClose={onClose}>
      <HabitCard action={action} when={habitWhen(h?.schedule ?? null, today)} onEdit={onEdit} stopped={!running} />
      <div className="stack-sm">
        <span className="small">
          <span className="muted">Small version: </span>
          {action.min_label?.trim() || <span className="muted">none yet (add one in Edit)</span>}
        </span>
        {action.cue?.trim() && (
          <span className="small">
            <span className="muted">When: </span>
            {action.cue}
          </span>
        )}
      </div>
      <div className="row-start" style={{ gap: 8 }}>
        <button className="btn small" onClick={onEdit}>
          {running ? 'Edit' : 'Start again'}
        </button>
        {running && (
          <button className="btn small" onClick={onPause}>
            Pause a week
          </button>
        )}
        {running && (
          <button className="btn small" onClick={onGraduate}>
            Make it automatic
          </button>
        )}
      </div>
    </Sheet>
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
          minLabel: action.min_label ?? '',
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
        Small version, for off days (optional)
        <input value={v.minLabel} onChange={(e) => set({ minLabel: e.target.value })} placeholder="e.g. 2 minutes" />
      </label>
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
