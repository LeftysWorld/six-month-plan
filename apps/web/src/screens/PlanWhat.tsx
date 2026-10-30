import { useMemo, useState } from 'react';
import { addDays, daysBetween, shortDate, type GoalType } from '@six/core';
import { useStore } from '../data/store.tsx';
import { useView } from '../data/useView.ts';
import { fmt } from '../data/derive.ts';
import { newGoalPath } from '../data/newGoal.ts';
import { leadingNumber } from '../data/ladder.ts';
import { pathLetter, pathsOf } from '../data/paths.ts';
import { startsSoon, type GoalDraftInput } from '../data/ideaPlan.ts';
import { NumberInput } from '../components/ui.tsx';
import { WeightChart } from '../components/WeightChart.tsx';
import { Shell, useLadder, type StepProps } from './PlanGoal.tsx';

const TYPES: { value: GoalType; title: string; sub: string }[] = [
  { value: 'finish', title: 'Finish something', sub: 'A result, by a date' },
  { value: 'number', title: 'Reach a number', sub: 'Start, target, date' },
  { value: 'practice', title: 'Build a practice', sub: 'Show up, times a week' },
];

/**
 * Step 1 of making a goal: what it is, what's true on the last day, and when it runs. This is the
 * old Make a goal form without its week goal and first task (the plan's later steps do those).
 * Going on saves it to the idea's draft; the goal itself is made at the end of the plan.
 */
