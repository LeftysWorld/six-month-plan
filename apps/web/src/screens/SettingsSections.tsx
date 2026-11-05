import { useState, type ReactNode } from 'react';
import {
  EQUIPMENT,
  PATTERNS,
  bodyPrefs,
  shortDate,
  trainingRules,
  workoutPrefs,
  type EffortMode,
  type MeasurementType,
  type TrainingLimit,
  type TrainingRules,
  type WorkoutPrefs,
} from '@six/core';
import { useStore } from '../data/store.tsx';
import { opsAddMeasurement, opsAddMeasurementType, opsProfile } from '../data/ops.ts';
import { fmt } from '../data/derive.ts';
import { CoachSetup, RunCoachButton, coachUrl } from '../components/CoachSetup.tsx';
import { useToast } from '../components/ui.tsx';

/**
 * The sections of Settings that shape training and the coach: Training (your limits, your gym,
 * weight steps, your training week, how you log), Body (what you measure and when) and Workout
 * coach (status, runs, what it reads). Everything saves as you change it.
 */

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

// ---------- Small pieces ----------

export function Toggle({ label, hint, on, onChange }: { label: string; hint?: string; on: boolean; onChange: (on: boolean) => void }) {
  return (
    <label className="set-toggle">
      <span className="grow">
        <span>{label}</span>
        {hint && <span className="set-hint">{hint}</span>}
      </span>
      <input type="checkbox" role="switch" checked={on} onChange={(e) => onChange(e.target.checked)} />
      <span className="set-switch" aria-hidden="true" />
    </label>
  );
}

export function SetCard({ title, action, children }: { title?: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="set-card">
      {(title || action) && (
        <div className="row-between" style={{ alignItems: 'center', gap: 10 }}>
          {title && <h2 className="set-card-title">{title}</h2>}
          {action}
        </div>
      )}
      {children}
    </section>
  );
}

function DayPicker({ days, onChange, single, label }: { days: number[]; onChange: (days: number[]) => void; single?: boolean; label: string }) {
  return (
    <div className="set-days" role={single ? 'radiogroup' : 'group'} aria-label={label}>
      {DAYS.map((d, i) => {
        const n = i + 1;
        const on = days.includes(n);
        return (
          <button
            key={d}
            type="button"
            role={single ? 'radio' : undefined}
            aria-checked={single ? on : undefined}
            aria-pressed={single ? undefined : on}
            className={on ? 'on' : ''}
            onClick={() => onChange(single ? [n] : on ? days.filter((x) => x !== n) : [...days, n].sort((a, b) => a - b))}
          >
            {d}
          </button>
        );
      })}
    </div>
  );
}

function StepperControl({ label, hint, value, options, format, onChange }: { label: string; hint: string; value: number; options: number[]; format: (v: number) => string; onChange: (v: number) => void }) {
  const i = Math.max(0, options.findIndex((o) => Math.abs(o - value) < 1e-9));
  return (
    <div className="set-row">
      <span className="grow">
        <span>{label}</span>
        <span className="set-hint">{hint}</span>
      </span>
      <span className="set-stepper">
        <button type="button" aria-label={`Smaller ${label.toLowerCase()}`} disabled={i <= 0} onClick={() => onChange(options[i - 1]!)}>
          −
        </button>
        <b className="set-value" aria-live="polite">
          {format(value)}
        </b>
        <button type="button" aria-label={`Bigger ${label.toLowerCase()}`} disabled={i >= options.length - 1} onClick={() => onChange(options[i + 1]!)}>
          +
        </button>
      </span>
    </div>
  );
}

// ---------- Training ----------

