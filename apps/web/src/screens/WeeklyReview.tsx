import { useEffect, useMemo, useState } from 'react';
import {
  addDays,
  blockIndex,
  blockRange,
  missingSessionsForWeek,
  quarterRange,
  reviewSuggestions,
  scheduleForWeek,
  sessionCredit,
  shortDate,
  weekDates,
  weekdayName,
  type ActionSchedule,
  type DateRange,
  type ISODate,
  type ReviewKind,
  type Session,
} from '@six/core';
import { useStore } from '../data/store.tsx';
import { fmt, minutesText, useView } from '../data/derive.ts';
import type { ReviewPayload } from '../data/model.ts';
import { opsCompleteReview } from '../data/ops.ts';
import { navigate, useRoute } from '../router.ts';
import { BackLink, NumberInput, OBSTACLES, PacePill, WEEKDAY_NAMES, useToast } from '../components/ui.tsx';
import { weekToReview } from './ReviewHub.tsx';

interface Choice {
  kind: 'keep' | 'lower' | 'minimum';
  perWeek?: number;
  minLabel?: string;
  minMinutes?: number | null;
}

interface Draft {
  step: number;
  measurements: Record<string, number | null>;
  obstacles: string[];
  wentWell: string;
  gotInWay: string;
  changeNext: string;
  choices: Record<string, Choice>;
  /** Day chosen for each next-week session, keyed by "actionId:slot". */
  placements: Record<string, ISODate | null>;
}

const STEPS = ['Look back', 'Measure', 'Reflect', 'Adjust', 'Plan'];
const slotKey = (s: Pick<Session, 'action_id' | 'slot'>) => `${s.action_id}:${s.slot}`;

