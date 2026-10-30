import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  MAX_TARGETS,
  PACE_CURVES,
  addDays,
  daysBetween,
  monthlyAmounts,
  shortDate,
  suggestLoadFix,
  totalBy,
  weekLoad,
  weekStart,
  type Goal,
  type ISODate,
  type PaceCurve,
  type Plan,
  type PlanStep,
} from '@six/core';
import { useStore } from '../data/store.tsx';
import { useView } from '../data/useView.ts';
import { fmt } from '../data/derive.ts';
import type { Op } from '../data/model.ts';
import { opsAddMilestone, opsUpdateGoal } from '../data/ops.ts';
import { href, navigate } from '../router.ts';
import { Empty, Icon, Sheet, useToast, WEEKDAY_NAMES } from '../components/ui.tsx';
import {
  LADDER_STEPS,
  blankTarget,
  blankTask,
  curveOf,
  daysLabel,
  defaultMonday,
  draftsFrom,
  goalTotal,
  hoursFor,
  hoursText,
  isLadderStep,
  isPlannedDown,
  ladderPeriods,
  ladderTargets,
  leadingNumber,
  loadTaskDrafts,
  opsCommitTasks,
  opsLinkTask,
  opsSaveTargets,
  opsToggleTarget,
  othersOverRange,
  periodEnd,
  saveTaskDrafts,
  suggestionsFor,
  targetText,
  targetsAt,
  unplannedGoals,
  weekChips,
  weekdayOf,
  type LadderPeriods,
  type LadderStep,
  type TargetDraft,
  type TargetLevel,
  type TaskDraft,
  type WeekChip,
} from '../data/ladder.ts';

/**
 * Plan this goal: one screen per level, from the finish back to this week.
 *   6 months → 3 months → this month → this week → the week's tasks → the plan on one page
 * Each level shows the one above it, suggests targets from it and from your hours, and saves when
 * you go on. On a computer the whole ladder sits on the left and the level above on the right; on a
 * phone the ladder is a strip across the top. Saturday's review opens the week step for next week.
 */

const LEVEL_NAME: Record<TargetLevel, string> = { quarter: '3 months', month: '1 month', week: 'This week' };
const TARGET_COLORS = ['var(--accent-ink)', 'var(--blue-ink)', 'var(--amber-ink)'];
const TARGET_FILLS = ['var(--accent-soft)', 'var(--blue-soft)', 'var(--amber-soft)'];

export function PlanGoal({ goalId, step: stepParam, week, from }: { goalId: string; step: string | null; week: string | null; from: string | null }) {
  const view = useView();
  const goal = view.goal(goalId);
  const plan = goal ? view.planForGoal(goal) : null;
  if (!goal) return <Empty title="Goal not found." />;
  if (!plan) {
    return (
      <Empty title="This goal isn't in a season yet.">
        <a href={href(`/goals/${goal.id}`)}>Back to the goal</a>
      </Empty>
    );
  }
  const monday = week && /^\d{4}-\d{2}-\d{2}$/.test(week) ? weekStart(week) : defaultMonday(view, goal, plan);
  const planned = isPlannedDown(view, goal, plan);
  const step: LadderStep = isLadderStep(stepParam) ? stepParam : planned ? 'review' : 'start';
  return <PlanScreens key={`${goal.id}-${step}-${monday}`} goal={goal} plan={plan} monday={monday} step={step} saturday={from === 'review'} />;
}

interface StepProps {
  goal: Goal;
  plan: Plan;
  p: LadderPeriods;
  step: LadderStep;
  saturday: boolean;
  go: (s: LadderStep) => void;
}

function PlanScreens({ goal, plan, monday, step, saturday }: { goal: Goal; plan: Plan; monday: ISODate; step: LadderStep; saturday: boolean }) {
  const view = useView();
  const p = ladderPeriods(view, goal, plan, monday);
  const go = (s: LadderStep) => navigate(`/goals/${goal.id}/plan?step=${s}&week=${monday}${saturday ? '&from=review' : ''}`);
  const props: StepProps = { goal, plan, p, step, saturday, go };
  switch (step) {
    case 'start':
      return <StartStep {...props} />;
    case 'season':
      return <SeasonStep {...props} />;
    case 'quarter':
    case 'month':
    case 'week':
      return <LevelStep {...props} level={step} />;
    case 'tasks':
      return <TasksStep {...props} />;
    default:
      return <ReviewStep {...props} />;
  }
}

// ---------- The frame every step shares ----------

const STEP_LABEL: Record<LadderStep, string> = { start: 'Plan this goal', season: 'Step 1 of 5', quarter: 'Step 2 of 5', month: 'Step 3 of 5', week: 'Step 4 of 5', tasks: 'Step 5 of 5', review: 'Your plan' };
const PREV: Record<LadderStep, LadderStep | null> = { start: null, season: 'start', quarter: 'season', month: 'quarter', week: 'month', tasks: 'week', review: 'tasks' };

function Shell({
  goal,
  plan,
  p,
  step,
  saturday,
  go,
  kicker,
  title,
  sub,
  context,
  aside,
  children,
  nextLabel,
  onNext,
  nextDisabled,
  backTo,
}: StepProps & {
  kicker: string;
  title: string;
  sub?: string;
  context?: ReactNode;
  aside?: ReactNode;
  children: ReactNode;
  nextLabel: string;
  onNext: () => void;
  nextDisabled?: boolean;
  backTo?: LadderStep | null;
}) {
  const onNextRef = useRef(onNext);
  onNextRef.current = onNext;
  // Enter goes on (not while typing in a long text, picking from a list, or with a sheet open).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Enter' || e.shiftKey || e.altKey || e.isComposing) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.tagName === 'BUTTON' || t.tagName === 'A' || t.isContentEditable)) return;
      if (document.querySelector('.sheet')) return;
      if (nextDisabled) return;
      e.preventDefault();
      onNextRef.current();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [nextDisabled]);
  const prev = backTo === undefined ? PREV[step] : backTo;
  const label = saturday && step === 'week' ? 'Saturday review' : STEP_LABEL[step];
  return (
    <div className="ladder rise">
      <div className="ladder-top">
        {prev ? (
          <button type="button" className="back" onClick={() => go(prev)}>
            <Icon name="back" />
            Back
          </button>
        ) : (
          <a className="back" href={href(`/goals/${goal.id}`)}>
            <Icon name="back" />
            {goal.title.length > 28 ? 'Goal' : goal.title}
          </a>
        )}
        <span className="mono ladder-step-label">{label}</span>
        <a className="icon-btn ladder-close" href={href(saturday ? '/review' : `/goals/${goal.id}`)} aria-label="Close the plan">
          <Icon name="x" />
        </a>
      </div>
      {step !== 'start' && <LadderRail goal={goal} plan={plan} p={p} step={step} go={go} />}
      <div className={`ladder-body${aside || context ? '' : ' no-aside'}${step === 'start' ? ' no-nav' : ''}`}>
        {step !== 'start' && <LadderNav goal={goal} plan={plan} p={p} step={step} go={go} />}
        <section className="ladder-main" aria-labelledby="ladder-title">
          {context && <div className="only-narrow ladder-narrow-context">{context}</div>}
          <header className="ladder-head">
            <span className="mono ladder-kicker">{kicker}</span>
            <h1 id="ladder-title">{title}</h1>
            {sub && <p className="ladder-sub">{sub}</p>}
          </header>
          {children}
          {aside && <div className="only-narrow ladder-narrow-aside">{aside}</div>}
          <footer className="ladder-foot">
            {prev ? (
              <button type="button" className="btn ladder-back-btn" onClick={() => go(prev)}>
                Back
              </button>
            ) : (
              <span />
            )}
            <div className="ladder-foot-go">
              <span className="xsmall muted only-wide ladder-enter">
                Press <kbd>Enter</kbd> to continue
              </span>
              <button type="button" className="btn primary ladder-next" onClick={onNext} disabled={nextDisabled}>
                {nextLabel}
              </button>
            </div>
          </footer>
        </section>
        {(aside || context) && (
          <aside className="ladder-aside only-wide">
            {context}
            {aside}
          </aside>
        )}
      </div>
    </div>
  );
}

