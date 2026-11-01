import { useState } from 'react';
import { daysBetween, isTally, onPathDate, shortDate, steadyRange, weekStart, weekToPlan, type Goal, type ISODate, type Plan, type PlanStep } from '@six/core';
import { useStore } from '../data/store.tsx';
import { fmt } from '../data/derive.ts';
import { opsSetLevel, type Chain } from '../data/chain.ts';
import { ladderPeriods, ladderTargets, periodEnd, targetsAt } from '../data/ladder.ts';
import { checkLevelTarget, levelStanding, noteParts, orderLevels, untilText, type WeightLevel, type WeightLevelId } from '../data/weightPlan.ts';
import { href, navigate } from '../router.ts';
import { planHref } from '../screens/PlanGoal.tsx';
import { useToast } from './ui.tsx';
import { useWeight } from './WeightGoal.tsx';

const fmt1 = (v: number) => (Math.round(v * 10) / 10).toFixed(1);
const WD = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const dayName = (d: ISODate) => WD[(new Date(`${d}T12:00:00Z`).getUTCDay() + 6) % 7];

/**
 * The plan for a weight goal: this week, this month, the 3-month checkpoint and the season, in date
 * order. Each level says where you'll be (checked against the path and your 7-day average) and what
 * you'll do to get there (its focus). The week's own goal and tasks live in This week, below.
 */
