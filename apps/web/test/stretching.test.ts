import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addDays, clockText, crCues, holdRest, holdSets, holdSteps, missingSessionsForWeek, parseClock, type Action, type ActionSchedule, type Goal, type Plan, type Session } from '@six/core';
import { applyOp, emptyData, type AppData, type Op } from '../src/data/model.ts';
import { opsEnsureWeek, opsMoveSession, opsSaveStretch } from '../src/data/ops.ts';
import { firstMondays, opsApplySplitsPack, previewSplitsPack, type PackChoices } from '../src/data/planPack.ts';
import { STRETCH_DAYS } from '../src/data/plans/splitsBackbend.ts';

// Thursday Oct 29 2026: the plan starts tomorrow, Friday Oct 30.
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


const all = (d: AppData, grouping: PackChoices['grouping'] = 'body'): PackChoices => ({ grouping, stop: previewSplitsPack(d, TODAY).stopping.map((s) => s.action.id), moveWorkouts: true });
const titlesOn = (d: AppData, date: string) => d.sessions.filter((s) => s.date === date && s.status !== 'moved').map((s) => s.title).sort();
const liftOn = (d: AppData, date: string) => titlesOn(d, date).filter((t) => /Chest|Shoulders/.test(t));
const stretchOn = (d: AppData, date: string) => titlesOn(d, date).filter((t) => t.includes('Stretch:'));
const norm = (x: AppData) => JSON.stringify(Object.fromEntries(Object.entries(x).map(([k, v]) => [k, Array.isArray(v) ? v.map((r) => JSON.stringify(r)).sort() : v])));

/**
 * This week as it really was on Thursday: Wednesday's workout moved to Thursday, Thursday's to
 * Friday, Friday's to Saturday, and the old top-up made a copy of each on its old day (slot 1,
 * no scheduled_on): two workouts Thursday and Friday.
 */
function buggyWeek(): AppData {
  let d = base();
  const find = (id: string) => d.sessions.find((s) => s.action_id === id && s.week_start === '2026-10-26')!;
  d = run(d, [...opsMoveSession(find('w3'), '2026-10-29'), ...opsMoveSession(find('w4'), '2026-10-30'), ...opsMoveSession(find('w5'), '2026-10-31')]);
  const strip = (s: Session): Session => ({ ...s, scheduled_on: null });
  const copy = (id: string, date: string): Session => ({ ...strip(find(id)), id: `copy-${id}`, slot: 1, date });
  d = { ...d, sessions: [...d.sessions.map(strip), copy('w3', '2026-10-28'), copy('w4', '2026-10-29'), copy('w5', '2026-10-30')] };
  return d;
}

test('the preview: starts tomorrow, goes in Body, and moves the workouts from this week', () => {
  const p = previewSplitsPack(base(), TODAY);
  assert.equal(p.state, 'none');
  assert.equal(p.start, '2026-10-30');
  assert.equal(p.existingGoal?.id, 'splits');
  assert.equal(p.bodyGroup?.name, 'Body');
  assert.deepEqual(p.stopping.map((s) => s.action.title).sort(), ['Measure the splits gap', 'Stretch']);
  assert.deepEqual(p.moving.map((m) => `${m.action.title}:${m.from}->${m.to}`), ['Chest & Back B:3->4', 'Shoulders & Arms B:4->5', 'Chest & Back C:5->6']);
  assert.deepEqual(p.checks, ['2026-11-02', '2026-12-07', '2027-01-04', '2027-02-01', '2027-03-01', '2027-04-05']);
});