export function WeeklyReview({ kind: kindParam }: { kind: string }) {
  const { data, today, commit } = useStore();
  const view = useView();
  const toast = useToast();
  const route = useRoute();
  const kind = (['weekly', 'block', 'quarter', 'retro'].includes(kindParam) ? kindParam : 'weekly') as ReviewKind;
  const monday = route.query.get('week') ?? weekToReview(data, today).monday;
  const sunday = addDays(monday, 6);
  const nextMonday = addDays(monday, 7);
  const plan = view.mainPlan;
  const draftKey = `six.review.draft.${kind}.${monday}`;

  const [draft, setDraft] = useState<Draft>(() => {
    try {
      const saved = localStorage.getItem(draftKey);
      if (saved) return JSON.parse(saved) as Draft;
    } catch {
      // ignore broken drafts
    }
    const weekObstacles = data.sessions.filter((s) => s.week_start === monday).flatMap((s) => s.obstacles);
    return {
      step: 0,
      measurements: {},
      obstacles: [...new Set(weekObstacles)],
      wentWell: '',
      gotInWay: '',
      changeNext: '',
      choices: {},
      placements: {},
    };
  });
  useEffect(() => {
    try {
      localStorage.setItem(draftKey, JSON.stringify(draft));
    } catch {
      // the draft just won't survive a reload
    }
  }, [draft, draftKey]);
  const set = (patch: Partial<Draft>) => setDraft((d) => ({ ...d, ...patch }));

  // ---- Look back ----
  const period: DateRange =
    kind === 'block' && plan
      ? blockRange(plan, blockIndex(plan, today))
      : kind === 'quarter' && plan
        ? quarterRange(plan, today)
        : kind === 'retro' && plan
          ? { start: plan.start_date, end: plan.end_date }
          : { start: monday, end: sunday };
  const lookEnd = period.end < today ? period.end : today;
  const weekSessions = data.sessions.filter(
    (s) => s.status !== 'moved' && (s.date ? s.date >= period.start && s.date <= period.end : s.week_start >= period.start && s.week_start <= period.end),
  );
  const credit = Math.round(weekSessions.reduce((sum, s) => sum + sessionCredit(s), 0) * 10) / 10;
  const studyMinutes = weekSessions
    .filter((s) => view.action(s.action_id)?.kind === 'study')
    .reduce((sum, s) => sum + (s.status !== 'planned' ? s.actual_minutes ?? 0 : 0), 0);
  const goals = plan ? view.goalsForPlan(plan.id) : [];
  const paces = goals.map((g) => view.goalPace(g, plan, { start: period.start, end: lookEnd }));

  // ---- Measure ----
  const due = view.measurementsDue(sunday);

  // ---- Adjust ----
  const suggestions = useMemo(
    () => reviewSuggestions(data.actions, data.schedules, data.sessions, monday),
    [data.actions, data.schedules, data.sessions, monday],
  );

  // Schedules and actions as they'll be next week, with the chosen changes applied.
  const { schedulesAfter, scheduleChanges, actionChanges } = useMemo(() => {
    const scheduleChanges: ReviewPayload['schedule_changes'] = [];
    const actionChanges: ReviewPayload['action_changes'] = [];
    let schedulesAfter: ActionSchedule[] = data.schedules;
    for (const s of suggestions) {
      const choice = draft.choices[s.actionId];
      const action = view.action(s.actionId);
      if (!choice || choice.kind === 'keep' || !action) continue;
      if (choice.kind === 'lower') {
        const current = scheduleForWeek(data.schedules, s.actionId, nextMonday);
        if (!current || current.effective_from >= nextMonday) continue;
        const perWeek = choice.perWeek ?? s.proposedPerWeek ?? 1;
        const fresh: ActionSchedule = {
          id: crypto.randomUUID(),
          action_id: s.actionId,
          rule: 'per_week',
          days: [],
          per_week: perWeek,
          effective_from: nextMonday,
          effective_to: null,
        };
        scheduleChanges.push({
          end_schedule_id: current.id,
          end_on: addDays(nextMonday, -1),
          new_schedule: fresh,
          summary: `${action.title}: ${current.rule === 'per_week' ? `${current.per_week}` : current.days.length} → ${perWeek} a week`,
          old_value: { rule: current.rule, days: current.days, per_week: current.per_week },
          new_value: { rule: 'per_week', per_week: perWeek },
        });
        schedulesAfter = [...schedulesAfter.map((x) => (x.id === current.id ? { ...x, effective_to: addDays(nextMonday, -1) } : x)), fresh];
      }
      if (choice.kind === 'minimum') {
        actionChanges.push({
          action_id: s.actionId,
          min_label: choice.minLabel?.trim() || '5 minutes',
          min_minutes: choice.minMinutes ?? 5,
          min_count: null,
          summary: `${action.title}: added minimum "${choice.minLabel?.trim() || '5 minutes'}"`,
          old_value: { min_label: action.min_label },
          new_value: { min_label: choice.minLabel?.trim() || '5 minutes' },
        });
      }
    }
    return { schedulesAfter, scheduleChanges, actionChanges };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [suggestions, draft.choices, data.schedules, nextMonday]);

  // ---- Plan next week ----
  const existingNext = useMemo(() => data.sessions.filter((s) => s.week_start === nextMonday && s.status !== 'moved'), [data.sessions, nextMonday]);
  const generated = useMemo(
    () => missingSessionsForWeek(data.actions, schedulesAfter, existingNext, nextMonday, () => crypto.randomUUID()),
    [data.actions, schedulesAfter, existingNext, nextMonday],
  );
  const nextSessions = [...existingNext, ...generated].map((s) => {
    const key = slotKey(s);
    return key in draft.placements && s.status === 'planned' ? { ...s, date: draft.placements[key] ?? null } : s;
  });
  const days = weekDates(nextMonday);
  const available = data.profile.available_minutes;
  const plannedByDay = days.map((d) => nextSessions.filter((s) => s.date === d).reduce((sum, s) => sum + s.planned_minutes, 0));
  const plannedTotal = nextSessions.reduce((sum, s) => sum + s.planned_minutes, 0);
  const availableTotal = available.reduce((a, b) => a + b, 0);
  const tray = nextSessions.filter((s) => !s.date && s.status === 'planned');

  function finish() {
    const changedExisting = existingNext.filter((s) => s.status === 'planned' && slotKey(s) in draft.placements && draft.placements[slotKey(s)] !== s.date);
    const payload: ReviewPayload = {
      review: {
        id: crypto.randomUUID(),
        kind,
        period_start: period.start,
        period_end: period.end,
        status: 'done',
        went_well: draft.wentWell.trim(),
        got_in_way: draft.gotInWay.trim(),
        change_next: draft.changeNext.trim(),
        obstacles: draft.obstacles,
        actions_done: credit,
        actions_planned: weekSessions.length,
        completed_at: null,
      },
      measurements: due
        .filter((t) => draft.measurements[t.id] != null)
        .map((t) => ({ id: crypto.randomUUID(), type_id: t.id, value: draft.measurements[t.id]!, measured_on: sunday < today ? sunday : today, source: 'manual', note: '' })),
      schedule_changes: scheduleChanges,
      action_changes: actionChanges,
      week_plan: { id: crypto.randomUUID(), week_start: nextMonday, available_minutes: availableTotal, planned_minutes: plannedTotal, saved_at: new Date().toISOString() },
      sessions: [
        ...generated.map((s) => ({ ...s, date: slotKey(s) in draft.placements ? draft.placements[slotKey(s)] ?? null : s.date })),
        ...changedExisting.map((s) => ({ ...s, date: draft.placements[slotKey(s)] ?? null })),
      ],
    };
    commit(opsCompleteReview(payload));
    localStorage.removeItem(draftKey);
    toast(kind === 'weekly' ? `Review saved. ${shortDate(nextMonday)} week is planned.` : 'Review saved.');
    navigate('/review');
  }

  const step = draft.step;
  return (
    <div className="stack">
      <div className="row-between">
        <BackLink label="Review" fallback="/review" />
        <span className="xsmall muted">Draft saved</span>
      </div>
      <div className="steps" aria-label={`Step ${step + 1} of 5`}>
        {STEPS.map((s, i) => (
          <div key={s} className={i <= step ? 'on' : ''} />
        ))}
      </div>
      <div className="xsmall muted">
        {STEPS.map((s, i) => (
          <span key={s}>
            {i > 0 && ' · '}
            {i === step ? <b style={{ color: 'var(--ink)' }}>{s}</b> : s}
          </span>
        ))}
      </div>

      {step === 0 && (
        <>
          <h1>
            {kind === 'weekly' ? 'Week of' : kind === 'block' ? 'Block ending' : kind === 'quarter' ? '3 months to' : 'Plan ending'}{' '}
            {shortDate(kind === 'weekly' ? monday : period.end)}
          </h1>
          <div className="grid-3">
            <Tile label="Actions" value={`${fmt(credit)} of ${weekSessions.length}`} />
            <Tile label="Study logged" value={minutesText(studyMinutes)} />
            <Tile label="Measurements due" value={String(due.length)} />
          </div>
          <div className="card stack-sm">
            <span className="label">Goals this period</span>
            {paces.map((p) => (
              <div key={p.goal.id} className="list-row">
                <span className="dot" style={{ background: p.goal.color }} />
                <span className="grow small">
                  {p.goal.title}
                  <span className="xsmall muted" style={{ display: 'block' }}>
                    {p.summary}
                  </span>
                </span>
                <PacePill label={p.label} />
              </div>
            ))}
            {paces.length === 0 && <span className="small muted">No goals in the current plan.</span>}
          </div>
        </>
      )}

      {step === 1 && (
        <>
          <h1>Record results</h1>
          {due.length === 0 && <p className="muted">Nothing is due this week. Skip ahead.</p>}
          <div className="card stack-sm">
            {due.map((t) => {
              const last = view.measurementsFor(t.id).at(-1);
              return (
                <NumberInput
                  key={t.id}
                  label={`${t.name} (${t.unit})${last ? ` · last ${fmt(last.value)} on ${shortDate(last.measured_on)}` : ''}`}
                  value={draft.measurements[t.id] ?? null}
                  onChange={(v) => set({ measurements: { ...draft.measurements, [t.id]: v } })}
                />
              );
            })}
          </div>
          <p className="xsmall muted">Only measurements that are due show up here. Log others any time from the goal page.</p>
        </>
      )}

      {step === 2 && (
        <>
          <h1>Reflect</h1>
          <div className="stack-sm">
            <span className="xsmall muted">What got in the way? (from your logs, change as needed)</span>
            <div className="chips">
              {OBSTACLES.map((o) => {
                const count = weekSessions.filter((s) => s.obstacles.includes(o)).length;
                return (
                  <button
                    key={o}
                    className="chip"
                    aria-pressed={draft.obstacles.includes(o)}
                    onClick={() => set({ obstacles: draft.obstacles.includes(o) ? draft.obstacles.filter((x) => x !== o) : [...draft.obstacles, o] })}
                  >
                    {o}
                    {count ? ` ×${count}` : ''}
                  </button>
                );
              })}
            </div>
          </div>
          <label className="field">
            What went well?
            <textarea value={draft.wentWell} onChange={(e) => set({ wentWell: e.target.value })} />
          </label>
          <label className="field">
            What got in the way?
            <textarea value={draft.gotInWay} onChange={(e) => set({ gotInWay: e.target.value })} />
          </label>
          <label className="field">
            What should change next week?
            <textarea value={draft.changeNext} onChange={(e) => set({ changeNext: e.target.value })} />
          </label>
        </>
      )}

      {step === 3 && (
        <>
          <h1>What should change?</h1>
          {suggestions.length === 0 && <div className="card tight small">Everything is on track. Nothing to change.</div>}
          {suggestions.map((s) => {
            const action = view.action(s.actionId);
            const goal = view.goalsForAction(s.actionId)[0];
            const choice = draft.choices[s.actionId] ?? { kind: 'keep' };
            const pick = (c: Choice) => set({ choices: { ...draft.choices, [s.actionId]: c } });
            return (
              <div key={s.actionId} className="card stack-sm">
                <div className="row-start small strong">
                  <span className="dot" style={{ background: goal?.color }} />
                  {action?.title}
                </div>
                <p style={{ margin: 0, fontSize: 14 }}>
                  {s.reason}.{' '}
                  {s.kind === 'lower_frequency'
                    ? `Lower the target to ${s.proposedPerWeek} a week?`
                    : 'Add a minimum version for hard days?'}
                </p>
                <div className="btn-row">
                  <button className={`btn small ${choice.kind === 'keep' ? 'dark' : ''}`} onClick={() => pick({ kind: 'keep' })}>
                    Keep as is
                  </button>
                  {s.kind === 'lower_frequency' ? (
                    <button className={`btn small ${choice.kind === 'lower' ? 'dark' : ''}`} onClick={() => pick({ kind: 'lower', perWeek: s.proposedPerWeek })}>
                      Lower to {s.proposedPerWeek}
                    </button>
                  ) : (
                    <button className={`btn small ${choice.kind === 'minimum' ? 'dark' : ''}`} onClick={() => pick({ kind: 'minimum', minLabel: '5 minutes', minMinutes: 5 })}>
                      Add minimum
                    </button>
                  )}
                </div>
                {choice.kind === 'minimum' && (
                  <div className="grid-2">
                    <label className="field">
                      Minimum version
                      <input value={choice.minLabel ?? ''} onChange={(e) => pick({ ...choice, minLabel: e.target.value })} />
                    </label>
                    <NumberInput label="Minutes" value={choice.minMinutes ?? null} onChange={(v) => pick({ ...choice, minMinutes: v })} />
                  </div>
                )}
                <span className="xsmall muted">Applies from {shortDate(nextMonday)}. Past weeks keep their old target.</span>
              </div>
            );
          })}
        </>
      )}

      {step === 4 && (
        <>
          <h1>
            Plan {shortDate(nextMonday)} – {shortDate(addDays(nextMonday, 6))}
          </h1>
          <div className={`banner ${plannedTotal > availableTotal ? 'warn' : 'info'}`}>
            <span>
              <b>{minutesText(plannedTotal)}</b> planned · {minutesText(availableTotal)} available
              {plannedTotal > availableTotal ? `. ${minutesText(plannedTotal - availableTotal)} over: move, shorten, or keep it.` : ''}
            </span>
          </div>
          {tray.length > 0 && (
            <div className="card tight stack-sm">
              <span className="xsmall muted">Not placed yet: pick a day for each</span>
              {tray.map((s) => (
                <div key={slotKey(s)} className="row-between">
                  <span className="row-start small" style={{ flexWrap: 'nowrap' }}>
                    <span className="dot" style={{ background: view.colorFor(s) }} />
                    {s.title}
                  </span>
                  <select
                    className="input"
                    style={{ width: 130 }}
                    aria-label={`Day for ${s.title}`}
                    value=""
                    onChange={(e) => set({ placements: { ...draft.placements, [slotKey(s)]: e.target.value || null } })}
                  >
                    <option value="">Pick a day</option>
                    {days.map((d, i) => (
                      <option key={d} value={d}>
                        {WEEKDAY_NAMES[i]} {shortDate(d)}
                      </option>
                    ))}
                  </select>
                </div>
              ))}
            </div>
          )}
          <div className="stack-sm">
            {days.map((d, i) => {
              const list = nextSessions.filter((s) => s.date === d);
              const over = plannedByDay[i]! > (available[i] ?? 0);
              return (
                <div key={d} className="day-row">
                  <div className="small strong" style={{ lineHeight: 1.2 }}>
                    {weekdayName(d)}
                    <span className="xsmall muted" style={{ display: 'block', fontWeight: 400 }}>
                      {d.slice(8)}
                    </span>
                  </div>
                  <div className="chips" style={{ gap: 4 }}>
                    {list.map((s) => (
                      <button
                        key={s.id}
                        className="mini-chip"
                        style={{ background: `${view.colorFor(s)}22`, color: 'var(--ink)', border: 0, cursor: s.status === 'planned' && s.action_id ? 'pointer' : 'default' }}
                        title={s.status === 'planned' ? 'Tap to unplace' : undefined}
                        onClick={() => s.status === 'planned' && s.action_id && set({ placements: { ...draft.placements, [slotKey(s)]: null } })}
                      >
                        {s.title} {s.planned_minutes}
                      </button>
                    ))}
                    {list.length === 0 && <span className="xsmall muted">Rest</span>}
                  </div>
                  <div className="xsmall" style={{ textAlign: 'right', color: over ? 'var(--amber-ink)' : 'var(--muted)', fontWeight: over ? 600 : 400 }}>
                    {minutesText(plannedByDay[i]!)}
                  </div>
                </div>
              );
            })}
          </div>
          <p className="xsmall muted">Tap a session on a day to send it back to "not placed".</p>
        </>
      )}

      <div className="btn-row">
        {step > 0 ? (
          <button className="btn" onClick={() => set({ step: step - 1 })}>
            Back
          </button>
        ) : (
          <button className="btn" onClick={() => set({ step: 1 })}>
            Skip to measure
          </button>
        )}
        {step < 4 ? (
          <button className="btn primary" onClick={() => set({ step: step + 1 })}>
            Next: {STEPS[step + 1]?.toLowerCase()}
          </button>
        ) : (
          <button className="btn primary" onClick={finish}>
            Save review and plan
          </button>
        )}
      </div>
    </div>
  );
}

function Tile({ label, value }: { label: string; value: string }) {
  return (
    <div className="card tight">
      <div className="xsmall muted">{label}</div>
      <div className="num" style={{ fontSize: 18 }}>
        {value}
      </div>
    </div>
  );
}
