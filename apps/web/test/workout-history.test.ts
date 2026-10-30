import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  addDays,
  buildSnapshot,
  describePlanChange,
  e1rm,
  e1rmAdjusted,
  estimateMinutes,
  repsLeft,
  renderReport,
  type HistoryInput,
  type WHExercise,
  type WHExerciseLog,
  type WHSession,
  type WHSet,
} from '../../../supabase/functions/_shared/workout_history.ts';

// Six weeks of a Mon/Wed/Fri plan ending Fri Oct 30 2026. Bench goes up every week; lat pulldown
// stalls at 100 lb from week 2; lateral raises sit at the top of the range for the last 2 sessions;
// one missed workout; a knee note and a pain flag on crunches. Efforts are 1–10 per exercise.
const AS_OF = '2026-10-30';
const FIRST_MONDAY = '2026-09-21';

const bench: WHExercise = { name: 'Flat DB Bench Press', sets: 3, reps_min: 8, reps_max: 12, weight: 50, rest: '2 min', note: '' };
const lat: WHExercise = { name: 'Lat Pulldown', sets: 3, reps_min: 8, reps_max: 12, weight: 100, rest: '2 min', note: 'Elbows to back pockets' };
const raise: WHExercise = { name: 'Seated Lateral Raise', sets: 3, reps_min: 12, reps_max: 15, weight: 12.5, rest: '60 sec', note: '' };
const crunch: WHExercise = { name: 'Sit-Up Bench Crunch', sets: 2, reps_min: 12, reps_max: 15, weight: null, weight_note: 'bodyweight', rest: '45 sec', note: '' };

