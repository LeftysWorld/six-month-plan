import { useState } from 'react';
import { addDays, isoWeekday, shortDate, type ISODate } from '@six/core';
import { useStore } from '../data/store.tsx';
import { useView } from '../data/derive.ts';
import { KIND_TEXT, calendarItems, dayTitle, opsAddOnDate, repeatingOn, type CalItem, type CalKind } from '../data/calendar.ts';
import { opsAddMilestone, opsLogSession, opsToggleMilestone } from '../data/ops.ts';
import { MilestoneSheet } from '../components/MilestoneSheet.tsx';
import { href, navigate } from '../router.ts';
import { Icon, useToast } from '../components/ui.tsx';

/**
 * The calendar: a month at a glance with what happens on each date (one-day tasks like an exam or a
 * class, one-offs, milestones, goals starting or due, the season's checkpoints), and the chosen day
 * in detail, where things can be ticked off or added. Repeating tasks live on Today and Habits; a
 * switch shows how many run each day.
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

export function Calendar() {
  const { data, today, commit } = useStore();
  const view = useView();
  const toast = useToast();
  const [month, setMonth] = useState(monthOf(today));
  const [picked, setPicked] = useState<ISODate>(today);
  const [repeating, setRepeating] = useState(false);
  const [editingMs, setEditingMs] = useState<string | null>(null);
  const msEditing = editingMs ? data.milestones.find((x) => x.id === editingMs) : undefined;
  const first = `${month}-01`;
  const gridStart = addDays(first, 1 - isoWeekday(first));
  const cells = Array.from({ length: 42 }, (_, i) => addDays(gridStart, i));
  // Drop a last row that's entirely next month.
  const shown = cells.slice(35).every((d) => monthOf(d) !== month) ? cells.slice(0, 35) : cells;
  const items = calendarItems(view, shown[0]!, shown.at(-1)!);
  const dayItems = items.get(picked) ?? [];
  const [y, m] = month.split('-').map(Number) as [number, number];
  const initial = (data.profile.display_name || 'You').trim().charAt(0).toUpperCase();
  const upcoming = [...items.entries()].filter(([d]) => d >= today && monthOf(d) === month).reduce((n, [, l]) => n + l.filter((x) => !x.done && x.kind !== 'season').length, 0);

  function toggle(item: CalItem) {
    if (item.milestoneId) {
      const ms = data.milestones.find((x) => x.id === item.milestoneId);
      if (!ms) return;
      commit(opsToggleMilestone(ms));
      toast(ms.completed_at ? `${ms.title} reopened` : `${ms.title} done`);
      return;
    }
    const s = item.sessionId ? data.sessions.find((x) => x.id === item.sessionId) : undefined;
    if (!s) return;
    const done = s.status !== 'planned' && s.status !== 'skipped';
    commit(opsLogSession(s, { status: done ? 'planned' : 'done', on: s.date ?? item.date }));
    toast(done ? `${s.title} unchecked` : `${s.title} done`);
  }

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

      <div className="cal-layout">
        <section className="card cal" aria-label={`${MONTHS[m - 1]} ${y}`}>
          <div className="cal-bar">
            <div className="row-start" style={{ gap: 4, flexWrap: 'nowrap' }}>
              <button className="icon-btn" aria-label="Previous month" onClick={() => setMonth(shiftMonth(month, -1))}>
                <Icon name="back" size={16} stroke={2.4} />
              </button>
              <b className="cal-month">
                {MONTHS[m - 1]} {y}
              </b>
              <button className="icon-btn" aria-label="Next month" onClick={() => setMonth(shiftMonth(month, 1))}>
                <Icon name="chevron" size={16} stroke={2.4} />
              </button>
            </div>
            <div className="row-start" style={{ gap: 6 }}>
              <button className={`chip cal-chip`} aria-pressed={repeating} onClick={() => setRepeating(!repeating)} title="Show how many repeating tasks run each day">
                Repeating
              </button>
              {(monthOf(today) !== month || picked !== today) && (
                <button
                  className="btn small"
                  onClick={() => {
                    setMonth(monthOf(today));
                    setPicked(today);
                  }}
                >
                  Today
                </button>
              )}
            </div>
          </div>
          <div className="cal-grid" role="grid">
            {DAYS.map((d) => (
              <span key={d} className="cal-dow" role="columnheader">
                {d}
              </span>
            ))}
            {shown.map((d) => {
              const list = items.get(d) ?? [];
              const rep = repeating ? repeatingOn(data, d) : null;
              const out = monthOf(d) !== month;
              return (
                <button
                  key={d}
                  type="button"
                  role="gridcell"
                  className={`cal-cell${out ? ' out' : ''}${d === today ? ' today' : ''}${d === picked ? ' picked' : ''}${d < today ? ' past' : ''}`}
                  aria-selected={d === picked}
                  aria-label={`${dayTitle(d)}${list.length ? `: ${list.map((x) => x.title).join(', ')}` : ''}`}
                  onClick={() => {
                    setPicked(d);
                    if (out) setMonth(monthOf(d));
                  }}
                >
                  <span className="cal-num">{Number(d.slice(8))}</span>
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
          <div className="cal-legend" aria-label="Key">
            {(['task', 'milestone', 'checkpoint', 'start', 'finish', 'season'] as CalKind[]).map((k) => (
              <span key={k}>
                <KindMark kind={k} /> {k === 'task' ? 'One day' : k === 'start' ? 'Goal starts' : k === 'finish' ? 'Goal due' : k === 'season' ? 'Season' : k === 'checkpoint' ? '3-month, month, week goal' : 'Date to hit'}
              </span>
            ))}
          </div>
        </section>

        <section className="card stack-sm cal-day" aria-label={dayTitle(picked)}>
          <div className="row-between">
            <b style={{ fontSize: 17 }}>{picked === today ? `Today · ${shortDate(picked)}` : dayTitle(picked)}</b>
            <a className="link-btn small" href={href('/today')} onClick={(e) => (e.preventDefault(), navigate('/today'))} style={{ display: picked === today ? 'inline-flex' : 'none' }}>
              Open Today
            </a>
          </div>
          {dayItems.length === 0 && <span className="small muted">Nothing dated on this day.</span>}
          {dayItems.map((x) => (
            <div key={x.id} className="cal-row">
              {x.sessionId || x.milestoneId ? (
                <button type="button" className={`ring ${x.done ? 'done' : ''}`} onClick={() => toggle(x)} aria-label={x.done ? `${x.title} done, tap to reopen` : `Mark ${x.title} done`} style={{ flex: 'none', cursor: 'pointer' }}>
                  {x.done && <Icon name="check" size={12} stroke={3.2} />}
                </button>
              ) : (
                <span className="cal-row-mark" style={{ ['--c' as string]: x.color }}>
                  <KindMark kind={x.kind} />
                </span>
              )}
              {x.milestoneId ? (
                <button type="button" className="grow stack-sm cal-row-btn" onClick={() => setEditingMs(x.milestoneId!)} aria-label={`Change ${x.title}`} style={{ gap: 1, minWidth: 0 }}>
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
          {(() => {
            const r = repeatingOn(data, picked);
            return r.goals + r.habits > 0 ? (
              <span className="xsmall muted">
                Also {r.goals ? `${r.goals} goal task${r.goals === 1 ? '' : 's'}` : ''}
                {r.goals && r.habits ? ' and ' : ''}
                {r.habits ? `${r.habits} habit${r.habits === 1 ? '' : 's'}` : ''} that repeat{r.goals + r.habits === 1 ? 's' : ''} on this day.
              </span>
            ) : null;
          })()}
          <AddOnDay date={picked} />
        </section>
      </div>
      {msEditing && <MilestoneSheet milestone={msEditing} onClose={() => setEditingMs(null)} />}
    </div>
  );
}

/** A small mark for each kind: a square for a one-day task, a dot for a milestone, a bar end for a goal's start or due date. */
function KindMark({ kind }: { kind: CalKind }) {
  return <span className={`kmark k-${kind}`} aria-hidden="true" />;
}

