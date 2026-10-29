import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addDays, holdSteps, missingSessionsForWeek, type Action, type ActionSchedule, type Goal, type Plan } from '@six/core';
import { applyOp, emptyData, type AppData, type Op } from '../src/data/model.ts';
import { opsEnsureWeek, opsSaveStretch } from '../src/data/ops.ts';
import { firstMondays, opsApplySplitsPack, previewSplitsPack } from '../src/data/planPack.ts';
import { STRETCH_DAYS } from '../src/data/plans/splitsBackbend.ts';

// Thursday Oct 29 2026: the plan starts Monday Nov 2.
const TODAY = '2026-10-29';
const run = (d: AppData, ops: Op[]) => ops.reduce(applyOp, d);
const goal = (id: string, title: string, group: string | null): Goal => ({ id, title, type: 'practice', why: '', done_means: '', unit: null, baseline_value: null, baseline_date: null, target_value: null, target_date: null, color: '#000', measurement_type_id: null, archived_at: null, group_id: group });
const action = (id: string, title: string, kind: Action['kind']): Action => ({ id, title, kind, planned_minutes: 30, planned_count: null, min_label: '', min_minutes: null, min_count: null, priority: false, archived_at: null });
const days = (id: string, d: number[], from = '2026-10-26'): ActionSchedule => ({ id: `s-${id}`, action_id: id, rule: 'days', days: d, per_week: null, effective_from: from, effective_to: null });

function base(): AppData {
  const d = emptyData();
  const season: Plan = { id: 'season', name: 'Oct 26 – Apr 26', start_date: '2026-10-26', end_date: '2027-04-26', block_days: 28, archived_at: null };
  d.plans = [season];
  d.groups = [{ id: 'body', name: 'Body', created_at: '2026-10-26T00:00:00Z', prize: 'Take IPPI 1–3' }];
  d.goals = [goal('weight', 'Lose weight', 'body'), goal('splits', 'Front and side splits', 'body')];
  d.planGoals = d.goals.map((g) => ({ id: `pg-${g.id}`, plan_id: 'season', goal_id: g.id }));
  const workouts = ['Chest & Back A', 'Shoulders & Arms A', 'Chest & Back B', 'Shoulders & Arms B', 'Chest & Back C'];
  d.actions = [action('stretch', 'Stretch', 'minutes'), action('gap', 'Measure the splits gap', 'measure'), action('read', 'Read', 'check'), ...workouts.map((t, i) => action(`w${i + 1}`, t, 'workout'))];
  d.schedules = [days('stretch', [1, 2, 3, 4, 5, 6, 7]), days('gap', [7]), days('read', [1, 2, 3, 4, 5, 6, 7]), ...workouts.map((_, i) => days(`w${i + 1}`, [i + 1]))];
  d.actionGoals = [{ id: 'ag-gap', action_id: 'gap', goal_id: 'splits' }, ...workouts.map((_, i) => ({ id: `ag-w${i + 1}`, action_id: `w${i + 1}`, goal_id: 'weight' }))];
  // This week (Oct 26 – Nov 1) already exists, and next week was looked at on Today (so it was made too).
  d.sessions = [...missingSessionsForWeek(d.actions, d.schedules, [], '2026-10-26', () => crypto.randomUUID()), ...missingSessionsForWeek(d.actions, d.schedules, [], '2026-11-02', () => crypto.randomUUID())];
  return d;
}

const all = (d: AppData) => ({ grouping: 'own' as const, stop: previewSplitsPack(d, TODAY).stopping.map((s) => s.action.id), moveWorkouts: true });
const titlesOn = (d: AppData, date: string) => d.sessions.filter((s) => s.date === date && s.status !== 'moved').map((s) => s.title).sort();

test('the preview finds the splits goal, the old stretching, and the workouts to move', () => {
  const p = previewSplitsPack(base(), TODAY);
  assert.equal(p.start, '2026-11-02');
  assert.equal(p.existingGoal?.id, 'splits');
  assert.equal(p.existingGroup?.name, 'Body');
  assert.deepEqual(p.stopping.map((s) => s.action.title).sort(), ['Measure the splits gap', 'Stretch']);
  assert.deepEqual(p.moving.map((m) => `${m.action.title}:${m.from}->${m.to}`), ['Chest & Back B:3->4', 'Shoulders & Arms B:4->5', 'Chest & Back C:5->6']);
  assert.deepEqual(p.checks, ['2026-11-02', '2026-12-07', '2027-01-04', '2027-02-01', '2027-03-01', '2027-04-05']);
});

test('applying it: four goals in their own group, sharing five stretching days and the monthly check', () => {
  const d = base();
  const { ops, goalIds } = opsApplySplitsPack(d, TODAY, all(d));
  const after = run(d, ops);
  const goals = goalIds.map((id) => after.goals.find((g) => g.id === id)!);
  assert.deepEqual(goals.map((g) => g.title), ['Front splits, both sides', 'Side (center) split', 'Chest to shins, seated and standing', 'Full backbend']);
  assert.equal(goals[0]!.id, 'splits'); // the existing goal, renamed: its history stays with it
  const group = after.groups.find((g) => g.id === goals[0]!.group_id)!;
  assert.equal(group.name, 'Splits & backbend');
  assert.ok(goals.every((g) => g.group_id === group.id));
  assert.ok(after.goals.find((g) => g.id === 'weight')!.group_id === 'body'); // Body keeps the weight goal
  const stretch = after.actions.filter((a) => a.kind === 'stretch');
  assert.equal(stretch.length, 5);
  for (const a of stretch) {
    assert.deepEqual(after.actionGoals.filter((x) => x.action_id === a.id).map((x) => x.goal_id).sort(), [...goalIds].sort());
    assert.ok(a.stretch_plan!.holds.length >= 9);
  }
  assert.deepEqual(after.schedules.filter((s) => stretch.some((a) => a.id === s.action_id)).map((s) => s.days[0]).sort(), [1, 2, 4, 5, 6]);
  const check = after.actions.find((a) => a.title === 'Monthly flexibility check')!;
  assert.equal(after.schedules.filter((s) => s.action_id === check.id).length, 6);
  assert.equal(after.measurementTypes.filter((t) => goalIds.includes(t.goal_id ?? '')).length, 5);
  assert.ok(after.measurementTypes.every((t) => t.on_today === false || !goalIds.includes(t.goal_id ?? '')));
});