export function TrainingSection() {
  const { data, commit } = useStore();
  const p = data.profile;
  const rules = trainingRules(p.training_rules);
  const prefs = workoutPrefs(p.workout_prefs);
  const u = p.units;
  const save = (patch: Partial<TrainingRules>) => commit(opsProfile({ training_rules: { ...rules, ...patch } }));
  const savePrefs = (patch: Partial<WorkoutPrefs>) => commit(opsProfile({ workout_prefs: { ...prefs, ...patch } }));
  const [editing, setEditing] = useState<number | null>(null);
  const stepOptions = u === 'kg' ? [0.5, 1, 1.25, 2, 2.5, 5] : [1, 2.5, 5, 10];

  return (
    <div className="set-stack">
      <p className="set-lede">Your limits, your gym and how you log. Weight suggestions follow these, and the workout coach treats them as rules it can't break.</p>

      <SetCard
        title="Limits and injuries"
        action={
          <button
            type="button"
            className="link-btn small"
            onClick={() => {
              save({ limits: [...rules.limits, { id: `limit-${Date.now()}`, name: 'New limit', summary: '', banned_patterns: [], banned_exercises: [] }] });
              setEditing(rules.limits.length);
            }}
          >
            + Add
          </button>
        }
      >
        {rules.limits.length === 0 && <span className="small muted">No limits. Add one for an injury or anything you want left out.</span>}
        {rules.limits.map((l, i) => (
          <LimitCard
            key={l.id}
            limit={l}
            editing={editing === i}
            onEdit={() => setEditing(editing === i ? null : i)}
            onChange={(next) => save({ limits: rules.limits.map((x, j) => (j === i ? next : x)) })}
            onRemove={() => {
              save({ limits: rules.limits.filter((_, j) => j !== i) });
              setEditing(null);
            }}
          />
        ))}
      </SetCard>

      <SetCard title="Equipment at your gym">
        <div className="set-chips" role="group" aria-label="Equipment">
          {EQUIPMENT.map((e) => {
            const on = rules.equipment.includes(e.id);
            return (
              <button key={e.id} type="button" className={`chip${on ? ' on' : ''}`} aria-pressed={on} onClick={() => save({ equipment: on ? rules.equipment.filter((x) => x !== e.id) : [...rules.equipment, e.id] })}>
                {e.name}
              </button>
            );
          })}
        </div>
        <Toggle label="One cable at a time" hint="No two-cable moves like crossovers" on={rules.one_cable_at_a_time} onChange={(on) => save({ one_cable_at_a_time: on })} />
      </SetCard>

      <SetCard title="Weight steps">
        <span className="set-hint" style={{ marginTop: -4 }}>
          How each lift moves up. Compound lifts (presses, rows, pulldowns): every set at the top of the range, then one standard step. Isolation lifts (curls, raises, extensions, flys): every set at the top, then one more set (up to 4), then the small step. Assisted: less assist.
        </span>
        <StepperControl label="Dumbbells" hint={`compound · e.g. 50 → ${fmt(50 + rules.steps.dumbbell)}`} value={rules.steps.dumbbell} options={stepOptions} format={(v) => `${fmt(v)} ${u}`} onChange={(v) => save({ steps: { ...rules.steps, dumbbell: v } })} />
        <StepperControl label="Machines" hint="one plate on the stack" value={rules.steps.machine} options={stepOptions} format={(v) => `${fmt(v)} ${u}`} onChange={(v) => save({ steps: { ...rules.steps, machine: v } })} />
        <StepperControl label="Cable" hint="one pin" value={rules.steps.cable} options={stepOptions} format={(v) => `${fmt(v)} ${u}`} onChange={(v) => save({ steps: { ...rules.steps, cable: v } })} />
        <StepperControl label="Small dumbbell step" hint="isolation · 0 if your gym has none (then slower tempo instead)" value={rules.iso_steps.dumbbell} options={[0, ...stepOptions]} format={(v) => (v ? `${fmt(v)} ${u}` : 'None')} onChange={(v) => save({ iso_steps: { ...rules.iso_steps, dumbbell: v } })} />
        <StepperControl label="Small cable step" hint="isolation · the smallest plate" value={rules.iso_steps.cable} options={[0, ...stepOptions]} format={(v) => (v ? `${fmt(v)} ${u}` : 'None')} onChange={(v) => save({ iso_steps: { ...rules.iso_steps, cable: v } })} />
        <StepperControl label="Assist step" hint="pull-ups and dips: this much less assist" value={rules.assist_step} options={stepOptions} format={(v) => `${fmt(v)} ${u}`} onChange={(v) => save({ assist_step: v })} />
        <StepperControl label="Biggest jump" hint="the coach never suggests more in one step" value={rules.max_jump_pct} options={[0.05, 0.1, 0.15, 0.2, 0.25, 0.5]} format={(v) => `${Math.round(v * 100)}%`} onChange={(v) => save({ max_jump_pct: v })} />
        <label className="field">
          Program started
          <input type="date" value={rules.program_start} onChange={(e) => e.target.value && save({ program_start: e.target.value })} />
          <span className="set-hint">Deload weeks count from here: every 8th week, or sooner when 3 or more lifts stall.</span>
        </label>
      </SetCard>

      <SetCard title="Your training week">
        <DayPicker label="Training days" days={rules.days} onChange={(days) => save({ days })} />
        <div className="set-pair">
          <label className="field">
            Shortest workout (min)
            <input type="number" inputMode="numeric" min={10} max={180} value={rules.session_minutes.min} onChange={(e) => save({ session_minutes: { ...rules.session_minutes, min: Math.max(5, Number(e.target.value) || 0) } })} />
          </label>
          <label className="field">
            Longest workout (min)
            <input type="number" inputMode="numeric" min={10} max={240} value={rules.session_minutes.max} onChange={(e) => save({ session_minutes: { ...rules.session_minutes, max: Math.max(5, Number(e.target.value) || 0) } })} />
          </label>
        </div>
        <StepperControl label="Exercises each workout" hint="about this many" value={rules.exercises_per_workout} options={[3, 4, 5, 6, 7, 8]} format={(v) => `About ${v}`} onChange={(v) => save({ exercises_per_workout: v })} />
        <Toggle label="Weights only" hint="No cardio finishers in lifting sessions" on={rules.weights_only} onChange={(on) => save({ weights_only: on })} />
      </SetCard>

      <SetCard title="Logging a workout">
        <span className="small">Effort rating (1–10) after each exercise</span>
        <div className="seg" role="radiogroup" aria-label="Effort rating">
          {(
            [
              ['each', 'Ask each time'],
              ['finish', 'At finish'],
              ['off', 'Off'],
            ] as [EffortMode, string][]
          ).map(([m, label]) => (
            <button key={m} type="button" role="radio" aria-checked={prefs.effort === m} onClick={() => savePrefs({ effort: m })}>
              {label}
            </button>
          ))}
        </div>
        <span className="set-hint">
          {prefs.effort === 'each' ? 'The slider shows under each exercise, and a finished exercise waits for its rating.' : prefs.effort === 'finish' ? 'You can still rate under each exercise; finishing reminds you of any you missed.' : 'No effort ratings. The coach reads less: it falls back to weights and reps.'}
        </span>
        <Toggle label="Whole-workout rating" hint="Asked once when you finish" on={prefs.workout_rating} onChange={(on) => savePrefs({ workout_rating: on })} />
        <Toggle label="Rest timer vibrates" hint="When rest ends, between sets" on={prefs.rest_vibrate} onChange={(on) => savePrefs({ rest_vibrate: on })} />
      </SetCard>
    </div>
  );
}