test('applying it: four goals in Body, sharing five stretching days and the monthly check', () => {
  const d = base();
  const { ops, goalIds } = opsApplySplitsPack(d, TODAY, all(d));
  const after = run(d, ops);
  const goals = goalIds.map((id) => after.goals.find((g) => g.id === id)!);
  assert.deepEqual(goals.map((g) => g.title), ['Front splits, both sides', 'Side (center) split', 'Chest to shins, seated and standing', 'Full backbend']);
  assert.equal(goals[0]!.id, 'splits'); // the existing goal, renamed: its history stays with it
  assert.ok(goals.every((g) => g.group_id === 'body'));
  assert.equal(after.groups.length, 1);
  assert.ok(goals.slice(1).every((g) => g.start_date === '2026-10-30'));
  const stretch = after.actions.filter((a) => a.kind === 'stretch');
  assert.equal(stretch.length, 5);
  for (const a of stretch) {
    assert.deepEqual(after.actionGoals.filter((x) => x.action_id === a.id).map((x) => x.goal_id).sort(), [...goalIds].sort());
    assert.ok(a.stretch_plan!.holds.length >= 9);
  }
  assert.deepEqual(after.schedules.filter((s) => stretch.some((a) => a.id === s.action_id)).map((s) => `${s.days[0]}@${s.effective_from}`).sort(), ['1@2026-10-30', '2@2026-10-30', '4@2026-10-30', '5@2026-10-30', '6@2026-10-30']);
  const check = after.actions.find((a) => a.title === 'Monthly flexibility check')!;
  assert.equal(after.schedules.filter((s) => s.action_id === check.id).length, 6);
  assert.equal(after.measurementTypes.filter((t) => goalIds.includes(t.goal_id ?? '')).length, 5);
});

test('this week: stretching Friday and Saturday, one workout a day Thu–Sat, the old Stretch until today', () => {
  const d = base();
  const after = run(d, opsApplySplitsPack(d, TODAY, all(d)).ops);
  assert.deepEqual(stretchOn(after, '2026-10-29'), []);
  assert.deepEqual(stretchOn(after, '2026-10-30'), ['Fri · Stretch: easy + backbend']);
  assert.deepEqual(stretchOn(after, '2026-10-31'), ['Sat · Stretch: push + split strength']);
  assert.deepEqual(stretchOn(after, '2026-11-01'), []);
  assert.deepEqual(liftOn(after, '2026-10-28'), []);
  assert.deepEqual(liftOn(after, '2026-10-29'), ['Chest & Back B']);
  assert.deepEqual(liftOn(after, '2026-10-30'), ['Shoulders & Arms B']);
  assert.deepEqual(liftOn(after, '2026-10-31'), ['Chest & Back C']);
  // The old daily Stretch: still on today, gone from tomorrow.
  assert.ok(titlesOn(after, '2026-10-29').includes('Stretch'));
  assert.ok(!titlesOn(after, '2026-10-30').includes('Stretch'));
  assert.equal(after.schedules.find((s) => s.action_id === 'stretch')!.effective_to, '2026-10-29');
  // Opening the app again changes nothing.
  assert.deepEqual(opsEnsureWeek(after, '2026-10-26'), []);
});

test('the week the move bug broke: the extra copies on Thursday and Friday come off', () => {
  const d = buggyWeek();
  assert.deepEqual(liftOn(d, '2026-10-29'), ['Chest & Back B', 'Shoulders & Arms B']);
  assert.deepEqual(liftOn(d, '2026-10-30'), ['Chest & Back C', 'Shoulders & Arms B']);
  const p = previewSplitsPack(d, TODAY);
  assert.deepEqual(p.extras.map((s) => s.id).sort(), ['copy-w3', 'copy-w4', 'copy-w5']);
  let after = run(d, opsApplySplitsPack(d, TODAY, all(d)).ops);
  after = run(after, opsEnsureWeek(after, '2026-10-26'));
  assert.deepEqual(liftOn(after, '2026-10-28'), []);
  assert.deepEqual(liftOn(after, '2026-10-29'), ['Chest & Back B']);
  assert.deepEqual(liftOn(after, '2026-10-30'), ['Shoulders & Arms B']);
  assert.deepEqual(liftOn(after, '2026-10-31'), ['Chest & Back C']);
  // A database that never got scheduled_on: the moves still hold when the app opens again.
  const noColumn = { ...after, sessions: after.sessions.map((s) => ({ ...s, scheduled_on: null })) };
  assert.deepEqual(opsEnsureWeek(noColumn, '2026-10-26').filter((o) => o.kind !== 'update'), []);
});

test('a copy you already did is kept, and the planned one on the new day comes off', () => {
  const d = buggyWeek();
  const done = { ...d, sessions: d.sessions.map((s) => (s.id === 'copy-w4' ? { ...s, status: 'done' as const } : s)) };
  const after = run(done, opsApplySplitsPack(done, TODAY, all(done)).ops);
  assert.deepEqual(liftOn(after, '2026-10-29'), ['Chest & Back B', 'Shoulders & Arms B']);
  assert.deepEqual(liftOn(after, '2026-10-30'), []);
});

