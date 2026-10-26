import { useState } from 'react';
import {
  addDays,
  isoWeekday,
  periodReviewSlots,
  planWeekNumber,
  retroSlot,
  reviewSuggestions,
  shortDate,
  weekStart,
  weekdayName,
  weeklyReviewCount,
  WEEKDAY_LONG,
  type ISODate,
  type PeriodReviewSlot,
  type Review,
} from '@six/core';
import { useStore } from '../data/store.tsx';
import { fmt, minutesText } from '../data/derive.ts';
import { useView } from '../data/useView.ts';
import type { AppData } from '../data/model.ts';
import {
  commitmentTrail,
  currentCommitment,
  hubInsights,
  minutesByGoal,
  opsWeekdayMove,
  reviewMinutes,
  scorecard,
  weekdayMove,
  type Insight,
} from '../data/insights.ts';
import { href } from '../router.ts';
import { Icon, useToast } from '../components/ui.tsx';
import { TrendBars } from '../components/TrendBars.tsx';
import { CommitmentCard } from '../components/Commitment.tsx';

/**
 * Which week a weekly review covers: the current week from Saturday on, otherwise last
 * week if it hasn't been reviewed yet.
 */
export function weekToReview(data: AppData, today: ISODate): { monday: ISODate; overdue: boolean; done: boolean } {
  const thisMonday = weekStart(today);
  const lastMonday = addDays(thisMonday, -7);
  const reviewed = (monday: ISODate) => data.reviews.some((r) => r.kind === 'weekly' && r.period_start === monday && r.status === 'done');
  const hasSessions = (monday: ISODate) => data.sessions.some((s) => s.week_start === monday);
  if (!reviewed(lastMonday) && hasSessions(lastMonday) && isoWeekday(today) < 6) {
    return { monday: lastMonday, overdue: true, done: false };
  }
  return { monday: thisMonday, overdue: false, done: reviewed(thisMonday) };
}

/** "Due today" on Sunday, "Due tomorrow" on Saturday, otherwise "Due Sunday" (or "Still open"). */
export function dueLabel(target: { overdue: boolean; done: boolean }, today: ISODate): string {
  if (target.done) return 'Done';
  if (target.overdue) return 'Still open';
  const dow = isoWeekday(today);
  return dow === 7 ? 'Due today' : dow === 6 ? 'Due tomorrow' : 'Due Sunday';
}

/** A batch's month or 3-month review is named after the batch when more than one window is running. */
const batchName = (s: PeriodReviewSlot, manyWindows: boolean) => (manyWindows ? `${s.plan.name}: ` : '');

const KIND_TITLE: Record<Review['kind'], string> = { weekly: 'Week', block: 'Month', quarter: '3-month', retro: 'Retrospective' };
const SLOT_COPY: Record<PeriodReviewSlot['kind'], { tag: string; name: (s: PeriodReviewSlot, manyWindows: boolean) => string; detail: string; minutes: number; color: string; ink: string }> = {
  block: { tag: 'M', name: (s, many) => `${batchName(s, many)}${s.title} review`, detail: 'How each goal is pacing, the dates you hit, one change for next month', minutes: 5, color: 'var(--accent-soft)', ink: 'var(--accent-ink)' },
  quarter: { tag: '3M', name: (s, many) => `${batchName(s, many)}3-month checkpoint`, detail: 'Keep, adjust or drop each goal, one change for the next 3 months', minutes: 10, color: 'var(--blue-soft)', ink: 'var(--blue-ink)' },
  retro: { tag: '6M', name: (s) => `${s.plan.name}: retrospective`, detail: 'Then vs now, what worked, what carries over, and your next season', minutes: 20, color: 'var(--gold-soft)', ink: 'var(--gold-ink)' },
};

export function slotHref(s: PeriodReviewSlot): string {
  return href(`/review/run?kind=${s.kind}&plan=${s.plan.id}&start=${s.period.start}`);
}

export function reviewTitle(r: Review): string {
  return `${KIND_TITLE[r.kind]} · ${shortDate(r.period_start)}${r.kind === 'weekly' ? '' : ` – ${shortDate(r.period_end)}`}`;
}