function LimitCard({ limit, editing, onEdit, onChange, onRemove }: { limit: TrainingLimit; editing: boolean; onEdit: () => void; onChange: (l: TrainingLimit) => void; onRemove: () => void }) {
  const [adding, setAdding] = useState('');
  const patternName = (id: string) => PATTERNS.find((x) => x.id === id)?.name ?? id.replace(/_/g, ' ');
  return (
    <div className="set-limit">
      <div className="row-between" style={{ alignItems: 'flex-start', gap: 10 }}>
        {editing ? (
          <label className="field grow">
            Name
            <input value={limit.name} onChange={(e) => onChange({ ...limit, name: e.target.value })} />
          </label>
        ) : (
          <span className="stack-sm" style={{ gap: 2 }}>
            <b>{limit.name}</b>
            <span className="small muted">{limit.summary || 'No description'}</span>
          </span>
        )}
        <button type="button" className="link-btn small" onClick={onEdit}>
          {editing ? 'Done' : 'Edit'}
        </button>
      </div>
      {editing && (
        <label className="field">
          In a sentence
          <textarea rows={2} value={limit.summary} onChange={(e) => onChange({ ...limit, summary: e.target.value })} placeholder="e.g. No lower-body training. Anything that loads the knee is out." />
        </label>
      )}
      <span className="mono">Movements left out</span>
      <div className="set-chips" role="group" aria-label={`Movements left out for ${limit.name}`}>
        {(editing ? PATTERNS.map((x) => x.id) : limit.banned_patterns).map((id) => {
          const on = limit.banned_patterns.includes(id);
          return editing ? (
            <button key={id} type="button" className={`chip small${on ? ' on' : ''}`} aria-pressed={on} onClick={() => onChange({ ...limit, banned_patterns: on ? limit.banned_patterns.filter((x) => x !== id) : [...limit.banned_patterns, id] })}>
              {patternName(id)}
            </button>
          ) : (
            <span key={id} className="set-tag">
              {patternName(id)}
            </span>
          );
        })}
        {!editing && limit.banned_patterns.length === 0 && <span className="small muted">None</span>}
      </div>
      <span className="mono">Exercises that bothered it</span>
      <div className="set-chips">
        {limit.banned_exercises.map((x) => (
          <span key={x} className="set-tag warn">
            {x}
            {editing && (
              <button type="button" aria-label={`Remove ${x}`} className="set-tag-x" onClick={() => onChange({ ...limit, banned_exercises: limit.banned_exercises.filter((y) => y !== x) })}>
                ×
              </button>
            )}
          </span>
        ))}
        {!editing && limit.banned_exercises.length === 0 && <span className="small muted">None</span>}
      </div>
      {editing && (
        <>
          <form
            className="set-inline"
            onSubmit={(e) => {
              e.preventDefault();
              const v = adding.trim();
              if (v && !limit.banned_exercises.some((x) => x.toLowerCase() === v.toLowerCase())) onChange({ ...limit, banned_exercises: [...limit.banned_exercises, v] });
              setAdding('');
            }}
          >
            <input value={adding} onChange={(e) => setAdding(e.target.value)} placeholder="Add an exercise, e.g. Dead bug" aria-label="Add an exercise that bothered it" />
            <button type="submit" className="btn small" disabled={!adding.trim()}>
              Add
            </button>
          </form>
          <button type="button" className="link-btn small" style={{ alignSelf: 'flex-start', color: 'var(--danger)' }} onClick={onRemove}>
            Remove this limit
          </button>
        </>
      )}
      {!editing && /knee/i.test(limit.name) && <span className="xsmall muted">Exercises marked “(knee test)” come out at the first hurt flag.</span>}
    </div>
  );
}

