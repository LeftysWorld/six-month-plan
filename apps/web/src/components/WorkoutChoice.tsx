import { useState } from 'react';
import { CLASS_PREFIX, addDays, classOf, planVariants, variantName, variantPlan, weekStart, type Action, type PlannedExercise, type Session } from '@six/core';
import { useStore } from '../data/store.tsx';
import type { Op } from '../data/model.ts';
import { opsLogSession, opsRestoreSession } from '../data/ops.ts';
import { rotationWeek, sessionVariant } from '../data/progress.ts';
import { Sheet, useToast } from './ui.tsx';

/** Classes to offer before you've logged any of your own. */
const CLASS_IDEAS = ['Water exercise', 'Strength class', 'Yoga', 'Stretch', 'Cycle', 'Dance'];

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/**
 * A rotating workout, opened on its day: the gym (one of its workouts, the next in turn first) or
 * a class instead. Picking a workout opens its log; a class is logged done under its name.
 */
export function WorkoutChoice({
  session,
  action,
  plan,
  onPick,
  onGeneral,
  onClose,
}: {
  session: Session;
  action: Action;
  /** The whole plan: every workout the task rotates between. */
  plan: PlannedExercise[];
  onPick: (variant: string) => void;
  onGeneral: () => void;
  onClose: () => void;
}) {
  const { data, today, commit } = useStore();
  const toast = useToast();
  const variants = planVariants(plan);
  const next = sessionVariant(data, action, session, plan);
  const day = session.date ?? today;
  const future = day > today;
  const week = rotationWeek(data, action.id, weekStart(day));
  const yesterday = addDays(day, -1);
  const liftedYesterday = rotationWeek(data, action.id, weekStart(yesterday)).liftedOn.includes(yesterday);
  // Classes you've logged before come first, newest first, then a few common ones.
  const mine = data.sessions
    .filter((s) => s.action_id === action.id && s.status !== 'planned')
    .sort((a, b) => ((a.logged_at ?? '') < (b.logged_at ?? '') ? 1 : -1))
    .map((s) => classOf(s.title))
    .filter((name): name is string => name != null);
  const ideas = [...new Set([...mine, ...CLASS_IDEAS])].slice(0, 8);
  const [name, setName] = useState(mine[0] ?? '');

  function logClass() {
    const title = name.trim();
    if (!title || future) return;
    const before = session;
    const retitle: Op = { kind: 'update', collection: 'sessions', id: session.id, patch: { title: `${CLASS_PREFIX}${title}` } };
    commit([...opsLogSession(session, { status: 'done', on: today }), retitle]);
    toast(`${title}: done`, () => commit(opsRestoreSession(before)));
    onClose();
  }

  return (
    <Sheet title={action.title} onClose={onClose}>
      <div className="small muted">
        This week so far: {plural(week.gym, 'gym day', 'gym days')}, {plural(week.classes, 'class', 'classes')}.
        {liftedYesterday ? ' You lifted yesterday: a class today gives those muscles their day off.' : ''}
      </div>
      <div className="stack-sm">
        <div className="xsmall muted">The gym</div>
        {variants.map((v) => {
          const exercises = variantPlan(plan, v);
          return (
            <button key={v} type="button" className={`btn${v === next ? ' primary' : ''}`} style={{ textAlign: 'left' }} onClick={() => onPick(v)}>
              <span style={{ display: 'block' }}>
                {variantName(v)}
                {v === next ? ' · next up' : ''}
              </span>
              <span className="xsmall" style={{ display: 'block', opacity: 0.8, fontWeight: 400 }}>
                {exercises
                  .slice(0, 4)
                  .map((e) => e.name)
                  .join(', ')}
                {exercises.length > 4 ? ` and ${exercises.length - 4} more` : ''}
              </span>
            </button>
          );
        })}
      </div>
      <div className="stack-sm">
        <label className="field">
          Or a class instead
          <input type="text" value={name} placeholder="Which class?" onChange={(e) => setName(e.target.value)} />
        </label>
        <div className="chips" role="group" aria-label="Classes">
          {ideas.map((idea) => (
            <button key={idea} type="button" className="chip" aria-pressed={name.trim() === idea} onClick={() => setName(idea)}>
              {idea}
            </button>
          ))}
        </div>
        <button type="button" className="btn" disabled={!name.trim() || future} onClick={logClass}>
          {future ? 'Log the class on its day' : 'Log the class as done'}
        </button>
      </div>
      <button type="button" className="link-btn small" style={{ alignSelf: 'flex-start', padding: 0 }} onClick={onGeneral}>
        Skip, move or log it another way
      </button>
    </Sheet>
  );
}
