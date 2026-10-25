import {
  addDays,
  isoWeekday,
  periodReviewSlots,
  planWeekNumber,
  retroSlot,
  shortDate,
  weekStart,
  weeklyReviewCount,
  type ISODate,
  type PeriodReviewSlot,
  type Review,
} from '@six/core';
import { useStore } from '../data/store.tsx';
import { fmt, useView } from '../data/derive.ts';
import type { AppData } from '../data/model.ts';
import { hubInsights } from '../data/insights.ts';
import { href } from '../router.ts';
import { Icon } from '../components/ui.tsx';
import { TrendBars } from '../components/TrendBars.tsx';
import { ProgressBento } from './Home.tsx';

/**
 * Which week a weekly review covers: the current week from Saturday on, otherwise last
 * week if it hasn't been reviewed yet. Returns null when there's nothing to review.
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

const KIND_TITLE: Record<Review['kind'], string> = { weekly: 'Week', block: 'Month', quarter: '3-month', retro: 'Retrospective' };
const SLOT_COPY: Record<PeriodReviewSlot['kind'], { tag: string; name: (s: PeriodReviewSlot) => string; detail: string; minutes: number; color: string; ink: string }> = {
  block: { tag: 'M', name: (s) => `${s.title} review`, detail: "How the month went, then set next month's goals", minutes: 15, color: 'var(--accent-soft)', ink: 'var(--accent-ink)' },
  quarter: { tag: '3M', name: () => '3-month checkpoint', detail: 'Keep, adjust or drop each goal, then set the next 3 months', minutes: 25, color: 'var(--blue-soft)', ink: 'var(--blue-ink)' },
  retro: { tag: '6M', name: (s) => `${s.plan.name}: retrospective`, detail: 'What worked, what carries over, and your next plan', minutes: 30, color: 'var(--gold-soft)', ink: 'var(--gold-ink)' },
};

export function slotHref(s: PeriodReviewSlot): string {
  return href(`/review/run?kind=${s.kind}&plan=${s.plan.id}&start=${s.period.start}`);
}

export function reviewTitle(r: Review): string {
  return `${KIND_TITLE[r.kind]} · ${shortDate(r.period_start)}${r.kind === 'weekly' ? '' : ` – ${shortDate(r.period_end)}`}`;
}

export function ReviewHub() {
  const { data, today } = useStore();
  const view = useView();
  const plan = view.mainPlan;
  const target = weekToReview(data, today);
  const weekLabel = plan && plan.start_date <= target.monday ? `Week ${planWeekNumber(plan, addDays(target.monday, 6))} review` : `Review of ${shortDate(target.monday)}`;
  const past = [...data.reviews].filter((r) => r.status === 'done').sort((a, b) => (a.period_end < b.period_end ? 1 : a.period_end > b.period_end ? -1 : a.kind === 'weekly' ? 1 : -1));
  const due = view.measurementsDue(addDays(target.monday, 6));
  const initial = (data.profile.display_name || 'You').trim().charAt(0).toUpperCase();
  const count = plan && plan.start_date <= today ? weeklyReviewCount(plan, data.reviews, today) : null;

  // Month, 3-month and plan reviews: the open (or missed) ones first, then what's coming up.
  const slots: PeriodReviewSlot[] = [];
  if (plan && plan.start_date <= today) slots.push(...periodReviewSlots(plan, data.reviews, today));
  const retroPlans = data.plans.filter((p) => !p.archived_at && p.start_date <= today && p.end_date >= addDays(today, -60));
  for (const p of retroPlans) {
    const r = retroSlot(p, data.reviews, today);
    if (r && (r.state !== 'upcoming' || p.id === plan?.id)) slots.push(r);
  }
  const open = slots.filter((s) => s.state !== 'upcoming');
  const upcoming = slots.filter((s) => s.state === 'upcoming').sort((a, b) => (a.opensOn < b.opensOn ? -1 : 1));
  const insights = plan && plan.start_date <= addDays(today, -7) ? hubInsights(data, today) : null;

  return (
    <div className="stack rise">
      <div className="topbar">
        <span className="mono">{plan ? plan.name : 'Review'}</span>
        <a className="avatar" href={href('/settings')} aria-label="Settings">
          {initial}
        </a>
      </div>
      <h1 style={{ marginTop: -4 }}>Review</h1>

      <div className="card dark stack">
        <div className="row-between" style={{ alignItems: 'baseline' }}>
          <h2>{weekLabel}</h2>
          <span className="xsmall muted">
            {target.done ? 'Done' : target.overdue ? 'Still open' : 'Due Sunday'} · ~5 min
          </span>
        </div>
        <p style={{ margin: 0, fontSize: 13.5, lineHeight: 1.45, color: 'var(--ink-2)' }}>
          {target.done
            ? 'This week is reviewed. The next one opens on Saturday.'
            : `${shortDate(target.monday)} – ${shortDate(addDays(target.monday, 6))}. ${
                due.length ? `${due.length} measurement${due.length === 1 ? '' : 's'} due. ` : ''
              }Look back, reflect, plan next week.`}
        </p>
        {count && count.weeks > 0 && (
          <span className="xsmall" style={{ color: 'var(--ink-2)' }}>
            {count.done} of {count.weeks} weekly review{count.weeks === 1 ? '' : 's'} done this plan
          </span>
        )}
        {!target.done && (
          <a className="btn primary" href={href(`/review/run?kind=weekly&week=${target.monday}`)}>
            Start review
          </a>
        )}
      </div>

      {open.map((s) => {
        const copy = SLOT_COPY[s.kind];
        return (
          <div key={`${s.kind}:${s.plan.id}:${s.period.start}`} className="card stack-sm">
            <div className="row-between" style={{ alignItems: 'baseline', gap: 8 }}>
              <span className="row-start" style={{ gap: 10, flexWrap: 'nowrap' }}>
                <SlotTag tag={copy.tag} color={copy.color} ink={copy.ink} />
                <b>{copy.name(s)}</b>
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
      })}

      {insights && (insights.lines.length > 0 || insights.trend.some((w) => w.rate != null)) && (
        <div className="card stack-sm">
          <span className="label">Insights</span>
          <TrendBars weeks={insights.trend} />
          {insights.lines.map((l) => (
            <span key={l} className="small" style={{ color: 'var(--ink-2)', lineHeight: 1.45 }}>
              {l}
            </span>
          ))}
        </div>
      )}

      {plan && plan.start_date <= today && (
        <>
          <div className="row-between" style={{ margin: '14px 2px 0' }}>
            <span className="label">Progress</span>
            <a className="label" href={href('/progress')} style={{ textDecoration: 'none', color: 'var(--ink-2)' }}>
              Charts ›
            </a>
          </div>
          <ProgressBento plan={plan} />
        </>
      )}

      {upcoming.length > 0 && (
        <div className="card stack-sm">
          <span className="label">Coming up</span>
          {upcoming.map((s) => {
            const copy = SLOT_COPY[s.kind];
            return (
              <div key={`${s.kind}:${s.plan.id}:${s.period.start}`} className="list-row">
                <SlotTag tag={copy.tag} color={copy.color} ink={copy.ink} />
                <div className="grow">
                  <div className="strong small">{copy.name(s)}</div>
                  <div className="xsmall muted">
                    Opens {shortDate(s.opensOn)} · {copy.detail}
                  </div>
                </div>
              </div>
            );
          })}
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
      <p className="xsmall muted" style={{ textAlign: 'center' }}>
        Missed a review? It stays open until the next one of its kind opens.
      </p>
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

/** One past review: what it covered, how much got done, and the change it planned. Opens the full review. */
export function PastRow({ review: r }: { review: Review }) {
  const line = r.went_well || r.change_next || r.carry_forward || '';
  return (
    <a className="list-row" href={href(`/review/past/${r.id}`)} style={{ alignItems: 'center' }}>
      <div className="grow" style={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
        <div className="row-between small" style={{ gap: 8 }}>
          <b>{reviewTitle(r)}</b>
          <span className="muted" style={{ whiteSpace: 'nowrap' }}>
            {fmt(r.actions_done, 0)} of {r.actions_planned} done
          </span>
        </div>
        {line && (
          <div className="xsmall muted" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {r.went_well ? `Went well: ${r.went_well}` : r.change_next ? `Next: ${r.change_next}` : `Carry over: ${line}`}
          </div>
        )}
      </div>
      <span style={{ color: 'var(--muted)', flex: 'none', display: 'inline-flex' }}>
        <Icon name="chevron" size={16} stroke={2.2} />
      </span>
    </a>
  );
}
