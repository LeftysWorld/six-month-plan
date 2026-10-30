import { useRef, useState } from 'react';
import { EFFORT_LEFT, EFFORT_TARGET, EFFORT_WORDS, effortZone } from '@six/core';
import { Icon, Sheet } from './ui.tsx';

/**
 * Effort per exercise, 1–10: how many more good reps were left on the last set (10 = none). The
 * slider starts empty (a pre-filled 7 just gets accepted every time), snaps to whole numbers, takes
 * a tap or a drag anywhere along it, and says in words what each number means as you slide, so an
 * 8 means the same thing every week. Keyboard: Tab to it, arrows to change.
 */

/** How an exercise went, while you log it. */
export interface ExerciseFeedbackValue {
  effort: number | null;
  pain: boolean;
  where: string;
  note: string;
}
export const blankFeedback = (): ExerciseFeedbackValue => ({ effort: null, pain: false, where: '', note: '' });

const STEPS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
const PLACES = ['Knee', 'Shoulder', 'Lower back', 'Elbow', 'Wrist', 'Other'];

export function EffortSlider({ value, onChange, label, last }: { value: number | null; onChange: (v: number) => void; label: string; last?: number | null }) {
  const track = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);
  const at = (clientX: number) => {
    const r = track.current!.getBoundingClientRect();
    return Math.min(10, Math.max(1, Math.floor(((clientX - r.left) / r.width) * 10) + 1));
  };
  const set = (v: number) => {
    if (v === value) return;
    onChange(v);
    navigator.vibrate?.(6);
  };
  const zone = value == null ? 'none' : effortZone(value);
  return (
    <div className={`effort z-${zone}`}>
      <div
        ref={track}
        className="effort-track"
        onPointerDown={(e) => {
          if (e.button !== 0) return;
          dragging.current = true;
          e.currentTarget.setPointerCapture(e.pointerId);
          set(at(e.clientX));
          (e.currentTarget.querySelector('input') as HTMLInputElement | null)?.focus({ preventScroll: true });
        }}
        onPointerMove={(e) => {
          if (dragging.current) set(at(e.clientX));
        }}
        onPointerUp={() => (dragging.current = false)}
        onPointerCancel={() => (dragging.current = false)}
      >
        {STEPS.map((n) => (
          <span key={n} className={`effort-cell${value != null && n <= value ? ' on' : ''}`} aria-hidden="true">
            <i />
            {value === n && <span className="effort-thumb" />}
          </span>
        ))}
        <input
          className="effort-input"
          type="range"
          min={1}
          max={10}
          step={1}
          value={value ?? 7}
          aria-label={label}
          aria-valuetext={value == null ? 'Not rated' : `${value}, ${EFFORT_WORDS[value]}, ${EFFORT_LEFT[value]}`}
          onChange={(e) => set(Number(e.target.value))}
        />
      </div>
      <div className="effort-nums" aria-hidden="true">
        {STEPS.map((n) => (
          <span key={n} className={n === value ? 'on' : ''}>
            {n}
          </span>
        ))}
        <span className="effort-target" style={{ gridColumn: `${EFFORT_TARGET.min} / ${EFFORT_TARGET.max + 1}` }}>
          your target
        </span>
      </div>
      {value == null && (
        <span className="row-between xsmall muted" style={{ gap: 8 }}>
          <span>Slide or tap after your last set.</span>
          {last != null && (
            <span>
              Last time: <b className="num" style={{ color: 'var(--ink)' }}>{last}</b>
            </span>
          )}
        </span>
      )}
    </div>
  );
}

/** The big number beside the question. */
function Readout({ value }: { value: number | null }) {
  return (
    <span className={`effort-readout z-${value == null ? 'none' : effortZone(value)}`} aria-hidden="true">
      <b className="num">{value ?? '–'}</b>
      <span>/10</span>
    </span>
  );
}

/**
 * Under an exercise's sets: the effort slider, what it means for next time, "hurt or felt wrong"
 * (and where), and a note. `next` moves on to the next exercise once this one's rated.
 */