function input(): HistoryInput {
  const sessions: WHSession[] = [];
  const sets: WHSet[] = [];
  const exerciseLogs: WHExerciseLog[] = [];
  const add = (id: string, date: string, title: string, actionId: string, status: string, rows: [WHExercise, number | null, number[], number | null, boolean?][], note = '') => {
    sessions.push({ id, action_id: actionId, date, week_start: date, title, status, planned_minutes: 45, actual_minutes: status === 'done' ? 42 : null, note, effort: 7 });
    for (const [ex, w, reps, effort, pain] of rows) {
      reps.forEach((r, i) => sets.push({ session_id: id, exercise: ex.name, set_no: i + 1, weight: w, reps: r, done: true }));
      if (effort != null || pain) exerciseLogs.push({ session_id: id, exercise: ex.name, effort, pain: !!pain, pain_where: pain ? 'Knee' : '', note: pain ? 'pulled on the knee' : '' });
    }
  };
  for (let wk = 0; wk < 6; wk++) {
    const mon = addDays(FIRST_MONDAY, wk * 7);
    add(`mon${wk}`, mon, 'Upper A', 'a', 'done', [[bench, 40 + wk * 2.5, [10, 10, 9], 8], [lat, wk === 0 ? 95 : 100, [10, 10, 9], 9]]);
    const wed = addDays(mon, 2);
    if (wk === 4) sessions.push({ id: `wed${wk}`, action_id: 'b', date: wed, week_start: mon, title: 'Upper B', status: 'planned', planned_minutes: 45, actual_minutes: null, note: '' });
    else add(`wed${wk}`, wed, 'Upper B', 'b', 'done', [[raise, 12.5, wk >= 4 ? [15, 15, 15] : [13, 12, 12], 7], [crunch, null, [15, 14], null, wk === 5]], wk === 5 ? 'knee felt off on the crunches' : '');
    const fri = addDays(mon, 4);
    if (fri <= AS_OF) add(`fri${wk}`, fri, 'Upper C', 'c', 'done', [[bench, 40 + wk * 2.5, [8, 8, 8], 8]]);
  }
  return {
    profile: { units: 'lb', timezone: 'America/New_York', coach_share_bodyweight: true },
    actions: [
      { id: 'a', title: 'Upper A', kind: 'workout', planned_minutes: 45, archived_at: null, workout_plan: [bench, lat], details: 'Warm up 5 min' },
      { id: 'b', title: 'Upper B', kind: 'workout', planned_minutes: 45, archived_at: null, workout_plan: [raise, crunch] },
      { id: 'c', title: 'Upper C', kind: 'workout', planned_minutes: 45, archived_at: null, workout_plan: [bench] },
      { id: 'x', title: 'Read', kind: 'check', planned_minutes: 20, archived_at: null },
    ],
    schedules: [
      { action_id: 'a', rule: 'days', days: [1], per_week: null, effective_from: '2026-09-21', effective_to: null },
      { action_id: 'b', rule: 'days', days: [3], per_week: null, effective_from: '2026-09-21', effective_to: null },
      { action_id: 'c', rule: 'days', days: [5], per_week: null, effective_from: '2026-09-21', effective_to: null },
      { action_id: 'x', rule: 'days', days: [1, 2, 3, 4, 5, 6, 7], per_week: null, effective_from: '2026-09-21', effective_to: null },
    ],
    sessions: [...sessions, { id: 'read1', action_id: 'x', date: '2026-10-29', week_start: '2026-10-26', title: 'Read', status: 'done', planned_minutes: 20, actual_minutes: 20, note: 'not a workout' }],
    sets,
    planVersions: [
      { action_id: 'a', plan: [{ ...bench, weight: 40 }, { ...lat, weight: 95 }], effective_on: '2026-09-21', source: 'backfill', created_at: '2026-09-21T10:00:00Z' },
      { action_id: 'a', plan: [bench, lat], effective_on: '2026-09-28', source: 'app', created_at: '2026-09-28T10:00:00Z' },
      { action_id: 'b', plan: [raise, { ...crunch }], effective_on: '2026-09-21', source: 'backfill' },
      { action_id: 'c', plan: [bench], effective_on: '2026-09-21', source: 'backfill' },
    ],
    measurementTypes: [{ id: 'w', name: 'Weight', unit: 'lb' }, { id: 's', name: 'Front split (left): front hip to floor', unit: 'in' }, { id: 'wa', name: 'Waist', unit: 'in' }, { id: 'ar', name: 'Right arm', unit: 'in' }],
    measurements: [
      ...Array.from({ length: 28 }, (_, i) => ({ type_id: 'w', value: 195 - i * 0.2, measured_on: addDays(AS_OF, -27 + i) })),
      ...Array.from({ length: 6 }, (_, i) => ({ type_id: 'wa', value: 38 - i * 0.25, measured_on: addDays('2026-09-27', i * 7) })),
      ...Array.from({ length: 6 }, (_, i) => ({ type_id: 'ar', value: 14.5, measured_on: addDays('2026-09-27', i * 7) })),
      { type_id: 's', value: 9, measured_on: '2026-10-25' },
    ],
    exerciseLogs,
    reports: [
      {
        id: 'r1',
        as_of: '2026-10-23',
        recommendation: 'change',
        change_level: 1,
        decision: { recommendation: 'change', change_level: 1, summary: 'Add reps on lateral raises', changes: [{ workout: 'Upper B', type: 'reps', exercise: 'Seated Lateral Raise', from: { reps_min: 10, reps_max: 12 }, to: { reps_min: 12, reps_max: 15 }, reason: 'top of range' }] },
        user_status: null,
        user_note: '',
      },
    ],
  };
}

test('only workouts you logged are in the snapshot: no missed or planned days', () => {
  const s = buildSnapshot(input(), { asOf: AS_OF });
  assert.ok(s.sessions.every((x) => x.workout !== 'Read'));
  assert.equal(s.sessions.find((x) => x.date === '2026-10-21'), undefined);
  assert.equal(s.sessions.at(-1)!.effort, 7);
  assert.equal(s.program.workouts.length, 3);
  assert.equal(s.program.workouts_per_week, 3);
  assert.deepEqual(s.program.workouts[0]!.days, [1]);
});