// ---------- Body ----------

const TAPE: { name: string; how: string }[] = [
  { name: 'Waist', how: 'At the navel, relaxed, after breathing out' },
  { name: 'Chest', how: 'Under the armpits, across the nipples' },
  { name: 'Right arm', how: 'Biceps at its widest, relaxed' },
  { name: 'Left arm', how: 'Biceps at its widest, relaxed' },
  { name: 'Shoulders', how: 'Around both shoulders at their widest' },
];
const isWeight = (t: MeasurementType) => /^(body\s*)?weight$/i.test(t.name.trim()) || (/weight/i.test(t.name) && /^(lb|lbs|kg)$/i.test(t.unit.trim()));

function nextDay(today: string, weekday: number): string {
  const d = new Date(`${today}T12:00:00Z`);
  const dow = d.getUTCDay() || 7;
  const add = (weekday - dow + 7) % 7;
  d.setUTCDate(d.getUTCDate() + add);
  return d.toISOString().slice(0, 10);
}

export function BodySection() {
  const { data, commit, today } = useStore();
  const toast = useToast();
  const p = data.profile;
  const prefs = bodyPrefs(p.body_prefs);
  const tapeUnit = p.units === 'kg' ? 'cm' : 'in';
  const types = data.measurementTypes.filter((t) => !t.archived_at);
  const weight = types.find(isWeight) ?? null;
  const lastOf = (id: string) => data.measurements.filter((m) => m.type_id === id).sort((a, b) => (a.measured_on < b.measured_on ? 1 : -1))[0] ?? null;
  const tape = TAPE.map((t) => ({ ...t, type: types.find((x) => x.name.trim().toLowerCase() === t.name.toLowerCase()) ?? null }));
  const extra = types.filter((t) => !isWeight(t) && !TAPE.some((x) => x.name.toLowerCase() === t.name.trim().toLowerCase()) && /waist|chest|arm|shoulder|neck|thigh|hip|calf|calves|forearm|glute/i.test(t.name));
  const missing = tape.filter((t) => !t.type);
  const [custom, setCustom] = useState('');
  const next = nextDay(today, prefs.measure_day);
  const saveBody = (patch: Partial<typeof prefs>) => commit(opsProfile({ body_prefs: { ...prefs, ...patch } }));

  return (
    <div className="set-stack">
      <p className="set-lede">What you measure and when. Weight shows the cut; the tape shows whether it's fat or muscle.</p>

      <SetCard title="Daily">
        {weight ? (
          <MeasureRow type={weight} hint="Mornings, before eating" last={lastOf(weight.id)} today={today} onLog={(v) => commit(opsAddMeasurement(weight.id, v, today))} />
        ) : (
          <div className="stack-sm">
            <span className="small muted">No weight measurement yet.</span>
            <button type="button" className="btn small" style={{ alignSelf: 'flex-start' }} onClick={() => commit(opsAddMeasurementType({ name: 'Weight', unit: p.units, cadence_days: 1, goal_id: null }))}>
              Track my weight daily
            </button>
          </div>
        )}
      </SetCard>

      <SetCard title="Weekly, with a tape" action={<span className="xsmall muted">{tapeUnit === 'in' ? 'inches' : 'centimetres'}</span>}>
        <span className="set-hint">Same morning each week, before eating, tape snug but not tight.</span>
        <DayPicker label="Measuring day" single days={[prefs.measure_day]} onChange={([d]) => saveBody({ measure_day: d! })} />
        <div className="set-note">
          Next: {next === today ? 'today' : shortDate(next)}. {missing.length ? 'Add the measurements below to start.' : 'Log each one here when you measure.'}
        </div>
        {missing.length > 0 && (
          <button
            type="button"
            className="btn small primary"
            style={{ alignSelf: 'flex-start' }}
            onClick={() => {
              commit(missing.flatMap((t) => opsAddMeasurementType({ name: t.name, unit: tapeUnit, cadence_days: 7, goal_id: null })));
              toast(`${missing.length} measurement${missing.length === 1 ? '' : 's'} added`);
            }}
          >
            Add {missing.length === TAPE.length ? 'waist, chest, arms and shoulders' : missing.map((t) => t.name.toLowerCase()).join(', ')}
          </button>
        )}
        {tape.map((t) =>
          t.type ? (
            <MeasureRow key={t.name} type={t.type} hint={t.how} last={lastOf(t.type.id)} today={today} onLog={(v) => commit(opsAddMeasurement(t.type!.id, v, today))} />
          ) : (
            <div key={t.name} className="set-row muted">
              <span className="grow">
                <span>{t.name}</span>
                <span className="set-hint">{t.how}</span>
              </span>
              <span className="xsmall">Not added</span>
            </div>
          ),
        )}
        {extra.map((t) => (
          <MeasureRow key={t.id} type={t} hint="" last={lastOf(t.id)} today={today} onLog={(v) => commit(opsAddMeasurement(t.id, v, today))} />
        ))}
        <form
          className="set-inline"
          onSubmit={(e) => {
            e.preventDefault();
            const name = custom.trim();
            if (!name) return;
            commit(opsAddMeasurementType({ name, unit: tapeUnit, cadence_days: 7, goal_id: null }));
            setCustom('');
            toast(`${name} added`);
          }}
        >
          <input value={custom} onChange={(e) => setCustom(e.target.value)} placeholder="Add one: neck, thighs, calves…" aria-label="Add a measurement" />
          <button type="submit" className="btn small" disabled={!custom.trim()}>
            Add
          </button>
        </form>
      </SetCard>

      <SetCard title="Progress photos">
        <Toggle label="Monthly photo reminder" hint="Front, side, back · first measuring day of the month" on={prefs.photo_reminder} onChange={(on) => saveBody({ photo_reminder: on })} />
      </SetCard>

      <SetCard title="Shared with the workout coach">
        <Toggle label="Weight and tape measurements" hint="They change how strength reads while you're losing weight. Photos and everything else you track stay private." on={p.coach_share_bodyweight ?? true} onChange={(on) => commit(opsProfile({ coach_share_bodyweight: on }))} />
      </SetCard>
    </div>
  );
}

