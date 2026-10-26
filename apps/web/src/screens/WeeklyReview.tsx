import { useEffect, useMemo, useState } from 'react';
import {
  addDays,
  chainAt,
  firstPlanWeek,
  missingSessionsForWeek,
  periodNode,
  periodTally,
  previousReview,
  reviewSuggestions,
  scheduleForWeek,
  sessionsPerWeek,
  shortDate,
  suggestPath,
  weekDates,
  weekStart,
  weekdayName,
  WEEKDAY_LONG,
  type ActionSchedule,
  type CommitmentAnswer,
  type DateRange,
  type Goal,
  type GoalDecision,
  type GoalResult,
  type ISODate,
  type Plan,
  type ReviewGoalResult,
  type ReviewKind,
  type Session,
  type Suggestion,
} from '@six/core';
import { useStore } from '../data/store.tsx';
import { fmt, minutesText, type View } from '../data/derive.ts';
import { useView } from '../data/useView.ts';
import type { AppData, Op, ReviewPayload } from '../data/model.ts';
import { opsArchiveAction, opsArchiveGoal, opsCompleteGoal, opsCompleteReview, opsCreatePlan, opsLinkGoalToPlan, opsReplacePath, opsUpdateGoal } from '../data/ops.ts';
import { catchUp, catchUpPlan, chainFor, isSet, opsSetLevel, type ChainLevel } from '../data/chain.ts';
import { withOps } from '../data/breakdown.ts';
import { selectedIdeas } from '../data/backlog.ts';
import { actionLookup, commitmentTrail, obstacleSentence, planTrend, readCheck, timeAverages, trendFor, weekdaySentence } from '../data/insights.ts';
import { navigate, useRoute } from '../router.ts';
import { BackLink, Empty, NumberInput, OBSTACLES, PacePill, WEEKDAY_NAMES, useToast } from '../components/ui.tsx';
import { TrendBars } from '../components/TrendBars.tsx';
import { weekToReview } from './ReviewHub.tsx';

/**
 * One review flow for every kind. Each kind has its own last step:
 * - weekly: look back, reflect, plan next week
 * - month ("block" in the database): look back, reflect, set next month's goals
 * - 3-month checkpoint: look back, reflect, keep / adjust / drop each goal and set the next 3 months
 * - plan retrospective: look back, reflect, start the next plan
 */

type ChoiceKind = 'keep' | 'lower' | 'raise' | 'move' | 'minimum' | 'pause' | 'catchup';
interface Choice {
  kind: ChoiceKind;
  perWeek?: number;
  minLabel?: string;
  minMinutes?: number | null;
}

interface Adjust {
  target?: number | null;
  date?: ISODate;
  doneMeans?: string;
}

interface Draft {
  v: 2;
  savedAt: string;
  step: number;
  measurements: Record<string, number | null>;
  obstacles: string[];
  wentWell: string;
  gotInWay: string;
  changeNext: string;
  carryForward: string;
  commitment: CommitmentAnswer | null;
  /** Goal id → how its period goal turned out. */
  results: Record<string, GoalResult>;
  choices: Record<string, Choice>;
  /** Day chosen for each next-week session, keyed by "actionId:slot". */
  placements: Record<string, ISODate | null>;
  /** Sessions taken out of next week, keyed by "actionId:slot". */
  removed: Record<string, boolean>;
  /** Next period's goals typed in the last step, keyed by "goalId:level". */
  nextGoals: Record<string, string>;
  nextValues: Record<string, number | null>;
  decisions: Record<string, GoalDecision>;
  adjust: Record<string, Adjust>;
  newPlan: { on: boolean; name: string; start: ISODate; end: ISODate; carry: Record<string, boolean> };
}

const STEPS: Record<ReviewKind, string[]> = {
  weekly: ['Look back', 'Reflect', 'Plan'],
  block: ['Look back', 'Reflect', 'Next month'],
  quarter: ['Look back', 'Reflect', 'Decide'],
  retro: ['Look back', 'Reflect', 'Next plan'],
};
const PERIOD_WORD: Record<ReviewKind, string> = { weekly: 'week', block: 'month', quarter: '3 months', retro: 'plan' };
const RESULT_LEVEL: Record<ReviewKind, ChainLevel | 'plan'> = { weekly: 'week', block: 'month', quarter: 'quarter', retro: 'plan' };
const DRAFT_DAYS = 21;
const slotKey = (s: Pick<Session, 'action_id' | 'slot'>) => `${s.action_id}:${s.slot}`;

export function WeeklyReview({ kind: kindParam }: { kind: string }) {
  const { data, today } = useStore();
  const view = useView();
  const route = useRoute();
  const kind = (['weekly', 'block', 'quarter', 'retro'].includes(kindParam) ? kindParam : 'weekly') as ReviewKind;
  const planParam = route.query.get('plan');
  const plan = (planParam ? view.plan(planParam) : undefined) ?? view.mainPlan;

  let period: DateRange & { title: string };
  if (kind === 'weekly') {
    const monday = route.query.get('week') ?? weekToReview(data, today).monday;
    period = { start: monday, end: addDays(monday, 6), title: `Week of ${shortDate(monday)}` };
  } else if (!plan) {
    return <Empty title="This review needs a plan." />;
  } else if (kind === 'retro') {
    period = { start: plan.start_date, end: plan.end_date, title: plan.name };
  } else {
    const fallback = chainAt(plan, today)[kind === 'block' ? 'month' : 'quarter'].start;
    const node = periodNode(plan, kind, route.query.get('start') ?? fallback);
    if (!node) return <Empty title="Couldn't find that period." />;
    period = { start: node.start, end: node.end, title: node.title };
  }
  return <ReviewRun key={`${kind}:${period.start}`} kind={kind} plan={plan} period={period} />;
}

function freshDraft(data: AppData, kind: ReviewKind, period: DateRange, plan: Plan | null, today: ISODate): Draft {
  const obstacles = data.sessions
    .filter((s) => (s.date ? s.date >= period.start && s.date <= period.end : s.week_start >= period.start && s.week_start <= period.end))
    .flatMap((s) => s.obstacles);
  const start = plan ? (addDays(plan.end_date, 1) > today ? addDays(plan.end_date, 1) : today) : today;
  return {
    v: 2,
    savedAt: new Date().toISOString(),
    step: 0,
    measurements: {},
    obstacles: kind === 'weekly' ? [...new Set(obstacles)] : [],
    wentWell: '',
    gotInWay: '',
    changeNext: '',
    carryForward: '',
    commitment: null,
    results: {},
    choices: {},
    placements: {},
    removed: {},
    nextGoals: {},
    nextValues: {},
    decisions: {},
    adjust: {},
    newPlan: { on: true, name: 'My next six months', start, end: addDays(start, 182), carry: {} },
  };
}