/** The ladder on a computer: every level, what you set on it, and a link to change it. */
function LadderNav({ goal, plan, p, step, go }: Pick<StepProps, 'goal' | 'plan' | 'p' | 'step' | 'go'>) {
  const { data } = useStore();
  const t = ladderTargets(data, goal, plan, p);
  const rows: { s: LadderStep; name: string; when: string; done: string; ask: string }[] = [
    { s: 'season', name: '6 months', when: shortDate(p.end), done: goal.done_means.trim() || goal.title, ask: `What's true on ${shortDate(p.end)}` },
    { s: 'quarter', name: '3 months', when: shortDate(periodEnd(p, p.quarter)), done: t.quarter.map((x) => targetText(goal, x)).join(' · '), ask: `What has to be true by ${shortDate(periodEnd(p, p.quarter))}` },
    { s: 'month', name: '1 month', when: shortDate(periodEnd(p, p.month)), done: t.month.map((x) => targetText(goal, x)).join(' · '), ask: `What you'd finish by ${shortDate(periodEnd(p, p.month))}` },
    { s: 'week', name: 'This week', when: shortDate(addDays(p.monday, 6)), done: t.week.map((x) => targetText(goal, x)).join(' · '), ask: "What you'll have by Sunday" },
    { s: 'tasks', name: 'Tasks', when: `${shortDate(p.monday)} –`, done: '', ask: 'What you do, on which day' },
  ];
  const order = LADDER_STEPS.indexOf(step as (typeof LADDER_STEPS)[number]);
  return (
    <nav className="ladder-nav only-wide" aria-label="The plan, level by level">
      <span className="mono ladder-nav-title">The plan</span>
      {rows.map((r, i) => {
        const current = r.s === step;
        const past = step === 'review' || (order >= 0 && i < order);
        const filled = !!r.done;
        return (
          <button key={r.s} type="button" className={`ladder-nav-row${current ? ' current' : ''}`} aria-current={current ? 'step' : undefined} onClick={() => go(r.s)}>
            <span className={`ladder-dot${current ? ' current' : filled || past ? ' done' : ''}`} aria-hidden="true">
              {!current && (filled || past) && <Icon name="check" size={12} stroke={3} />}
            </span>
            <span className="ladder-nav-text">
              <b>
                {r.name} <span className="muted">· {r.when}</span>
              </b>
              <span className={current ? 'ladder-nav-ask' : 'muted'}>{current || !r.done ? r.ask : r.done}</span>
            </span>
          </button>
        );
      })}
      <button type="button" className={`ladder-nav-row${step === 'review' ? ' current' : ''}`} onClick={() => go('review')}>
        <span className={`ladder-dot${step === 'review' ? ' current' : ''}`} aria-hidden="true" />
        <span className="ladder-nav-text">
          <b>The plan on one page</b>
          <span className="muted">Review and start</span>
        </span>
      </button>
    </nav>
  );
}

/** The ladder on a phone: five segments across the top. */
function LadderRail({ goal, p, step, go }: Pick<StepProps, 'goal' | 'plan' | 'p' | 'step' | 'go'>) {
  const order = step === 'review' ? 5 : LADDER_STEPS.indexOf(step as (typeof LADDER_STEPS)[number]);
  const items: { s: LadderStep; name: string; when: string }[] = [
    { s: 'season', name: '6 mo', when: shortDate(p.end) },
    { s: 'quarter', name: '3 mo', when: shortDate(periodEnd(p, p.quarter)) },
    { s: 'month', name: '1 mo', when: shortDate(periodEnd(p, p.month)) },
    { s: 'week', name: 'Week', when: shortDate(addDays(p.monday, 6)) },
    { s: 'tasks', name: 'Tasks', when: 'Mon–Sun' },
  ];
  return (
    <nav className="ladder-rail only-narrow" aria-label={`${goal.title}: plan levels`}>
      {items.map((x, i) => (
        <button key={x.s} type="button" className={`ladder-rail-seg${i < order ? ' done' : i === order ? ' current' : ''}`} aria-current={i === order ? 'step' : undefined} onClick={() => go(x.s)}>
          <span className="ladder-rail-bar" aria-hidden="true" />
          <span className="ladder-rail-name">{x.name}</span>
          <span className="ladder-rail-when">{x.when}</span>
        </button>
      ))}
    </nav>
  );
}

function ContextCard({ label, lines }: { label: string; lines: string[] }) {
  return (
    <div className="ladder-context">
      <span className="mono ladder-context-label">
        <Icon name="up" size={14} stroke={2.2} />
        {label}
      </span>
      {lines.length ? lines.map((l, i) => <span key={i} className="small">{l}</span>) : <span className="small muted">Nothing set yet. You can go back and add it.</span>}
    </div>
  );
}

function Card({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <div className="card ladder-card">
      {title && <b className="small">{title}</b>}
      {children}
    </div>
  );
}

function Tip({ children }: { children: ReactNode }) {
  return (
    <div className="card ladder-card">
      <span className="small muted" style={{ lineHeight: 1.5 }}>
        <b style={{ color: 'var(--ink)' }}>Tip.</b> {children}
      </span>
    </div>
  );
}

function Meter({ label, right, share, ok, note }: { label: string; right: string; share: number; ok: boolean; note?: string }) {
  return (
    <div className="card ladder-card">
      <div className="row-between">
        <b className="small">{label}</b>
        <b className="small">{right}</b>
      </div>
      <div className="ladder-meter" role="img" aria-label={`${label}: ${right}`}>
        <span style={{ width: `${Math.min(100, Math.round(share * 100))}%`, background: ok ? 'var(--blue)' : 'var(--amber-bar)' }} />
      </div>
      {note && <span className="xsmall muted" style={{ lineHeight: 1.45 }}>{note}</span>}
    </div>
  );
}

// ---------- Start ----------

function StartStep(props: StepProps) {
  const { goal, plan, p, go } = props;
  const view = useView();
  const group = goal.group_id ? view.data.groups.find((g) => g.id === goal.group_id) : undefined;
  const path = goal.path_id ? view.data.paths.find((x) => x.id === goal.path_id) : undefined;
  const span = Math.max(1, daysBetween(p.start, p.end));
  const at = (d: ISODate) => Math.min(100, Math.max(0, (daysBetween(p.start, d) / span) * 100));
  const marks = [
    { d: addDays(p.monday, 6), name: 'This week' },
    { d: periodEnd(p, p.month), name: '1 month' },
    { d: periodEnd(p, p.quarter), name: '3 months' },
    { d: p.end, name: 'The finish' },
  ].filter((m, i, all) => all.findIndex((x) => x.d === m.d) === i);
  const steps = [
    ['6 months', `What's true on ${shortDate(p.end)}`],
    ['3 months', `What has to be true by ${shortDate(periodEnd(p, p.quarter))}`],
    ['1 month', `What you'd finish by ${shortDate(periodEnd(p, p.month))}`],
    ['This week', "What you'll have by Sunday"],
    ['Tasks', 'What you do, on which day'],
  ];
  const cadence = [
    ['Once, now', 'All five steps', 'About 8 min'],
    ['Every Saturday', 'This week and its tasks', 'About 3 min'],
    ['Each month review', 'The month, then the week', 'About 5 min'],
    ['The 3-month checkpoint', 'Keep, adjust or drop', 'About 10 min'],
  ];
  return (
    <Shell
      {...props}
      kicker={[plan.name, group?.name, path?.name].filter(Boolean).join(' · ')}
      title={goal.title}
      sub={`Finishes ${shortDate(p.end)} · ${Math.max(0, daysBetween(view.today, p.end))} days`}
      nextLabel="Plan this goal"
      onNext={() => go('season')}
      aside={
        <Card title="How often you come back">
          {cadence.map(([a, b, c]) => (
            <div key={a} className="ladder-cadence">
              <span>
                <b className="small">{a}</b>
                <span className="xsmall muted">{b}</span>
              </span>
              <span className="xsmall muted">{c}</span>
            </div>
          ))}
        </Card>
      }
    >
      <div className="card ladder-card">
        <b>{isPlannedDown(view, goal, plan) ? 'Plan it again, top to bottom' : "This goal isn't planned down yet"}</b>
        <span className="small muted" style={{ lineHeight: 1.5 }}>
          Work from the finish back to this week. Each step suggests targets from the one above it and from the hours you have.
        </span>
        <div className="ladder-timeline" role="img" aria-label={marks.map((m) => `${m.name}: ${shortDate(m.d)}`).join(', ')}>
          <span className="ladder-timeline-line" />
          {marks.map((m) => (
            <span key={m.name} className="ladder-timeline-mark" style={{ left: `${at(m.d)}%` }} data-end={at(m.d) > 85 ? 'true' : undefined}>
              <span className="ladder-timeline-dot" />
              <b className="xsmall">{shortDate(m.d)}</b>
              <span className="xsmall muted">{m.name}</span>
            </span>
          ))}
        </div>
        <div className="ladder-steps-preview">
          {steps.map(([name, q], i) => (
            <div key={name} className="ladder-step-preview">
              <span className="mono" style={{ color: 'var(--accent-ink)' }}>Step {i + 1}</span>
              <b className="small">{name}</b>
              <span className="xsmall muted">{q}</span>
            </div>
          ))}
        </div>
      </div>
    </Shell>
  );
}