test('from Nov 2: Wednesday and Sunday off, lifting and stretching Mon, Tue, Thu, Fri, Sat', () => {
  const d = base();
  let after = run(d, opsApplySplitsPack(d, TODAY, all(d)).ops);
  after = run(after, opsEnsureWeek(after, '2026-11-02'));
  for (const date of ['2026-11-02', '2026-11-03', '2026-11-05', '2026-11-06', '2026-11-07']) {
    assert.equal(stretchOn(after, date).length, 1, date);
    assert.equal(liftOn(after, date).length, 1, date);
  }
  for (const date of ['2026-11-04', '2026-11-08']) {
    assert.deepEqual([...stretchOn(after, date), ...liftOn(after, date)], [], date);
    assert.ok(!titlesOn(after, date).includes('Stretch'), date);
  }
  assert.deepEqual(liftOn(after, '2026-11-07'), ['Chest & Back C']);
  assert.ok(titlesOn(after, '2026-11-02').includes('Monthly flexibility check'));
  assert.ok(titlesOn(after, '2026-11-04').includes('Read'));
});

test('one Undo puts everything back, and applying again has nothing to do', () => {
  const d = buggyWeek();
  const { ops, undo } = opsApplySplitsPack(d, TODAY, all(d));
  const restored = run(run(d, ops), undo);
  assert.equal(norm(restored), norm(d));
  const after = run(d, ops);
  assert.equal(previewSplitsPack(after, TODAY).state, 'current');
  assert.throws(() => opsApplySplitsPack(after, TODAY, all(after)), /up to date/);
});

test('in a group of their own, and leaving the workouts alone', () => {
  const d = base();
  const after = run(d, opsApplySplitsPack(d, TODAY, { grouping: 'own', stop: [], moveWorkouts: false }).ops);
  assert.equal(after.goals.filter((g) => g.group_id === 'body').length, 1);
  assert.equal(after.groups.find((g) => g.name === 'Splits & backbend') != null, true);
  assert.equal(after.schedules.find((s) => s.action_id === 'w3')!.effective_to, null);
  assert.equal(after.schedules.find((s) => s.action_id === 'stretch')!.effective_to, null);
});

/** What the Nov 2 version left behind: its own group, schedules from Nov 2, holds without sets, old Stretch until Nov 1. */
function appliedNov2(): AppData {
  const d = buggyWeek();
  let v1 = run(d, opsApplySplitsPack(d, TODAY, { grouping: 'own', stop: previewSplitsPack(d, TODAY).stopping.map((s) => s.action.id), moveWorkouts: false }).ops);
  const stretchIds = new Set(v1.actions.filter((a) => a.kind === 'stretch').map((a) => a.id));
  const ops: Op[] = [];
  for (const s of v1.schedules) if (stretchIds.has(s.action_id)) ops.push({ kind: 'update', collection: 'schedules', id: s.id, patch: { effective_from: '2026-11-02' } });
  for (const x of v1.sessions) if (stretchIds.has(x.action_id ?? '') && x.week_start === '2026-10-26') ops.push({ kind: 'delete', collection: 'sessions', id: x.id });
  for (const a of v1.actions) if (stretchIds.has(a.id)) ops.push({ kind: 'update', collection: 'actions', id: a.id, patch: { stretch_plan: { ...a.stretch_plan!, holds: a.stretch_plan!.holds.map(({ rest: _r, ...h }) => h) } } });
  for (const g of v1.goals) if (g.start_date === '2026-10-30') ops.push({ kind: 'update', collection: 'goals', id: g.id, patch: { start_date: '2026-11-02' } });
  for (const id of ['stretch', 'gap']) {
    const s = v1.schedules.find((x) => x.action_id === id)!;
    ops.push({ kind: 'update', collection: 'schedules', id: s.id, patch: { effective_to: '2026-11-01' } });
  }
  // Workouts moved from Nov 2 only.
  for (const [id, to] of [['w3', 4], ['w4', 5], ['w5', 6]] as const) {
    const s = v1.schedules.find((x) => x.action_id === id)!;
    ops.push({ kind: 'update', collection: 'schedules', id: s.id, patch: { effective_to: '2026-11-01' } });
    ops.push({ kind: 'insert', collection: 'schedules', rows: [{ id: `nov2-${id}`, action_id: id, rule: 'days', days: [to], per_week: null, effective_from: '2026-11-02', effective_to: null }] });
  }
  v1 = run(v1, ops);
  // The old Stretch was still on this weekend.
  v1 = run(v1, opsEnsureWeek(v1, '2026-10-26'));
  return v1;
}

