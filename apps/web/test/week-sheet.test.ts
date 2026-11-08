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