// ---------- 6 months: the goal itself ----------

function SeasonStep(props: StepProps) {
  const { goal, p, go } = props;
  const { data, today, commit } = useStore();
  const view = useView();
  const [doneMeans, setDoneMeans] = useState(goal.done_means);
  const [why, setWhy] = useState(goal.why);
  const existingTotals = data.milestones.filter((m) => m.goal_id === goal.id && (m.value != null || leadingNumber(m.title) != null)).sort((a, b) => (a.due_date < b.due_date ? -1 : 1));
  const [newTotals, setNewTotals] = useState<string[]>(existingTotals.length ? [] : ['']);
  const path = goal.path_id ? data.paths.find((x) => x.id === goal.path_id) : undefined;
  const kind =
    goal.type === 'number'
      ? `A number: ${goal.baseline_value != null ? `${fmt(goal.baseline_value)} → ` : ''}${goal.target_value != null ? fmt(goal.target_value) : '?'} ${goal.unit ?? ''}`.trim()
      : goal.type === 'finish'
        ? 'Something to finish'
        : 'A practice to keep';

  function save() {
    const ops: Op[] = [];
    const patch: Partial<Goal> = {};
    if (doneMeans.trim() !== goal.done_means.trim()) patch.done_means = doneMeans.trim();
    if (why.trim() !== goal.why.trim()) patch.why = why.trim();
    if (Object.keys(patch).length) ops.push(...opsUpdateGoal(goal, patch));
    for (const t of newTotals) if (leadingNumber(t) != null) ops.push(...opsAddMilestone(goal.id, t, p.end));
    commit(ops);
    go('quarter');
  }

  return (
    <Shell
      {...props}
      kicker={`Step 1 of 5 · By ${shortDate(p.end)}`}
      title="What's true on the last day?"
      sub={'Write the result, not the work: “signed offer”, not “apply to jobs”.'}
      nextLabel="Next: 3-month checkpoint"
      onNext={save}
      aside={
        <>
          <Card title="Result or work?">
            <span className="small">
              <b style={{ color: 'var(--blue-ink)' }}>Result</b> Signed offer by {shortDate(p.end)}
            </span>
            <span className="small">
              <b style={{ color: 'var(--amber-ink)' }}>Work</b> Apply to product roles
            </span>
            <span className="xsmall muted">The work goes in the levels below. This level is only the finish line.</span>
          </Card>
          {path && (
            <Card title="Counts toward">
              <span className="small">{path.name}</span>
              <span className="xsmall muted">Its progress rolls up from this goal.</span>
            </Card>
          )}
        </>
      }
    >
      <div className="stack-sm">
        <span className="label">Kind of goal</span>
        <span className="small">
          {kind}
          {goal.type === 'number' && goal.target_date ? ` by ${shortDate(goal.target_date)}` : ''}
        </span>
        {goal.type === 'number' && <span className="xsmall muted">Change the target or its path from the goal's page.</span>}
      </div>
      <label className="field">
        Done means
        <textarea rows={2} value={doneMeans} onChange={(e) => setDoneMeans(e.target.value)} placeholder="e.g. Signed offer for a technical AI product owner role" />
        <span className="xsmall muted" style={{ fontWeight: 400 }}>You'll know it on the day: yes or no.</span>
      </label>
      {goal.type !== 'number' && (
        <div className="stack-sm">
          <span className="label">Count along the way (optional)</span>
          {existingTotals.map((m) => {
            const linked = m.count_action_id ? view.action(m.count_action_id) : undefined;
            return (
              <div key={m.id} className="ladder-total-row">
                <b className="small">{m.title}</b>
                <span className="xsmall muted">
                  by {shortDate(m.due_date)} · {linked ? `counted from “${linked.title}”` : 'counted once you add a Count task'}
                </span>
              </div>
            );
          })}
          {newTotals.map((t, i) => (
            <input
              key={i}
              className="input"
              value={t}
              aria-label="A running total, starting with the number"
              placeholder="e.g. 150 applications"
              onChange={(e) => setNewTotals(newTotals.map((x, j) => (j === i ? e.target.value : x)))}
            />
          ))}
          {newTotals.some((t) => t.trim() && leadingNumber(t) == null) && <span className="xsmall" style={{ color: 'var(--amber-ink)' }}>Start it with the number, like "150 applications".</span>}
          <button type="button" className="link-btn small" style={{ alignSelf: 'flex-start' }} onClick={() => setNewTotals([...newTotals, ''])}>
            + Add a running total
          </button>
          <span className="xsmall muted">Every level below can then be checked against a number. Today: {goalTotal(data, goal, today)?.now ?? 0} so far.</span>
        </div>
      )}
      <label className="field">
        Why it matters
        <textarea rows={2} value={why} onChange={(e) => setWhy(e.target.value)} placeholder="e.g. Turn delivery experience into owning the product" />
      </label>
    </Shell>
  );
}

// ---------- 3 months, 1 month, this week ----------

function LevelStep(props: StepProps & { level: TargetLevel }) {
  const { goal, plan, p, level, go, saturday } = props;
  const { data, today, commit } = useStore();
  const view = useView();
  const node = p[level];
  const end = periodEnd(p, node);
  const parentLevel = level === 'quarter' ? null : level === 'month' ? 'quarter' : 'month';
  const parents = parentLevel ? targetsAt(data, goal.id, plan.id, parentLevel, p[parentLevel].start).filter((s) => s.target_note.trim() || s.target_value != null) : [];
  const existing = targetsAt(data, goal.id, plan.id, level, node.start);
  const [drafts, setDrafts] = useState<TargetDraft[]>(() => (existing.length ? draftsFrom(existing) : [blankTarget(parents[0]?.id ?? null)]));
  const [curve, setCurve] = useState<PaceCurve>(curveOf(goal));
  const total = goalTotal(data, goal, today);
  // Suggestions follow the pace you pick right now.
  const suggestions = useMemo(() => suggestionsFor(view, { ...goal, pace_curve: curve }, plan, level, p, parents), [view, goal, curve, plan, level, p, parents]);
  const used = new Set(drafts.map((d) => d.text.trim().toLowerCase()));
  const open = suggestions.filter((s) => !used.has(s.text.trim().toLowerCase()));
  const nextStep: LadderStep = level === 'quarter' ? 'month' : level === 'month' ? 'week' : 'tasks';
  const filled = drafts.filter((d) => d.text.trim() || d.value != null).length;

  function useSuggestion(s: (typeof suggestions)[number]) {
    const fresh: TargetDraft = { id: crypto.randomUUID(), text: s.text, doneMeans: s.doneMeans, value: s.value, parentId: s.parentId };
    const blank = drafts.findIndex((d) => !d.text.trim() && d.value == null);
    if (blank >= 0) setDrafts(drafts.map((d, i) => (i === blank ? { ...fresh, id: d.id } : d)));
    else if (drafts.length < MAX_TARGETS) setDrafts([...drafts, fresh]);
  }

  function save() {
    const ops: Op[] = opsSaveTargets(data, goal, plan, level, node, drafts);
    if (level === 'quarter' && curve !== curveOf(goal)) ops.push(...opsUpdateGoal(goal, { pace_curve: curve }));
    commit(ops);
    go(nextStep);
  }

  const kicker =
    level === 'quarter' ? `Step 2 of 5 · Checkpoint · ${shortDate(end)}` : level === 'month' ? `Step 3 of 5 · If you started Monday · ${shortDate(end)}` : `Step 4 of 5 · Week of ${shortDate(p.monday)} · by Sunday ${shortDate(addDays(p.monday, 6))}`;
  const title = level === 'quarter' ? 'Halfway there, what has to be true?' : level === 'month' ? `What would be done by ${shortDate(end)}?` : saturday ? 'Set next week from the month' : 'What will you have by Sunday?';
  const sub =
    level === 'quarter'
      ? goal.type === 'finish'
        ? `A finish can't be half done, so name what you'd see on ${shortDate(end)} if you were on track.`
        : `Name what you'd see on ${shortDate(end)} if you were on track.`
      : level === 'month'
        ? 'Count only what fits in the hours you really have this month.'
        : saturday
          ? "Suggested from what's left this month. Keep, change or drop each one."
          : 'Three or fewer. Each one moves a month target, and the arrow shows which.';
  const contextLabel = level === 'quarter' ? `From your 6-month goal · ${shortDate(p.end)}` : level === 'month' ? `From your checkpoint · ${shortDate(periodEnd(p, p.quarter))}` : `From this month · ${shortDate(periodEnd(p, p.month))}`;
  const contextLines = level === 'quarter' ? [goal.done_means.trim() || goal.title, ...(total ? [`${total.target} ${total.unit}`] : [])] : parents.map((s) => targetText(goal, s));

  return (
    <Shell
      {...props}
      kicker={kicker}
      title={title}
      sub={sub}
      context={<ContextCard label={contextLabel} lines={contextLines} />}
      aside={<LevelAside goal={goal} plan={plan} p={p} level={level} drafts={drafts} />}
      nextLabel={level === 'quarter' ? 'Next: this month' : level === 'month' ? 'Next: this week' : saturday ? "Next: next week's tasks" : 'Next: tasks for this week'}
      onNext={save}
    >
      {level === 'week' && <LastWeek goal={goal} plan={plan} p={p} show={saturday} />}
      {level === 'quarter' && (total || goal.type === 'number') && <PacePicker goal={goal} p={p} curve={curve} setCurve={setCurve} total={total?.target ?? null} unit={total?.unit ?? goal.unit ?? ''} />}
      {open.length > 0 && filled < MAX_TARGETS && (
        <div className="stack-sm">
          <span className="label">Suggested</span>
          <div className="ladder-suggestions">
            {open.map((s) => (
              <div key={s.key} className="ladder-suggestion">
                <span className="stack-sm" style={{ gap: 2, minWidth: 0 }}>
                  <b className="small">{s.text}</b>
                  <span className="xsmall muted">{s.why}</span>
                </span>
                <button type="button" className="btn small" onClick={() => useSuggestion(s)}>
                  Use this
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
      <div className="stack-sm">
        <span className="label">
          By {shortDate(level === 'week' ? addDays(p.monday, 6) : end)} · up to {MAX_TARGETS}
        </span>
        <TargetsEditor goal={goal} level={level} drafts={drafts} setDrafts={setDrafts} parents={parents} total={total?.unit ?? null} />
      </div>
    </Shell>
  );
}

function TargetsEditor({ goal, level, drafts, setDrafts, parents, total }: { goal: Goal; level: TargetLevel; drafts: TargetDraft[]; setDrafts: (d: TargetDraft[]) => void; parents: PlanStep[]; total: string | null }) {
  const placeholder = level === 'quarter' ? 'e.g. Past round one with 3 companies' : level === 'month' ? 'e.g. First PRD drafted' : 'e.g. Resume rewritten for product roles';
  const change = (i: number, patch: Partial<TargetDraft>) => setDrafts(drafts.map((d, j) => (j === i ? { ...d, ...patch } : d)));
  const showValue = goal.type === 'number' || !!total;
  return (
    <div className="ladder-targets">
      {drafts.map((d, i) => (
        <div key={d.id} className="ladder-target">
          <span className="ladder-num" aria-hidden="true">{i + 1}</span>
          <div className="ladder-target-body">
            <label className="field">
              <span className="sr-only">Target {i + 1}</span>
              <input value={d.text} onChange={(e) => change(i, { text: e.target.value })} placeholder={placeholder} aria-label={`${LEVEL_NAME[level]} target ${i + 1}`} />
            </label>
            <input className="input ladder-done-input" value={d.doneMeans} onChange={(e) => change(i, { doneMeans: e.target.value })} placeholder="Done means… (optional)" aria-label={`Done means, target ${i + 1}`} />
            <div className="row-start" style={{ gap: 10 }}>
              {showValue && (
                <label className="xsmall muted row-start" style={{ gap: 6 }}>
                  {goal.type === 'number' ? `Reading (${goal.unit ?? ''})` : `Running total (${total})`}
                  <input
                    className="input ladder-value-input"
                    inputMode="decimal"
                    value={d.value ?? ''}
                    onChange={(e) => change(i, { value: e.target.value.trim() === '' || !Number.isFinite(Number(e.target.value)) ? null : Number(e.target.value) })}
                  />
                </label>
              )}
              {parents.length > 0 && (
                <label className="xsmall muted row-start" style={{ gap: 6 }}>
                  <Icon name="up" size={12} stroke={2.2} />
                  Moves
                  <select className="input ladder-parent-select" value={d.parentId ?? ''} onChange={(e) => change(i, { parentId: e.target.value || null })}>
                    <option value="">Nothing above</option>
                    {parents.map((s) => (
                      <option key={s.id} value={s.id}>
                        {targetText(goal, s).slice(0, 60)}
                      </option>
                    ))}
                  </select>
                </label>
              )}
            </div>
          </div>
          <button type="button" className="icon-btn" aria-label={`Remove target ${i + 1}`} onClick={() => setDrafts(drafts.filter((_, j) => j !== i))}>
            <Icon name="x" size={16} />
          </button>
        </div>
      ))}
      {drafts.length < MAX_TARGETS && (
        <button type="button" className="btn ghost small ladder-add" onClick={() => setDrafts([...drafts, blankTarget(parents[0]?.id ?? null)])}>
          <Icon name="plus" size={16} /> Add a target
        </button>
      )}
    </div>
  );
}

function PacePicker({ goal, p, curve, setCurve, total, unit }: { goal: Goal; p: LadderPeriods; curve: PaceCurve; setCurve: (c: PaceCurve) => void; total: number | null; unit: string }) {
  const months = total ? monthlyAmounts(total, curve, p.start, p.end) : [];
  const max = Math.max(1, ...months.map((m) => m.amount));
  const checkpoint = periodEnd(p, p.quarter);
  const byCheckpoint = total ? totalBy(total, curve, p.start, p.end, checkpoint) : null;
  return (
    <div className="stack-sm">
      <span className="label">Pace</span>
      {goal.type === 'number' ? (
        <span className="small muted">A number goal follows its path (set on the goal's page). The suggestions below read from it.</span>
      ) : (
        <>
          <div className="seg ladder-curve" role="radiogroup" aria-label="How the work is spread">
            {PACE_CURVES.map((c) => (
              <button key={c.id} type="button" role="radio" aria-checked={curve === c.id} onClick={() => setCurve(c.id)}>
                {c.label}
              </button>
            ))}
          </div>
          <span className="xsmall muted">{PACE_CURVES.find((c) => c.id === curve)!.hint}</span>
          {months.length > 0 && (
            <div className="card ladder-card">
              <div className="row-between" style={{ flexWrap: 'wrap' }}>
                <b className="small">
                  {unit[0]?.toUpperCase()}
                  {unit.slice(1)} by month
                </b>
                <span className="xsmall muted">
                  {byCheckpoint != null ? `${byCheckpoint} by ${shortDate(checkpoint)} · ` : ''}
                  {total} by {shortDate(p.end)}
                </span>
              </div>
              <div className="ladder-bars" role="img" aria-label={months.map((m) => `${m.month}: ${m.amount}`).join(', ')}>
                {months.map((m) => (
                  <span key={m.from} className="ladder-bar-col">
                    <b className="xsmall">{m.amount}</b>
                    <span className="ladder-bar" style={{ height: `${Math.max(4, Math.round((m.amount / max) * 100))}px`, background: m.from <= checkpoint ? 'var(--accent)' : 'var(--fill-strong)' }} />
                    <span className="xsmall muted">{m.month}</span>
                  </span>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

/** The right-hand column of a level: what else needs your hours, and whether this level fits. */
function LevelAside({ goal, plan, p, level, drafts }: { goal: Goal; plan: Plan; p: LadderPeriods; level: TargetLevel; drafts: TargetDraft[] }) {
  const view = useView();
  const hours = hoursFor(view, goal, p.monday);
  if (level === 'quarter') {
    const others = othersOverRange(view, goal, p.monday, periodEnd(p, p.quarter)).slice(0, 5);
    return (
      <>
        <Card title={`Also in these 3 months`}>
          {others.length === 0 && <span className="small muted">No other goal has tasks planned yet.</span>}
          {others.map((o) => (
            <div key={o.goal.id} className="row-between small">
              <span className="row-start" style={{ gap: 8 }}>
                <span className="dot" style={{ background: o.goal.color }} />
                {o.goal.title}
              </span>
              <span className="muted">
                {hoursText(o.minutes)} a week{o.starts ? ` from ${shortDate(o.starts)}` : ''}
              </span>
            </div>
          ))}
          <span className="xsmall muted">You have about {hoursText(hours.available)} a week (Settings).</span>
        </Card>
        <Tip>For something you finish, name what you'd see halfway if you were on track. Keep, adjust or drop is decided at the checkpoint.</Tip>
      </>
    );
  }
  if (level === 'month') {
    const rest = hours.others.slice(3).reduce((s, o) => s + o.minutes, 0);
    const parts = [
      ...hours.others.slice(0, 3).map((o) => ({ name: o.goal.title, m: o.minutes, color: 'var(--fill-strong)' })),
      ...(rest ? [{ name: `${hours.others.length - 3} other goal${hours.others.length - 3 === 1 ? '' : 's'}`, m: rest, color: 'var(--fill-strong)' }] : []),
      ...(hours.loose ? [{ name: 'No goal', m: hours.loose, color: 'var(--track)' }] : []),
    ];
    const total = Math.max(1, hours.available);
    return (
      <Card title={`Your ${hoursText(hours.available)} a week`}>
        <div className="ladder-stack" role="img" aria-label="How your week's hours are shared">
          {parts.map((x) => (
            <span key={x.name} style={{ flexGrow: x.m / total, background: x.color }} />
          ))}
          <span style={{ flexGrow: hours.left / total, background: 'var(--accent)' }} />
        </div>
        {parts.map((x) => (
          <div key={x.name} className="row-between xsmall ladder-legend-row">
            <span>{x.name}</span>
            <b>{hoursText(x.m)}</b>
          </div>
        ))}
        <div className="row-between xsmall ladder-legend-row">
          <span style={{ color: 'var(--accent-ink)', fontWeight: 600 }}>Left for this goal</span>
          <b>{hoursText(hours.left)}</b>
        </div>
        <span className="xsmall muted">
          {hours.left === 0 ? 'Other goals already fill your hours. Trim one, or count on more time in Settings, before adding here. ' : `This goal has ${hoursText(hours.mine)} planned the week of ${shortDate(p.monday)}. `}
          From Settings → minutes per weekday, and every goal's tasks that week.
        </span>
      </Card>
    );
  }
  const set = drafts.filter((d) => d.text.trim()).length;
  return (
    <>
      <Meter
        label="This goal this week"
        right={hours.left ? `${hoursText(hours.mine)} of ${hoursText(hours.left)}` : `${hoursText(hours.mine)} · no hours left`}
        share={hours.left ? hours.mine / hours.left : hours.mine ? 1 : 0}
        ok={hours.mine <= hours.left}
        note={hours.mine === 0 ? `Nothing planned yet for ${set ? 'these goals' : 'this week'}. You'll put each task on a day next.` : "Planned so far. You'll add tasks and place them on days next."}
      />
      <Tip>A week goal says what you'll have, not what you'll do. The doing goes in the tasks.</Tip>
    </>
  );
}

/** Saturday: how last week's targets went, and where the month stands. */
function LastWeek({ goal, plan, p, show }: { goal: Goal; plan: Plan; p: LadderPeriods; show: boolean }) {
  const { data, today, commit } = useStore();
  const view = useView();
  const toast = useToast();
  const prevMonday = addDays(p.monday, -7);
  const prev = ladderPeriods(view, goal, plan, prevMonday);
  const last = targetsAt(data, goal.id, plan.id, 'week', prev.week.start).filter((s) => s.target_note.trim() || s.target_value != null);
  const total = goalTotal(data, goal, today);
  const month = targetsAt(data, goal.id, plan.id, 'month', p.month.start).find((s) => s.target_value != null);
  if (!show && last.length === 0) return null;
  if (last.length === 0 && !total) return null;
  const review = data.reviews.find((r) => r.kind === 'weekly' && r.period_start <= prevMonday && r.period_end >= prevMonday && r.status === 'done');
  const result = review?.goal_results?.find((r) => r.goal_id === goal.id)?.result;
  return (
    <div className="ladder-lastweek">
      {last.length > 0 && (
        <div className="card ladder-card">
          <div className="row-between">
            <b className="small">Last week, as it stands</b>
            {result && <span className={`pill ${result === 'hit' ? 'ahead' : result === 'partly' ? 'on_track' : 'behind'}`}>{result === 'hit' ? 'Hit' : result === 'partly' ? 'Partly' : 'Missed'}</span>}
          </div>
          {last.map((s) => (
            <button
              key={s.id}
              type="button"
              className="ladder-tick-row"
              onClick={() => {
                commit(opsToggleTarget(s));
                toast(s.completed_at ? 'Reopened' : 'Marked done', () => commit([{ kind: 'update', collection: 'planSteps', id: s.id, patch: { completed_at: s.completed_at } }]));
              }}
            >
              <span className={`ring ${s.completed_at ? 'done' : ''}`} style={{ width: 22, height: 22 }}>
                {s.completed_at && <Icon name="check" size={12} stroke={3.2} />}
              </span>
              <span className="small" style={s.completed_at ? { color: 'var(--muted)' } : undefined}>
                {targetText(goal, s)}
              </span>
            </button>
          ))}
        </div>
      )}
      {total && (
        <Meter
          label={`${shortDate(periodEnd(p, p.month))} · ${total.unit}`}
          right={`${total.now} of ${month ? Number(month.target_value) : '?'}`}
          share={month ? total.now / Math.max(1, Number(month.target_value)) : 0}
          ok={true}
          note={total.actionId ? undefined : `Not counted yet: add a Count task (it adds to ${total.target} ${total.unit}).`}
        />
      )}
    </div>
  );
}

// ---------- The week's tasks ----------

function TasksStep(props: StepProps) {
  const { goal, plan, p, go } = props;
  const { data, today, commit } = useStore();
  const view = useView();
  const toast = useToast();
  const targets = ladderTargets(data, goal, plan, p).week;
  const [drafts, setDraftsState] = useState<TaskDraft[]>(() => loadTaskDrafts(goal.id, p.monday));
  const [editing, setEditing] = useState<TaskDraft | null>(null);
  const [kept, setKept] = useState<ISODate[]>([]);
  const setDrafts = (next: TaskDraft[]) => {
    setDraftsState(next);
    saveTaskDrafts(goal.id, p.monday, next);
  };
  const chips = weekChips(view, goal, p.monday, targets, drafts);
  const available = data.profile.available_minutes;
  const placed = chips.map((c) => ({ key: c.key, taskKey: c.taskKey, date: c.date, minutes: c.minutes, movable: !!c.draftKey }));
  const load = weekLoad(p.monday, placed, available);
  const fix = suggestLoadFix(p.monday, placed, available, today > p.monday ? today : p.monday, kept);
  const fixChip = fix ? chips.find((c) => c.key === fix.key) : undefined;
  const mineMinutes = chips.filter((c) => c.mine).reduce((s, c) => s + c.minutes, 0);
  const hours = hoursFor(view, goal, p.monday);
  const budget = hours.left;
  const running = view
    .actionsForGoal(goal.id)
    .filter((a) => !a.archived_at && chips.some((c) => c.actionId === a.id));

  function applyFix() {
    if (!fix || !fixChip?.draftKey) return;
    const from = weekdayOf(fix.from);
    const to = weekdayOf(fix.to);
    setDrafts(drafts.map((d) => (d.key === fixChip.draftKey ? { ...d, days: [...d.days.filter((x) => x !== from), to].sort((a, b) => a - b) } : d)));
  }

  function moveDraft(draftKey: string, fromDay: number, toDay: number) {
    const d = drafts.find((x) => x.key === draftKey);
    if (!d || fromDay === toDay || d.days.includes(toDay)) return;
    setDrafts(drafts.map((x) => (x.key === draftKey ? { ...x, days: [...x.days.filter((y) => y !== fromDay), toDay].sort((a, b) => a - b) } : x)));
  }

  function saveDraft(d: TaskDraft) {
    const exists = drafts.some((x) => x.key === d.key);
    setDrafts(exists ? drafts.map((x) => (x.key === d.key ? d : x)) : [...drafts, d]);
    setEditing(null);
  }

  return (
    <Shell
      {...props}
      kicker={`Step 5 of 5 · ${shortDate(p.monday)} – ${shortDate(addDays(p.monday, 6))}`}
      title="What gets you there?"
      sub="Each week goal gets the tasks that make it happen, each on a day with minutes. On a computer, drag a task to another day."
      nextLabel="Review the plan"
      onNext={() => go('review')}
    >
      {targets.length === 0 && (
        <div className="banner info">
          <span>No week goals yet. Tasks can still go in, or go back and set what you'll have by Sunday.</span>
          <button type="button" className="link-btn small" onClick={() => go('week')}>
            Set the week
          </button>
        </div>
      )}
      <div className="ladder-legend">
        {targets.map((t, i) => (
          <span key={t.id} className="row-start xsmall" style={{ gap: 6 }}>
            <span className="ladder-num small-num" style={{ background: TARGET_COLORS[i] }}>{i + 1}</span>
            {targetText(goal, t)}
          </span>
        ))}
        <span className="row-start xsmall muted" style={{ gap: 6 }}>
          <span className="ladder-other-swatch" />
          Other goals
        </span>
      </div>

      {fix && fixChip && (
        <div className="ladder-fix" role="status">
          <span className="small">
            <b>
              {WEEKDAY_NAMES[weekdayOf(fix.from) - 1]} is {fix.over} min over.
            </b>{' '}
            Move "{fixChip.title}" ({fix.minutes} m) to {WEEKDAY_NAMES[weekdayOf(fix.to) - 1]}, which has room?
          </span>
          <span className="row-start" style={{ gap: 8 }}>
            <button type="button" className="btn small ladder-fix-go" onClick={applyFix}>
              Move to {WEEKDAY_NAMES[weekdayOf(fix.to) - 1]}
            </button>
            <button type="button" className="btn small ghost" onClick={() => setKept([...kept, fix.from])}>
              Keep it
            </button>
          </span>
        </div>
      )}

      <WeekGrid p={p} chips={chips} load={load} today={today} onEdit={(key) => setEditing(drafts.find((d) => d.key === key) ?? null)} onAdd={(day) => setEditing(blankTask(targets.length ? 0 : null, day))} onMove={moveDraft} />
      <WeekBars p={p} load={load} chips={chips} />

      <div className="stack-sm">
        <span className="label">Tasks by week goal</span>
        {[...targets.map((t, i) => ({ t, i })), { t: null as PlanStep | null, i: -1 }].map(({ t, i }) => {
          const mine = drafts.filter((d) => (t ? d.target === i : d.target == null || d.target >= targets.length));
          const linked = running.filter((a) => (t ? a.step_id === t.id : !targets.some((x) => x.id === a.step_id)));
          if (!t && mine.length === 0 && linked.length === 0) return null;
          return (
            <div key={t?.id ?? 'none'} className="card ladder-group">
              <div className="row-start ladder-group-head">
                {t ? <span className="ladder-num small-num" style={{ background: TARGET_COLORS[i] }}>{i + 1}</span> : null}
                <b className="small">{t ? targetText(goal, t) : 'Not tied to a week goal'}</b>
              </div>
              {mine.map((d) => (
                <button key={d.key} type="button" className="ladder-task-row" onClick={() => setEditing(d)}>
                  <span className="stack-sm" style={{ gap: 2, minWidth: 0 }}>
                    <span className="small strong">{d.title || 'Untitled task'}</span>
                    <span className="xsmall muted">
                      {daysLabel(d.days)} · {d.repeat === 'week' ? (d.days.length === 1 ? 'one-off' : 'this week') : d.repeat === 'month' ? `repeats to ${shortDate(periodEnd(p, p.month))}` : 'no end date'}
                      {d.kind === 'count' ? ` · +${d.count ?? 1} to the total each time` : ''}
                    </span>
                  </span>
                  <b className="small">{d.minutes} m</b>
                </button>
              ))}
              {linked.map((a) => (
                <div key={a.id} className="ladder-task-row running">
                  <span className="stack-sm" style={{ gap: 2, minWidth: 0 }}>
                    <span className="small">{a.title}</span>
                    <span className="xsmall muted">Already running · {daysLabel(chips.filter((c) => c.actionId === a.id).map((c) => weekdayOf(c.date)))}</span>
                  </span>
                  {targets.length > 0 && (
                    <select
                      className="input ladder-parent-select"
                      aria-label={`Which week goal "${a.title}" serves`}
                      value={a.step_id && targets.some((x) => x.id === a.step_id) ? a.step_id : ''}
                      onChange={(e) => commit(opsLinkTask(a, e.target.value || null))}
                    >
                      <option value="">No week goal</option>
                      {targets.map((x, j) => (
                        <option key={x.id} value={x.id}>
                          {j + 1}. {targetText(goal, x).slice(0, 40)}
                        </option>
                      ))}
                    </select>
                  )}
                </div>
              ))}
              {t && (
                <button type="button" className="link-btn small ladder-add-task" onClick={() => setEditing(blankTask(i))}>
                  + Add a task
                </button>
              )}
            </div>
          );
        })}
        {targets.length === 0 && (
          <button type="button" className="btn ghost small" style={{ alignSelf: 'flex-start' }} onClick={() => setEditing(blankTask(null))}>
            <Icon name="plus" size={16} /> Add a task
          </button>
        )}
      </div>
      <span className="xsmall muted">
        {drafts.length} new task{drafts.length === 1 ? '' : 's'} · {hoursText(mineMinutes)} for this goal this week{budget ? ` of about ${hoursText(budget)} you have for it` : ''}. Nothing is saved until you start the plan.
      </span>
      {editing && <TaskDraftSheet draft={editing} goal={goal} targets={targets} p={p} onClose={() => setEditing(null)} onSave={saveDraft} onRemove={(key) => { setDrafts(drafts.filter((d) => d.key !== key)); setEditing(null); toast('Task removed from the plan'); }} />}
    </Shell>
  );
}

/** The week as seven columns of tasks (on a computer). Your planned tasks can be dragged to another day. */
function WeekGrid({ p, chips, load, today, onEdit, onAdd, onMove }: { p: LadderPeriods; chips: WeekChip[]; load: ReturnType<typeof weekLoad>; today: ISODate; onEdit: (draftKey: string) => void; onAdd: (day: number) => void; onMove: (draftKey: string, from: number, to: number) => void }) {
  const [over, setOver] = useState<number | null>(null);
  return (
    <div className="ladder-grid-wrap only-wide">
      <div className="ladder-grid">
        {load.map((day, i) => {
          const weekday = i + 1;
          const gone = day.date < today;
          const items = chips.filter((c) => c.date === day.date).sort((a, b) => Number(b.mine) - Number(a.mine) || (a.target ?? 9) - (b.target ?? 9));
          return (
            <div
              key={day.date}
              className={`ladder-day${day.over ? ' over' : ''}${over === weekday ? ' drop' : ''}${gone ? ' gone' : ''}`}
              onDragOver={(e) => {
                if (gone) return;
                e.preventDefault();
                setOver(weekday);
              }}
              onDragLeave={() => setOver(null)}
              onDrop={(e) => {
                e.preventDefault();
                setOver(null);
                const [key, from] = String(e.dataTransfer.getData('text/plain')).split('|');
                if (key && from && !gone) onMove(key, Number(from), weekday);
              }}
            >
              <div className="ladder-day-head">
                <b className="small">
                  {WEEKDAY_NAMES[i]} <span className="muted" style={{ fontWeight: 400 }}>{shortDate(day.date).replace(/^\w+ /, '')}</span>
                </b>
                <span className="xsmall" style={day.over ? { color: 'var(--amber-ink)', fontWeight: 600 } : { color: 'var(--muted)' }}>
                  {day.over ? `${day.over} m over` : `${day.planned} of ${day.available} m`}
                </span>
                <span className="ladder-meter thin">
                  <span style={{ width: `${day.available ? Math.min(100, (day.planned / day.available) * 100) : day.planned ? 100 : 0}%`, background: day.over ? 'var(--amber-bar)' : 'var(--accent)' }} />
                </span>
              </div>
              {items.map((c) =>
                c.mine ? (
                  <button
                    key={c.key}
                    type="button"
                    className={`ladder-chip${c.draftKey ? '' : ' running'}`}
                    style={{ background: c.target != null ? TARGET_FILLS[c.target] : 'var(--fill)' }}
                    draggable={!!c.draftKey}
                    onDragStart={(e) => e.dataTransfer.setData('text/plain', `${c.draftKey}|${weekday}`)}
                    onClick={() => c.draftKey && onEdit(c.draftKey)}
                    title={c.draftKey ? 'Drag to another day, or tap to edit' : 'Already running'}
                  >
                    <span className="xsmall row-start" style={{ gap: 5, color: c.target != null ? TARGET_COLORS[c.target] : 'var(--muted)', fontWeight: 600 }}>
                      {c.target != null && <span className="ladder-num tiny-num" style={{ background: TARGET_COLORS[c.target] }}>{c.target + 1}</span>}
                      {c.minutes} m{c.draftKey ? '' : ' · running'}
                    </span>
                    <span className="small">{c.title}</span>
                  </button>
                ) : (
                  <span key={c.key} className="ladder-chip other">
                    {c.title} · {c.minutes} m
                  </span>
                ),
              )}
              {!gone && (
                <button type="button" className="ladder-day-add" aria-label={`Add a task on ${WEEKDAY_NAMES[i]}`} onClick={() => onAdd(weekday)}>
                  <Icon name="plus" size={14} /> Add
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** The week as bars (on a phone): this goal, other goals, and your hours, day by day. */
function WeekBars({ p, load, chips }: { p: LadderPeriods; load: ReturnType<typeof weekLoad>; chips: WeekChip[] }) {
  const max = Math.max(1, ...load.map((d) => Math.max(d.available, d.planned)));
  const h = 72;
  return (
    <div className="card ladder-card only-narrow">
      <div className="ladder-weekbars" role="img" aria-label={load.map((d, i) => `${WEEKDAY_NAMES[i]}: ${d.planned} of ${d.available} minutes`).join('; ')}>
        {load.map((d, i) => {
          const mine = chips.filter((c) => c.date === d.date && c.mine).reduce((s, c) => s + c.minutes, 0);
          const other = d.planned - mine;
          return (
            <span key={d.date} className="ladder-weekbar">
              <span className="ladder-weekbar-col" style={{ height: h }}>
                <span className="ladder-weekbar-cap" style={{ bottom: Math.round((d.available / max) * h) }} />
                <span style={{ height: Math.round((mine / max) * h), background: d.over ? 'var(--amber-bar)' : 'var(--accent)', borderRadius: '4px 4px 0 0' }} />
                <span style={{ height: Math.round((other / max) * h), background: 'var(--fill-strong)' }} />
              </span>
              <span className="xsmall" style={d.over ? { color: 'var(--amber-ink)', fontWeight: 600 } : { color: 'var(--muted)' }}>
                {d.over ? `+${d.over}m` : `${d.planned}/${d.available}`}
              </span>
              <b className="xsmall">
                {WEEKDAY_NAMES[i]![0]} <span className="muted" style={{ fontWeight: 400 }}>{Number(addDays(p.monday, i).slice(8))}</span>
              </b>
            </span>
          );
        })}
      </div>
      <div className="row-start xsmall muted" style={{ gap: 14, justifyContent: 'center' }}>
        <span className="row-start" style={{ gap: 5 }}>
          <span className="ladder-swatch" style={{ background: 'var(--accent)' }} />
          This goal
        </span>
        <span className="row-start" style={{ gap: 5 }}>
          <span className="ladder-swatch" style={{ background: 'var(--fill-strong)' }} />
          Other goals
        </span>
        <span className="row-start" style={{ gap: 5 }}>
          <span className="ladder-swatch line" />
          Your hours
        </span>
      </div>
    </div>
  );
}

function TaskDraftSheet({ draft, goal, targets, p, onClose, onSave, onRemove }: { draft: TaskDraft; goal: Goal; targets: PlanStep[]; p: LadderPeriods; onClose: () => void; onSave: (d: TaskDraft) => void; onRemove: (key: string) => void }) {
  const { data, today } = useStore();
  const [d, setD] = useState<TaskDraft>(draft);
  const total = goalTotal(data, goal, today);
  const isNew = !draft.title;
  const toggleDay = (day: number) => setD({ ...d, days: d.days.includes(day) ? d.days.filter((x) => x !== day) : [...d.days, day].sort((a, b) => a - b) });
  const ok = d.title.trim() !== '' && d.days.length > 0;
  return (
    <Sheet title={isNew ? 'New task' : 'Edit task'} onClose={onClose}>
      <div className="stack">
        <label className="field">
          What you'll do
          <input autoFocus value={d.title} onChange={(e) => setD({ ...d, title: e.target.value })} placeholder="e.g. Apply to 1 role" />
        </label>
        {targets.length > 0 && (
          <label className="field">
            For which week goal
            <select value={d.target ?? ''} onChange={(e) => setD({ ...d, target: e.target.value === '' ? null : Number(e.target.value) })}>
              {targets.map((t, i) => (
                <option key={t.id} value={i}>
                  {i + 1}. {targetText(goal, t)}
                </option>
              ))}
              <option value="">None of them</option>
            </select>
          </label>
        )}
        <div className="field">
          Which days
          <div className="row-start" style={{ gap: 6 }}>
            {WEEKDAY_NAMES.map((n, i) => {
              const day = i + 1;
              const gone = addDays(p.monday, i) < today;
              return (
                <button key={n} type="button" className="chip ladder-day-chip" aria-pressed={d.days.includes(day)} disabled={gone} onClick={() => toggleDay(day)}>
                  {n}
                </button>
              );
            })}
          </div>
        </div>
        <label className="field">
          Minutes each time
          <input inputMode="numeric" value={d.minutes} onChange={(e) => setD({ ...d, minutes: Math.max(0, Number(e.target.value.replace(/\D/g, '')) || 0) })} />
        </label>
        <div className="field">
          How long it runs
          <div className="seg" role="radiogroup" aria-label="How long it runs">
            {(
              [
                ['week', d.days.length === 1 ? 'Just this once' : 'This week only'],
                ['month', `To ${shortDate(periodEnd(p, p.month))}`],
                ['open', 'No end date'],
              ] as const
            ).map(([id, label]) => (
              <button key={id} type="button" role="radio" aria-checked={d.repeat === id} onClick={() => setD({ ...d, repeat: id })}>
                {label}
              </button>
            ))}
          </div>
        </div>
        {goal.type !== 'number' && (
          <label className="row-start small" style={{ gap: 10 }}>
            <input type="checkbox" checked={d.kind === 'count'} onChange={(e) => setD({ ...d, kind: e.target.checked ? 'count' : 'check', count: e.target.checked ? d.count ?? 1 : null })} />
            Counts toward {total ? `the ${total.unit} total` : 'a running total'}
            {d.kind === 'count' && (
              <input className="input ladder-value-input" inputMode="numeric" aria-label="How many each time" value={d.count ?? 1} onChange={(e) => setD({ ...d, count: Math.max(1, Number(e.target.value.replace(/\D/g, '')) || 1) })} />
            )}
            {d.kind === 'count' && <span className="muted">each time</span>}
          </label>
        )}
        <div className="row-between">
          {isNew ? (
            <span />
          ) : (
            <button type="button" className="btn danger small" onClick={() => onRemove(draft.key)}>
              Remove
            </button>
          )}
          <button type="button" className="btn primary" disabled={!ok} onClick={() => onSave({ ...d, title: d.title.trim() })}>
            {isNew ? 'Add task' : 'Save'}
          </button>
        </div>
      </div>
    </Sheet>
  );
}

// ---------- The plan on one page ----------

function ReviewStep(props: StepProps) {
  const { goal, plan, p, go, saturday } = props;
  const { data, today, commit } = useStore();
  const view = useView();
  const toast = useToast();
  const t = ladderTargets(data, goal, plan, p);
  const drafts = loadTaskDrafts(goal.id, p.monday);
  const chips = weekChips(view, goal, p.monday, t.week, drafts);
  const firstDay = today > p.monday ? today : p.monday;
  const firstChips = chips.filter((c) => c.mine && c.date === firstDay);
  const unplanned = unplannedGoals(view, goal.id).slice(0, 4);
  const reminder = data.profile.review_reminder !== false;
  const levels: { s: LadderStep; name: string; when: string; text: string }[] = [
    { s: 'season', name: '6 months', when: shortDate(p.end), text: goal.done_means.trim() || goal.title },
    { s: 'quarter', name: '3 months', when: shortDate(periodEnd(p, p.quarter)), text: t.quarter.map((x) => targetText(goal, x)).join(' · ') },
    { s: 'month', name: '1 month', when: shortDate(periodEnd(p, p.month)), text: t.month.map((x) => targetText(goal, x)).join(' · ') },
    { s: 'week', name: 'This week', when: shortDate(addDays(p.monday, 6)), text: t.week.map((x) => targetText(goal, x)).join(' · ') },
    {
      s: 'tasks',
      name: 'Tasks',
      when: `${shortDate(p.monday)} –`,
      text: `${chips.filter((c) => c.mine).length} on the calendar · ${hoursText(chips.filter((c) => c.mine).reduce((s, c) => s + c.minutes, 0))}${drafts.length ? ` · ${drafts.length} new` : ''}`,
    },
  ];
  const missing = levels.filter((l) => !l.text);

  function start() {
    const { ops, undo, made } = opsCommitTasks(data, goal, p, t.week, drafts, today);
    commit(ops);
    saveTaskDrafts(goal.id, p.monday, []);
    navigate(saturday ? '/review' : `/goals/${goal.id}`);
    toast(made ? `Plan started: ${made} task${made === 1 ? '' : 's'} on your days` : 'Plan saved', made ? () => commit(undo) : undefined);
  }

  return (
    <Shell
      {...props}
      kicker={goal.title}
      title="Your plan, top to bottom"
      sub="Every level answers to the one above it. Tap any level to change it."
      backTo="tasks"
      nextLabel={drafts.length ? 'Start the plan' : 'Done'}
      onNext={start}
      aside={
        <>
          {unplanned.length > 0 && (
            <Card title={`Not planned yet · ${unplanned.length} goal${unplanned.length === 1 ? '' : 's'}`}>
              {unplanned.map((g) => (
                <a key={g.id} className="row-between ladder-unplanned" href={href(`/goals/${g.id}/plan`)}>
                  <span className="row-start small" style={{ gap: 8 }}>
                    <span className="dot" style={{ background: g.color }} />
                    {g.title}
                  </span>
                  <span className="xsmall" style={{ color: 'var(--accent-ink)', fontWeight: 600 }}>Plan</span>
                </a>
              ))}
            </Card>
          )}
        </>
      }
    >
      <div className="ladder-cascade">
        {levels.map((l, i) => (
          <button key={l.s} type="button" className={`ladder-cascade-item${l.text ? '' : ' empty'}`} onClick={() => go(l.s)}>
            <span className={`ladder-dot${l.text ? ' done' : ''}`} aria-hidden="true">
              {l.text && <Icon name="check" size={12} stroke={3} />}
            </span>
            {i < levels.length - 1 && <span className="ladder-cascade-stem" aria-hidden="true" />}
            <span className="ladder-cascade-text">
              <span className="mono" style={{ color: 'var(--accent-ink)' }}>
                {l.name} · {l.when}
              </span>
              <span className="small strong">{l.text || 'Not set yet: tap to add'}</span>
            </span>
          </button>
        ))}
      </div>
      {missing.length > 0 && <span className="xsmall" style={{ color: 'var(--amber-ink)' }}>{missing.map((m) => m.name).join(', ')} {missing.length === 1 ? 'is' : 'are'} still empty. The plan works without, but each level is what the one below is checked against.</span>}
      <div className="ladder-two">
        <Card title={`${firstDay === today ? 'Today' : shortDate(firstDay)} on Today`}>
          {firstChips.length === 0 && <span className="small muted">Nothing for this goal that day.</span>}
          {firstChips.map((c) => (
            <span key={c.key} className="small">
              {c.title} · <span className="muted">{c.minutes} m</span>
            </span>
          ))}
        </Card>
        <button type="button" className="card ladder-switch" aria-pressed={reminder} onClick={() => commit([{ kind: 'profile', patch: { review_reminder: !reminder } }])}>
          <span className="stack-sm" style={{ gap: 2 }}>
            <b className="small">Remind me to plan next week</b>
            <span className="xsmall muted">The weekend review push. The review opens next week's plan from this month.</span>
          </span>
          <span className={`ladder-toggle${reminder ? ' on' : ''}`} aria-hidden="true">
            <span />
          </span>
        </button>
      </div>
    </Shell>
  );
}

// Used by the weekly review and the goal page: the link that opens a week of the plan.
export function planHref(goalId: string, step: LadderStep, monday?: ISODate, fromReview = false): string {
  return `/goals/${goalId}/plan?step=${step}${monday ? `&week=${monday}` : ''}${fromReview ? '&from=review' : ''}`;
}