/**
 * Review: the review that's due (or, once done, the change you're making), how each goal went
 * week by week, patterns with a fix, the changes you've tried, and past reviews.
 */
export function ReviewHub() {
  const { data, today } = useStore();
  const view = useView();
  // Every goal you're working on, across batches and own clocks. Trends start from the earliest
  // window that has started.
  const goals = view.groupConnected(view.activeGoals);
  const running = view.livePlans.filter((p) => p.start_date <= today && view.goalsForPlan(p.id).length > 0);
  const plan = running[0] ?? null;
  const started = !!plan;
  const target = weekToReview(data, today);
  const initial = (data.profile.display_name || 'You').trim().charAt(0).toUpperCase();
  const commitment = currentCommitment(data.reviews, today);
  const past = [...data.reviews].filter((r) => r.status === 'done').sort((a, b) => (a.period_end < b.period_end ? 1 : a.period_end > b.period_end ? -1 : a.kind === 'weekly' ? 1 : -1));

  // Month, 3-month and plan reviews: open (or missed) ones are cards; only the next upcoming one is shown.
  const slots: PeriodReviewSlot[] = [];
  for (const p of running) slots.push(...periodReviewSlots(p, data.reviews, today));
  for (const p of data.plans.filter((x) => !x.archived_at && x.start_date <= today && x.end_date >= addDays(today, -60) && view.goalsForPlan(x.id, true).length > 0)) {
    const r = retroSlot(p, data.reviews, today);
    if (r) slots.push(r);
  }
  const manyWindows = running.length > 1;
  const open = slots.filter((s) => s.state !== 'upcoming');
  const nextUp = slots.filter((s) => s.state === 'upcoming').sort((a, b) => (a.opensOn < b.opensOn ? -1 : 1))[0];
  const insights = plan && started ? hubInsights(data, plan, today, !target.done) : null;
  const score = plan && started && goals.length ? scorecard(view, data, plan, goals, today) : null;
  const trail = commitmentTrail(data.reviews);

  const topCard = <WeeklyCard target={target} />;
  const commitmentCard = commitment ? <CommitmentCard review={commitment.review} text={commitment.text} forWeek={commitment.forWeek} today={today} /> : null;
  const openCards = open.map((s) => <SlotCard key={`${s.kind}:${s.plan.id}:${s.period.start}`} s={s} manyWindows={manyWindows} />);

  return (
    <div className="stack rise">
      <div className="topbar">
        <span className="mono">{plan ? plan.name : 'Review'}</span>
        <a className="avatar" href={href('/settings')} aria-label="Settings">
          {initial}
        </a>
      </div>
      <h1 style={{ marginTop: -4 }}>Review</h1>

      <div className="review-grid">
        <div className="stack review-main">
          {topCard}
          {commitmentCard}
          {openCards}
          {score && <Scorecard score={score} />}
          {insights && <InsightsCard trend={insights.trend} insights={insights.insights} goals={goals} reviewMonday={target.monday} />}
        </div>
        <div className="stack review-side">
          {trail.length > 0 && <ChangesTried trail={trail} />}
          {nextUp && (
            <div className="card tight row-start" style={{ gap: 12, flexWrap: 'nowrap' }}>
              <SlotTag tag={SLOT_COPY[nextUp.kind].tag} color={SLOT_COPY[nextUp.kind].color} ink={SLOT_COPY[nextUp.kind].ink} />
              <div className="grow" style={{ minWidth: 0 }}>
                <div className="small strong">Next: {SLOT_COPY[nextUp.kind].name(nextUp, manyWindows)}</div>
                <div className="xsmall muted">
                  Opens {shortDate(nextUp.opensOn)} · ~{SLOT_COPY[nextUp.kind].minutes} min
                </div>
              </div>
            </div>
          )}
          <div className="card stack-sm">
            <div className="row-between">
              <span className="label">Past reviews</span>
              {past.length > 5 && (
                <a className="label" href={href('/review/past')} style={{ textDecoration: 'none', color: 'var(--ink-2)' }}>
                  See all {past.length} ›
                </a>
              )}
            </div>
            {past.length === 0 && <span className="small muted">Your first review will show up here.</span>}
            {past.slice(0, 5).map((r) => (
              <PastRow key={r.id} review={r} />
            ))}
          </div>
          {started && (
            <div className="row-start" style={{ gap: 8 }}>
              <a className="btn ghost small" href={href('/review/then-now')}>
                Then vs now ›
              </a>
              <a className="btn ghost small" href={href('/paths')}>
                Your paths ›
              </a>
              <a className="btn ghost small" href={href('/progress')}>
                All charts ›
              </a>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/** The weekly review: what it covers, an honest time estimate and Start, or (when done) next week at a glance. */
function WeeklyCard({ target }: { target: ReturnType<typeof weekToReview> }) {
  const { data, today } = useStore();
  const view = useView();
  const goals = view.groupConnected(view.activeGoals);
  const running = view.livePlans.filter((p) => p.start_date <= today && view.goalsForPlan(p.id).length > 0);
  const plan = running[0] ?? null;
  const end = addDays(target.monday, 6);
  // "Week 3 review" when everything runs in one window; otherwise just the week's dates.
  const label = running.length === 1 && plan!.start_date <= target.monday ? `Week ${planWeekNumber(plan!, end)} review` : 'Weekly review';
  const due = view.measurementsDue(end);
  const count = plan ? weeklyReviewCount(plan, data.reviews, today) : null;

  if (target.done) {
    const nextMonday = addDays(target.monday, 7);
    const next = data.sessions.filter((s) => s.week_start === nextMonday && s.status === 'planned');
    const minutes = next.reduce((sum, s) => sum + s.planned_minutes, 0);
    return (
      <div className="card dark stack-sm">
        <div className="row-between" style={{ alignItems: 'baseline' }}>
          <h2>{label}</h2>
          <span className="xsmall" style={{ color: 'var(--accent-ink)' }}>
            Done
          </span>
        </div>
        <p style={{ margin: 0, fontSize: 13.5, lineHeight: 1.45, color: 'var(--ink-2)' }}>
          Next week ({shortDate(nextMonday)} – {shortDate(addDays(nextMonday, 6))}) is planned: {next.length} task{next.length === 1 ? '' : 's'}
          {minutes ? `, ${minutesText(minutes)}` : ''}. The next review opens Saturday.
        </p>
        {count && count.weeks > 0 && <ReviewCount done={count.done} weeks={count.weeks} />}
      </div>
    );
  }

  const suggestions = reviewSuggestions(data.actions, data.schedules, data.sessions, target.monday, { availableMinutes: data.profile.available_minutes, today });
  // The two-minute review: hit / partly / missed, readings, one change. Planning in detail is optional.
  const minutes = Math.max(2, Math.min(5, reviewMinutes({ goals: goals.length, measurements: due.length, suggestions: 0, planning: false })));
  return (
    <div className="card dark stack">
      <div className="row-between" style={{ alignItems: 'baseline', gap: 8 }}>
        <h2>{label}</h2>
        <span className="xsmall" style={{ color: target.overdue || isoWeekday(today) === 7 ? 'var(--amber-ink)' : 'var(--muted)', whiteSpace: 'nowrap' }}>
          {dueLabel(target, today)} · ~{minutes} min
        </span>
      </div>
      <p style={{ margin: 0, fontSize: 13.5, lineHeight: 1.45, color: 'var(--ink-2)' }}>
        {shortDate(target.monday)} – {shortDate(end)}. Hit, partly or missed for {goals.length} goal{goals.length === 1 ? '' : 's'}
        {due.length ? `, ${due.length} reading${due.length === 1 ? '' : 's'}` : ''}, one change for next week. Done.
        {suggestions.length ? ` ${suggestions.length} suggestion${suggestions.length === 1 ? '' : 's'} waiting if you want to plan in detail.` : ''}
      </p>
      {count && count.weeks > 0 && <ReviewCount done={count.done} weeks={count.weeks} />}
      <a className="btn primary" href={href(`/review/run?kind=weekly&week=${target.monday}`)}>
        Start review
      </a>
    </div>
  );
}

function ReviewCount({ done, weeks }: { done: number; weeks: number }) {
  return (
    <span className="xsmall" style={{ color: 'var(--ink-2)', display: 'flex', alignItems: 'center', gap: 8 }}>
      <span style={{ display: 'flex', gap: 3 }} aria-hidden="true">
        {Array.from({ length: Math.min(weeks, 26) }, (_, i) => (
          <span key={i} style={{ width: 8, height: 8, borderRadius: 2, background: i < done ? 'var(--accent)' : 'var(--track)' }} />
        ))}
      </span>
      {done} of {weeks} weekly review{weeks === 1 ? '' : 's'} done
    </span>
  );
}

function SlotCard({ s, manyWindows }: { s: PeriodReviewSlot; manyWindows: boolean }) {
  const copy = SLOT_COPY[s.kind];
  return (
    <div className="card stack-sm">
      <div className="row-between" style={{ alignItems: 'baseline', gap: 8 }}>
        <span className="row-start" style={{ gap: 10, flexWrap: 'nowrap' }}>
          <SlotTag tag={copy.tag} color={copy.color} ink={copy.ink} />
          <b>{copy.name(s, manyWindows)}</b>
        </span>
        <span className="xsmall" style={{ color: s.state === 'overdue' ? 'var(--amber-ink)' : 'var(--muted)', whiteSpace: 'nowrap' }}>
          {s.state === 'overdue' ? 'Still open' : `Due ${shortDate(s.period.end)}`} · ~{copy.minutes} min
        </span>
      </div>
      <span className="small" style={{ color: 'var(--ink-2)' }}>
        {shortDate(s.period.start)} – {shortDate(s.period.end)}. {copy.detail}.
      </span>
      <a className="btn primary small" href={slotHref(s)} style={{ alignSelf: 'flex-start' }}>
        Start
      </a>
    </div>
  );
}

function SlotTag({ tag, color, ink }: { tag: string; color: string; ink: string }) {
  return (
    <span className="num" style={{ width: 38, height: 38, borderRadius: 12, background: color, color: ink, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, flex: 'none' }}>
      {tag}
    </span>
  );
}

const MARK: Record<string, { glyph: string; word: string }> = { hit: { glyph: '✓', word: 'hit' }, partly: { glyph: '½', word: 'partly' }, missed: { glyph: '✕', word: 'missed' } };

/** Goals × weeks: how much got done (shading) and how the week goal was rated (mark). */
function Scorecard({ score }: { score: ReturnType<typeof scorecard> }) {
  const { mondays, rows, hits } = score;
  return (
    <div className="card stack-sm">
      <div className="row-between" style={{ gap: 8 }}>
        <span className="label">Week by week</span>
        {hits.rated > 0 && (
          <span className="xsmall muted">
            Week goals hit {hits.hit} of {hits.rated}
          </span>
        )}
      </div>
      <div className="scorecard" style={{ gridTemplateColumns: `minmax(0, 1fr) repeat(${mondays.length}, 34px)` }}>
        <span />
        {mondays.map((m, i) => (
          <span key={m} className="mono score-head">
            {i === mondays.length - 1 ? 'NOW' : shortDate(m).replace(' ', ' ').toUpperCase()}
          </span>
        ))}
        {rows.map(({ goal, cells }) => (
          <Row key={goal.id} goal={goal} cells={cells} />
        ))}
      </div>
      <div className="row-start xsmall muted" style={{ gap: 14 }}>
        <span>Shade = tasks done</span>
        <span>✓ hit · ½ partly · ✕ missed</span>
      </div>
    </div>
  );
}

function Row({ goal, cells }: { goal: { id: string; title: string; color: string }; cells: ReturnType<typeof scorecard>['rows'][number]['cells'] }) {
  return (
    <>
      <a href={href(`/goals/${goal.id}`)} className="score-goal small">
        <span className="dot" style={{ width: 8, height: 8, flex: 'none', background: goal.color }} />
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{goal.title}</span>
      </a>
      {cells.map((c) => {
        const tasks = c.planned ? `${c.done} of ${c.planned} tasks` : 'no tasks due';
        const label = `${goal.title}, week of ${shortDate(c.monday)}${c.current ? ' (so far)' : ''}: ${tasks}${c.result ? `, week goal ${MARK[c.result]!.word}` : ''}`;
        return (
          <span
            key={c.monday}
            className={`score-cell${c.current ? ' current' : ''}`}
            role="img"
            aria-label={label}
            title={label}
            style={{
              background: c.rate == null ? 'var(--track)' : `color-mix(in srgb, ${goal.color} ${Math.round(18 + c.rate * 72)}%, transparent)`,
              color: c.result === 'missed' ? 'var(--amber-ink)' : 'var(--ink)',
            }}
          >
            {c.result ? MARK[c.result]!.glyph : ''}
          </span>
        );
      })}
    </>
  );
}

/** Weekly trend, where the time went last week, and patterns, each with a fix where there is one. */
function InsightsCard({ trend, insights, goals, reviewMonday }: { trend: ReturnType<typeof hubInsights>['trend']; insights: Insight[]; goals: ReturnType<ReturnType<typeof useView>['goalsForPlan']>; reviewMonday: ISODate }) {
  const { data, today } = useStore();
  const view = useView();
  const lastMonday = addDays(weekStart(today), -7);
  const time = minutesByGoal(view, data, goals, lastMonday);
  const total = time.reduce((s, x) => s + x.minutes, 0);
  return (
    <div className="card stack">
      <span className="label">Insights</span>
      <TrendBars weeks={trend} />
      {time.length > 0 && (
        <div className="stack-sm" style={{ gap: 6 }}>
          <span className="xsmall muted">
            Where your time went · week of {shortDate(lastMonday)} · {minutesText(total)}
          </span>
          {time.map((t) => (
            <div key={t.goal.id} className="time-row xsmall">
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.goal.title}</span>
              <span className="time-bar" aria-hidden="true">
                <span style={{ width: `${Math.max(3, (t.minutes / time[0]!.minutes) * 100)}%`, background: t.goal.color }} />
              </span>
              <span style={{ textAlign: 'right', color: 'var(--ink-2)' }}>{minutesText(t.minutes)}</span>
            </div>
          ))}
        </div>
      )}
      {insights.map((i) => (
        <InsightRow key={i.text} insight={i} reviewMonday={reviewMonday} />
      ))}
    </div>
  );
}

function InsightRow({ insight, reviewMonday }: { insight: Insight; reviewMonday: ISODate }) {
  const { data, today, commit } = useStore();
  const toast = useToast();
  const [confirm, setConfirm] = useState(false);
  const a = insight.action;
  const move = a?.kind === 'move-weekday' ? weekdayMove(data, a.weekday, today) : null;
  return (
    <div className="stack-sm" style={{ gap: 8, borderTop: '1px solid var(--line)', paddingTop: 10 }}>
      <span className="small" style={{ color: 'var(--ink-2)', lineHeight: 1.45 }}>
        {insight.text}
      </span>
      {a?.kind === 'review' && (
        <a className="btn small" href={href(`/review/run?kind=weekly&week=${reviewMonday}`)} style={{ alignSelf: 'flex-start' }}>
          {a.label}
        </a>
      )}
      {move && !confirm && (
        <button className="btn small" type="button" onClick={() => setConfirm(true)} style={{ alignSelf: 'flex-start' }}>
          Move {WEEKDAY_LONG[move.from - 1]} tasks to {WEEKDAY_LONG[move.to - 1]}
        </button>
      )}
      {move && confirm && (
        <div className="note-box stack-sm" style={{ gap: 8 }}>
          <span className="small">
            From {weekdayName(move.start)} {shortDate(move.start)}, {move.tasks.map((t) => t.title).join(', ')} move{move.tasks.length === 1 ? 's' : ''} from {WEEKDAY_LONG[move.from - 1]} to{' '}
            {WEEKDAY_LONG[move.to - 1]}. Earlier weeks keep their days.
          </span>
          <div className="btn-row">
            <button
              className="btn small primary"
              type="button"
              onClick={() => {
                commit(opsWeekdayMove(data, move, today));
                setConfirm(false);
                toast(`Moved to ${WEEKDAY_LONG[move.to - 1]} from ${shortDate(move.start)}`);
              }}
            >
              Move
            </button>
            <button className="btn small" type="button" onClick={() => setConfirm(false)}>
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

const KEPT: Record<string, { word: string; ink: string }> = {
  yes: { word: 'Stuck', ink: 'var(--accent-ink)' },
  partly: { word: 'Partly', ink: 'var(--ink-2)' },
  no: { word: "Didn't", ink: 'var(--amber-ink)' },
};

/** The changes you committed to in weekly reviews and whether they stuck. */
function ChangesTried({ trail }: { trail: ReturnType<typeof commitmentTrail> }) {
  const answered = trail.filter((t) => t.kept);
  const stuck = answered.filter((t) => t.kept === 'yes').length;
  return (
    <div className="card stack-sm">
      <div className="row-between">
        <span className="label">Changes you tried</span>
        {answered.length > 0 && (
          <span className="xsmall muted">
            {stuck} of {answered.length} stuck
          </span>
        )}
      </div>
      {trail.map((t) => (
        <div key={t.review.id} className="list-row" style={{ alignItems: 'flex-start', gap: 10 }}>
          <span className="mono" style={{ fontSize: 10.5, width: 46, flex: 'none', paddingTop: 2 }}>
            {shortDate(addDays(t.review.period_start, 7)).toUpperCase()}
          </span>
          <span className="small grow" style={{ lineHeight: 1.4 }}>
            {t.text}
          </span>
          <span className="xsmall strong" style={{ flex: 'none', color: t.kept ? KEPT[t.kept]!.ink : 'var(--muted)' }}>
            {t.kept ? KEPT[t.kept]!.word : t.answered ? 'No answer' : 'In progress'}
          </span>
        </div>
      ))}
    </div>
  );
}

/** One past review: what it covered, how much got done, and the change it planned (and whether it stuck). */
export function PastRow({ review: r }: { review: Review }) {
  const { data } = useStore();
  const after = r.kind === 'weekly' ? data.reviews.filter((x) => x.kind === 'weekly' && x.status === 'done' && x.period_start > r.period_start).sort((a, b) => (a.period_start < b.period_start ? -1 : 1))[0] : null;
  const kept = r.change_next.trim() && after?.commitment_kept ? KEPT[after.commitment_kept]!.word.toLowerCase() : null;
  const results = r.goal_results ?? [];
  const hit = results.filter((g) => g.result === 'hit').length;
  const line = r.change_next.trim()
    ? `Change: ${r.change_next.trim()}${kept ? ` → ${kept}` : ''}`
    : r.carry_forward?.trim()
      ? `Carry over: ${r.carry_forward.trim()}`
      : r.went_well.trim()
        ? `Went well: ${r.went_well.trim()}`
        : '';
  return (
    <a className="list-row" href={href(`/review/past/${r.id}`)} style={{ alignItems: 'center' }}>
      <div className="grow" style={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
        <div className="row-between small" style={{ gap: 8 }}>
          <b>{reviewTitle(r)}</b>
          <span className="muted" style={{ whiteSpace: 'nowrap' }}>
            {fmt(r.actions_done, 0)} of {r.actions_planned} done{results.length ? ` · ${hit}/${results.length} goals` : ''}
          </span>
        </div>
        {line && <div className="xsmall muted" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{line}</div>}
      </div>
      <span style={{ color: 'var(--muted)', flex: 'none', display: 'inline-flex' }}>
        <Icon name="chevron" size={16} stroke={2.2} />
      </span>
    </a>
  );
}