function ReviewRun({ kind, plan, period }: { kind: ReviewKind; plan: Plan | null; period: DateRange & { title: string } }) {
  const { data, today, commit } = useStore();
  const view = useView();
  const toast = useToast();
  const steps = STEPS[kind];
  const word = PERIOD_WORD[kind];
  // Month, 3-month and plan reviews belong to one window, so two windows never share a draft.
  const draftKey = `six.review.draft.${kind}.${kind === 'weekly' ? 'all' : plan?.id ?? 'none'}.${period.start}`;
  const nextMonday = kind === 'weekly' ? addDays(period.start, 7) : addDays(weekStart(today), 7);

  // ---- Draft (kept on this device only) ----
  const [draft, setDraft] = useState<Draft>(() => {
    const base = freshDraft(data, kind, period, plan, today);
    try {
      const saved = JSON.parse(localStorage.getItem(draftKey) ?? 'null') as Partial<Draft> | null;
      const age = saved?.savedAt ? (Date.now() - Date.parse(saved.savedAt)) / 864e5 : Infinity;
      if (saved && saved.v === 2 && age < DRAFT_DAYS) return { ...base, ...saved, newPlan: { ...base.newPlan, ...saved.newPlan } };
    } catch {
      // ignore broken drafts
    }
    return base;
  });
  const [stored, setStored] = useState(true);
  useEffect(() => {
    try {
      localStorage.setItem(draftKey, JSON.stringify({ ...draft, savedAt: new Date().toISOString() }));
      setStored(true);
    } catch {
      setStored(false);
    }
  }, [draft, draftKey]);
  const set = (patch: Partial<Draft>) => setDraft((d) => ({ ...d, ...patch }));

  // ---- What happened ----
  const actionById = actionLookup(data);
  const tally = periodTally(data.sessions, period, today, actionById);
  // The weekly review covers every goal you're working on, each in its own batch or own clock.
  // Month, 3-month and plan reviews cover the goals of the one plan they belong to.
  const isWeekly = kind === 'weekly';
  // Connected goals sit next to each other, so the gym is reviewed beside the weight trend.
  // The retrospective looks at every goal of the plan, the ones you finished included; the month and
  // 3-month reviews only ask about goals still running.
  const planGoals = plan ? (kind === 'retro' ? view.goalsForPlan(plan.id, true).filter((g) => !g.archived_at) : view.goalsForPlan(plan.id)) : [];
  const goals = view.groupConnected(isWeekly ? view.activeGoals : planGoals);
  const planOf = (g: Goal): Plan | null => (isWeekly ? view.planForGoal(g) : plan);
  const goalPlans = goals.map(planOf).filter((p): p is Plan => !!p);
  const trendPlan: Plan | null = isWeekly ? ([...goalPlans].sort((a, b) => (a.start_date < b.start_date ? -1 : 1))[0] ?? null) : plan;
  const lookEnd = period.end < today ? period.end : today;
  const paces = goals.map((g) => view.goalPace(g, planOf(g), { start: period.start, end: lookEnd }));
  const prev = previousReview(data.reviews, kind, period.start, isWeekly ? null : plan?.id);
  const due = kind === 'weekly' || kind === 'block' ? view.measurementsDue(period.end) : [];
  const lastMonday = weekStart(period.end < today ? period.end : today);
  const trendWeeks = kind === 'weekly' || kind === 'block' ? 8 : Math.min(26, Math.max(1, Math.ceil((Date.parse(lookEnd) - Date.parse(period.start)) / (7 * 864e5))));
  const trend = trendPlan && (kind === 'weekly' || kind === 'block') ? planTrend(data, trendPlan, lastMonday, today) : trendFor(data, lastMonday, trendWeeks, today, trendPlan ? firstPlanWeek(trendPlan) : undefined);
  const resultLines = goalResultLines(data, goals, planOf, kind, period);

  // ---- Suggestions (weekly only) ----
  const existingNext = useMemo(() => data.sessions.filter((s) => s.week_start === nextMonday && s.status !== 'moved'), [data.sessions, nextMonday]);
  const recent = timeAverages(trendFor(data, weekStart(period.start), 3, today, trendPlan ? firstPlanWeek(trendPlan) : undefined));
  const available = data.profile.available_minutes;
  const availableTotal = available.reduce((a, b) => a + b, 0);
  const realistic = recent && recent.done > 0 ? Math.round(recent.done / 5) * 5 : null;
  const suggestions = useMemo(() => {
    if (kind !== 'weekly') return [];
    const all = reviewSuggestions(data.actions, data.schedules, data.sessions, period.start, { availableMinutes: available, today });
    // Never suggest doing more when next week is already more than you have (or than you've been doing).
    const base = [...existingNext, ...missingSessionsForWeek(data.actions, data.schedules, existingNext, nextMonday, () => 'base')];
    const baseMinutes = base.filter((x) => x.status === 'planned').reduce((sum, x) => sum + x.planned_minutes, 0);
    const budget = Math.min(availableTotal, realistic != null ? realistic * 1.25 : Infinity);
    return baseMinutes > budget ? all.filter((x) => x.kind !== 'raise_frequency') : all;
  }, [kind, data.actions, data.schedules, data.sessions, period.start, available, today, existingNext, nextMonday, availableTotal, realistic]);
  // Extra tasks that would catch a goal up this month (only for goals that are behind).
  const catchUpFor = (goalId: string | undefined): number | null => {
    const g = goals.find((x) => x.id === goalId);
    const gp = g ? planOf(g) : null;
    return gp && g && kind === 'weekly' ? catchUpPlan(view, data, g, gp, today)?.extra ?? null : null;
  };
  const goalOf = (actionId: string) => view.goalsForAction(actionId)[0];
  // A behind goal whose task also has a "lower" or "minimum" suggestion gets one choice in Reflect.
  const decideLater = new Set(suggestions.filter((x) => (x.kind === 'lower_frequency' || x.kind === 'add_minimum') && catchUpFor(goalOf(x.actionId)?.id) != null).map((x) => goalOf(x.actionId)?.id));
  const { schedulesAfter, scheduleChanges, actionChanges } = useMemo(
    () => applyChoices(view, data, suggestions, draft.choices, nextMonday),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [suggestions, draft.choices, data.schedules, nextMonday],
  );

  // ---- Plan next week (weekly) ----
  // Catch-up picks add that many extra sessions of the task to next week (placed on the lightest days).
  const extras = useMemo(() => {
    if (kind !== 'weekly') return [] as Session[];
    const out: Session[] = [];
    for (const sug of suggestions) {
      const c = draft.choices[sug.actionId];
      const a = view.action(sug.actionId);
      if (c?.kind !== 'catchup' || !a) continue;
      for (let i = 0; i < (c.perWeek ?? 1); i++) {
        out.push({ id: crypto.randomUUID(), action_id: a.id, week_start: nextMonday, slot: 500 + i, date: null, title: a.title, priority: false, planned_minutes: a.planned_minutes, planned_count: a.planned_count, status: 'planned', actual_minutes: null, actual_count: null, note: '', obstacles: [], origin: 'oneoff', source: 'catch-up', moved_from: null, logged_at: null });
      }
    }
    return out;
  }, [kind, suggestions, draft.choices, nextMonday]); // eslint-disable-line react-hooks/exhaustive-deps
  // Next week may already have sessions (the calendar or a look ahead made them). The ones a task's
  // old schedule made are stale once its schedule changes here: they're deleted and remade.
  const rescheduled = useMemo(() => new Set(scheduleChanges.filter((c) => c.new_schedule).map((c) => c.action_id)), [scheduleChanges]);
  const stale = useMemo(
    () => existingNext.filter((s) => s.status === 'planned' && s.origin === 'scheduled' && !!s.action_id && rescheduled.has(s.action_id)),
    [existingNext, rescheduled],
  );
  const existingKept = useMemo(() => existingNext.filter((s) => !stale.includes(s)), [existingNext, stale]);
  const generated = useMemo(
    () => (kind === 'weekly' ? [...missingSessionsForWeek(data.actions, schedulesAfter, existingKept, nextMonday, () => crypto.randomUUID()), ...extras] : []),
    [kind, data.actions, schedulesAfter, existingKept, nextMonday, extras],
  );
  // Sessions of a paused task don't belong in next week.
  const paused = new Set(scheduleChanges.filter((c) => !c.new_schedule).map((c) => c.action_id));
  const days = weekDates(nextMonday);
  const suggested = useMemo(() => lightestDays([...existingKept, ...generated], days, available), [existingKept, generated, nextMonday]); // eslint-disable-line react-hooks/exhaustive-deps
  const placements: Record<string, ISODate | null> = { ...suggested, ...draft.placements };
  const isOut = (s: Session) => s.status === 'planned' && !!s.action_id && (!!draft.removed[slotKey(s)] || paused.has(s.action_id));
  const nextSessions = [...existingKept, ...generated].map((s) => {
    const key = slotKey(s);
    return key in placements && s.status === 'planned' ? { ...s, date: placements[key] ?? null } : s;
  });
  const keptNext = nextSessions.filter((s) => !isOut(s));
  const plannedByDay = days.map((d) => keptNext.filter((s) => s.date === d).reduce((sum, s) => sum + s.planned_minutes, 0));
  const plannedTotal = keptNext.reduce((sum, s) => sum + s.planned_minutes, 0);
  const tray = keptNext.filter((s) => !s.date && s.status === 'planned');
  const outList = nextSessions.filter(isOut);
  const [editing, setEditing] = useState<string | null>(null);

  /**
   * Take tasks out of next week until it fits your real week (what you've actually done lately,
   * or the time you have, whichever is less). Non-priority tasks go first, from the task with
   * the most sessions, latest day first; every task keeps at least one session.
   */
  function fitWeek(target: number) {
    const removed = { ...draft.removed };
    let total = plannedTotal;
    const pool = keptNext.filter((s) => s.status === 'planned' && s.action_id);
    const left = new Map<string, number>();
    for (const s of pool) left.set(s.action_id!, (left.get(s.action_id!) ?? 0) + 1);
    let taken = 0;
    let minutes = 0;
    while (total > target) {
      const options = pool.filter((s) => !removed[slotKey(s)] && (left.get(s.action_id!) ?? 0) > 1);
      if (!options.length) break;
      options.sort(
        (a, b) =>
          Number(!!view.action(a.action_id!)?.priority) - Number(!!view.action(b.action_id!)?.priority) ||
          (left.get(b.action_id!) ?? 0) - (left.get(a.action_id!) ?? 0) ||
          (b.date ?? '9') .localeCompare(a.date ?? '9') ||
          b.planned_minutes - a.planned_minutes,
      );
      const pick = options[0]!;
      removed[slotKey(pick)] = true;
      left.set(pick.action_id!, (left.get(pick.action_id!) ?? 1) - 1);
      total -= pick.planned_minutes;
      taken += 1;
      minutes += pick.planned_minutes;
    }
    set({ removed });
    if (taken) toast(`Took out ${taken} task${taken === 1 ? '' : 's'} (${minutesText(minutes)}). Put any back below.`);
  }

  // ---- Next goals ----
  const nextFields = nextGoalFields(data, goals, planOf, kind, period, nextMonday);

  function finish() {
    const now = new Date().toISOString();
    const results: ReviewGoalResult[] = resultLines
      .filter((l) => draft.results[l.goal.id])
      .map((l) => ({ goal_id: l.goal.id, level: RESULT_LEVEL[kind], step_id: l.stepId, note: l.note, result: draft.results[l.goal.id]! }));
    const changedExisting = existingKept.filter(
      (s) => s.status === 'planned' && (isOut(s) || (slotKey(s) in placements && placements[slotKey(s)] !== s.date)),
    );
    const out = (s: Session): Session => (isOut(s) ? { ...s, status: 'moved', note: paused.has(s.action_id ?? '') ? 'Paused in the weekly review' : 'Taken out in the weekly review' } : s);
    const payload: ReviewPayload = {
      review: {
        id: crypto.randomUUID(),
        kind,
        plan_id: isWeekly ? null : plan?.id ?? null,
        period_start: period.start,
        period_end: period.end,
        status: 'done',
        went_well: draft.wentWell.trim(),
        got_in_way: draft.gotInWay.trim(),
        change_next: kind === 'retro' ? '' : draft.changeNext.trim(),
        obstacles: draft.obstacles,
        actions_done: tally.credit,
        actions_planned: tally.planned,
        completed_at: null,
        commitment_kept: prev?.change_next ? draft.commitment : null,
        goal_results: results,
        goal_decisions: kind === 'quarter' ? Object.entries(draft.decisions).map(([goal_id, decision]) => ({ goal_id, decision })) : [],
        carry_forward: kind === 'retro' ? draft.carryForward.trim() : '',
        minutes_planned: tally.minutesPlanned,
        minutes_done: tally.minutesDone,
      },
      measurements: due
        .filter((t) => draft.measurements[t.id] != null)
        .map((t) => ({ id: crypto.randomUUID(), type_id: t.id, value: draft.measurements[t.id]!, measured_on: period.end < today ? period.end : today, source: 'manual', note: '' })),
      schedule_changes: scheduleChanges,
      action_changes: actionChanges,
      week_plan:
        kind === 'weekly'
          ? { id: crypto.randomUUID(), week_start: nextMonday, available_minutes: availableTotal, planned_minutes: plannedTotal, saved_at: now }
          : null,
      sessions:
        kind === 'weekly'
          ? [
              ...generated.map((s) => out({ ...s, date: slotKey(s) in placements ? placements[slotKey(s)] ?? null : s.date })),
              ...changedExisting.map((s) => out({ ...s, date: placements[slotKey(s)] ?? s.date })),
            ]
          : [],
    };
    // Everything the review decided goes out as one change set, applied one after another on fresh
    // data, so a refused save never leaves half a review behind.
    const staleOps: Op[] = stale.map((s) => ({ kind: 'delete', collection: 'sessions', id: s.id }));
    let next = withOps(data, [...staleOps, ...opsCompleteReview(payload)]);
    const ops: Op[] = [...staleOps, ...opsCompleteReview(payload)];
    const add = (more: Op[]) => {
      ops.push(...more);
      next = withOps(next, more);
    };
    // A period goal that was hit is marked complete (and unmarked if it wasn't).
    for (const r of results) {
      const step = r.step_id ? next.planSteps.find((s) => s.id === r.step_id) : null;
      if (!step) continue;
      const done = r.result === 'hit';
      if (!!step.completed_at !== done) add([{ kind: 'update', collection: 'planSteps', id: step.id, patch: { completed_at: done ? now : null } }]);
    }
    {
      // Keep / adjust / drop first, so next goals are suggested from the redrawn path.
      if (kind === 'quarter' && plan) {
        for (const g of goals) {
          const decision = draft.decisions[g.id] ?? 'keep';
          if (decision === 'drop') add(opsDropGoal(next, view, g, nextMonday));
          if (decision === 'adjust') add(opsAdjustGoal(next, view, g, plan, draft.adjust[g.id] ?? {}, today));
        }
      }
      for (const f of nextFields) {
        if (kind === 'quarter' && draft.decisions[f.goal.id] === 'drop') continue;
        const text = (draft.nextGoals[f.key] ?? (f.current || f.previous)).trim();
        const value = draft.nextValues[f.key] !== undefined ? draft.nextValues[f.key] : f.currentValue ?? f.suggested;
        const patch: { target_note?: string; target_value?: number | null } = {};
        if (text && text !== f.current) patch.target_note = text;
        if (f.goal.type === 'number' && value != null && value !== f.currentValue) patch.target_value = value;
        if (!Object.keys(patch).length) continue;
        const gp = planOf(f.goal);
        if (!gp) continue;
        add(opsSetLevel(next, f.goal, gp, chainFor(next, f.goal, gp, f.date), f.level, patch));
      }
    }
    // Retrospective: a goal you achieved (and aren't carrying over) moves to Completed.
    if (kind === 'retro') {
      for (const r of results) {
        const g = next.goals.find((x) => x.id === r.goal_id);
        if (r.result === 'hit' && g && !g.completed_at && !carryDefault(draft, g)) add(opsCompleteGoal(next, g, '', addDays(period.end, 1)));
      }
    }
    let newPlanId: string | null = null;
    if (kind === 'retro' && draft.newPlan.on && draft.newPlan.name.trim() && draft.newPlan.end > draft.newPlan.start) {
      const created = opsCreatePlan({ name: draft.newPlan.name, start: draft.newPlan.start, end: draft.newPlan.end });
      add(created.ops);
      newPlanId = created.plan.id;
      for (const g of goals) if (carryDefault(draft, g)) add(opsLinkGoalToPlan(next, g.id, created.plan.id));
    }
    commit(ops);

    try {
      localStorage.removeItem(draftKey);
    } catch {
      // nothing to clean up
    }
    toast(kind === 'weekly' ? `Review saved. The ${shortDate(nextMonday)} week is planned.` : kind === 'retro' && newPlanId ? 'Retrospective saved. Your next plan is ready for goals.' : 'Review saved.');
    navigate(newPlanId ? `/plans/${newPlanId}` : '/review');
  }

  const step = Math.min(draft.step, steps.length - 1);
  return (
    <div className="stack">
      <div className="row-between">
        <BackLink label="Review" fallback="/review" />
        <span className="xsmall muted">{stored ? 'Draft saved on this device' : "Draft can't be saved here"}</span>
      </div>
      <div className="steps" aria-label={`Step ${step + 1} of ${steps.length}`}>
        {steps.map((s, i) => (
          <div key={s} className={i <= step ? 'on' : ''} />
        ))}
      </div>
      <div className="xsmall muted">
        {steps.map((s, i) => (
          <span key={s}>
            {i > 0 && ' · '}
            {i === step ? <b style={{ color: 'var(--ink)' }}>{s}</b> : s}
          </span>
        ))}
      </div>

      {step === 0 && (
        <>
          <h1>{kind === 'weekly' ? period.title : kind === 'retro' ? `${period.title}: retrospective` : `${period.title} review`}</h1>
          <span className="small muted" style={{ marginTop: -8 }}>
            {shortDate(period.start)} – {shortDate(period.end)}
          </span>

          {prev?.change_next && (
            <div className="card stack-sm">
              <span className="label">Last {word} you said</span>
              <p style={{ margin: 0, fontSize: 16, lineHeight: 1.4 }}>“{prev.change_next}”</p>
              <span className="xsmall muted">
                Did it happen?
                {readCheck(prev.id) ? ` Midweek you said you were ${readCheck(prev.id) === 'on' ? 'on it' : 'slipping'}.` : ''}
              </span>
              <div className="chips" role="group" aria-label="Did it happen?">
                {(['yes', 'partly', 'no'] as const).map((a) => (
                  <button key={a} className="chip" aria-pressed={draft.commitment === a} onClick={() => set({ commitment: draft.commitment === a ? null : a })}>
                    {a === 'yes' ? 'Yes' : a === 'partly' ? 'Partly' : 'No'}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="grid-3">
            <Tile label="Tasks done" value={`${fmt(tally.credit, 0)} of ${tally.planned}`} />
            <Tile label="Time" value={`${minutesText(tally.minutesDone)}`} sub={tally.minutesPlanned ? `of ${minutesText(tally.minutesPlanned)} planned` : undefined} />
            <Tile label="Goals on pace" value={`${paces.filter((p) => p.label === 'ahead' || p.label === 'on_track').length} of ${paces.filter((p) => p.label !== 'none').length}`} />
          </div>
          {tally.upcoming > 0 && (
            <span className="xsmall muted" style={{ marginTop: -6 }}>
              {tally.upcoming} task{tally.upcoming === 1 ? '' : 's'} still to come (through {weekdayName(period.end)} {shortDate(period.end)}) {tally.upcoming === 1 ? "isn't" : "aren't"} counted as missed.
            </span>
          )}

          <div className="card stack-sm">
            <span className="label">{kind === 'retro' ? 'Your six-month goals' : `Your ${word} goals`}</span>
            {resultLines.length === 0 && <span className="small muted">{isWeekly ? 'No goals committed yet.' : 'No goals in this plan.'}</span>}
            {resultLines.map((l) => {
              const pace = paces.find((p) => p.goal.id === l.goal.id);
              const gp = planOf(l.goal);
              const fix = gp && (kind === 'weekly' || kind === 'block') && pace?.label === 'behind' ? catchUp(view, data, l.goal, gp, today) : null;
              const pick = (r: GoalResult) => {
                const results = { ...draft.results };
                if (results[l.goal.id] === r) delete results[l.goal.id];
                else results[l.goal.id] = r;
                set({ results });
              };
              const paceInk = pace?.label === 'behind' ? 'var(--amber-ink)' : pace?.label === 'ahead' ? 'var(--blue-ink)' : pace?.label === 'on_track' ? 'var(--accent-ink)' : 'var(--muted)';
              const paceWord = pace?.label === 'behind' ? 'Behind' : pace?.label === 'ahead' ? 'Ahead' : pace?.label === 'on_track' ? 'On track' : '';
              return (
                <div key={l.goal.id} className="review-goal">
                  <div className="review-goal-text">
                    <span className="row-start small strong" style={{ flexWrap: 'nowrap', minWidth: 0, gap: 8 }}>
                      <span className="dot" style={{ background: l.goal.color, flex: 'none' }} />
                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{l.goal.title}</span>
                    </span>
                    {(() => {
                      const linked = view.connectionsFor(l.goal.id).filter((c) => goals.some((g) => g.id === c.goal.id));
                      return linked.length > 0 ? (
                        <span className="xsmall muted">
                          Connected with {linked.map((c) => c.goal.title).join(', ')}
                          {linked.some((c) => c.shared.length) ? ` · shares ${[...new Set(linked.flatMap((c) => c.shared.map((a) => a.title)))].join(', ')}` : ''}
                        </span>
                      ) : null;
                    })()}
                    <span className="xsmall" style={{ color: 'var(--ink-2)', lineHeight: 1.4 }}>
                      {l.note ? l.note : `No ${word} goal was written down.`}
                    </span>
                    {pace && pace.label !== 'none' && (
                      <span className="xsmall muted">
                        <b style={{ color: paceInk, fontWeight: 600 }}>{paceWord}</b> · {pace.summary}
                      </span>
                    )}
                    {pace?.label === 'behind' && decideLater.has(l.goal.id) ? (
                      <span className="xsmall" style={{ color: 'var(--amber-ink)' }}>Catch up or lower the bar: you'll choose in the next step.</span>
                    ) : (
                      fix && <span className="xsmall" style={{ color: 'var(--amber-ink)' }}>{fix}</span>
                    )}
                  </div>
                  {l.note && (
                    <div className="seg review-rate" role="group" aria-label={`How did ${l.goal.title} go?`}>
                      {(['hit', 'partly', 'missed'] as const).map((r) => (
                        <button key={r} type="button" aria-pressed={draft.results[l.goal.id] === r} onClick={() => pick(r)}>
                          {resultWord(kind, r)}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          <div className="card stack-sm">
            <span className="label">{kind === 'weekly' || kind === 'block' ? 'Recent weeks' : `Every week of the ${word}`}</span>
            <TrendBars weeks={trend} highlight={kind === 'weekly' ? period.start : undefined} />
          </div>

          {due.length > 0 && (
            <div className="card stack-sm">
              <span className="label">Record results</span>
              {due.map((t) => {
                const last = view.measurementsFor(t.id).at(-1);
                return (
                  <NumberInput
                    key={t.id}
                    label={`${t.name}${t.unit ? ` (${t.unit})` : ''}${last ? ` · last ${fmt(last.value)} on ${shortDate(last.measured_on)}` : ''}`}
                    value={draft.measurements[t.id] ?? null}
                    placeholder={last ? `e.g. ${fmt(last.value)}` : undefined}
                    onChange={(v) => set({ measurements: { ...draft.measurements, [t.id]: v } })}
                  />
                );
              })}
            </div>
          )}
        </>
      )}

      {step === 1 && (
        <Reflect kind={kind} period={period} draft={draft} set={set} suggestions={suggestions} nextMonday={nextMonday} catchUpFor={catchUpFor} />
      )}

      {step === 2 && kind === 'weekly' && (
        <>
          <h1>
            Plan {shortDate(nextMonday)} – {shortDate(addDays(nextMonday, 6))}
          </h1>
          {nextFields.length > 0 && <NextGoalsCard fields={nextFields} draft={draft} set={set} title="Next week's goals" />}
          <TimeCheck planned={plannedTotal} available={availableTotal} recent={recent} onFit={fitWeek} />
          {Object.keys(suggested).length > 0 && <span className="xsmall muted">"Any day" tasks are placed on your lightest days. Tap a task to move it or take it out.</span>}
          {tray.length > 0 && (
            <div className="card tight stack-sm">
              <span className="xsmall muted">Not on a day yet</span>
              {tray.map((s) => (
                <div key={slotKey(s)} className="row-between">
                  <span className="row-start small" style={{ flexWrap: 'nowrap' }}>
                    <span className="dot" style={{ background: view.colorFor(s) }} />
                    {s.title} · {minutesText(s.planned_minutes)}
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
              const list = keptNext.filter((s) => s.date === d);
              const over = plannedByDay[i]! > (available[i] ?? 0);
              const open = list.find((s) => slotKey(s) === editing);
              return (
                <div key={d} className="stack-sm" style={{ gap: 4 }}>
                  <div className="day-row">
                    <div className="small strong" style={{ lineHeight: 1.2 }}>
                      {weekdayName(d)}
                      <span className="xsmall muted" style={{ display: 'block', fontWeight: 400 }}>
                        {d.slice(8)}
                      </span>
                    </div>
                    <div className="chips" style={{ gap: 4 }}>
                      {list.map((s) => {
                        const movable = s.status === 'planned' && !!s.action_id;
                        const key = slotKey(s);
                        return (
                          <button
                            key={s.id}
                            type="button"
                            className="mini-chip"
                            aria-expanded={movable ? editing === key : undefined}
                            style={{
                              background: `color-mix(in srgb, ${view.colorFor(s)} 16%, transparent)`,
                              color: 'var(--ink)',
                              border: editing === key ? '1px solid var(--ink)' : 0,
                              cursor: movable ? 'pointer' : 'default',
                            }}
                            aria-label={movable ? `${s.title}, ${minutesText(s.planned_minutes)}, ${weekdayName(d)}. Move or take out` : `${s.title}, ${minutesText(s.planned_minutes)}`}
                            onClick={() => movable && setEditing(editing === key ? null : key)}
                          >
                            {s.title} · {minutesText(s.planned_minutes)}
                          </button>
                        );
                      })}
                      {list.length === 0 && <span className="xsmall muted">Rest</span>}
                    </div>
                    <div className="xsmall" style={{ textAlign: 'right', color: over ? 'var(--amber-ink)' : 'var(--muted)', fontWeight: over ? 600 : 400 }}>
                      {minutesText(plannedByDay[i]!)}
                    </div>
                  </div>
                  {open && (
                    <div className="card tight stack-sm" style={{ gap: 8 }}>
                      <span className="xsmall muted">Move {open.title} to</span>
                      <div className="chips" style={{ gap: 6 }}>
                        {days.map((other, j) => (
                          <button
                            key={other}
                            type="button"
                            className="chip"
                            style={{ minHeight: 34, padding: '0 12px', fontSize: 13 }}
                            aria-pressed={other === d}
                            onClick={() => {
                              set({ placements: { ...draft.placements, [editing!]: other } });
                              setEditing(null);
                            }}
                          >
                            {WEEKDAY_NAMES[j]}
                          </button>
                        ))}
                      </div>
                      <div className="btn-row">
                        <button
                          type="button"
                          className="btn small danger"
                          onClick={() => {
                            set({ removed: { ...draft.removed, [editing!]: true } });
                            setEditing(null);
                          }}
                        >
                          Take out of next week
                        </button>
                        <button type="button" className="btn small" onClick={() => setEditing(null)}>
                          Done
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          {outList.length > 0 && (
            <div className="card tight stack-sm">
              <span className="xsmall muted">Not happening next week</span>
              {outList.map((s) => (
                <div key={slotKey(s)} className="row-between small">
                  <span className="row-start" style={{ flexWrap: 'nowrap' }}>
                    <span className="dot" style={{ background: view.colorFor(s) }} />
                    {s.title} · {minutesText(s.planned_minutes)}
                    {paused.has(s.action_id ?? '') ? ' (paused)' : ''}
                  </span>
                  {!paused.has(s.action_id ?? '') && (
                    <button type="button" className="link-btn small" onClick={() => set({ removed: { ...draft.removed, [slotKey(s)]: false } })}>
                      Put back
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {step === 2 && kind === 'block' && (
        <>
          <h1>Next month</h1>
          {nextFields.length > 0 ? (
            <>
              <span className="small muted" style={{ marginTop: -8 }}>
                {nextFields[0]!.periodTitle} · what should be true by {shortDate(nextFields[0]!.end)}?
              </span>
              <NextGoalsCard fields={nextFields} draft={draft} set={set} title="Next month's goals" />
            </>
          ) : (
            <div className="card small">This was the plan's last month. The plan retrospective comes next.</div>
          )}
        </>
      )}

      {step === 2 && kind === 'quarter' && plan && (
        <>
          <Decide goals={goals} fields={nextFields} draft={draft} set={set} view={view} plan={plan} nextMonday={nextMonday} />
          <SelectedIdeas when="Dropping or finishing a goal makes room for one of these." />
        </>
      )}

      {step === 2 && kind === 'retro' && plan && (
        <>
          <NextPlan goals={goals} draft={draft} set={set} />
          <SelectedIdeas when="Good candidates for your next plan, alongside the goals you carry over." />
        </>
      )}

      <div className="btn-row">
        {step > 0 ? (
          <button className="btn" onClick={() => set({ step: step - 1 })}>
            Back
          </button>
        ) : (
          <a className="btn" href="#/review">
            Cancel
          </a>
        )}
        {step < steps.length - 1 ? (
          <button className="btn primary" onClick={() => set({ step: step + 1 })}>
            Next: {steps[step + 1]?.toLowerCase()}
          </button>
        ) : (
          <button className="btn primary" onClick={finish}>
            {kind === 'weekly' ? 'Save review and plan' : kind === 'retro' ? (draft.newPlan.on ? 'Save and start next plan' : 'Save retrospective') : 'Save review'}
          </button>
        )}
      </div>
    </div>
  );
}

// ---------- Reflect ----------

function Reflect({
  kind,
  period,
  draft,
  set,
  suggestions,
  nextMonday,
  catchUpFor,
}: {
  kind: ReviewKind;
  period: DateRange;
  draft: Draft;
  set: (patch: Partial<Draft>) => void;
  suggestions: Suggestion[];
  nextMonday: ISODate;
  catchUpFor: (goalId: string | undefined) => number | null;
}) {
  const { data, today } = useStore();
  const view = useView();
  const word = PERIOD_WORD[kind];
  const periodSessions = data.sessions.filter((s) => (s.date ? s.date >= period.start && s.date <= period.end : s.week_start >= period.start && s.week_start <= period.end));
  const stuck = commitmentTrail(data.reviews.filter((r) => r.period_start < period.start), 12)
    .filter((t) => t.kept === 'yes')
    .slice(0, 3);
  const before = data.reviews
    .filter((r) => r.status === 'done' && r.got_in_way.trim() && r.period_start < period.start)
    .sort((a, b) => (a.period_start < b.period_start ? 1 : -1))
    .slice(0, 3);
  const first = view.livePlans.filter((p) => p.start_date <= today)[0];
  const earliest = first ? firstPlanWeek(first) : addDays(period.start, -21);
  const window: DateRange = kind === 'weekly' ? { start: addDays(period.start, -21) < earliest ? earliest : addDays(period.start, -21), end: period.end } : period;
  const patterns = [obstacleSentence(data, window), weekdaySentence(data, window, today)].filter(Boolean) as string[];

  return (
    <>
      <h1>Reflect</h1>
      {patterns.length > 0 && (
        <div className="card tight stack-sm">
          <span className="label">Patterns</span>
          {patterns.map((p) => (
            <span key={p} className="small" style={{ color: 'var(--ink-2)' }}>
              {p}
            </span>
          ))}
        </div>
      )}
      <div className="stack-sm">
        <span className="xsmall muted">What got in the way? (from your logs, change as needed)</span>
        <div className="chips">
          {OBSTACLES.map((o) => {
            const count = periodSessions.filter((s) => s.obstacles.includes(o)).length;
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
      {(stuck.length > 0 || before.length > 0) && (
        <div className="card tight stack-sm">
          {stuck.length > 0 && (
            <>
              <span className="label">Changes that stuck</span>
              {stuck.map((t) => (
                <span key={t.review.id} className="small" style={{ color: 'var(--ink-2)' }}>
                  <span className="mono" style={{ fontSize: 10.5 }}>
                    {shortDate(addDays(t.review.period_start, 7)).toUpperCase()}
                  </span>{' '}
                  {t.text}
                </span>
              ))}
            </>
          )}
          {before.length > 0 && (
            <>
              <span className="label" style={{ marginTop: stuck.length ? 6 : 0 }}>
                What got in the way before, in your words
              </span>
              {before.map((r) => (
                <span key={r.id} className="small" style={{ color: 'var(--ink-2)' }}>
                  <span className="mono" style={{ fontSize: 10.5 }}>
                    {shortDate(r.period_start).toUpperCase()}
                  </span>{' '}
                  {r.got_in_way}
                </span>
              ))}
            </>
          )}
        </div>
      )}
      <label className="field">
        {kind === 'retro' ? 'What worked?' : 'What went well?'}
        <textarea value={draft.wentWell} onChange={(e) => set({ wentWell: e.target.value })} placeholder={kind === 'retro' ? 'e.g. Studying first thing every weekday' : 'e.g. Studied every weekday before work'} />
      </label>
      <label className="field">
        {kind === 'retro' ? "What didn't work?" : 'What got in the way?'}
        <textarea value={draft.gotInWay} onChange={(e) => set({ gotInWay: e.target.value })} placeholder={kind === 'retro' ? 'e.g. Planning guitar for late evenings' : 'e.g. Too tired after work for guitar'} />
      </label>
      {kind === 'retro' ? (
        <label className="field">
          What carries into the next plan?
          <textarea value={draft.carryForward} onChange={(e) => set({ carryForward: e.target.value })} placeholder="e.g. Morning study block, Sunday weigh-ins" />
        </label>
      ) : (
        <label className="field">
          What will you change {kind === 'weekly' ? 'next week' : kind === 'block' ? 'next month' : 'for the next 3 months'}?
          <textarea value={draft.changeNext} onChange={(e) => set({ changeNext: e.target.value })} placeholder="e.g. Guitar right after breakfast" />
          <span className="xsmall muted" style={{ fontWeight: 400 }}>
            Your next {word} review starts by asking whether this happened.
          </span>
        </label>
      )}
      {suggestions.length > 0 && (
        <span className="label" style={{ marginTop: 6 }}>
          Suggested changes
        </span>
      )}
      {suggestions.map((s) => (
        <SuggestionCard key={s.actionId} s={s} draft={draft} set={set} view={view} nextMonday={nextMonday} catchUp={catchUpFor(view.goalsForAction(s.actionId)[0]?.id)} />
      ))}
    </>
  );
}

function SuggestionCard({ s, draft, set, view, nextMonday, catchUp }: { s: Suggestion; draft: Draft; set: (p: Partial<Draft>) => void; view: View; nextMonday: ISODate; catchUp: number | null }) {
  const action = view.action(s.actionId);
  const goal = view.goalsForAction(s.actionId)[0];
  const choice = draft.choices[s.actionId] ?? { kind: 'keep' };
  const pick = (c: Choice) => set({ choices: { ...draft.choices, [s.actionId]: c } });
  const question =
    s.kind === 'lower_frequency'
      ? `Lower it to ${s.proposedPerWeek} a week?`
      : s.kind === 'raise_frequency'
        ? `Ready for ${s.proposedPerWeek} a week?`
        : s.kind === 'move_day'
          ? `Move ${WEEKDAY_LONG[s.fromDay! - 1]} to ${WEEKDAY_LONG[s.toDay! - 1]}?`
          : s.kind === 'pause'
            ? 'Pause it for now? You can turn it back on from the goal page.'
            : 'Add a minimum version for hard days?';
  const actionChoice: Choice =
    s.kind === 'lower_frequency'
      ? { kind: 'lower', perWeek: s.proposedPerWeek }
      : s.kind === 'raise_frequency'
        ? { kind: 'raise', perWeek: s.proposedPerWeek }
        : s.kind === 'move_day'
          ? { kind: 'move' }
          : s.kind === 'pause'
            ? { kind: 'pause' }
            : { kind: 'minimum', minLabel: '5 minutes', minMinutes: 5 };
  const actionLabel =
    s.kind === 'lower_frequency'
      ? `Lower to ${s.proposedPerWeek}`
      : s.kind === 'raise_frequency'
        ? `Raise to ${s.proposedPerWeek}`
        : s.kind === 'move_day'
          ? `Move to ${WEEKDAY_NAMES[s.toDay! - 1]}`
          : s.kind === 'pause'
            ? 'Pause it'
            : 'Add minimum';
  // A goal that's behind gets one decision: catch up, or lower the bar.
  const offerCatchUp = catchUp != null && (s.kind === 'lower_frequency' || s.kind === 'add_minimum');
  return (
    <div className="card stack-sm">
      <div className="row-start small strong">
        <span className="dot" style={{ background: goal?.color }} />
        {action?.title}
      </div>
      <p style={{ margin: 0, fontSize: 14 }}>
        {s.reason}. {offerCatchUp ? `${goal?.title ?? 'This goal'} is behind this month. Catch up, or lower the bar?` : question}
      </p>
      <div className="btn-row" style={{ flexWrap: 'wrap' }}>
        <button className={`btn small ${choice.kind === 'keep' ? 'dark' : ''}`} onClick={() => pick({ kind: 'keep' })}>
          Keep as is
        </button>
        {offerCatchUp && (
          <button className={`btn small ${choice.kind === 'catchup' ? 'dark' : ''}`} onClick={() => pick({ kind: 'catchup', perWeek: catchUp! })}>
            Catch up (+{catchUp})
          </button>
        )}
        <button className={`btn small ${choice.kind === actionChoice.kind ? 'dark' : ''}`} onClick={() => pick(actionChoice)}>
          {actionLabel}
        </button>
      </div>
      {choice.kind === 'minimum' && (
        <div className="grid-2">
          <label className="field">
            Minimum version
            <input value={choice.minLabel ?? ''} placeholder="e.g. 5 minutes" onChange={(e) => pick({ ...choice, minLabel: e.target.value })} />
          </label>
          <NumberInput label="Minutes" value={choice.minMinutes ?? null} placeholder="e.g. 5" onChange={(v) => pick({ ...choice, minMinutes: v })} />
        </div>
      )}
      <span className="xsmall muted">
        {choice.kind === 'catchup' ? `Adds ${choice.perWeek} extra to next week, on your lightest days.` : `Applies from ${shortDate(nextMonday)}. Past weeks keep their old target.`}
      </span>
    </div>
  );
}

// ---------- Plan / next goals ----------

function TimeCheck({ planned, available, recent, onFit }: { planned: number; available: number; recent: { done: number; planned: number; weeks: number } | null; onFit: (target: number) => void }) {
  const realistic = recent && recent.done > 0 ? recent.done : null;
  const tooMuch = (realistic != null && planned > realistic * 1.25) || planned > available;
  const target = Math.round(Math.min(available, realistic ?? Infinity) / 5) * 5;
  return (
    <div className={`banner ${tooMuch ? 'warn' : 'info'}`} style={{ flexDirection: 'column', alignItems: 'flex-start', gap: 4 }}>
      <span>
        <b>{minutesText(planned)}</b> planned · {minutesText(available)} available
      </span>
      {recent && recent.planned > 0 && (
        <span className="small">
          Recent weeks you've done about <b>{minutesText(Math.round(recent.done / 5) * 5)}</b> of {minutesText(Math.round(recent.planned / 5) * 5)} planned.
          {realistic != null && planned > realistic * 1.25 ? ` Plan around ${minutesText(Math.round(realistic / 5) * 5)}.` : ''}
        </span>
      )}
      {planned > available && <span className="small">{minutesText(planned - available)} more than you have.</span>}
      {tooMuch && target > 0 && (
        <button type="button" className="btn small" onClick={() => onFit(target)} style={{ marginTop: 6 }}>
          Fit to my real week ({minutesText(target)})
        </button>
      )}
    </div>
  );
}

interface NextField {
  key: string;
  goal: Goal;
  level: ChainLevel;
  /** A date inside the period being set (used to find its chain). */
  date: ISODate;
  periodTitle: string;
  end: ISODate;
  label: string;
  current: string;
  currentValue: number | null;
  suggested: number | null;
  /** This period's goal at the same level, used to prefill ("same as this week"). */
  previous: string;
}

function NextGoalsCard({ fields, draft, set, title }: { fields: NextField[]; draft: Draft; set: (p: Partial<Draft>) => void; title: string }) {
  return (
    <div className="card stack">
      <span className="label">{title}</span>
      {fields.map((f) => (
        <NextGoalField key={f.key} f={f} draft={draft} set={set} />
      ))}
    </div>
  );
}

function NextGoalField({ f, draft, set }: { f: NextField; draft: Draft; set: (p: Partial<Draft>) => void }) {
  const value = draft.nextGoals[f.key] ?? (f.current || f.previous);
  const same = !f.current && !!f.previous && value === f.previous;
  const unit = f.level === 'week' ? 'week' : f.level === 'month' ? 'month' : '3 months';
  return (
    <div className="stack-sm" style={{ gap: 6 }}>
      <label className="field">
        <span className="row-start" style={{ gap: 6 }}>
          <span className="dot" style={{ width: 7, height: 7, background: f.goal.color }} />
          {f.goal.title} · {f.label}
        </span>
        <input value={value} onChange={(e) => set({ nextGoals: { ...draft.nextGoals, [f.key]: e.target.value } })} placeholder={`What should be true by ${shortDate(f.end)}?`} />
        {same && (
          <span className="xsmall muted" style={{ fontWeight: 400 }}>
            Same as this {unit}. Edit it if it changes, or{' '}
            <button type="button" className="link-btn xsmall" onClick={() => set({ nextGoals: { ...draft.nextGoals, [f.key]: '' } })}>
              clear it
            </button>
            .
          </span>
        )}
      </label>
      {f.goal.type === 'number' && (
        <NumberInput
          label={`Target by ${shortDate(f.end)}${f.goal.unit ? ` (${f.goal.unit})` : ''}${f.suggested != null ? ` · your path says ${fmt(f.suggested)}` : ''}`}
          value={draft.nextValues[f.key] !== undefined ? draft.nextValues[f.key]! : f.currentValue ?? f.suggested}
          placeholder={f.suggested != null ? `e.g. ${fmt(f.suggested)} (on your path)` : undefined}
          onChange={(v) => set({ nextValues: { ...draft.nextValues, [f.key]: v } })}
        />
      )}
    </div>
  );
}

function Decide({ goals, fields, draft, set, view, plan, nextMonday }: { goals: Goal[]; fields: NextField[]; draft: Draft; set: (p: Partial<Draft>) => void; view: View; plan: Plan; nextMonday: ISODate }) {
  const today = view.today;
  return (
    <>
      <h1>Decide</h1>
      <span className="small muted" style={{ marginTop: -8 }}>
        Does each goal still make sense? Keep it, adjust it, or drop it, then set the next 3 months.
      </span>
      {goals.map((g) => {
        const decision = draft.decisions[g.id] ?? 'keep';
        const adjust = draft.adjust[g.id] ?? {};
        const mine = fields.filter((f) => f.goal.id === g.id);
        const setAdjust = (patch: Adjust) => set({ adjust: { ...draft.adjust, [g.id]: { ...adjust, ...patch } } });
        const pace = view.goalPace(g, plan);
        return (
          <div key={g.id} className="card stack-sm">
            <div className="row-between">
              <span className="row-start small strong" style={{ flexWrap: 'nowrap' }}>
                <span className="dot" style={{ background: g.color }} />
                {g.title}
              </span>
              <PacePill label={pace.label} />
            </div>
            <span className="xsmall muted">{pace.summary}</span>
            <div className="chips" role="group" aria-label={`What to do with ${g.title}`} style={{ gap: 6 }}>
              {(['keep', 'adjust', 'drop'] as const).map((d) => (
                <button key={d} className="chip" style={{ minHeight: 34, padding: '0 12px', fontSize: 13 }} aria-pressed={decision === d} onClick={() => set({ decisions: { ...draft.decisions, [g.id]: d } })}>
                  {d === 'keep' ? 'Keep' : d === 'adjust' ? 'Adjust' : 'Drop'}
                </button>
              ))}
            </div>
            {decision === 'drop' && (
              <span className="small" style={{ color: 'var(--amber-ink)' }}>
                Archives this goal and takes its tasks off your list from {shortDate(nextMonday)}. Its history is kept.
              </span>
            )}
            {decision === 'adjust' &&
              (g.type === 'number' ? (
                <div className="grid-2">
                  <NumberInput label={`New 6-month target${g.unit ? ` (${g.unit})` : ''}`} value={adjust.target ?? null} placeholder={g.target_value != null ? `e.g. ${fmt(g.target_value)}` : undefined} onChange={(v) => setAdjust({ target: v })} />
                  <label className="field">
                    By
                    <input type="date" min={addDays(today, 1)} max={plan.end_date} value={adjust.date ?? g.target_date ?? plan.end_date} onChange={(e) => e.target.value && setAdjust({ date: e.target.value < addDays(today, 1) ? addDays(today, 1) : e.target.value > plan.end_date ? plan.end_date : e.target.value })} />
                  </label>
                  <span className="xsmall muted" style={{ gridColumn: 'span 2' }}>
                    The path is redrawn from where you are now to the new target.
                  </span>
                </div>
              ) : (
                <label className="field">
                  How will you know you made it?
                  <input value={adjust.doneMeans ?? g.done_means} placeholder="e.g. 3 songs recorded start to finish" onChange={(e) => setAdjust({ doneMeans: e.target.value })} />
                </label>
              ))}
            {decision !== 'drop' && mine.map((f) => <NextGoalField key={f.key} f={f} draft={draft} set={set} />)}
          </div>
        );
      })}
    </>
  );
}

function NextPlan({ goals, draft, set }: { goals: Goal[]; draft: Draft; set: (p: Partial<Draft>) => void }) {
  const np = draft.newPlan;
  const setPlan = (patch: Partial<Draft['newPlan']>) => set({ newPlan: { ...np, ...patch } });
  return (
    <>
      <h1>Next plan</h1>
      <div className="chips" role="group" aria-label="Start the next plan now?">
        <button className="chip" aria-pressed={np.on} onClick={() => setPlan({ on: true })}>
          Start my next plan
        </button>
        <button className="chip" aria-pressed={!np.on} onClick={() => setPlan({ on: false })}>
          Not now
        </button>
      </div>
      {np.on && (
        <div className="card stack">
          <label className="field">
            Name
            <input value={np.name} placeholder="e.g. Spring to fall" onChange={(e) => setPlan({ name: e.target.value })} />
          </label>
          <div className="grid-2">
            <label className="field">
              Starts
              <input type="date" value={np.start} onChange={(e) => setPlan({ start: e.target.value, end: addDays(e.target.value, 182) })} />
            </label>
            <label className="field">
              Ends
              <input type="date" value={np.end} min={addDays(np.start, 7)} onChange={(e) => setPlan({ end: e.target.value })} />
            </label>
          </div>
          {goals.length > 0 && (
            <div className="stack-sm">
              <span className="label">Carry these goals over</span>
              <span className="xsmall muted">Carried goals keep their tasks and history. Goals you hit are left behind unless you tick them.</span>
              {goals.map((g) => (
                <label key={g.id} className="row-start small" style={{ gap: 10, minHeight: 40, cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={carryDefault(draft, g)}
                    onChange={(e) => setPlan({ carry: { ...np.carry, [g.id]: e.target.checked } })}
                    style={{ width: 20, height: 20 }}
                  />
                  <span className="dot" style={{ background: g.color }} />
                  {g.title}
                  {draft.results[g.id] ? <span className="xsmall muted">· {resultWord('retro', draft.results[g.id]!)}</span> : null}
                </label>
              ))}
            </div>
          )}
        </div>
      )}
    </>
  );
}

/** Ideas selected for the next commitment, shown where you decide what comes next (3-month and retro). */
function SelectedIdeas({ when }: { when: string }) {
  const { data } = useStore();
  const ideas = selectedIdeas(data);
  if (!ideas.length) return null;
  return (
    <div className="card stack-sm">
      <span className="label" style={{ color: 'var(--accent-ink)' }}>
        Selected for next commitment
      </span>
      <ol style={{ margin: 0, paddingLeft: 20 }}>
        {ideas.map((i) => (
          <li key={i.id} className="small" style={{ padding: '3px 0' }}>
            <b style={{ fontWeight: 550 }}>{i.title}</b>
            {i.note ? <span className="muted"> · {i.note}</span> : null}
          </li>
        ))}
      </ol>
      <span className="xsmall muted">{when} Start them from Goals › Backlog after you save.</span>
    </div>
  );
}

// ---------- Helpers ----------

function Tile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="card tight">
      <div className="xsmall muted">{label}</div>
      <div className="num" style={{ fontSize: 18 }}>
        {value}
      </div>
      {sub && <div className="xsmall muted">{sub}</div>}
    </div>
  );
}

function resultWord(kind: ReviewKind, r: GoalResult): string {
  if (kind === 'retro') return r === 'hit' ? 'Achieved' : r === 'partly' ? 'Partly' : 'Not this time';
  return r === 'hit' ? 'Hit' : r === 'partly' ? 'Partly' : 'Missed';
}

/** A goal is carried into the next plan unless it was achieved (or the person changed the tick). */
function carryDefault(draft: Draft, g: Goal): boolean {
  return draft.newPlan.carry[g.id] ?? (!g.completed_at && draft.results[g.id] !== 'hit');
}

/** Each goal's written goal for the period under review (or the 6-month goal for a retrospective). */
function goalResultLines(data: AppData, goals: Goal[], planOf: (g: Goal) => Plan | null, kind: ReviewKind, period: DateRange): { goal: Goal; note: string; stepId: string | null }[] {
  return goals.flatMap((goal) => {
    const plan = planOf(goal);
    if (!plan) return [];
    if (kind === 'retro') {
      const target = goal.type === 'number' && goal.target_value != null ? `${fmt(goal.target_value)} ${goal.unit ?? ''}`.trim() : '';
      return { goal, note: [target, goal.done_means.trim()].filter(Boolean).join(' · ') || goal.title, stepId: null };
    }
    const level = RESULT_LEVEL[kind] as ChainLevel;
    const link = chainFor(data, goal, plan, period.start < plan.start_date ? plan.start_date : period.start)[level];
    const value = link.step?.target_value != null && goal.type === 'number' ? `${fmt(link.step.target_value)} ${goal.unit ?? ''}`.trim() : '';
    const note = isSet(link) ? [value, link.step!.target_note.trim()].filter(Boolean).join(' · ') : '';
    return { goal, note, stepId: link.step?.id ?? null };
  });
}

/** Goals to write down in the last step: next week's (weekly), next month's (month), next 3 months + its first month (3-month). */
function nextGoalFields(data: AppData, goals: Goal[], planOf: (g: Goal) => Plan | null, kind: ReviewKind, period: DateRange, nextMonday: ISODate): NextField[] {
  const out: NextField[] = [];
  const startOfNext = kind === 'weekly' ? nextMonday : addDays(period.end, 1);
  if (kind === 'retro') return out;
  const levels: ChainLevel[] = kind === 'weekly' ? ['quarter', 'month', 'week'] : kind === 'block' ? ['month'] : ['quarter', 'month'];
  for (const g of goals) {
    const plan = planOf(g);
    // A goal whose batch or own clock ends before next week has nothing to set.
    if (!plan || startOfNext > plan.end_date) continue;
    const chain = chainFor(data, g, plan, startOfNext);
    const now = chainFor(data, g, plan, period.start < plan.start_date ? plan.start_date : period.start);
    for (const level of levels) {
      const link = chain[level];
      const prev = now[level];
      // Weekly: always next week; next month / 3 months only when they start next week and aren't set yet.
      if (kind === 'weekly' && level !== 'week' && (link.node.start < nextMonday || isSet(link))) continue;
      out.push({
        key: `${g.id}:${level}`,
        goal: g,
        level,
        date: startOfNext,
        periodTitle: link.node.title,
        end: link.node.end,
        label: level === 'week' ? `${link.node.title} (${shortDate(link.node.start)})` : level === 'month' ? `${link.node.title}, ${shortDate(link.node.start)} – ${shortDate(link.node.end)}` : `${link.node.title}, from ${shortDate(link.node.start)}`,
        current: link.step?.target_note ?? '',
        currentValue: link.step?.target_value ?? null,
        suggested: link.suggested,
        previous: isSet(prev) && prev.node.start !== link.node.start ? prev.step!.target_note.trim() : '',
      });
    }
  }
  return out;
}

/** "Any day" tasks go on the lightest day that doesn't already have the same task. */
function lightestDays(all: Session[], days: ISODate[], available: number[]): Record<string, ISODate> {
  const out: Record<string, ISODate> = {};
  const load = days.map((d) => all.filter((s) => s.date === d).reduce((sum, s) => sum + s.planned_minutes, 0));
  const has = days.map((d) => new Set(all.filter((s) => s.date === d).map((s) => s.action_id)));
  for (const s of all.filter((x) => !x.date && x.status === 'planned' && x.action_id)) {
    let best = -1;
    for (let i = 0; i < days.length; i++) {
      if (has[i]!.has(s.action_id)) continue;
      const room = (available[i] ?? 0) - load[i]!;
      if (best === -1 || room > (available[best] ?? 0) - load[best]!) best = i;
    }
    if (best === -1) best = load.indexOf(Math.min(...load));
    out[slotKey(s)] = days[best]!;
    load[best]! += s.planned_minutes;
    has[best]!.add(s.action_id);
  }
  return out;
}

/** Turn the chosen suggestions into schedule and task changes, and the schedules as they'll be next week. */
function applyChoices(view: View, data: AppData, suggestions: Suggestion[], choices: Record<string, Choice>, nextMonday: ISODate) {
  const scheduleChanges: ReviewPayload['schedule_changes'] = [];
  const actionChanges: ReviewPayload['action_changes'] = [];
  let schedulesAfter: ActionSchedule[] = data.schedules;
  for (const s of suggestions) {
    const choice = choices[s.actionId];
    const action = view.action(s.actionId);
    if (!choice || choice.kind === 'keep' || !action) continue;
    if (choice.kind === 'minimum') {
      const label = choice.minLabel?.trim() || '5 minutes';
      actionChanges.push({
        action_id: s.actionId,
        min_label: label,
        min_minutes: choice.minMinutes ?? 5,
        min_count: null,
        summary: `${action.title}: added minimum "${label}"`,
        old_value: { min_label: action.min_label },
        new_value: { min_label: label },
      });
      continue;
    }
    const current = scheduleForWeek(data.schedules, s.actionId, nextMonday);
    if (!current || current.effective_from >= nextMonday) continue;
    const before = { rule: current.rule, days: current.days, per_week: current.per_week };
    let fresh: ActionSchedule | null = null;
    let summary = '';
    if (choice.kind === 'lower' || choice.kind === 'raise') {
      const perWeek = choice.perWeek ?? s.proposedPerWeek ?? 1;
      fresh = { id: crypto.randomUUID(), action_id: s.actionId, rule: 'per_week', days: [], per_week: perWeek, effective_from: nextMonday, effective_to: null };
      summary = `${action.title}: ${sessionsPerWeek(current)} → ${perWeek} a week`;
    } else if (choice.kind === 'move' && s.fromDay && s.toDay) {
      const days = [...new Set(current.days.map((d) => (d === s.fromDay ? s.toDay! : d)))].sort((a, b) => a - b);
      fresh = { id: crypto.randomUUID(), action_id: s.actionId, rule: 'days', days, per_week: null, effective_from: nextMonday, effective_to: null };
      summary = `${action.title}: ${WEEKDAY_NAMES[s.fromDay - 1]} → ${WEEKDAY_NAMES[s.toDay - 1]}`;
    } else if (choice.kind === 'pause') {
      summary = `${action.title}: paused`;
    } else {
      continue;
    }
    scheduleChanges.push({
      end_schedule_id: current.id,
      end_on: addDays(nextMonday, -1),
      action_id: s.actionId,
      new_schedule: fresh,
      summary,
      old_value: before,
      new_value: fresh ? { rule: fresh.rule, days: fresh.days, per_week: fresh.per_week } : { paused: true },
    });
    schedulesAfter = [...schedulesAfter.map((x) => (x.id === current.id ? { ...x, effective_to: addDays(nextMonday, -1) } : x)), ...(fresh ? [fresh] : [])];
  }
  return { schedulesAfter, scheduleChanges, actionChanges };
}

/** Drop a goal: archive it and its own tasks, and take its planned sessions off the list from `from`. */
function opsDropGoal(data: AppData, view: View, goal: Goal, from: ISODate): Op[] {
  const ops: Op[] = [...opsArchiveGoal(goal, true)];
  const own = view.actionsForGoal(goal.id).filter((a) => data.actionGoals.filter((ag) => ag.action_id === a.id).length === 1);
  const ids = new Set(own.map((a) => a.id));
  for (const a of own) ops.push(...opsArchiveAction(a, true));
  for (const s of data.sessions) {
    if (!s.action_id || !ids.has(s.action_id) || s.status !== 'planned') continue;
    if ((s.date ?? s.week_start) >= from) ops.push({ kind: 'delete', collection: 'sessions', id: s.id });
  }
  return ops;
}

/** Adjust a goal: a number goal gets a new target and a path redrawn from where it is now; others a new "done means". */
function opsAdjustGoal(data: AppData, view: View, goal: Goal, plan: Plan, adjust: Adjust, today: ISODate): Op[] {
  if (goal.type === 'number') {
    if (adjust.target == null) return [];
    const date = adjust.date ?? goal.target_date ?? plan.end_date;
    const status = view.goalPace(goal, plan).number;
    const from = status?.trend ?? status?.latest ?? goal.baseline_value ?? adjust.target;
    const path = suggestPath(from, adjust.target, today, date, plan.block_days);
    return [...opsUpdateGoal(goal, { target_value: adjust.target, target_date: date }), ...opsReplacePath(data, goal, path, today)];
  }
  const doneMeans = adjust.doneMeans?.trim();
  return doneMeans && doneMeans !== goal.done_means ? opsUpdateGoal(goal, { done_means: doneMeans }) : [];
}
