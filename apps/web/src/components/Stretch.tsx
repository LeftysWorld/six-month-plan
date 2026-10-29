import { useEffect, useState } from 'react';
import { blankHold, holdSteps, weekdayName, type Session, type StretchHold, type StretchPlan } from '@six/core';
import { useStore } from '../data/store.tsx';
import { opsLogSession, opsRestoreSession, opsSaveStretch } from '../data/ops.ts';
import type { Op } from '../data/model.ts';
import { Icon, Sheet, useToast } from './ui.tsx';
import { LinkToGoal, needsGoalLink } from './LinkToGoal.tsx';
import { MoveDayPicker, moveDatesFor } from './MoveDayPicker.tsx';
import { useView } from '../data/useView.ts';

/**
 * The stretching task type: the day's holds live on the task (the Daily Eight, then the focus slot),
 * push or easy. On the day the log lists them in order: tap to read how, tick each one off, flag one
 * that hurt. Nothing is timed: the plan says how long, you hold it.
 */

const dayLabel = (plan: StretchPlan, easy: boolean) => (easy ? 'Easy day' : plan.day === 'push' ? 'Push day' : 'Easy day');

// ---------- On the Today card ----------

export function StretchCardPlan({ session, plan }: { session: Session; plan: StretchPlan }) {
  const { data } = useStore();
  const logged = data.stretchHolds.filter((h) => h.session_id === session.id);
  const done = logged.filter((h) => h.done).length;
  return (
    <span className="task-card-plan xsmall muted">
      {dayLabel(plan, false)} · {plan.intensity} · focus: {plan.focus || '–'} · {plan.holds.length} holds
      {logged.length > 0 ? ` · ${done} of ${plan.holds.length} done` : ''}
      {logged.some((h) => h.pain) ? ' · ⚠ something hurt' : ''}
    </span>
  );
}

// ---------- Logging a session ----------

interface Draft {
  done: boolean[];
  pain: boolean[];
  easy: boolean;
}
const draftKey = (id: string) => `six.stretch.${id}`;

function readDraft(id: string): Draft | null {
  try {
    const raw = localStorage.getItem(draftKey(id));
    return raw ? (JSON.parse(raw) as Draft) : null;
  } catch {
    return null;
  }
}