test('what you did, week by week, with nothing compared to the plan', () => {
  const s = buildSnapshot(input(), { asOf: AS_OF });
  // 4 weeks back from Fri Oct 30 = Oct 3 .. Oct 30: 12 workouts on the calendar, the Wednesday of Oct 21 not done.
  assert.equal(s.metrics.workouts_done_4w, 11);
  assert.equal(s.metrics.days_since_last_workout, 0);
  assert.equal(s.metrics.weeks.length, 8);
  assert.deepEqual(s.metrics.weeks.at(-2), { week_start: '2026-10-19', workouts: 2, sets: 9, avg_effort: 7 });
  assert.equal(s.metrics.weeks[0]!.workouts, 0);
  const json = JSON.stringify(s.metrics);
  for (const gone of ['attendance', 'planned', 'top_of_range', 'set_completion']) assert.ok(!json.includes(gone), gone);
});

test('per-exercise metrics: progressing, stalled, ready to move up, pain', () => {
  const s = buildSnapshot(input(), { asOf: AS_OF });
  const by = (n: string) => s.metrics.exercises.find((e) => e.exercise === n)!;
  assert.ok((by('Flat DB Bench Press').e1rm_trend_pct ?? 0) > 0);
  assert.equal(by('Lat Pulldown').stalled, true);
  assert.ok((by('Lat Pulldown').weeks_since_gain ?? 0) >= 3);
  assert.equal(by('Seated Lateral Raise').next_step_pct, 0.4);
  assert.equal(by('Sit-Up Bench Crunch').pain_flags_4w, 1);
  assert.equal(by('Sit-Up Bench Crunch').e1rm_now, null);
  // As done: the last workouts of an exercise, with effort.
  const r = by('Seated Lateral Raise');
  assert.deepEqual(r.recent.at(-1), { date: '2026-10-28', weight: 12.5, reps: [15, 15, 15], weights: [12.5, 12.5, 12.5], effort: 7, pain: false, e1rm: 18.8, e1rm_adj: 20 });
  assert.equal(r.sessions_at_weight, 5);
  assert.equal(r.effort_last, 7);
  assert.equal(by('Lat Pulldown').avg_effort_2w, 9);
  assert.equal(by('Lat Pulldown').sessions_at_weight, 5);
  assert.equal(by('Flat DB Bench Press').sessions_at_weight, 2);
});

test('body measurements: shared with body weight, flexibility tests left out', () => {
  const s = buildSnapshot(input(), { asOf: AS_OF });
  assert.deepEqual(s.body_measurements.map((b) => b.name), ['Right arm', 'Waist']);
  const waist = s.body_measurements.find((b) => b.name === 'Waist')!;
  assert.deepEqual(waist.latest, { date: '2026-10-25', value: 37 });
  assert.equal(waist.change_4w, -1);
  assert.equal(s.body_measurements.find((b) => b.name === 'Right arm')!.change_4w, 0);
  const off = input();
  off.profile.coach_share_bodyweight = false;
  assert.deepEqual(buildSnapshot(off, { asOf: AS_OF }).body_measurements, []);
});

test('exercise notes and hurt flags come through per workout', () => {
  const s = buildSnapshot(input(), { asOf: AS_OF });
  const wed = s.sessions.find((x) => x.date === '2026-10-28')!;
  assert.deepEqual(wed.exercises.find((l) => l.exercise === 'Sit-Up Bench Crunch'), { exercise: 'Sit-Up Bench Crunch', effort: null, pain: true, pain_where: 'Knee', note: 'pulled on the knee' });
  assert.ok(s.comments.some((c) => c.source === 'exercise_note' && c.text.includes('(hurt: knee) pulled on the knee')));
});

test('plan history: program age, last change, describe the change', () => {
  const s = buildSnapshot(input(), { asOf: AS_OF });
  assert.equal(s.program.last_target_change_on, '2026-09-28');
  assert.equal(s.program.last_structural_change_on, null);
  assert.equal(s.program.program_age_weeks, 5);
  assert.equal(describePlanChange([{ ...bench, weight: 40 }], [bench, raise], 'lb'), 'Flat DB Bench Press 40 → 50 lb; Seated Lateral Raise added');
});