function MeasureRow({ type, hint, last, today, onLog }: { type: MeasurementType; hint: string; last: { value: number; measured_on: string } | null; today: string; onLog: (v: number) => void }) {
  const [value, setValue] = useState('');
  const [open, setOpen] = useState(false);
  const loggedToday = last?.measured_on === today;
  return (
    <div className="set-measure">
      <div className="set-row" style={{ borderTop: 0, padding: 0 }}>
        <span className="grow">
          <span>{type.name}</span>
          <span className="set-hint">
            {hint}
            {hint && last ? ' · ' : ''}
            {last ? `last ${fmt(Number(last.value))} ${type.unit}${loggedToday ? ' today' : `, ${shortDate(last.measured_on)}`}` : hint ? '' : 'not measured yet'}
          </span>
        </span>
        {loggedToday && !open ? (
          <span className="set-pill">Logged today</span>
        ) : (
          <button type="button" className="btn small" onClick={() => setOpen(!open)} aria-expanded={open}>
            {open ? 'Cancel' : 'Log'}
          </button>
        )}
      </div>
      {open && (
        <form
          className="set-inline"
          onSubmit={(e) => {
            e.preventDefault();
            const v = Number(value);
            if (!Number.isFinite(v) || v <= 0) return;
            onLog(v);
            setValue('');
            setOpen(false);
          }}
        >
          <input autoFocus type="number" inputMode="decimal" step="any" value={value} onChange={(e) => setValue(e.target.value)} placeholder={type.unit} aria-label={`${type.name} in ${type.unit}`} />
          <button type="submit" className="btn small primary" disabled={!value}>
            Save
          </button>
        </form>
      )}
    </div>
  );
}