export function StretchSheet({ session, plan, onClose, onGeneral }: { session: Session; plan: StretchPlan; onClose: () => void; onGeneral?: () => void }) {
  const { data, today, commit } = useStore();
  const view = useView();
  const toast = useToast();
  const day = session.date ?? today;
  const future = day > today;
  const saved = data.stretchHolds.filter((h) => h.session_id === session.id);
  const fromSaved = (key: 'done' | 'pain') => plan.holds.map((h, i) => !!(saved.find((x) => x.position === i && x.hold === h.name) ?? saved.find((x) => x.hold === h.name))?.[key]);
  const [draft] = useState<Draft | null>(() => readDraft(session.id));
  const fits = (a: boolean[] | undefined) => a && a.length === plan.holds.length;
  const [done, setDone] = useState<boolean[]>(() => (fits(draft?.done) ? draft!.done : fromSaved('done')));
  const [pain, setPain] = useState<boolean[]>(() => (fits(draft?.pain) ? draft!.pain : fromSaved('pain')));
  const [easy, setEasy] = useState<boolean>(() => draft?.easy ?? /ran as an easy day/i.test(session.note));
  const [open, setOpen] = useState<number>(-1);
  const [note, setNote] = useState(session.note);
  const [moving, setMoving] = useState(false);
  const mode: 'push' | 'easy' = easy ? 'easy' : plan.day;
  const count = done.filter(Boolean).length;
  const anyKnee = plan.holds.some((h) => h.knee);

  useEffect(() => {
    if (future) return;
    try {
      localStorage.setItem(draftKey(session.id), JSON.stringify({ done, pain, easy } satisfies Draft));
    } catch {
      // storage blocked: the draft just isn't kept
    }
  }, [done, pain, easy, future, session.id]);

  const toggle = (i: number) => {
    setDone((d) => d.map((x, j) => (j === i ? !x : x)));
    // Ticking a hold opens the next one that isn't done, so the order carries you through.
    if (!done[i]) {
      const next = plan.holds.findIndex((_, j) => j > i && !done[j]);
      setOpen(next);
    }
  };

  function finish() {
    const before = session;
    const { ops, undo } = opsSaveStretch(
      data,
      session.id,
      plan.holds.map((h, i) => ({ hold: h.name, done: !!done[i], pain: !!pain[i] })),
    );
    const status = count >= plan.holds.length ? 'done' : 'partial';
    const flagged = plan.holds.filter((_, i) => pain[i]).map((h) => h.name);
    const extra = [easy && plan.day === 'push' ? 'Ran as an easy day.' : '', flagged.length ? `Hurt: ${flagged.join(', ')}.` : ''].filter(Boolean);
    const cleaned = note.replace(/\s*Ran as an easy day\.|\s*Hurt: [^.]*\./g, '').trim();
    const finalNote = [cleaned, ...extra].filter(Boolean).join(' ');
    commit([...ops, ...opsLogSession(session, { status, note: finalNote, on: today })]);
    try {
      localStorage.removeItem(draftKey(session.id));
    } catch {
      // nothing to clear
    }
    toast(`${session.title}: ${count} of ${plan.holds.length} holds`, () => commit([...undo, ...opsRestoreSession(before)] as Op[]));
    onClose();
  }

  const sections: { title: string; part: 'daily' | 'focus' }[] = [
    { title: 'The daily holds', part: 'daily' },
    { title: `Focus · ${plan.focus || 'today'}`, part: 'focus' },
  ];

  return (
    <Sheet title={session.title} onClose={onClose}>
      {needsGoalLink(data, session) && <LinkToGoal session={session} />}
      <div className="row-between small muted" style={{ marginTop: -8, flexWrap: 'wrap', gap: 6 }}>
        <span>
          {dayLabel(plan, easy)} · {easy && plan.day === 'push' ? '5–6 out of 10, passive' : plan.intensity}
          {session.planned_minutes ? ` · about ${session.planned_minutes} min` : ''}
        </span>
        {!future && <span className="num">{count} of {plan.holds.length} done</span>}
      </div>
      {!future && (
        <span className="workout-progress" aria-hidden="true">
          <i style={{ width: `${plan.holds.length ? (count / plan.holds.length) * 100 : 0}%` }} />
        </span>
      )}
      {future && <div className="banner info">This is {weekdayName(day)}’s session. Open it from Today on {weekdayName(day)} to tick off each hold.</div>}

      {plan.day === 'push' && !future && (
        <label className="check-row small">
          <input type="checkbox" checked={easy} onChange={(e) => setEasy(e.target.checked)} />
          <span>Sore or tweaky? Run it as an easy day: same holds, passive, no contract-relax.</span>
        </label>
      )}
      {mode === 'push' && (
        <details className="task-details">
          <summary>Contract-relax (C-R)</summary>
          <div className="task-details-body">
            Inside the stretch, press the stretched muscle into the floor, block or band at about half effort for 5–10 seconds without moving. Then relax and sink a little deeper for 20–30 seconds. 3 rounds per hold. Breathe slowly the whole time; if you can't breathe calmly, back off a little.
          </div>
        </details>
      )}
      {anyKnee && (
        <details className="task-details">
          <summary>Protect your knee</summary>
          <div className="task-details-body">
            Folded mat or towel under your knees. Hips supported on blocks in the front splits. Into the frog slowly, then stay still. Sharp or pinching knee pain: raise the blocks or skip that hold today. Same for bridges and butterfly.
          </div>
        </details>
      )}

      {sections.map((sec) => {
        const items = plan.holds.map((h, i) => ({ h, i })).filter(({ h }) => h.part === sec.part);
        if (!items.length) return null;
        return (
          <div key={sec.part} className="stack-sm" style={{ gap: 8 }}>
            <span className="label">{sec.title}</span>
            {items.map(({ h, i }) => (
              <HoldRow
                key={i}
                hold={h}
                n={i + 1}
                mode={mode}
                done={!!done[i]}
                pain={!!pain[i]}
                open={open === i}
                future={future}
                onOpen={() => setOpen(open === i ? -1 : i)}
                onTick={() => toggle(i)}
                onPain={() => setPain((p) => p.map((x, j) => (j === i ? !x : x)))}
              />
            ))}
          </div>
        );
      })}
      {plan.finish && <span className="small muted">{plan.finish}</span>}

      {!future && (
        <>
          <label className="field">
            Note <span style={{ fontWeight: 400 }}>(optional)</span>
            <textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="How deep, which side was tighter, the knee" />
          </label>
          <div className="row-between" style={{ gap: 8, flexWrap: 'wrap' }}>
            <span className="row-start" style={{ gap: 12 }}>
              {onGeneral && (
                <button type="button" className="link-btn small" style={{ padding: 0 }} onClick={onGeneral}>
                  Skip, minimum or log without holds
                </button>
              )}
              {moveDatesFor(view, session, today).length > 0 && (
                <button type="button" className="link-btn small" style={{ padding: 0 }} onClick={() => setMoving(!moving)}>
                  {moving ? 'Cancel move' : 'Move to another day'}
                </button>
              )}
            </span>
            <button type="button" className="btn primary" disabled={count === 0} onClick={finish}>
              {session.status === 'planned' ? 'Finish' : 'Save'}
            </button>
          </div>
          {moving && <MoveDayPicker session={session} onMoved={onClose} />}
        </>
      )}
      <span className="xsmall muted">Stretching should feel strong, never sharp. Stop any stretch that causes sharp, pinching or nerve-like pain.</span>
    </Sheet>
  );
}