test('a workout without recorded versions falls back to its current plan', () => {
  const i = input();
  i.planVersions = [];
  const s = buildSnapshot(i, { asOf: AS_OF });
  assert.equal(s.program.workouts[0]!.versions[0]!.source, 'current');
  assert.equal(s.program.workouts[0]!.current_since, '2026-09-21');
});

test('decisions: what became of the last report, and what is new since', () => {
  const s = buildSnapshot(input(), { asOf: AS_OF });
  assert.equal(s.decisions.length, 1);
  assert.equal(s.decisions[0]!.inferred_status, 'applied');
  assert.equal(s.since_last?.last_report_as_of, '2026-10-23');
  assert.deepEqual(s.since_last?.sessions, ['2026-10-26 Upper A (done)', '2026-10-28 Upper B (done)', '2026-10-30 Upper C (done)']);
});

test('body weight: weekly averages and trend, or nothing when sharing is off', () => {
  const s = buildSnapshot(input(), { asOf: AS_OF });
  assert.equal(s.bodyweight.shared, true);
  if (s.bodyweight.shared) assert.equal(s.bodyweight.trend_per_week, -1.4);
  const off = input();
  off.profile.coach_share_bodyweight = false;
  assert.deepEqual(buildSnapshot(off, { asOf: AS_OF }).bodyweight, { shared: false });
});

test('the snapshot is a pure function: same data, same fingerprint; an edited past log changes it', () => {
  const a = buildSnapshot(input(), { asOf: AS_OF });
  const b = buildSnapshot(input(), { asOf: AS_OF });
  assert.equal(a.meta.fingerprint, b.meta.fingerprint);
  const edited = input();
  edited.sets[0]!.reps = 12;
  assert.notEqual(buildSnapshot(edited, { asOf: AS_OF }).meta.fingerprint, a.meta.fingerprint);
  // As of an earlier date, later workouts don't exist.
  const earlier = buildSnapshot(input(), { asOf: '2026-10-09' });
  assert.ok(earlier.sessions.every((x) => x.date <= '2026-10-09'));
  assert.equal(earlier.decisions.length, 0);
});

test('older weeks are summarised; the last 8 weeks are set by set', () => {
  const s = buildSnapshot(input(), { asOf: AS_OF, detailWeeks: 2 });
  assert.ok(s.sessions.every((x) => x.date >= '2026-10-19'));
  assert.ok(s.history.some((h) => h.week_start === '2026-09-21' && h.exercise === 'Lat Pulldown' && h.best_weight === 95));
});

test('the report reads like a report', () => {
  const md = renderReport(buildSnapshot(input(), { asOf: AS_OF }));
  for (const heading of ['# Workout history', '## At a glance', '## New since the last coach report', '## The program now', '## Exercise by exercise', '## Plan changes', '## Your notes', '## Coach decisions so far']) assert.ok(md.includes(heading), heading);
  assert.match(md, /Lat Pulldown \| 100 × 10, 10, 9 @9 \|/);
  assert.match(md, /stalled \d+ wks/);
  assert.match(md, /⚠ hurt/);
  assert.match(md, /effort 8/);
  assert.match(md, /Waist \| 37 in on Oct 25 · -1 in over 4 weeks/);
  assert.match(md, /knee felt off/);
  assert.match(md, /Body weight \| 189\.6 lb/);
});

test('helpers', () => {
  assert.equal(e1rm(100, 10), 133.3);
  assert.equal(e1rm(null, 10), null);
  assert.equal(e1rm(100, 20), null);
  assert.deepEqual([10, 9, 8, 5, 4, 1].map(repsLeft), [0, 1, 2, 5, 6, 6]);
  assert.equal(e1rmAdjusted(100, 10, 8), 140);
  assert.equal(e1rmAdjusted(100, 10, null), null);
  assert.equal(e1rmAdjusted(100, 18, 5), null);
  assert.equal(estimateMinutes([bench, lat]), 5 + Math.round((6 * (45 + 120)) / 60));
});
