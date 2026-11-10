import { test } from 'node:test';
import assert from 'node:assert/strict';
import { emptyData, type AppData } from '../src/data/model.ts';
import { capPlan } from '../src/data/progress.ts';
import { sheetMonday, weekSheet, weekSheetHtml } from '../src/data/weekSheet.ts';
import type { Action, ActionSchedule, PlannedExercise, Session, WorkoutReport, WorkoutSet } from '@six/core';

const ex = (name: string, sets: number, lo: number, hi: number, weight: number | null, weight_note = ''): PlannedExercise => ({ name, sets, reps_min: lo, reps_max: hi, weight, weight_note, rest: '60 sec', note: '' });
const action: Action = {
  id: 'a1',
  title: 'Shoulders & Arms B',
  kind: 'workout',
  planned_minutes: 60,
  planned_count: null,
  min_label: '',
  min_minutes: null,
  min_count: null,
  priority: false,
  archived_at: null,
  workout_plan: [ex('Flat DB Bench Press', 3, 8, 12, 55), ex('Cable Lateral Raise', 3, 10, 12, 7.5), ex('Low-Incline DB Fly', 3, 12, 15, 25), ex('Sit-Up Bench Crunch (knee test)', 3, 12, 15, null, 'bodyweight')],
} as Action;
const schedule: ActionSchedule = { id: 'sc1', action_id: 'a1', rule: 'days', days: [5], per_week: null, effective_from: '2026-10-01', effective_to: null };
const done: Session = { id: 's1', action_id: 'a1', week_start: '2026-11-02', slot: 0, date: '2026-11-06', title: 'Shoulders & Arms B', priority: false, planned_minutes: 60, planned_count: null, status: 'done', actual_minutes: 60, actual_count: null, note: '', obstacles: [], origin: 'schedule', source: '', moved_from: null, logged_at: null } as Session;
const sets = (name: string, w: number | null, reps: number[]): WorkoutSet[] => reps.map((r, i) => ({ id: `${name}${i}`, session_id: 's1', exercise: name, set_no: i + 1, weight: w, reps: r, done: true }) as WorkoutSet);
const report = {
  id: 'r1',
  kind: 'coach',
  as_of: '2026-11-08',
  user_status: null,
  recommendation: 'change',
  decision: {
    recommendation: 'change',
    change_level: 4,
    summary: 'Swap the raise.',
    changes: [{ workout: 'Shoulders & Arms B', action_id: 'a1', type: 'swap', exercise: 'Cable Lateral Raise', from: { name: 'Cable Lateral Raise' }, to: { name: 'Seated Lateral Raise', weight: 10 }, reason: 'It hurt the left wrist.' }],
  },
} as unknown as WorkoutReport;

const base = (): AppData => ({
  ...emptyData(),
  actions: [action],
  schedules: [schedule],
  sessions: [done],
  workoutSets: [...sets('Flat DB Bench Press', 55, [12, 12, 12]), ...sets('Low-Incline DB Fly', 25, [15, 15, 15]), ...sets('Sit-Up Bench Crunch (knee test)', null, [15, 15, 15])],
  workoutReports: [report],
  profile: { ...emptyData().profile, units: 'lb', training_rules: { max_reps: 12, iso_steps: { dumbbell: 5, cable: 5 } } },
});

test('a rep cap brings long ranges down to it and leaves bodyweight lifts alone', () => {
  assert.deepEqual([capPlan(ex('Fly', 3, 12, 15, 25), 12).reps_min, capPlan(ex('Fly', 3, 12, 15, 25), 12).reps_max], [10, 12]);
  assert.equal(capPlan(ex('Flat DB Bench Press', 3, 8, 12, 55), 12).reps_min, 8);
  assert.equal(capPlan(ex('Sit-Up Bench Crunch', 3, 12, 15, null, 'bodyweight'), 12).reps_max, 15);
  assert.equal(capPlan(ex('Fly', 3, 12, 15, 25), 0).reps_max, 15);
});