function HoldRow({ hold, n, mode, done, pain, open, future, onOpen, onTick, onPain }: { hold: StretchHold; n: number; mode: 'push' | 'easy'; done: boolean; pain: boolean; open: boolean; future: boolean; onOpen: () => void; onTick: () => void; onPain: () => void }) {
  const cr = hold.cr && mode === 'push';
  return (
    <section className={`stretch-hold${done ? ' done' : ''}${pain ? ' pain' : ''}`} aria-label={hold.name}>
      <div className="stretch-hold-head">
        {!future ? (
          <button type="button" className={`set-tick${done ? ' on' : ''}`} aria-pressed={done} aria-label={`${hold.name} done`} onClick={onTick}>
            <Icon name="check" size={16} stroke={2.6} />
          </button>
        ) : (
          <span className="workout-ex-badge">{n}</span>
        )}
        <button type="button" className="stretch-hold-name" aria-expanded={open} onClick={onOpen}>
          <b>{hold.name}</b>
          <span className="xsmall muted">
            {hold.dose}
            {cr ? ' · C-R' : ''}
            {hold.knee ? ' · mind the knee' : ''}
            {pain ? ' · ⚠ hurt' : ''}
          </span>
        </button>
        <span style={{ transform: open ? 'rotate(-90deg)' : 'rotate(90deg)', display: 'inline-flex', color: 'var(--muted)', flex: 'none' }} aria-hidden="true">
          <Icon name="chevron" size={14} stroke={2.2} />
        </span>
      </div>
      {open && (
        <div className="stretch-hold-body small">
          {holdSteps(hold, mode).map((t, i) => (
            <p key={i} style={{ margin: 0 }}>
              {t}
            </p>
          ))}
          {!future && (
            <button type="button" className={`pain-toggle${pain ? ' on' : ''}`} aria-pressed={pain} onClick={onPain}>
              {pain ? '⚠ This hurt (tap to undo)' : 'Sharp or pinching pain'}
            </button>
          )}
        </div>
      )}
    </section>
  );
}

// ---------- Editing the plan (on the task) ----------