test('already applied the Nov 2 version: the update moves it up to tomorrow, into Body, and fixes this week', () => {
  const v1 = appliedNov2();
  assert.deepEqual(stretchOn(v1, '2026-10-30'), []);
  assert.ok(titlesOn(v1, '2026-10-31').includes('Stretch'));
  const p = previewSplitsPack(v1, TODAY);
  assert.equal(p.state, 'older');
  assert.ok(p.updates.some((u) => /Fri Oct 30 instead of Mon Nov 2/.test(u)), p.updates.join(' | '));
  assert.ok(p.updates.some((u) => /into Body/.test(u)));
  assert.ok(p.updates.some((u) => /sets and timers/.test(u)));

  const { ops, undo } = opsApplySplitsPack(v1, TODAY, all(v1));
  let after = run(v1, ops);
  after = run(after, opsEnsureWeek(after, '2026-10-26'));
  // Stretching tomorrow and Saturday; the old Stretch only through today.
  assert.deepEqual(stretchOn(after, '2026-10-30'), ['Fri · Stretch: easy + backbend']);
  assert.deepEqual(stretchOn(after, '2026-10-31'), ['Sat · Stretch: push + split strength']);
  assert.ok(!titlesOn(after, '2026-10-31').includes('Stretch'));
  // One workout a day, Saturday's Chest & Back C not on Friday.
  assert.deepEqual(liftOn(after, '2026-10-29'), ['Chest & Back B']);
  assert.deepEqual(liftOn(after, '2026-10-30'), ['Shoulders & Arms B']);
  assert.deepEqual(liftOn(after, '2026-10-31'), ['Chest & Back C']);
  // In Body; the empty group is gone.
  const pack = after.goals.filter((g) => /splits|Side \(center\)|Chest to shins|backbend/i.test(g.title));
  assert.equal(pack.length, 4);
  assert.ok(pack.every((g) => g.group_id === 'body'));
  assert.ok(!after.groups.some((g) => g.name === 'Splits & backbend'));
  assert.ok(pack.filter((g) => g.id !== 'splits').every((g) => g.start_date === '2026-10-30'));
  // The holds have their rest times back.
  assert.ok(after.actions.filter((a) => a.kind === 'stretch').every((a) => a.stretch_plan!.holds.some((h) => h.rest)));
  // Next week as before: Wed and Sun off.
  after = run(after, opsEnsureWeek(after, '2026-11-02'));
  assert.deepEqual(liftOn(after, '2026-11-04'), []);
  assert.deepEqual(liftOn(after, '2026-11-05'), ['Chest & Back B']);
  assert.equal(after.schedules.filter((s) => s.action_id === 'w3' && (s.effective_to == null || s.effective_to >= '2026-11-02')).length, 1);
  // Up to date now, and Undo goes back to the Nov 2 version exactly.
  assert.equal(previewSplitsPack(run(v1, ops), TODAY).state, 'current');
  assert.equal(norm(run(run(v1, ops), undo)), norm(v1));
});

test('the plan content follows the PDF: Daily Eight first, push and easy days, Wednesday off', () => {
  assert.deepEqual(STRETCH_DAYS.map((d) => d.day), [1, 2, 4, 5, 6]);
  assert.deepEqual(STRETCH_DAYS.map((d) => d.plan.day), ['push', 'easy', 'push', 'easy', 'push']);
  for (const d of STRETCH_DAYS) {
    assert.deepEqual(d.plan.holds.slice(0, 8).map((h) => h.part), Array(8).fill('daily'));
    assert.ok(d.plan.holds.slice(8).every((h) => h.part === 'focus'));
    // Every hold has a timer or reps to tick.
    for (const h of d.plan.holds) assert.ok(holdSets(h).every((s) => s.seconds != null || s.reps != null), h.name);
  }
  const sphinx = STRETCH_DAYS[0]!.plan.holds[7]!;
  assert.match(holdSteps(sphinx, 'push').join(' '), /cobra/);
  assert.match(holdSteps(sphinx, 'easy').join(' '), /all three as sphinx/);
});