export function WeightPlanCard({ goal, plan, chain, onEdit }: { goal: Goal; plan: Plan; chain: Chain; onEdit: (level: 'week' | 'goal') => void }) {
  const w = useWeight(goal, plan);
  const { data, today, view, unit, start, direction, target, by, latest } = w;
  const { commit } = useStore();
  const toast = useToast();
  const monday = weekStart(today < plan.start_date ? plan.start_date : today);
  const p = ladderPeriods(view, goal, plan, monday);
  const ladder = ladderTargets(data, goal, plan, p);
  const weekStep = chain.week.step;

  const levels: WeightLevel[] = orderLevels([
    { id: 'week', label: 'This week', end: chain.week.node.end, value: weekStep?.target_value ?? null, note: weekStep?.target_note.trim() ?? '', step: weekStep },
    { id: 'month', label: 'This month', end: periodEnd(p, p.month), value: ladder.month[0]?.target_value ?? null, note: ladder.month[0]?.target_note.trim() ?? '', step: ladder.month[0] ?? null },
    { id: 'quarter', label: '3 months', end: periodEnd(p, p.quarter), value: ladder.quarter[0]?.target_value ?? null, note: ladder.quarter[0]?.target_note.trim() ?? '', step: ladder.quarter[0] ?? null },
    { id: 'season', label: 'Season', end: by, value: target, note: goal.done_means.trim(), step: null },
  ]);
  const nextOpen = levels.find((l) => l.id !== 'week' && l.end >= today && l.value != null);
  const [sel, setSel] = useState<WeightLevelId>(nextOpen?.id ?? 'week');
  const [editing, setEditing] = useState<'target' | 'focus' | null>(null);
  const [draft, setDraft] = useState('');

  const trend = w.trendNow ?? (latest ? Number(latest.value) : start.value);
  const steadyHigh = steadyRange(trend).high;
  const opts = { trend, today, direction, pathAt: w.pathAt, steadyHigh };
  const idx = Math.max(0, levels.findIndex((l) => l.id === sel));
  const cur = levels[idx]!;
  const s = levelStanding(cur, opts);
  const prev = levels.slice(0, idx).reverse().find((l) => l.value != null);
  const u = unit ? ` ${unit}` : '';

  // The season bar: from the goal's start to its finish, with each level where it falls.
  const span = Math.max(1, daysBetween(start.date, by));
  const at = (d: ISODate) => Math.max(0, Math.min(100, (daysBetween(start.date, d) / span) * 100));

  // Thursday on, the week to plan is next week: offer it when it isn't planned yet.
  const nextMonday = weekToPlan(today);
  const nextPlanned = nextMonday !== monday && targetsAt(data, goal.id, plan.id, 'week', ladderPeriods(view, goal, plan, nextMonday).week.start).length > 0;

  // How this week's tasks went, for the week's "what you'll do".
  const weekEnd = chain.week.node.end;
  const weekFrom = chain.week.node.start;
  const doneish = (st: string) => st === 'done' || st === 'partial' || st === 'minimum';
  const tally = view
    .actionsForGoal(goal.id)
    .filter((a) => !a.archived_at)
    .map((a) => {
      const xs = data.sessions.filter((x) => x.action_id === a.id && x.status !== 'moved' && (x.date ? x.date >= weekFrom && x.date <= weekEnd : x.week_start === weekFrom));
      const missed = xs.filter((x) => x.date && x.date < today && x.status === 'planned');
      return { action: a, total: xs.length, done: xs.filter((x) => doneish(x.status)).length, missed };
    })
    .filter((x) => x.total > 0);
  const workouts = tally.filter((x) => x.action.kind === 'workout');
  const doing: { title: string; text: string; tone: 'good' | 'late' | 'none' }[] = [];
  if (workouts.length) {
    const total = workouts.reduce((n, x) => n + x.total, 0);
    const done = workouts.reduce((n, x) => n + x.done, 0);
    const missed = workouts.filter((x) => x.missed.length).map((x) => x.action.title);
    doing.push({ title: 'Workouts', text: `${done} of ${total}${missed.length ? ` · ${missed.join(', ')} not logged` : ''}`, tone: done === total ? 'good' : missed.length ? 'late' : 'none' });
  }
  for (const x of tally.filter((t) => t.action.kind !== 'workout')) {
    doing.push({ title: x.action.title, text: `${x.done} of ${x.total}${x.missed.length ? ' · missed one' : ''}`, tone: x.done === x.total ? 'good' : x.missed.length ? 'late' : 'none' });
  }

  // Milestones on the way, for the footer.
  const weighted = data.milestones
    .filter((m) => m.goal_id === goal.id && m.value != null && !isTally(m) && !m.count_action_id && !m.completed_at)
    .map((m) => ({ value: Number(m.value), on: onPathDate(start, w.path, Number(m.value)) }))
    .filter((m) => m.on)
    .sort((a, b) => (a.on! < b.on! ? -1 : 1))
    .slice(0, 2);

  const open = (id: WeightLevelId) => () => {
    setSel(id);
    setEditing(null);
  };
  const ladderStep = (id: WeightLevelId) => (id === 'season' ? 'season' : id);
  const startTarget = () => {
    if (cur.id === 'season') return onEdit('goal');
    if (cur.id === 'week') {
      setDraft(cur.value != null ? String(cur.value) : chain.week.suggested != null ? String(chain.week.suggested) : '');
      return setEditing('target');
    }
    if (!cur.step) return navigate(planHref(goal.id, ladderStep(cur.id), monday));
    setDraft(cur.value != null ? String(cur.value) : '');
    setEditing('target');
  };
  const startFocus = () => {
    if (cur.id !== 'week' && !cur.step) return navigate(planHref(goal.id, ladderStep(cur.id), monday));
    if (cur.id === 'week') return onEdit('week');
    setDraft(cur.note);
    setEditing('focus');
  };
  const check = editing === 'target' ? checkLevelTarget(levels, idx, draft, { start: start.value, direction, trend, today, unit, steadyHigh, fmt }) : null;
  const saveStep = (step: PlanStep | null, patch: { target_value?: number | null; target_note?: string }, level: 'week' | 'month' | 'quarter') => {
    if (level === 'week') commit(opsSetLevel(data, goal, plan, chain, 'week', patch));
    else if (step) commit([{ kind: 'update', collection: 'planSteps', id: step.id, patch }]);
  };
  const saveTarget = () => {
    if (!check?.ok || cur.id === 'season') return;
    const before = cur.value;
    const v = Math.round(Number(draft) * 10) / 10;
    saveStep(cur.step, { target_value: v }, cur.id);
    setEditing(null);
    toast(`${cur.label}: ${fmt(v)}${u}`, cur.step ? () => saveStep(cur.step, { target_value: before }, cur.id as 'week' | 'month' | 'quarter') : undefined);
  };
  const saveFocus = () => {
    if (cur.id === 'season' || cur.id === 'week' || !cur.step) return;
    const before = cur.note;
    saveStep(cur.step, { target_note: draft.trim() }, cur.id);
    setEditing(null);
    toast(`${cur.label}’s focus saved`, () => saveStep(cur.step, { target_note: before }, cur.id as 'month' | 'quarter'));
  };

  const behindWord = direction < 0 ? 'above' : 'below';
  const chip = (() => {
    if (cur.value == null || !s) return null;
    if (cur.id === 'week') {
      const off = Math.round((cur.value - trend) * -direction * 10) / 10; // positive = past it
      if (off >= 0) return { tone: 'good', text: 'Your 7-day average is past it' };
      return { tone: -off <= w.band ? 'good' : 'late', text: `Your 7-day average is ${fmt1(-off)}${u} ${behindWord} it${-off <= w.band ? ', inside the zone' : ''}` };
    }
    if (Math.abs(s.offPath) <= 1) return { tone: 'good', text: `On your path (${fmt1(s.path)} that day)` };
    return s.offPath > 0 ? { tone: 'good', text: `${fmt1(s.offPath)}${u} ahead of your path` } : { tone: 'late', text: `${fmt1(-s.offPath)}${u} behind your path` };
  })();

  return (
    <section className="card wp-card" aria-label="The plan">
      <div className="row-between" style={{ alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <span className="stack-sm" style={{ gap: 1 }}>
          <b className="plan-card-title" style={{ margin: 0 }}>The plan</b>
          <span className="xsmall muted">Where you’ll be, and what you’ll do to get there</span>
        </span>
        <a className="btn small" href={href(planHref(goal.id, 'review'))}>
          Open the plan
        </a>
      </div>

      <div className="wp-bar" aria-hidden="true">
        <span className="wp-bar-track" />
        <span className="wp-bar-fill" style={{ width: `${at(today)}%`, background: goal.color }} />
        {levels.map((l) => (
          <span key={l.id} className={`wp-mark ${l.id}${l.id === sel ? ' on' : ''}`} style={{ left: `${at(l.end)}%` }} />
        ))}
      </div>

      <div className="wp-tiles" role="group" aria-label="Plan levels">
        {levels.map((l) => {
          const st = levelStanding(l, opts);
          const on = l.id === sel;
          let stat = 'Not set';
          let good = true;
          if (l.value != null && st) {
            if (l.id === 'week') {
              const off = Math.round((l.value - trend) * -direction * 10) / 10;
              stat = off >= 0 ? 'Past it' : `${fmt(-off)} ${behindWord}`;
              good = -off <= w.band;
            } else if (l.end < today) stat = 'Done';
            else {
              stat = `Needs ${fmt(st.needs)}/wk`;
              good = !st.steep;
            }
          }
          return (
            <button key={l.id} type="button" className={`wp-tile${on ? ' on' : ''}`} aria-pressed={on} onClick={open(l.id)} aria-label={`${l.label}, ${l.value != null ? `${fmt(l.value)}${u}` : 'not set'} by ${shortDate(l.end)}, ${stat}`}>
              <span className="wp-tile-label">{l.label}</span>
              <b className="num">{l.value != null ? fmt(l.value) : '—'}</b>
              <span className="wp-tile-date">by {shortDate(l.end)}</span>
              <span className={`wp-tile-stat ${l.value == null ? 'none' : good ? 'good' : 'late'}`}>{stat}</span>
            </button>
          );
        })}
      </div>

      <div className="wp-detail" aria-live="polite">
        <div className="wp-detail-main">
          <span className="mono" style={{ fontSize: 10.5 }}>
            {cur.label} · by {dayName(cur.end)} {shortDate(cur.end)} · {untilText(today, cur.end, shortDate)}
          </span>
          <span className="wp-value num">
            {cur.value != null ? fmt(cur.value) : '—'}
            <span className="wg-unit"> {unit}</span>
          </span>
          {chip && (
            <span className="wg-chip" style={chip.tone === 'good' ? { background: 'var(--blue-soft)', color: 'var(--blue-ink)' } : { background: 'var(--amber-soft)', color: 'var(--amber-ink)' }}>
              <span className="wg-chip-dot" style={{ background: chip.tone === 'good' ? 'var(--blue)' : 'var(--amber-bar)' }} />
              {chip.text}
            </span>
          )}
          {cur.value != null && s && (
            <div className="wp-stats">
              {cur.id === 'week' ? (
                <>
                  <div>
                    <span>Today</span>
                    <b>{latest ? fmt1(Number(latest.value)) : '—'}</b>
                  </div>
                  <div>
                    <span>7-day average</span>
                    <b style={{ color: 'var(--accent-ink)' }}>{fmt1(trend)}</b>
                  </div>
                  <div>
                    <span>The path today</span>
                    <b style={{ color: 'var(--blue-ink)' }}>{fmt1(w.pathAt(today))}</b>
                  </div>
                </>
              ) : (
                <>
                  <div>
                    <span>To go</span>
                    <b>
                      {fmt(s.toGo)}
                      {u}
                    </b>
                  </div>
                  <div>
                    <span>Needs</span>
                    <b style={s.steep ? { color: 'var(--amber-ink)' } : undefined}>
                      {fmt(s.needs)}
                      {u}/wk
                    </b>
                  </div>
                  <div>
                    <span>Path that day</span>
                    <b style={{ color: 'var(--blue-ink)' }}>{fmt1(s.path)}</b>
                  </div>
                </>
              )}
            </div>
          )}
          {cur.id !== 'week' && cur.value != null && prev?.value != null && (
            <span className="small" style={{ lineHeight: 1.5, color: 'var(--ink-2)' }}>
              {fmt(Math.round(Math.abs(prev.value - cur.value) * 10) / 10)}
              {u} after {prev.label.toLowerCase()} ({fmt(prev.value)} by {shortDate(prev.end)}), from your 7-day average of {fmt1(trend)}.
            </span>
          )}
          {cur.value == null && <span className="small muted">Not planned yet. Set it in the plan, from the level above.</span>}

          {editing === 'target' ? (
            <div className="wp-edit" role="group" aria-label={`Change ${cur.label.toLowerCase()}’s target`}>
              <label className="field" style={{ margin: 0 }}>
                Target by {shortDate(cur.end)} ({unit})
                <span className="row-start" style={{ gap: 10, flexWrap: 'wrap' }}>
                  <input type="number" step="0.1" inputMode="decimal" autoFocus value={draft} onChange={(e) => setDraft(e.target.value)} style={{ width: 120 }} />
                  <span className="xsmall muted">Your path says {fmt1(w.pathAt(cur.end))} by then.</span>
                </span>
              </label>
              {check && (
                <span role="status" className={`wp-check ${check.ok ? 'good' : 'late'}`}>
                  {check.text}
                </span>
              )}
              <span className="row-start" style={{ gap: 8 }}>
                <button type="button" className="btn small primary" disabled={!check?.ok} onClick={saveTarget}>
                  Save
                </button>
                <button type="button" className="btn small" onClick={() => setEditing(null)}>
                  Cancel
                </button>
              </span>
            </div>
          ) : (
            <span className="row-start" style={{ gap: 14, flexWrap: 'wrap' }}>
              <button type="button" className="btn small" onClick={startTarget}>
                {cur.id === 'season' ? 'Edit the goal' : cur.id === 'week' ? 'Edit this week' : cur.value == null ? 'Set it in the plan' : 'Edit target'}
              </button>
              <a className="link-btn small" href={href(planHref(goal.id, ladderStep(cur.id), monday))} style={{ textDecoration: 'none', display: 'inline-flex', alignItems: 'center' }}>
                Open in the plan ›
              </a>
            </span>
          )}
        </div>

        <div className="wp-detail-side">
          <span className="mono" style={{ fontSize: 10.5 }}>
            What you’ll do
          </span>
          {cur.id === 'week' && (
            <>
              {noteParts(cur.note).length > 0 ? (
                <div className="wp-do">
                  {noteParts(cur.note).map((t) => (
                    <span key={t} className="small" style={{ fontWeight: 600 }}>
                      {t}
                    </span>
                  ))}
                </div>
              ) : (
                <span className="small muted">No week goal yet.</span>
              )}
              {doing.length > 0 && (
                <div className="wp-doing">
                  <span className="xsmall muted">From this week’s tasks</span>
                  {doing.map((d) => (
                    <span key={d.title} className="wp-doing-row">
                      <span className="wg-chip-dot" style={{ background: d.tone === 'good' ? 'var(--blue)' : d.tone === 'late' ? 'var(--amber-bar)' : 'var(--faint)' }} />
                      <span className="small" style={{ fontWeight: 600 }}>{d.title}</span>
                      <span className="xsmall" style={{ color: d.tone === 'good' ? 'var(--blue-ink)' : d.tone === 'late' ? 'var(--amber-ink)' : 'var(--muted)' }}>{d.text}</span>
                    </span>
                  ))}
                </div>
              )}
              {nextMonday !== monday && !nextPlanned && (
                <div className="wp-next">
                  <span className="small" style={{ color: 'var(--ink-2)' }}>
                    Next week ({shortDate(nextMonday)}) isn’t set yet
                  </span>
                  <a className="btn small" href={href(planHref(goal.id, 'week', nextMonday))}>
                    Plan next week
                  </a>
                </div>
              )}
            </>
          )}
          {cur.id === 'season' && (
            <span className="small" style={{ lineHeight: 1.5, fontWeight: 600 }}>
              {cur.note ? `Done means: “${cur.note}”` : `${fmt(target)}${u} by ${shortDate(by)}`}
            </span>
          )}
          {(cur.id === 'month' || cur.id === 'quarter') &&
            (editing === 'focus' ? (
              <div className="wp-edit" role="group" aria-label={`${cur.label}’s focus`}>
                <label className="field" style={{ margin: 0 }}>
                  {cur.id === 'month' ? `What will you keep doing until ${shortDate(cur.end)}?` : `What should be true by ${shortDate(cur.end)}?`}
                  <textarea autoFocus rows={3} value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="e.g. Five workouts every week, keto on weekdays" />
                </label>
                <span className="row-start" style={{ gap: 8 }}>
                  <button type="button" className="btn small primary" onClick={saveFocus}>
                    Save
                  </button>
                  <button type="button" className="btn small" onClick={() => setEditing(null)}>
                    Cancel
                  </button>
                </span>
              </div>
            ) : (
              <>
                {cur.note ? (
                  <span className="small" style={{ lineHeight: 1.5, fontWeight: 600 }}>{cur.note}</span>
                ) : (
                  <span className="small" style={{ lineHeight: 1.5, color: 'var(--ink-2)' }}>
                    {cur.id === 'month' ? 'No focus for this month yet. The number says where; the focus says what you’ll keep doing to get there.' : `No focus for the checkpoint yet. What should be a habit by ${shortDate(cur.end)}?`}
                  </span>
                )}
                <button type="button" className="btn small" style={{ alignSelf: 'flex-start' }} onClick={startFocus}>
                  {cur.note ? 'Edit focus' : '+ Add a focus'}
                </button>
              </>
            ))}
        </div>
      </div>

      {weighted.length > 0 && (
        <span className="xsmall muted" style={{ lineHeight: 1.45 }}>
          Milestones on the way ({weighted.map((m) => `${fmt(m.value)} by ${shortDate(m.on!)}`).join(', ')}) are in{' '}
          <button type="button" className="link-btn xsmall" style={{ minHeight: 0 }} onClick={() => document.getElementById('wg-milestones')?.scrollIntoView({ behavior: 'smooth', block: 'center' })}>
            Milestones &amp; prizes
          </button>
          .
        </span>
      )}
    </section>
  );
}