/** The day's holds, one small card each: name, how long, contract-relax, knee, how-to, push and easy notes. */
export function StretchPlanEditor({ plan, onChange }: { plan: StretchPlan; onChange: (p: StretchPlan) => void }) {
  const edit = (i: number, patch: Partial<StretchHold>) => onChange({ ...plan, holds: plan.holds.map((h, j) => (j === i ? { ...h, ...patch } : h)) });
  const move = (i: number, by: number) => {
    const j = i + by;
    if (j < 0 || j >= plan.holds.length) return;
    const holds = [...plan.holds];
    [holds[i], holds[j]] = [holds[j]!, holds[i]!];
    onChange({ ...plan, holds });
  };
  return (
    <div className="stack-sm">
      <span className="xsmall muted">The day's holds, in order. On the day, each one is ticked off; nothing is timed.</span>
      <div className="plan-ex-grid" style={{ gridTemplateColumns: 'repeat(3, minmax(0, 1fr))' }}>
        <label className="field">
          Day
          <select value={plan.day} onChange={(e) => onChange({ ...plan, day: e.target.value as 'push' | 'easy', intensity: e.target.value === 'push' ? '7–8 out of 10' : '5–6 out of 10' })}>
            <option value="push">Push (C-R)</option>
            <option value="easy">Easy (passive)</option>
          </select>
        </label>
        <label className="field">
          Intensity
          <input value={plan.intensity} onChange={(e) => onChange({ ...plan, intensity: e.target.value })} />
        </label>
        <label className="field">
          Focus
          <input value={plan.focus} onChange={(e) => onChange({ ...plan, focus: e.target.value })} placeholder="Hamstrings" />
        </label>
      </div>
      {plan.holds.map((h, i) => (
        <div key={i} className="card tight stack-sm">
          <div className="row-between" style={{ gap: 6 }}>
            <input value={h.name} onChange={(e) => edit(i, { name: e.target.value })} placeholder="Side Split" aria-label={`Hold ${i + 1} name`} style={{ flex: 1 }} />
            <span className="row-start" style={{ gap: 2, flex: 'none' }}>
              <button type="button" className="link-btn xsmall" onClick={() => move(i, -1)} aria-label="Move up">↑</button>
              <button type="button" className="link-btn xsmall" onClick={() => move(i, 1)} aria-label="Move down">↓</button>
              <button type="button" className="link-btn xsmall" onClick={() => onChange({ ...plan, holds: plan.holds.filter((_, j) => j !== i) })} aria-label="Remove hold">✕</button>
            </span>
          </div>
          <div className="plan-ex-grid" style={{ gridTemplateColumns: 'repeat(2, minmax(0, 1fr))' }}>
            <label className="field">
              How long
              <input value={h.dose} onChange={(e) => edit(i, { dose: e.target.value })} placeholder="3 min" />
            </label>
            <label className="field">
              Part
              <select value={h.part} onChange={(e) => edit(i, { part: e.target.value as 'daily' | 'focus' })}>
                <option value="daily">Daily hold</option>
                <option value="focus">Focus slot</option>
              </select>
            </label>
          </div>
          <span className="row-start small" style={{ gap: 14 }}>
            <label className="check-row small">
              <input type="checkbox" checked={!!h.cr} onChange={(e) => edit(i, { cr: e.target.checked })} />
              <span>Contract-relax on push days</span>
            </label>
            <label className="check-row small">
              <input type="checkbox" checked={!!h.knee} onChange={(e) => edit(i, { knee: e.target.checked })} />
              <span>Mind the knee</span>
            </label>
          </span>
          <textarea rows={2} value={h.how} onChange={(e) => edit(i, { how: e.target.value })} placeholder="How to get into it and what to feel" aria-label="How" />
          <input value={h.push ?? ''} onChange={(e) => edit(i, { push: e.target.value })} placeholder="Push day: (optional)" aria-label="Push day" />
          <input value={h.easy ?? ''} onChange={(e) => edit(i, { easy: e.target.value })} placeholder="Easy day: (optional)" aria-label="Easy day" />
        </div>
      ))}
      <button type="button" className="btn small" style={{ alignSelf: 'flex-start' }} onClick={() => onChange({ ...plan, holds: [...plan.holds, blankHold(plan.holds.some((h) => h.part === 'focus') ? 'focus' : 'daily')] })}>
        + Add a hold
      </button>
      <label className="field">
        Last line <span style={{ fontWeight: 400 }}>(optional)</span>
        <input value={plan.finish ?? ''} onChange={(e) => onChange({ ...plan, finish: e.target.value })} placeholder="Finish with 30 s hugging both knees to your chest" />
      </label>
    </div>
  );
}