/** Put something on the chosen day: a one-day task for a goal (an exam, a class), or a one-off. */
function AddOnDay({ date }: { date: ISODate }) {
  const { data, today, commit } = useStore();
  const view = useView();
  const toast = useToast();
  const [title, setTitle] = useState('');
  const [goalId, setGoalId] = useState('');
  const [as, setAs] = useState<'task' | 'date'>('task');
  // Past days take only dates to hit (a milestone you reached then); tasks are for today on.
  const past = date < today;
  const asDate = !!goalId && (as === 'date' || past);
  const goals = view.activeGoals;
  return (
    <form
      className="stack-sm cal-add"
      onSubmit={(e) => {
        e.preventDefault();
        if (past && !goalId) return;
        const ops = asDate ? opsAddMilestone(goalId, title, date) : opsAddOnDate(data, { title, date, goalId: goalId || null }, today);
        if (!ops.length || !title.trim()) return;
        commit(ops);
        toast(asDate ? `${title.trim()}: a date for ${view.goal(goalId)?.title}. It's on the roadmap too.` : `${title.trim()} added on ${shortDate(date)}`);
        setTitle('');
      }}
    >
      <span className="label">{past ? `Add a date on ${shortDate(date)}` : `Add on ${shortDate(date)}`}</span>
      <input className="input" aria-label="What" placeholder={asDate ? 'e.g. JHU course starts, Weigh 200 lb' : 'e.g. AIGP exam, JHU class'} value={title} onChange={(e) => setTitle(e.target.value)} />
      {goalId && !past && (
        <div className="seg" role="tablist" aria-label="Add as">
          <button type="button" role="tab" aria-selected={as === 'task'} onClick={() => setAs('task')}>
            A task to do that day
          </button>
          <button type="button" role="tab" aria-selected={as === 'date'} onClick={() => setAs('date')}>
            A date to hit
          </button>
        </div>
      )}
      {goalId && (
        <span className="xsmall muted">
          {asDate ? 'A date inside the goal, on the roadmap and its page (class begins, weigh 200 lb).' : 'Shows on Today that day, with a check, and on the goal\'s page.'}
        </span>
      )}
      <div className="row-start" style={{ flexWrap: 'nowrap' }}>
        <select className="input" aria-label="For" value={goalId} onChange={(e) => setGoalId(e.target.value)}>
          {past ? <option value="">Pick a goal</option> : <option value="">Not for a goal (one-off)</option>}
          {goals.map((g) => (
            <option key={g.id} value={g.id}>
              For {g.title}
            </option>
          ))}
        </select>
        <button className="btn small" type="submit" disabled={!title.trim() || (past && !goalId)} style={{ flex: 'none', minHeight: 44 }}>
          Add
        </button>
      </div>
    </form>
  );
}