test('from Nov 2: Wednesday and Sunday off, lifting and stretching Mon, Tue, Thu, Fri, Sat', () => {
  const d = base();
  let after = run(d, opsApplySplitsPack(d, TODAY, all(d)).ops);
  after = run(after, opsEnsureWeek(after, '2026-11-02'));
  const stretchOn = (date: string) => titlesOn(after, date).filter((t) => t.includes('Stretch:'));
  const liftOn = (date: string) => titlesOn(after, date).filter((t) => /Chest|Shoulders/.test(t));
  for (const date of ['2026-11-02', '2026-11-03', '2026-11-05', '2026-11-06', '2026-11-07']) {
    assert.equal(stretchOn(date).length, 1, date);
    assert.equal(liftOn(date).length, 1, date);
  }
  for (const date of ['2026-11-04', '2026-11-08']) {
    assert.deepEqual([...stretchOn(date), ...liftOn(date)], [], date);
    assert.ok(!titlesOn(after, date).includes('Stretch'), date);
  }
  assert.deepEqual(liftOn('2026-11-07'), ['Chest & Back C']);
  assert.ok(titlesOn(after, '2026-11-02').includes('Monthly flexibility check'));
  // Habits and other tasks are untouched.
  assert.ok(titlesOn(after, '2026-11-04').includes('Read'));
});

test('this week stays as it was', () => {
  const d = base();
  const after = run(d, opsApplySplitsPack(d, TODAY, all(d)).ops);
  for (const date of ['2026-10-29', '2026-10-30', '2026-10-31', '2026-11-01']) assert.deepEqual(titlesOn(after, date), titlesOn(d, date), date);
  assert.ok(titlesOn(after, '2026-10-31').includes('Stretch'));
  assert.equal(after.schedules.find((s) => s.action_id === 'stretch')!.effective_to, '2026-11-01');
});

test('one Undo puts everything back, and it can only be applied once', () => {
  const d = base();
  const { ops, undo } = opsApplySplitsPack(d, TODAY, all(d));
  const restored = run(run(d, ops), undo);
  const norm = (x: AppData) => JSON.stringify(Object.fromEntries(Object.entries(x).map(([k, v]) => [k, Array.isArray(v) ? v.map((r) => JSON.stringify(r)).sort() : v])));
  assert.equal(norm(restored), norm(d));
  assert.throws(() => opsApplySplitsPack(run(d, ops), TODAY, all(d)), /already/);
});

test('keeping the goals in the existing group, and leaving the workouts alone', () => {
  const d = base();
  const after = run(d, opsApplySplitsPack(d, TODAY, { grouping: 'existing', stop: [], moveWorkouts: false }).ops);
  assert.equal(after.goals.filter((g) => g.group_id === 'body').length, 5);
  assert.equal(after.schedules.find((s) => s.action_id === 'w3')!.effective_to, null);
  assert.equal(after.schedules.find((s) => s.action_id === 'stretch')!.effective_to, null);
});

test('the plan content follows the PDF: Daily Eight first, push and easy days, Wednesday off', () => {
  assert.deepEqual(STRETCH_DAYS.map((d) => d.day), [1, 2, 4, 5, 6]);
  assert.deepEqual(STRETCH_DAYS.map((d) => d.plan.day), ['push', 'easy', 'push', 'easy', 'push']);
  for (const d of STRETCH_DAYS) {
    assert.deepEqual(d.plan.holds.slice(0, 8).map((h) => h.part), Array(8).fill('daily'));
    assert.ok(d.plan.holds.slice(8).every((h) => h.part === 'focus'));
  }
  const sphinx = STRETCH_DAYS[0]!.plan.holds[7]!;
  assert.match(holdSteps(sphinx, 'push').join(' '), /cobra/);
  assert.match(holdSteps(sphinx, 'easy').join(' '), /all three as sphinx/);
});

test('logging a stretching session saves each hold, and Undo restores the previous log', () => {
  const d = base();
  const first = opsSaveStretch(d, 'sess', [{ hold: 'Side Split', done: true, pain: false }, { hold: 'Frog Stretch', done: false, pain: true }]);
  const after = run(d, first.ops);
  assert.equal(after.stretchHolds.length, 2);
  const second = opsSaveStretch(after, 'sess', [{ hold: 'Side Split', done: true, pain: false }]);
  const after2 = run(after, second.ops);
  assert.equal(after2.stretchHolds.length, 1);
  assert.equal(run(after2, second.undo).stretchHolds.length, 2);
});

test('first Mondays', () => {
  assert.deepEqual(firstMondays('2026-11-02', '2027-02-28'), ['2026-11-02', '2026-12-07', '2027-01-04', '2027-02-01']);
  assert.deepEqual(firstMondays('2026-11-03', '2026-12-31'), ['2026-12-07']);
  assert.equal(addDays('2026-11-02', 0), '2026-11-02');
});
