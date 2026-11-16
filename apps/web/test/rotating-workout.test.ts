import { test } from 'node:test';
import assert from 'node:assert/strict';
import { emptyData, type AppData } from '../src/data/model.ts';
import { applyOp } from '../src/data/model.ts';
import { fullPlanOn, isClassSession, opsChooseAgain, planOn, rotationWeek, sessionVariant } from '../src/data/progress.ts';
import type { Action, PlannedExercise, Session, WorkoutSet } from '@six/core';

const ex = (name: string, variant?: string): PlannedExercise => ({ name, sets: 3, reps_min: 8, reps_max: 10, weight: null, weight_note: '', rest: '60 sec', note: '', ...(variant ? { variant } : {}) });
const A = ['Squat', 'Romanian Deadlift', 'Chest Press Machine'];
const B = ['Leg Press', 'Chest Press Machine', 'Lat Pulldown'];
const action = { id: 'a1', title: 'Strength day', kind: 'workout', planned_minutes: 45, planned_count: null, min_label: '', min_minutes: null, min_count: null, priority: true, archived_at: null, workout_plan: [...A.map((n) => ex(n, 'A')), ...B.map((n) => ex(n, 'B'))] } as Action;
const session = (id: string, date: string | null, status: Session['status'], title = 'Strength day', logged_at: string | null = null): Session =>
  ({ id, action_id: 'a1', week_start: '2026-11-16', slot: Number(id.slice(1)), date, title, priority: true, planned_minutes: 45, planned_count: null, status, actual_minutes: null, actual_count: null, note: '', obstacles: [], origin: 'scheduled', source: 'manual', moved_from: null, logged_at }) as Session;
const sets = (sessionId: string, names: string[]): WorkoutSet[] => names.map((n, i) => ({ id: `${sessionId}-${i}`, session_id: sessionId, exercise: n, set_no: 1, weight: 20, reps: 10, done: true }) as WorkoutSet);
const TODAY = '2026-11-19';
const names = (plan: PlannedExercise[]) => plan.map((e) => e.name);

test('a rotating workout: the first one, then the other, whichever days they land on', () => {
  const s1 = session('s1', null, 'planned');
  const fresh: AppData = { ...emptyData(), actions: [action], sessions: [s1] };
  assert.equal(sessionVariant(fresh, action, s1), 'A');
  assert.deepEqual(names(planOn(fresh, action, s1, TODAY)), A, 'the card shows only the workout that is next');
  assert.equal(fullPlanOn(fresh, action, s1, TODAY).length, 6, 'the whole plan is still there to choose from');

  // Monday: workout A logged. The next open session is B, and Monday still reads as A.
  const mon = session('s2', '2026-11-16', 'done', 'Strength day', '2026-11-16T14:00:00Z');
  const after: AppData = { ...fresh, sessions: [mon, s1], workoutSets: sets('s2', A) };
  assert.equal(sessionVariant(after, action, s1), 'B');
  assert.deepEqual(names(planOn(after, action, s1, TODAY)), B);
  assert.deepEqual(names(planOn(after, action, mon, TODAY)), A);
});

test('a class instead of the gym: it counts for the week, has no sets, and does not move the rotation', () => {
  const mon = session('s1', '2026-11-16', 'done', 'Strength day', '2026-11-16T14:00:00Z');
  const tue = session('s2', '2026-11-17', 'done', 'Class: Water exercise', '2026-11-17T14:00:00Z');
  const open = session('s3', null, 'planned');
  const data: AppData = { ...emptyData(), actions: [action], sessions: [mon, tue, open], workoutSets: sets('s1', A) };
  assert.equal(isClassSession(tue), true);
  assert.deepEqual(planOn(data, action, tue, TODAY), []);
  assert.equal(sessionVariant(data, action, tue), null);
  assert.equal(sessionVariant(data, action, open), 'B', 'the class did not use up workout B');
  assert.deepEqual(rotationWeek(data, 'a1', '2026-11-16'), { gym: 1, classes: 1, planned: 3, liftedOn: ['2026-11-16'] });
  // Unchecked, it is an open gym-or-class session again.
  assert.equal(isClassSession({ ...tue, status: 'planned' }), false);
});

test('an ordinary workout is untouched: one plan, no rotation', () => {
  const plain = { ...action, id: 'a2', workout_plan: [ex('Flat DB Bench Press'), ex('Lat Pulldown')] } as Action;
  const s = { ...session('s9', '2026-11-19', 'planned'), action_id: 'a2' } as Session;
  const data: AppData = { ...emptyData(), actions: [plain], sessions: [s] };
  assert.equal(sessionVariant(data, plain, s), null);
  assert.equal(planOn(data, plain, s, TODAY), plain.workout_plan);
});

test('choosing again: a class or a logged workout is cleared, the session is open on its day, and undo brings it back', () => {
  // Logged a class, then went to the gym after all.
  const cls = session('s1', '2026-11-17', 'done', 'Class: Water exercise', '2026-11-17T14:00:00Z');
  const withClass: AppData = { ...emptyData(), actions: [action], sessions: [cls] };
  const again = opsChooseAgain(withClass, action, cls);
  const reopened = again.ops.reduce(applyOp, withClass);
  const open = reopened.sessions[0]!;
  assert.deepEqual([open.status, open.title, open.date, open.logged_at], ['planned', 'Strength day', '2026-11-17', null]);
  assert.equal(isClassSession(open), false);
  assert.equal(sessionVariant(reopened, action, open), 'A', 'the choice is back, with the next workout in turn');
  assert.deepEqual(again.undo.reduce(applyOp, reopened).sessions[0], cls);

  // Finished workout A, then it should have been something else: its sets go with it, and come back on undo.
  const gym = session('s2', '2026-11-16', 'done', 'Strength day', '2026-11-16T14:00:00Z');
  const withGym: AppData = { ...emptyData(), actions: [action], sessions: [gym], workoutSets: sets('s2', A) };
  const redo = opsChooseAgain(withGym, action, gym);
  const cleared = redo.ops.reduce(applyOp, withGym);
  assert.equal(cleared.workoutSets.length, 0);
  assert.equal(cleared.sessions[0]!.status, 'planned');
  const back = redo.undo.reduce(applyOp, cleared);
  assert.deepEqual(back.sessions[0], gym);
  assert.deepEqual(back.workoutSets.map((w) => w.exercise).sort(), [...A].sort());
});