export function WhatStep(props: StepProps) {
  const { draft, saveDraft, idea } = useLadder();
  const { data, today } = useStore();
  const view = useView();
  const d = draft!;
  const [input, setInput] = useState<GoalDraftInput>(d.input);
  const set = (patch: Partial<GoalDraftInput>) => setInput((x) => ({ ...x, ...patch }));
  const [seasonName, setSeasonName] = useState(d.seasonName);
  const [totals, setTotals] = useState<string[]>(d.totals.length ? d.totals : ['']);
  const [more, setMore] = useState(false);

  const seasons = view.batches;
  const plan = seasons.find((p) => p.id === input.planId) ?? null;
  const seasonStart = plan?.start_date ?? today;
  const seasonEnd = plan?.end_date ?? addDays(today, 182);
  const blockDays = plan?.block_days ?? 28;
  const from = today < seasonStart ? seasonStart : today;
  const start = input.start && input.start > from ? input.start : from;
  const end = input.type === 'number' ? input.targetDate || seasonEnd : input.finish || seasonEnd;
  const horizon = daysBetween(start, end) + 1;
  const existing = plan ? view.goalsForPlan(plan.id) : [];
  const paths = pathsOf(data);
  const others = view.activeGoals;
  const path = useMemo(() => newGoalPath(input, start, blockDays), [input.type, input.baseline, input.target, input.targetDate, input.pathEdits, start, blockDays]); // eslint-disable-line react-hooks/exhaustive-deps

  const gaps: string[] = [];
  if (!input.title.trim()) gaps.push('a name');
  if (input.type === 'number' ? input.target == null || !input.targetDate || input.targetDate <= today : !input.doneMeans.trim()) gaps.push(input.type === 'number' ? 'a target and a date' : 'what done means');
  if (seasons.length > 0 && !plan) gaps.push('a season');
  const badTotal = totals.some((t) => t.trim() && leadingNumber(t) == null);

  function next() {
    if (gaps.length || badTotal) return;
    saveDraft({ ...d, input: { ...input, planId: plan?.id ?? '', title: input.title.trim() }, seasonName, totals: totals.map((t) => t.trim()).filter(Boolean), what: true }, 'quarter');
  }

  return (
    <Shell
      {...props}
      kicker={`Step 1 of 5 · By ${shortDate(end)}`}
      title="What is it, and what's true on the last day?"
      sub={'Write the result, not the work: “signed offer”, not “apply to jobs”. Then say when it runs.'}
      nextLabel="Next: 3-month checkpoint"
      onNext={next}
      nextDisabled={gaps.length > 0 || badTotal}
      backTo="start"
      aside={
        <>
          <div className="card ladder-card">
            <b className="small">Result or work?</b>
            <span className="small">
              <b style={{ color: 'var(--blue-ink)' }}>Result</b> Signed offer by {shortDate(end)}
            </span>
            <span className="small">
              <b style={{ color: 'var(--amber-ink)' }}>Work</b> Apply to product roles
            </span>
            <span className="xsmall muted">The work goes in the levels below. This level is only the finish line.</span>
          </div>
          <div className="card ladder-card">
            <b className="small">When</b>
            <span className="small">
              {shortDate(start)} – {shortDate(end)} · about {Math.max(1, Math.round(horizon / 7))} weeks
            </span>
            <span className="xsmall muted">{startsSoon(start, today) ? 'Starts this week or next: you plan its first week and tasks too.' : "Starts later: its first week and tasks are planned once it's up next."}</span>
          </div>
        </>
      }
    >
      <label className="field">
        Goal
        <input autoFocus={!input.title} value={input.title} onChange={(e) => set({ title: e.target.value })} placeholder="e.g. Land a technical AI product owner role" />
      </label>
      <div className="grid-3">
        {TYPES.map((t) => (
          <button key={t.value} type="button" className="choice" aria-pressed={input.type === t.value} onClick={() => set({ type: t.value })}>
            <b>{t.title}</b>
            <span>{t.sub}</span>
          </button>
        ))}
      </div>

      {input.type !== 'number' && (
        <label className="field">
          Done means · by {shortDate(end)}
          <textarea rows={2} value={input.doneMeans} onChange={(e) => set({ doneMeans: e.target.value })} placeholder="e.g. Signed offer for a technical AI product owner role" />
          <span className="xsmall muted" style={{ fontWeight: 400 }}>You'll know it on the day: yes or no.</span>
        </label>
      )}

      {input.type === 'number' && (
        <div className="stack">
          <div className="grid-2">
            <label className="field">
              What you measure
              <input value={input.measureName} onChange={(e) => set({ measureName: e.target.value })} placeholder="e.g. Body weight" />
            </label>
            <label className="field">
              Unit
              <input value={input.unit} onChange={(e) => set({ unit: e.target.value })} placeholder="e.g. lb" />
            </label>
          </div>
          <div className="grid-3">
            <NumberInput label="Starting point" value={input.baseline} onChange={(v) => set({ baseline: v })} placeholder="e.g. 190" />
            <NumberInput label="Target" value={input.target} onChange={(v) => set({ target: v })} placeholder="e.g. 160" />
            <label className="field">
              By
              <input type="date" value={input.targetDate} min={addDays(today, 7)} max={seasonEnd} onChange={(e) => set({ targetDate: e.target.value })} />
            </label>
          </div>
          {input.baseline == null && <span className="xsmall muted">Don't know your start yet? Leave it empty and log your first reading later.</span>}
          {path.length > 0 && input.baseline != null && (
            <div className="stack-sm">
              <div className="row-between small">
                <b>Suggested path</b>
                <span className="muted">
                  {fmt((input.target! - input.baseline) / Math.max(1, path.length))} {input.unit} every {Math.round(blockDays / 7)} weeks
                </span>
              </div>
              <WeightChart start={{ date: start, value: input.baseline }} path={path} readings={[]} range={{ start, end: input.targetDate }} today={today} unit={input.unit} color={input.color} controls={false} />
              <div className="grid-3">
                {path.map((p, i) => (
                  <NumberInput key={p.date} label={i === path.length - 1 ? `Goal · ${p.date.slice(5)}` : `Checkpoint ${i + 1} · ${p.date.slice(5)}`} value={p.value} onChange={(v) => v != null && set({ pathEdits: { ...input.pathEdits, [p.date]: v } })} />
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {input.type !== 'number' && (
        <div className="stack-sm">
          <span className="label">Count along the way (optional)</span>
          {totals.map((t, i) => (
            <input key={i} className="input" value={t} aria-label="A running total, starting with the number" placeholder="e.g. 150 applications" onChange={(e) => setTotals(totals.map((x, j) => (j === i ? e.target.value : x)))} />
          ))}
          {badTotal && <span className="xsmall" style={{ color: 'var(--amber-ink)' }}>Start it with the number, like "150 applications".</span>}
          <button type="button" className="link-btn small" style={{ alignSelf: 'flex-start' }} onClick={() => setTotals([...totals, ''])}>
            + Add a running total
          </button>
          <span className="xsmall muted">Every level below can then be checked against a number, and its suggestions follow your pace.</span>
        </div>
      )}

      <label className="field">
        Why it matters <span style={{ fontWeight: 400 }}>(one line for the hard days)</span>
        <input value={input.why} onChange={(e) => set({ why: e.target.value })} placeholder="e.g. Own the product, not just the delivery" />
      </label>

      {paths.length > 0 && (
        <div className="stack-sm">
          <span className="label">Which path is this a bet on?</span>
          <div className="chips" role="radiogroup" aria-label="Path">
            {paths.map((p) => (
              <button key={p.id} type="button" className="chip" role="radio" aria-checked={input.pathId === p.id} onClick={() => set({ pathId: input.pathId === p.id ? null : p.id })} style={{ display: 'inline-flex', alignItems: 'center', gap: 7 }}>
                <span className="dot" style={{ width: 7, height: 7, background: p.color }} />
                {pathLetter(data, p)} · {p.name}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="card stack ladder-card">
        <span className="label">When</span>
        {seasons.length === 0 ? (
          <label className="field">
            Your season starts today and runs six months · to {shortDate(seasonEnd)}
            <input value={seasonName} onChange={(e) => setSeasonName(e.target.value)} placeholder="e.g. Winter to summer" />
            <span className="xsmall muted" style={{ fontWeight: 400 }}>
              A season is the review calendar: month reviews, a 3-month checkpoint, a retrospective. Every goal has its own start and finish inside it.
            </span>
          </label>
        ) : seasons.length > 1 ? (
          <label className="field">
            Season
            <select value={input.planId} onChange={(e) => set({ planId: e.target.value, start: null, finish: null })}>
              {seasons.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                  {p.name.includes(shortDate(p.start_date)) ? '' : ` · ${shortDate(p.start_date)} – ${shortDate(p.end_date)}`}
                </option>
              ))}
            </select>
          </label>
        ) : (
          <span className="small muted">
            {plan?.name} · {shortDate(seasonStart)} – {shortDate(seasonEnd)}
          </span>
        )}
        {idea?.plan_id && idea.plan_id !== input.planId && seasons.some((p) => p.id === idea.plan_id) && <span className="xsmall muted">It was planned for {seasons.find((p) => p.id === idea.plan_id)!.name}; you're pulling it into {plan?.name}.</span>}
        <div className="grid-2">
          <label className="field">
            Starts <span style={{ fontWeight: 400 }}>(optional)</span>
            <input type="date" value={input.start ?? ''} min={from} max={end} onChange={(e) => set({ start: e.target.value || null })} />
            <span className="xsmall muted" style={{ fontWeight: 400 }}>
              Empty means {from === today ? 'today' : shortDate(from)}. Later for a course that begins in a month.
            </span>
          </label>
          {input.type !== 'number' && (
            <label className="field">
              Finish by <span style={{ fontWeight: 400 }}>(optional)</span>
              <input type="date" value={input.finish ?? ''} min={input.start || from} max={seasonEnd} onChange={(e) => set({ finish: e.target.value || null })} />
              <span className="xsmall muted" style={{ fontWeight: 400 }}>
                Empty means the end of the season. Earlier for an exam or a course.
              </span>
            </label>
          )}
        </div>
        {existing.length >= 3 && <div className="banner warn">{plan?.name} already has {existing.length} goals. Most people stick with 3–4 at a time.</div>}
      </div>

      <details open={more} onToggle={(e) => setMore((e.currentTarget as HTMLDetailsElement).open)}>
        <summary className="small" style={{ cursor: 'pointer', minHeight: 40, display: 'flex', alignItems: 'center' }}>
          More: dates to hit, prizes, a group
        </summary>
        <div className="stack" style={{ marginTop: 10 }}>
          {(input.type === 'finish' || input.type === 'number') && (
            <div className="stack-sm">
              <span className="label">{input.type === 'number' ? 'Dates to hit (10 lb down by Dec 13…)' : 'Dates to hit (modules, exam booking, exam day)'}</span>
              {input.milestones.map((m, i) => (
                <div key={i} className="grid-2">
                  <input className="input" aria-label={`Date to hit ${i + 1}`} placeholder={input.type === 'number' ? '10 lb down' : 'Exam booked'} value={m.title} onChange={(e) => set({ milestones: input.milestones.map((x, j) => (j === i ? { ...x, title: e.target.value } : x)) })} />
                  <input className="input" type="date" aria-label={`Day for date to hit ${i + 1}`} value={m.due_date} min={from} max={end} onChange={(e) => e.target.value && set({ milestones: input.milestones.map((x, j) => (j === i ? { ...x, due_date: e.target.value } : x)) })} />
                </div>
              ))}
              <button type="button" className="link-btn small" style={{ alignSelf: 'flex-start' }} onClick={() => set({ milestones: [...input.milestones, { title: '', due_date: addDays(input.milestones.at(-1)?.due_date ?? from, 28) }] })}>
                + Add a date
              </button>
            </div>
          )}
          <div className="grid-2">
            <label className="field">
              Prize when it's finished
              <input value={input.prize ?? ''} onChange={(e) => set({ prize: e.target.value })} placeholder="e.g. a weekend away" />
            </label>
            <label className="field">
              And if it's finished by {shortDate(end)}
              <input value={input.prizeOnTime ?? ''} onChange={(e) => set({ prizeOnTime: e.target.value })} placeholder="e.g. …plus the good one" />
            </label>
          </div>
          {idea?.group_id && data.groups.some((g) => g.id === idea.group_id) ? (
            <span className="small muted">Joins the {data.groups.find((g) => g.id === idea.group_id)!.name} group, like the rest of its ideas.</span>
          ) : (
            others.length > 0 && (
              <div className="stack-sm">
                <span className="xsmall muted">Group it with a goal it works with (optional):</span>
                <div className="chips" role="radiogroup" aria-label="Group with">
                  {others.map((g) => {
                    const on = input.groupWithGoalId === g.id;
                    return (
                      <button key={g.id} type="button" className="chip" role="radio" aria-checked={on} onClick={() => set({ groupWithGoalId: on ? null : g.id })} style={{ display: 'inline-flex', alignItems: 'center', gap: 7 }}>
                        <span className="dot" style={{ width: 7, height: 7, background: g.color }} />
                        {g.title}
                      </button>
                    );
                  })}
                </div>
              </div>
            )
          )}
        </div>
      </details>

      {gaps.length > 0 && <span className="xsmall muted">Still needs {gaps.join(', ')}.</span>}
    </Shell>
  );
}