export function ExerciseFeedback({
  name,
  value,
  onChange,
  hint,
  last,
  next,
}: {
  name: string;
  value: ExerciseFeedbackValue;
  onChange: (patch: Partial<ExerciseFeedbackValue>) => void;
  hint: string | null;
  last: number | null;
  next?: { label: string; go: () => void } | null;
}) {
  const [noteOpen, setNoteOpen] = useState(value.note.trim() !== '');
  const [guide, setGuide] = useState(false);
  const kneeTest = /knee test/i.test(name);
  const e = value.effort;
  return (
    <div className="ex-feedback">
      <div className="row-between" style={{ alignItems: 'flex-end', gap: 12 }}>
        <span className="stack-sm" style={{ gap: 2 }}>
          <span className="mono">Effort</span>
          <b style={{ fontSize: 16 }}>How hard was that?</b>
          <button type="button" className="link-btn xsmall" style={{ alignSelf: 'flex-start', minHeight: 28 }} onClick={() => setGuide(true)}>
            What the numbers mean
          </button>
        </span>
        <Readout value={e} />
      </div>
      <EffortSlider value={e} onChange={(v) => onChange({ effort: v })} label={`Effort for ${name}, 1 to 10`} last={last} />
      {e != null && (
        <div className={`effort-read z-${effortZone(e)}`} aria-live="polite">
          <b>
            {EFFORT_WORDS[e]} · {EFFORT_LEFT[e]}
          </b>
          {hint && <span>{hint}</span>}
        </div>
      )}
      <div className="ex-feedback-btns">
        <button type="button" className={`ex-fb-btn${value.pain ? ' hurt' : ''}`} aria-pressed={value.pain} onClick={() => onChange({ pain: !value.pain, where: value.pain ? '' : value.where })}>
          <Icon name="alert" size={17} /> {value.pain ? 'Hurt: flagged' : 'Hurt or felt wrong'}
        </button>
        <button type="button" className={`ex-fb-btn${noteOpen ? ' on' : ''}`} aria-expanded={noteOpen} onClick={() => setNoteOpen(!noteOpen)}>
          <Icon name="edit" size={17} /> {value.note.trim() && !noteOpen ? 'Note ✓' : 'Note'}
        </button>
      </div>
      {value.pain && (
        <div className="ex-hurt">
          <b>Where did it hurt?</b>
          <div className="chips" role="group" aria-label="Where it hurt">
            {PLACES.map((p) => (
              <button key={p} type="button" className="chip" aria-pressed={value.where === p} onClick={() => onChange({ where: value.where === p ? '' : p })}>
                {p}
              </button>
            ))}
          </div>
          <span className="xsmall">
            {kneeTest ? 'This is a knee test: pain here means it should come off your plan, not be pushed.' : "Don't add weight or reps to this one until it stops hurting. Add a note on what you felt."}
          </span>
        </div>
      )}
      {noteOpen && (
        <label className="field">
          Note for this exercise
          <textarea rows={2} value={value.note} onChange={(x) => onChange({ note: x.target.value })} placeholder="e.g. left shoulder pinched on the last rep" />
        </label>
      )}
      {next && e != null && (
        <button type="button" className="btn small" style={{ alignSelf: 'flex-start' }} onClick={next.go}>
          Next: {next.label} <Icon name="chevron" size={14} stroke={2.4} />
        </button>
      )}
      {guide && <EffortGuide onClose={() => setGuide(false)} />}
    </div>
  );
}

/** "What the numbers mean": the scale, by reps left. */
export function EffortGuide({ onClose }: { onClose: () => void }) {
  const rows: { n: string; v: number; target: boolean }[] = [
    { n: '10', v: 10, target: false },
    { n: '9', v: 9, target: true },
    { n: '8', v: 8, target: true },
    { n: '7', v: 7, target: true },
    { n: '6', v: 6, target: false },
    { n: '5', v: 5, target: false },
    { n: '1–4', v: 4, target: false },
  ];
  return (
    <Sheet title="How many more good reps?" onClose={onClose}>
      <p className="small muted" style={{ margin: 0 }}>
        Rate the exercise by your last set: how many more reps could you have done with good form? Not how out of breath you are.
      </p>
      <div className="effort-scale">
        {rows.map((r) => (
          <div key={r.n} className={`effort-scale-row${r.target ? ' target' : ''}`}>
            <span className={`effort-pill z-${effortZone(r.v)}`}>{r.n}</span>
            <b>{r.v === 4 ? 'Easy' : EFFORT_WORDS[r.v]}</b>
            <span className="small muted num">{EFFORT_LEFT[r.v]}</span>
          </div>
        ))}
      </div>
      <div className="effort-tip">
        <b>
          Your target is {EFFORT_TARGET.min}–{EFFORT_TARGET.max}
        </b>{' '}
        on most sets. Under {EFFORT_TARGET.min}, the weight is too light. At 10, keep the weight next time.
      </div>
      <button type="button" className="btn primary" onClick={onClose}>
        Got it
      </button>
    </Sheet>
  );
}

/**
 * Before a workout is saved: any exercise not rated yet (tap one to rate it), and an optional 1–10
 * for the whole workout.
 */
export function FinishWorkout({
  summary,
  unrated,
  effort,
  onEffort,
  onRate,
  onSave,
  onBack,
  saveLabel,
}: {
  summary: string;
  unrated: { name: string; index: number }[];
  effort: number | null;
  onEffort: (v: number | null) => void;
  onRate: (index: number) => void;
  onSave: () => void;
  onBack: () => void;
  saveLabel: string;
}) {
  return (
    <Sheet title="Finish workout" onClose={onBack}>
      <p className="small muted" style={{ margin: '-8px 0 0' }}>
        {summary}
      </p>
      {unrated.length > 0 && (
        <div className="finish-unrated">
          <b className="small">{unrated.length === 1 ? "One exercise isn't rated" : `${unrated.length} exercises aren't rated`}</b>
          {unrated.map((u) => (
            <div key={u.index} className="row-between" style={{ gap: 10 }}>
              <span className="small">{u.name}</span>
              <button type="button" className="btn small" onClick={() => onRate(u.index)}>
                Rate it
              </button>
            </div>
          ))}
        </div>
      )}
      <div className="stack-sm" style={{ gap: 10 }}>
        <div className="row-between" style={{ alignItems: 'baseline' }}>
          <b>How hard was today overall?</b>
          <span className="tag">Optional</span>
        </div>
        <div className="finish-effort" role="radiogroup" aria-label="Whole workout effort, 1 to 10">
          {STEPS.map((n) => (
            <button key={n} type="button" role="radio" aria-checked={effort === n} className={effort === n ? 'on' : ''} onClick={() => onEffort(effort === n ? null : n)}>
              {n}
            </button>
          ))}
        </div>
        <span className="xsmall muted">{effort != null ? `${effort} · ${EFFORT_WORDS[effort]}` : 'Skip it if you like. Each exercise has its own rating.'}</span>
      </div>
      <button type="button" className="btn primary" onClick={onSave}>
        {saveLabel}
      </button>
      <button type="button" className="link-btn small" style={{ alignSelf: 'center' }} onClick={onBack}>
        Back to the workout
      </button>
    </Sheet>
  );
}