test('sets read from the dose', () => {
  const sets = (dose: string) => holdSets({ name: 'x', dose, how: '', part: 'daily' }).map((s) => `${s.label}:${s.seconds ?? s.reps}`);
  assert.deepEqual(sets('2.5 min'), ['1:150']);
  assert.deepEqual(sets('3.5–4 min'), ['1:210']);
  assert.deepEqual(sets('5 min'), ['1:300']);
  assert.deepEqual(sets('1.5 min each leg'), ['Left:90', 'Right:90']);
  assert.deepEqual(sets('3 × 45 s'), ['1:45', '2:45', '3:45']);
  assert.deepEqual(sets('3 × 20–30 s'), ['1:20', '2:20', '3:20']);
  assert.deepEqual(sets('2 × 8–10'), ['1:8–10', '2:8–10']);
  assert.deepEqual(sets('2 × 10 each leg'), ['1:10 each leg', '2:10 each leg']);
  assert.deepEqual(sets('until it feels good'), ['1:null']);
  assert.equal(holdSets({ name: 'x', dose: '2 × 8–10', how: '', part: 'focus' })[0]!.repsTarget, 10);
  assert.equal(holdRest({ name: 'x', dose: '3 × 20–30 s', rest: '30 s', how: '', part: 'focus' }, undefined), 30);
  assert.equal(holdRest({ name: 'x', dose: '1.5 min each leg', how: '', part: 'focus' }, { label: 'Right', seconds: 90, reps: null, repsTarget: null }), 10);
});

test('contract-relax cues fit the hold', () => {
  // 90 s each leg (the band hamstring stretch): hold 15 s, then 2 rounds, as the plan says.
  const ham = crCues(90);
  assert.equal(ham.filter((c) => c.kind === 'contract').length, 2);
  assert.equal(ham.find((c) => c.kind === 'contract')!.at, 15);
  // 5 min side split: 3 rounds in the middle minutes.
  const side = crCues(300).filter((c) => c.kind === 'contract');
  assert.equal(side.length, 3);
  assert.ok(side[0]!.at >= 60 && side[2]!.at + 35 <= 240);
  assert.deepEqual(crCues(30), []);
});

test('times typed in', () => {
  assert.equal(parseClock('3:05'), 185);
  assert.equal(parseClock('3'), 180);
  assert.equal(parseClock('2.5'), 150);
  assert.equal(parseClock('45'), 45);
  assert.equal(parseClock(''), null);
  assert.equal(clockText(185), '3:05');
});

test('logging a stretching session saves each set, and Undo restores the previous log', () => {
  const d = base();
  const set = (hold: string, position: number, set_no: number, seconds: number | null, done: boolean, pain = false) => ({ hold, position, set_no, seconds, reps: null, done, pain });
  const first = opsSaveStretch(d, 'sess', [set('Side Split', 4, 1, 300, true), set('Lying Band Hamstring Stretch', 8, 1, 90, true), set('Lying Band Hamstring Stretch', 8, 2, 75, true, true)]);
  const after = run(d, first.ops);
  assert.equal(after.stretchHolds.length, 3);
  assert.deepEqual(after.stretchHolds.filter((h) => h.position === 8).map((h) => `${h.set_no}:${h.seconds}`).sort(), ['1:90', '2:75']);
  const second = opsSaveStretch(after, 'sess', [set('Side Split', 4, 1, 300, true)]);
  const after2 = run(after, second.ops);
  assert.equal(after2.stretchHolds.length, 1);
  assert.equal(run(after2, second.undo).stretchHolds.length, 3);
});

test('first Mondays', () => {
  assert.deepEqual(firstMondays('2026-11-02', '2027-02-28'), ['2026-11-02', '2026-12-07', '2027-01-04', '2027-02-01']);
  assert.deepEqual(firstMondays('2026-11-03', '2026-12-31'), ['2026-12-07']);
  assert.equal(addDays('2026-11-02', 0), '2026-11-02');
});