// ---------- Workout coach ----------

/** The next scheduled run: the coach's cron is Saturday 04:00 UTC (Friday 11 pm Eastern). */
export function nextCoachRun(now = new Date()): Date {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 4, 0, 0));
  while (d.getUTCDay() !== 6 || d <= now) d.setUTCDate(d.getUTCDate() + 1);
  return d;
}

export function runLabel(d: Date, timeZone: string): string {
  try {
    const day = new Intl.DateTimeFormat('en-US', { timeZone, weekday: 'short', month: 'short', day: 'numeric' }).format(d);
    const time = new Intl.DateTimeFormat('en-US', { timeZone, hour: 'numeric', minute: '2-digit' }).format(d).replace(':00', '').toLowerCase();
    return `${day}, ${time}`;
  } catch {
    return d.toUTCString();
  }
}

export function CoachSection() {
  const { data, db } = useStore();
  const p = data.profile;
  const connected = !!p.coach_key_hash;
  const reports = [...(data.workoutReports ?? [])].sort((a, b) => (a.as_of < b.as_of ? 1 : -1));
  const last = reports[0] ?? null;
  const rules = trainingRules(p.training_rules);
  const rec = (r: (typeof reports)[number]) => (r.recommendation === 'change' ? `Change, level ${r.change_level}` : r.recommendation === 'hold' ? 'Hold: no change' : 'Too early or no recommendation');

  return (
    <div className="set-stack">
      <p className="set-lede">Reads what you actually did each week and recommends a change, or no change. Nothing in your plan changes until you decide.</p>

      <SetCard>
        <div className="row-start" style={{ gap: 10 }}>
          <span className={`set-status-dot${connected ? ' ok' : ''}`} aria-hidden="true" />
          <span className="stack-sm" style={{ gap: 1 }}>
            <b style={{ fontSize: 17 }}>{connected ? 'Connected' : 'Not connected yet'}</b>
            <span className="small muted">{connected ? 'Reads your history, saves reports here' : 'Set it up under Connection below'}</span>
          </span>
        </div>
        <div className="set-pair">
          <div className="set-fact">
            <span>Last run</span>
            <b>{last ? shortDate(last.as_of) : 'Not yet'}</b>
            <span>{last ? rec(last) : 'Run it to test'}</span>
          </div>
          <div className="set-fact">
            <span>Next run</span>
            <b>{runLabel(nextCoachRun(), p.timezone)}</b>
            <span>Every week</span>
          </div>
        </div>
        {db.mode === 'supabase' && <RunCoachButton />}
        <a className="link-btn small" href="#/workouts/report" style={{ alignSelf: 'center' }}>
          Open the workout report
        </a>
      </SetCard>

      <SetCard title="When it runs">
        <span className="small">Fridays at 11 pm Eastern, after your last workout of the week, so the report covers all of it.</span>
        <span className="set-hint">The schedule lives in the coach's Vercel project. Run it any time with the button above.</span>
      </SetCard>

      <SetCard title="What it reads">
        <a className="set-row link" href="#/workouts/report">
          <span className="grow">
            <span>Your workouts</span>
            <span className="set-hint">Sets, weights, reps, effort, hurt flags, notes</span>
          </span>
        </a>
        <a className="set-row link" href="#/settings/training">
          <span className="grow">
            <span>Training rules</span>
            <span className="set-hint">
              {rules.limits.map((l) => l.name).join(', ') || 'No limits'} · {rules.equipment.length} pieces of equipment · steps and schedule
            </span>
          </span>
        </a>
        <a className="set-row link" href="#/settings/body">
          <span className="grow">
            <span>Weight and measurements</span>
            <span className="set-hint">{p.coach_share_bodyweight ?? true ? 'Shared' : 'Not shared'}</span>
          </span>
        </a>
      </SetCard>

      <SetCard title="AI models">
        {[
          ['Analyst', 'Reads your history, makes the calls', 'Opus 5.5'],
          ['Planner', 'Writes the options, inside your rules', 'Sonnet 5.5'],
          ['Critic', 'Decides if a change is worth it', 'Opus 5.5'],
        ].map(([role, job, model]) => (
          <div key={role} className="set-row">
            <span className="grow">
              <span>{role}</span>
              <span className="set-hint">{job}</span>
            </span>
            <span className="set-pill">{model}</span>
          </div>
        ))}
      </SetCard>

      <details className="set-card set-details" open={!connected}>
        <summary>Connection</summary>
        <div className="set-stack" style={{ marginTop: 12 }}>
          <span className="small muted">Coach address: {coachUrl().replace(/^https?:\/\//, '')}</span>
          <CoachSetup />
        </div>
      </details>
    </div>
  );
}
