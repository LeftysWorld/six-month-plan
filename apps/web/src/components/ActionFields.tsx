import type { ActionKind } from '@six/core';
import type { ActionInput } from '../data/ops.ts';
import { WEEKDAY_NAMES } from './ui.tsx';

export function blankAction(title = ''): ActionInput {
  return {
    title,
    kind: 'minutes',
    planned_minutes: 30,
    planned_count: null,
    min_label: '',
    min_minutes: null,
    min_count: null,
    priority: false,
    rule: 'per_week',
    days: [1, 3, 5],
    per_week: 5,
  };
}

const KINDS: { value: ActionKind; label: string; hint: string }[] = [
  { value: 'minutes', label: 'Minutes', hint: 'Practice for a time' },
  { value: 'count', label: 'Count', hint: 'e.g. 3 applications' },
  { value: 'check', label: 'Just do it', hint: 'Done or not' },
  { value: 'workout', label: 'Workout', hint: 'Sets, reps, weight' },
  { value: 'study', label: 'Study', hint: 'Hours toward a course' },
  { value: 'photo', label: 'Photo', hint: 'Take a photo each time' },
];

/** Fields for a regular action: what, how much, how often, and the minimum version. */
export function ActionFields({ value, onChange, showSchedule = true }: { value: ActionInput; onChange: (v: ActionInput) => void; showSchedule?: boolean }) {
  const set = (patch: Partial<ActionInput>) => onChange({ ...value, ...patch });
  return (
    <div className="stack">
      <label className="field">
        What will you do?
        <input value={value.title} onChange={(e) => set({ title: e.target.value })} placeholder="e.g. Guitar practice" />
      </label>
      <div className="stack-sm">
        <span className="xsmall muted">How do you log it?</span>
        <div className="chips">
          {KINDS.map((k) => (
            <button
              key={k.value}
              type="button"
              className="chip"
              aria-pressed={value.kind === k.value}
              title={k.hint}
              onClick={() => set({ kind: k.value, planned_count: k.value === 'count' ? value.planned_count ?? 3 : null })}
            >
              {k.label}
            </button>
          ))}
        </div>
      </div>
      <div className="grid-2">
        <label className="field">
          Minutes each time
          <input type="number" min={0} value={value.planned_minutes} onChange={(e) => set({ planned_minutes: Number(e.target.value) })} />
        </label>
        {value.kind === 'count' && (
          <label className="field">
            How many
            <input type="number" min={1} value={value.planned_count ?? 1} onChange={(e) => set({ planned_count: Math.max(1, Number(e.target.value)) })} />
          </label>
        )}
      </div>
      {showSchedule && (
        <div className="stack-sm">
          <span className="xsmall muted">How often?</span>
          <div className="seg" role="tablist">
            <button type="button" role="tab" aria-selected={value.rule === 'per_week'} onClick={() => set({ rule: 'per_week' })}>
              Times per week
            </button>
            <button type="button" role="tab" aria-selected={value.rule === 'days'} onClick={() => set({ rule: 'days' })}>
              Fixed days
            </button>
          </div>
          {value.rule === 'per_week' ? (
            <label className="field">
              Times a week (you place them on days each week)
              <input type="number" min={1} max={14} value={value.per_week ?? 1} onChange={(e) => set({ per_week: Math.min(14, Math.max(1, Number(e.target.value))) })} />
            </label>
          ) : (
            <div className="chips" role="group" aria-label="Days">
              {WEEKDAY_NAMES.map((d, i) => {
                const day = i + 1;
                const on = value.days.includes(day);
                return (
                  <button
                    key={d}
                    type="button"
                    className="chip"
                    aria-pressed={on}
                    onClick={() => set({ days: on ? value.days.filter((x) => x !== day) : [...value.days, day].sort() })}
                  >
                    {d}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}
      <div className="stack-sm">
        <span className="xsmall muted">Minimum version for hard days (still counts as showing up)</span>
        <div className="grid-2">
          <label className="field">
            Describe it
            <input value={value.min_label} onChange={(e) => set({ min_label: e.target.value })} placeholder="e.g. 5 minutes" />
          </label>
          {value.kind === 'count' ? (
            <label className="field">
              Minimum count
              <input type="number" min={0} value={value.min_count ?? ''} onChange={(e) => set({ min_count: e.target.value === '' ? null : Number(e.target.value) })} />
            </label>
          ) : (
            <label className="field">
              Minimum minutes
              <input type="number" min={0} value={value.min_minutes ?? ''} onChange={(e) => set({ min_minutes: e.target.value === '' ? null : Number(e.target.value) })} />
            </label>
          )}
        </div>
      </div>
      <label className="row-start small">
        <input type="checkbox" checked={value.priority} onChange={(e) => set({ priority: e.target.checked })} style={{ width: 20, height: 20 }} />
        Show under Priorities on Today
      </label>
    </div>
  );
}

/** Minutes a week this action asks for. */
export function weeklyMinutes(a: ActionInput): number {
  const times = a.rule === 'per_week' ? a.per_week ?? 0 : a.days.length;
  return times * a.planned_minutes;
}