test("the week sheet lays the coach's swap over the plan and gives every lift its next target", () => {
  const sheet = weekSheet(base(), '2026-11-09', '2026-11-08');
  assert.equal(sheet.days.length, 1);
  const day = sheet.days[0]!;
  assert.match(day.title, /^Friday · Nov 13 · Shoulders & Arms B/);
  const row = (name: string) => day.rows.find((r) => r.name === name)!;
  assert.equal(row('Flat DB Bench Press').weight, '60 lb');
  assert.equal(row('Flat DB Bench Press').tag, 'UP');
  assert.equal(row('Seated Lateral Raise').tag, 'SWAP');
  assert.equal(row('Seated Lateral Raise').last, 'replaces Cable Lateral Raise');
  assert.ok(!day.rows.some((r) => r.name === 'Cable Lateral Raise'));
  // 15s at 25 lb under a 12-rep cap: a set before a 20% jump.
  assert.equal(row('Low-Incline DB Fly').setsReps, '4 × 10–12');
  assert.equal(row('Low-Incline DB Fly').tag, '+1 SET');
  assert.equal(row('Sit-Up Bench Crunch (knee test)').setsReps, '3 × 12–15');
  assert.ok(sheet.summary.some((s) => s.includes('Coach changes') && s.includes('Seated Lateral Raise')));
  const html = weekSheetHtml(sheet);
  assert.match(html, /This Week's Lifting/);
  assert.match(html, /Week of Nov 9, 2026/);
});

test('a declined report stays off the sheet, and Sunday opens next week', () => {
  const data = { ...base(), workoutReports: [{ ...report, user_status: 'declined' } as WorkoutReport] };
  const sheet = weekSheet(data, '2026-11-09', '2026-11-08');
  assert.ok(sheet.days[0]!.rows.some((r) => r.name === 'Cable Lateral Raise'));
  assert.equal(sheet.coach, null);
  assert.equal(sheetMonday('2026-11-08'), '2026-11-09');
  assert.equal(sheetMonday('2026-11-11'), '2026-11-09');
});

test('push-ups: Monday test sets, Thursday training sets from it, all outside the rep cap', () => {
  const pushAction = {
    ...action,
    id: 'p1',
    title: 'Chest & Back B',
    workout_plan: [ex('Push-Up Training Sets', 10, 17, 17, null, 'bodyweight'), ex('Paused Push-Ups', 3, 8, 12, null, 'bodyweight')],
  } as Action;
  const monday: Session = { ...done, id: 's9', action_id: 'other', date: '2026-11-16', week_start: '2026-11-16' } as Session;
  const data: AppData = {
    ...base(),
    actions: [pushAction],
    schedules: [{ ...schedule, id: 'sc9', action_id: 'p1', days: [4] }],
    sessions: [monday],
    workoutSets: [40, 30, 26, 22, 20].map((r, i) => ({ id: `x${i}`, session_id: 's9', exercise: 'Push-Up Max Sets', set_no: i + 1, weight: null, reps: r, done: true }) as WorkoutSet),
    workoutReports: [],
  };
  const sheet = weekSheet(data, '2026-11-16', '2026-11-17');
  const rows = sheet.days[0]!.rows;
  assert.equal(rows[0]!.setsReps, 'up to 10 × 20');
  assert.equal(rows[0]!.weight, 'bodyweight');
  assert.equal(rows[1]!.setsReps, '3 × 8–12');
  assert.ok(sheet.summary.some((s) => s.includes('Push-ups') && s.includes('last test 40') && s.includes('Thursday: up to 10 × 20')));
});

test("a plan change doesn't rewrite a workout already done: past days show the plan they had", async () => {
  const { planOn } = await import('../src/data/progress.ts');
  const old = [ex('Machine Chest Press', 3, 10, 12, 60)];
  const now = [ex('Push-Ups', 5, 21, 21, null, 'bodyweight')];
  const act = { ...action, id: 'm1', workout_plan: now } as Action;
  const data: AppData = {
    ...base(),
    planVersions: [
      { id: 'v1', action_id: 'm1', plan: old, effective_on: '2026-11-03', created_at: '2026-11-03T20:00:00Z' },
      { id: 'v2', action_id: 'm1', plan: now, effective_on: '2026-11-10', created_at: '2026-11-10T13:25:00Z' },
    ] as AppData['planVersions'],
  };
  const monday = { ...done, action_id: 'm1', date: '2026-11-09', logged_at: '2026-11-09T18:00:00Z' } as Session;
  assert.equal(planOn(data, act, monday, '2026-11-10')[0]!.name, 'Machine Chest Press');
  assert.equal(planOn(data, act, { ...monday, date: '2026-11-16' } as Session, '2026-11-10')[0]!.name, 'Push-Ups');
  assert.equal(planOn(data, act, { ...monday, date: '2026-11-10' } as Session, '2026-11-10')[0]!.name, 'Push-Ups');
  // A change made later on the same day as a logged workout doesn't reach back into it.
  const tuesdayLogged = { ...monday, date: '2026-11-10', logged_at: '2026-11-10T09:00:00Z' } as Session;
  assert.equal(planOn(data, act, tuesdayLogged, '2026-11-11')[0]!.name, 'Machine Chest Press');
});
