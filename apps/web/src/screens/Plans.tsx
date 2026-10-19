import { useState } from 'react';
import { addDays, daysBetween, planTotalWeeks, planWeekNumber, shortDate, type Plan } from '@six/core';
import { useStore } from '../data/store.tsx';
import { useView } from '../data/derive.ts';
import { opsCreatePlan } from '../data/ops.ts';
import { href, navigate } from '../router.ts';
import { PacePill } from '../components/ui.tsx';

/** Create a plan: name, start, end (defaults to six months). */
export function PlanForm({ onDone }: { onDone?: () => void }) {
  const { today, commit } = useStore();
  const [name, setName] = useState('My next six months');
  const [start, setStart] = useState(today);
  const [end, setEnd] = useState(addDays(today, 182));
  return (
    <form
      className="card stack"
      onSubmit={(e) => {
        e.preventDefault();
        if (!name.trim() || end <= start) return;
        const { ops, plan } = opsCreatePlan({ name, start, end });
        commit(ops);
        onDone?.();
        navigate(`/goals/new?plan=${plan.id}`);
      }}
    >
      <h2>New six-month plan</h2>
      <label className="field">
        Name
        <input value={name} onChange={(e) => setName(e.target.value)} required />
      </label>
      <div className="grid-2">
        <label className="field">
          Starts
          <input
            type="date"
            value={start}
            onChange={(e) => {
              setStart(e.target.value);
              setEnd(addDays(e.target.value, 182));
            }}
          />
        </label>
        <label className="field">
          Ends
          <input type="date" value={end} min={addDays(start, 7)} onChange={(e) => setEnd(e.target.value)} />
        </label>
      </div>
      <p className="xsmall muted" style={{ margin: 0 }}>
        Plans can overlap. Starting a new one never resets another.
      </p>
      <button className="btn primary" type="submit">
        Create plan and add a goal
      </button>
    </form>
  );
}

export function Plans() {
  const { data, today } = useStore();
  const [creating, setCreating] = useState(false);
  const live = data.plans.filter((p) => !p.archived_at);
  const active = live.filter((p) => p.start_date <= today && p.end_date >= today);
  const upcoming = live.filter((p) => p.start_date > today);
  const past = data.plans.filter((p) => p.archived_at || p.end_date < today);

  // Overlap strip: from the earliest start to the latest end.
  const all = [...active, ...upcoming];
  const min = all.reduce((m, p) => (p.start_date < m ? p.start_date : m), today);
  const max = all.reduce((m, p) => (p.end_date > m ? p.end_date : m), addDays(today, 30));
  const span = Math.max(1, daysBetween(min, max));
  const pct = (d: string) => (daysBetween(min, d) / span) * 100;

  return (
    <div className="stack">
      <div className="row-between">
        <h1 style={{ fontSize: 34 }}>Plans</h1>
        <button className="btn dark small" onClick={() => setCreating(!creating)}>
          {creating ? 'Cancel' : '+ New plan'}
        </button>
      </div>
      {creating && <PlanForm onDone={() => setCreating(false)} />}

      {all.length > 1 && (
        <div className="card tight stack-sm">
          <div style={{ position: 'relative', height: 18 * all.length + 6 }} role="img" aria-label="How your plans overlap in time">
            {all.map((p, i) => (
              <div
                key={p.id}
                title={p.name}
                style={{
                  position: 'absolute',
                  left: `${pct(p.start_date)}%`,
                  width: `${Math.max(2, pct(p.end_date) - pct(p.start_date))}%`,
                  top: i * 18,
                  height: 14,
                  borderRadius: 7,
                  background: p.start_date <= today ? 'var(--accent)' : 'var(--surface)',
                  border: p.start_date <= today ? 0 : '2px dashed var(--violet-ink)',
                }}
              />
            ))}
            <div style={{ position: 'absolute', left: `${pct(today)}%`, top: -4, bottom: -4, width: 2, background: 'var(--ink)' }} />
          </div>
          <div className="xsmall muted">Plans overlap. All of them feed Today; nothing resets.</div>
        </div>
      )}

      {active.length > 0 && <div className="section-label">Active</div>}
      {active.map((p) => (
        <PlanCard key={p.id} plan={p} />
      ))}
      {upcoming.length > 0 && <div className="section-label">Starting soon</div>}
      {upcoming.map((p) => (
        <PlanCard key={p.id} plan={p} />
      ))}
      {live.length === 0 && !creating && <PlanForm />}
      {past.length > 0 && (
        <details className="card tight">
          <summary className="small strong" style={{ cursor: 'pointer', minHeight: 32, display: 'flex', alignItems: 'center' }}>
            Archived and finished ({past.length})
          </summary>
          <div className="stack-sm" style={{ marginTop: 8 }}>
            {past.map((p) => (
              <a key={p.id} className="list-row" href={href(`/plans/${p.id}`)}>
                <span className="grow">{p.name}</span>
                <span className="xsmall muted">
                  {shortDate(p.start_date)} – {shortDate(p.end_date)}
                </span>
              </a>
            ))}
          </div>
        </details>
      )}
    </div>
  );
}

function PlanCard({ plan }: { plan: Plan }) {
  const { today } = useStore();
  const view = useView();
  const goals = view.goalsForPlan(plan.id);
  const started = plan.start_date <= today;
  const elapsed = Math.min(1, Math.max(0, daysBetween(plan.start_date, today) / Math.max(1, daysBetween(plan.start_date, plan.end_date))));
  const sixMonth = started ? view.horizons(plan).find((h) => h.key === 'plan')?.progress : undefined;
  const circumference = 2 * Math.PI * 19;
  return (
    <a className="card stack-sm" href={href(`/plans/${plan.id}`)} style={{ textDecoration: 'none', color: 'inherit' }}>
      <div className="row-between">
        <div>
          <div style={{ fontWeight: 600, fontSize: 17 }}>{plan.name}</div>
          <div className="small muted">
            {shortDate(plan.start_date)} → {shortDate(plan.end_date)}
            {started ? ` · week ${planWeekNumber(plan, today)} of ${planTotalWeeks(plan)}` : ` · starts in ${daysBetween(today, plan.start_date)} days`}
          </div>
        </div>
        <svg width="46" height="46" viewBox="0 0 46 46" role="img" aria-label={`${Math.round(elapsed * 100)}% of plan time used`}>
          <circle cx="23" cy="23" r="19" fill="none" style={{ stroke: 'var(--track)' }} strokeWidth="5" />
          <circle cx="23" cy="23" r="19" fill="none" style={{ stroke: 'var(--accent)' }} strokeWidth="5" strokeLinecap="round" strokeDasharray={circumference} strokeDashoffset={circumference * (1 - elapsed)} transform="rotate(-90 23 23)" />
        </svg>
      </div>
      <div className="chips">
        {goals.map((g) => (
          <span key={g.id} className="pill none" style={{ fontWeight: 500, fontSize: 12 }}>
            <span className="dot" style={{ background: g.color, width: 7, height: 7 }} />
            {g.title}
          </span>
        ))}
        {goals.length === 0 && <span className="small muted">No goals yet</span>}
      </div>
      {sixMonth && sixMonth.label !== 'none' && (
        <div className="row-start small">
          Goals on pace: <b>{sixMonth.actual} of {sixMonth.expected}</b> <PacePill label={sixMonth.label} />
        </div>
      )}
    </a>
  );
}
