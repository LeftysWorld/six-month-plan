import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyOp, emptyData, type AppData, type Op } from '../src/data/model.ts';
import { opsLinkGoals, opsRecordReading, opsSetTaskGoals, opsShareTask, opsUnshareTask } from '../src/data/connect.ts';
import { View } from '../src/data/derive.ts';
import { prepGaps } from '@six/core';
import type { Goal } from '@six/core';

const goal = (id: string, title: string): Goal => ({ id, title, type: 'practice', why: '', done_means: '', unit: null, baseline_value: null, baseline_date: null, target_value: null, target_date: null, color: '#000', measurement_type_id: null, archived_at: null });
const run = (data: AppData, ops: Op[]) => ops.reduce(applyOp, data);

function base(): AppData {
  const d = emptyData();
  d.goals = [goal('gym', 'Work out'), goal('weight', 'Lose weight'), goal('guitar', 'Guitar')];
  d.actions = [{ id: 'lift', title: 'Gym', kind: 'workout', planned_minutes: 60, planned_count: null, min_label: '', min_minutes: null, min_count: null, priority: false, archived_at: null }];
  d.actionGoals = [{ id: 'ag1', action_id: 'lift', goal_id: 'gym' }];
  return d;
}

test('connecting two goals makes one link whichever way round, and updates its note', () => {
  let d = run(base(), opsLinkGoals(base(), 'gym', 'weight', 'gym helps'));
  assert.equal(d.goalLinks.length, 1);
  d = run(d, opsLinkGoals(d, 'weight', 'gym', 'gym helps'));
  assert.equal(d.goalLinks.length, 1, 'no duplicate the other way round');
  d = run(d, opsLinkGoals(d, 'weight', 'gym', 'new note'));
  assert.equal(d.goalLinks[0]!.note, 'new note');
  assert.deepEqual(opsLinkGoals(d, 'gym', 'gym', ''), [], 'a goal cannot connect to itself');
});

test('sharing a task connects goals; unsharing keeps it on the other goal', () => {
  let d = run(base(), opsShareTask(base(), 'lift', 'weight'));
  assert.deepEqual(opsShareTask(d, 'lift', 'weight'), [], 'sharing twice does nothing');
  const view = new View(d, '2026-10-25', 0.5);
  const c = view.connectionsFor('gym');
  assert.equal(c.length, 1);
  assert.equal(c[0]!.goal.id, 'weight');
  assert.equal(c[0]!.sameGroup, false, 'connected through the task, not a group');
  assert.deepEqual(c[0]!.shared.map((a) => a.id), ['lift']);
  d = run(d, opsUnshareTask(d, 'lift', 'weight'));
  assert.deepEqual(d.actionGoals.map((ag) => ag.goal_id), ['gym']);
  assert.equal(new View(d, '2026-10-25', 0.5).connectionsFor('gym').length, 0);
});

test("setting a task's goals adds and removes links but never leaves it with none", () => {
  let d = run(base(), opsSetTaskGoals(base(), 'lift', ['gym', 'weight']));
  assert.deepEqual(d.actionGoals.map((ag) => ag.goal_id).sort(), ['gym', 'weight']);
  d = run(d, opsSetTaskGoals(d, 'lift', ['weight']));
  assert.deepEqual(d.actionGoals.map((ag) => ag.goal_id), ['weight']);
  assert.deepEqual(opsSetTaskGoals(d, 'lift', []), []);
});

test('a reading replaces the one already saved that day, and undo puts it back', () => {
  let d = base();
  d.measurementTypes = [{ id: 'w', name: 'Weight', unit: 'lb', cadence_days: 1, goal_id: 'weight', archived_at: null } as AppData['measurementTypes'][number]];
  const first = opsRecordReading(d, 'w', 204, '2026-10-25');
  d = run(d, first.ops);
  assert.equal(d.measurements.length, 1);
  const second = opsRecordReading(d, 'w', 203.4, '2026-10-25');
  d = run(d, second.ops);
  assert.equal(d.measurements.length, 1);
  assert.equal(d.measurements[0]!.value, 203.4);
  d = run(d, second.undo);
  assert.equal(d.measurements[0]!.value, 204);
  d = run(d, first.undo);
  assert.equal(d.measurements.length, 0);
});

test('goals in a group are listed next to each other', async () => {
  const { opsCreateGroup } = await import('../src/data/groups.ts');
  const d = run(base(), opsCreateGroup(base(), 'Body', ['gym', 'weight']).ops);
  const view = new View(d, '2026-10-25', 0.5);
  const order = view.groupConnected([d.goals[0]!, d.goals[2]!, d.goals[1]!]).map((g) => g.id);
  assert.deepEqual(order, ['gym', 'weight', 'guitar']);
});

test('a prepared idea can be ready with a shared task instead of its own', () => {
  const periods = { quarter: { start: '2026-10-01' }, month: { start: '2026-10-01' }, week: { start: '2026-10-19' } } as Parameters<typeof prepGaps>[1];
  const prep = { quarter: 'q', month: 'm', week: 'w', clock: 'own' as const };
  assert.ok(prepGaps(prep, periods).includes('task'));
  assert.ok(!prepGaps({ ...prep, reuse: ['lift'] }, periods).includes('task'));
});

test('a task goes on a day at most once, so missed days cannot pile onto one day', () => {
  const d = base();
  const session = (id: string, date: string | null, status: AppData['sessions'][number]['status'] = 'planned'): AppData['sessions'][number] => ({
    id, action_id: 'lift', week_start: '2026-10-19', slot: Number(id.slice(1)), date, title: 'Gym', priority: false, planned_minutes: 60, planned_count: null,
    status, actual_minutes: null, actual_count: null, note: '', obstacles: [], origin: 'scheduled', source: 'manual', moved_from: null, logged_at: null,
  });
  d.sessions = [session('s1', '2026-10-25', 'done'), session('s2', null), session('s3', null)];
  const view = new View(d, '2026-10-25', 0.5);
  assert.equal(view.canPlace(d.sessions[1]!, '2026-10-25'), false, 'Sunday already has the gym (done)');
  assert.equal(view.canPlace(d.sessions[1]!, '2026-10-26'), true, 'Monday is free');
  assert.equal(view.canPlace(d.sessions[0]!, '2026-10-25'), true, 'a session never blocks itself');
  const oneOff = { ...d.sessions[1]!, action_id: null };
  assert.equal(view.canPlace(oneOff, '2026-10-25'), true, 'one-offs can go anywhere');
});

test('a task that ends with its week can still be shared (the old filter only allowed no end date)', async () => {
  const { runningSchedule, shareCandidates, matchingTasks } = await import('../src/data/connect.ts');
  const d = base();
  d.plans = [{ id: 'p', name: 'Plan', start_date: '2026-10-01', end_date: '2027-03-31', block_days: 28, archived_at: null } as AppData['plans'][number]];
  d.planGoals = d.goals.map((g, i) => ({ id: `pg${i}`, plan_id: 'p', goal_id: g.id }));
  d.schedules = [
    { id: 'old', action_id: 'lift', rule: 'per_week', days: [], per_week: 5, effective_from: '2026-10-01', effective_to: '2026-10-18' },
    { id: 'now', action_id: 'lift', rule: 'per_week', days: [], per_week: 5, effective_from: '2026-10-19', effective_to: '2026-10-25' },
  ];
  assert.equal(runningSchedule(d, 'lift', '2026-10-25')?.id, 'now', 'ends this week but still running');
  assert.equal(runningSchedule(d, 'lift', '2026-10-26'), null, 'finished once the week is over');
  const view = new View(d, '2026-10-25', 0.5);
  const groups = shareCandidates(view, 'weight', '2026-10-25');
  assert.deepEqual(groups.map((g) => [g.goal.id, g.tasks.map((t) => t.action.id)]), [['gym', ['lift']]]);
  assert.equal(shareCandidates(view, 'gym', '2026-10-25').length, 0, 'a goal is never offered its own tasks');
  assert.equal(matchingTasks(groups, 'gym session').length, 1, 'typing "gym session" suggests Gym');
  assert.equal(matchingTasks(groups, 'GYM').length, 1);
  assert.equal(matchingTasks(groups, 'guitar').length, 0);
  assert.equal(matchingTasks(groups, 'gy').length, 0, 'too short to suggest');
});

test('groups work like phone folders: make, add, take out, and a group of one goes away', async () => {
  const { opsCreateGroup, opsAddToGroup, opsRemoveFromGroup, opsUngroup, groupMembers } = await import('../src/data/groups.ts');
  let d = base();
  const made = opsCreateGroup(d, 'Body', ['gym', 'weight']);
  d = run(d, made.ops);
  assert.equal(d.groups.length, 1);
  assert.deepEqual(groupMembers(d, made.groupId).map((g) => g.id).sort(), ['gym', 'weight']);
  d = run(d, opsAddToGroup(d, 'guitar', made.groupId));
  assert.equal(groupMembers(d, made.groupId).length, 3);
  d = run(d, opsRemoveFromGroup(d, 'guitar'));
  assert.equal(d.goals.find((g) => g.id === 'guitar')!.group_id, null);
  assert.equal(d.groups.length, 1, 'two goals left: the group stays');
  d = run(d, opsRemoveFromGroup(d, 'gym'));
  assert.equal(d.groups.length, 0, 'one goal left: the group goes away');
  assert.ok(d.goals.every((g) => !g.group_id), 'and the last goal is on its own again');
  // Ungroup keeps the goals.
  const again = opsCreateGroup(d, 'Body', ['gym', 'weight']);
  d = run(d, again.ops);
  d = run(d, opsUngroup(d, d.groups[0]!));
  assert.equal(d.groups.length, 0);
  assert.equal(d.goals.length, 3);
});

test('a goal is in one group at most: joining another group leaves the old one', async () => {
  const { opsCreateGroup, opsAddToGroup } = await import('../src/data/groups.ts');
  let d = base();
  d.goals.push(goal('jhu', 'JHU AI certificate'));
  const body = opsCreateGroup(d, 'Body', ['gym', 'weight']);
  d = run(d, body.ops);
  const learn = opsCreateGroup(d, 'Learning', ['guitar', 'jhu']);
  d = run(d, learn.ops);
  d = run(d, opsAddToGroup(d, 'gym', learn.groupId));
  assert.equal(d.goals.find((g) => g.id === 'gym')!.group_id, learn.groupId);
  assert.ok(!d.groups.some((g) => g.id === body.groupId), 'Body had one goal left, so it is gone');
  assert.equal(d.goals.find((g) => g.id === 'weight')!.group_id, null);
});

test('old connections become groups once, then the links are gone', async () => {
  const { opsFoldLinksIntoGroups, suggestGroupNames } = await import('../src/data/groups.ts');
  let d = run(base(), opsLinkGoals(base(), 'gym', 'weight', ''));
  d = run(d, opsFoldLinksIntoGroups(d));
  assert.equal(d.goalLinks.length, 0);
  assert.equal(d.groups.length, 1);
  assert.equal(d.groups[0]!.name, 'Body', 'named from what the goals are about');
  assert.deepEqual(opsFoldLinksIntoGroups(d), [], 'nothing left to do the second time');
  assert.equal(suggestGroupNames([goal('a', 'JHU AI certificate'), goal('b', 'Pass IAPP AIGP')])[0], 'Learning');
});

test('deleting a goal removes its own tasks and logs, keeps shared tasks for other goals', async () => {
  const { opsDeleteGoal } = await import('../src/data/ops.ts');
  const { opsCreateGroup } = await import('../src/data/groups.ts');
  let d = base();
  d.actions.push({ id: 'photo', title: 'Body photo', kind: 'photo', planned_minutes: 0, planned_count: null, min_label: '', min_minutes: null, min_count: null, priority: false, archived_at: null });
  d.actionGoals.push({ id: 'ag2', action_id: 'lift', goal_id: 'weight' }, { id: 'ag3', action_id: 'photo', goal_id: 'weight' });
  d.schedules = [{ id: 'sp', action_id: 'photo', rule: 'days', days: [1, 2, 3, 4, 5, 6, 7], per_week: null, effective_from: '2026-10-19', effective_to: null }];
  d.sessions = [{ id: 'ph1', action_id: 'photo', week_start: '2026-10-19', slot: 0, date: '2026-10-20', title: 'Body photo', priority: false, planned_minutes: 0, planned_count: null, status: 'done', actual_minutes: 0, actual_count: null, note: '', obstacles: [], origin: 'scheduled', source: 'manual', moved_from: null, logged_at: null }];
  d.attachments = [{ id: 'f1', session_id: 'ph1', action_id: 'photo', path: 'demo/f1/me.jpg', name: 'me.jpg', mime_type: 'image/jpeg', size_bytes: 10, created_at: '' }];
  d.planGoals = [{ id: 'pg', plan_id: 'p', goal_id: 'weight' }];
  d = run(d, opsCreateGroup(d, 'Body', ['gym', 'weight']).ops);
  const weight = d.goals.find((g) => g.id === 'weight')!;
  const { ops, files } = opsDeleteGoal(d, weight);
  d = run(d, ops);
  assert.ok(!d.goals.some((g) => g.id === 'weight'));
  assert.ok(d.actions.some((a) => a.id === 'lift'), 'the shared gym task keeps running for Work out');
  assert.deepEqual(d.actionGoals.map((ag) => ag.goal_id), ['gym']);
  assert.ok(!d.actions.some((a) => a.id === 'photo'), 'its own photo task is gone');
  assert.equal(d.sessions.length, 0);
  assert.equal(d.attachments.length, 0);
  assert.deepEqual(files, ['demo/f1/me.jpg'], 'and its files are listed for removal');
  assert.equal(d.planGoals.length, 0);
  assert.equal(d.groups.length, 0, 'Body had one goal left, so the group is gone');
});

test('moving goals into a batch keeps tasks and the week goal; an emptied own clock is archived', async () => {
  const { opsMoveGoals, currentWindow, planMove } = await import('../src/data/move.ts');
  const { opsStartChain } = await import('../src/data/chain.ts');
  const today = '2026-10-25';
  let d = base();
  const own = { id: 'own', name: 'Work out', start_date: '2026-10-01', end_date: '2027-03-31', block_days: 28, archived_at: null, solo: true } as AppData['plans'][number];
  const batch = { id: 'batch', name: 'Career & credentials', start_date: '2026-10-19', end_date: '2027-04-18', block_days: 28, archived_at: null } as AppData['plans'][number];
  d.plans = [own, batch];
  d.planGoals = [{ id: 'pg1', plan_id: 'own', goal_id: 'gym' }];
  d = run(d, opsStartChain(d, d.goals[0]!, own, today, { quarter: 'Gym habit locked in', month: 'Twenty sessions', week: 'Five sessions, legs twice' }));
  const move = planMove(d, d.goals[0]!, batch, today);
  assert.equal(move.notes.week, 'Five sessions, legs twice', 'the week goal carries over');
  d = run(d, opsMoveGoals(d, [d.goals[0]!], { kind: 'plan', plan: batch }, today));
  assert.equal(currentWindow(d, 'gym', today)?.id, 'batch');
  assert.ok(d.plans.find((p) => p.id === 'own')!.archived_at, 'its old own clock had nothing left, so it is archived');
  assert.ok(d.actions.some((a) => a.id === 'lift'), 'daily tasks stay');
  const weekStep = d.planSteps.find((st) => st.plan_id === 'batch' && st.goal_id === 'gym' && st.level === 'week');
  assert.equal(weekStep?.target_note, 'Five sessions, legs twice');
  // Moving a whole group onto own clocks gives each goal its own window.
  d = run(d, opsMoveGoals(d, [d.goals[0]!, d.goals[1]!], { kind: 'own', months: 3 }, today));
  const w1 = currentWindow(d, 'gym', today)!;
  const w2 = currentWindow(d, 'weight', today)!;
  assert.ok(w1.solo && w2.solo && w1.id !== w2.id);
});

test('seasons: this season is the batch running today, next is the one after; tracks measure the whole window', async () => {
  const { seasonsOf, goalTrack, nextSeasonDates } = await import('../src/data/season.ts');
  const d = base();
  const now = { id: 'now', name: 'My next six months', start_date: '2026-10-01', end_date: '2027-04-24', block_days: 28, archived_at: null } as AppData['plans'][number];
  const later = { id: 'later', name: 'Next season', start_date: '2027-04-25', end_date: '2027-10-24', block_days: 28, archived_at: null } as AppData['plans'][number];
  d.plans = [later, now];
  d.planGoals = [{ id: 'pg', plan_id: 'now', goal_id: 'weight' }];
  d.goals[1] = { ...d.goals[1]!, type: 'number', unit: 'lb', baseline_value: 214, baseline_date: '2026-10-01', target_value: 195, target_date: '2027-04-24', measurement_type_id: 'mt' };
  d.measurementTypes = [{ id: 'mt', name: 'Weight', unit: 'lb', cadence_days: 1, goal_id: 'weight', archived_at: null } as AppData['measurementTypes'][number]];
  d.measurements = [{ id: 'm1', type_id: 'mt', value: 209.6, measured_on: '2026-10-24', source: 'manual', note: '' }];
  const view = new View(d, '2026-10-25', 0.5);
  const s = seasonsOf(view);
  assert.equal(s.current?.id, 'now');
  assert.equal(s.next?.id, 'later');
  assert.deepEqual(nextSeasonDates(now), { start: '2027-04-25', end: '2027-10-24' });
  const t = goalTrack(view, d.goals[1]!, now);
  assert.equal(t.target, '195 lb');
  assert.equal(t.by, '2027-04-24');
  assert.equal(t.prog, 23, '214 → 209.6 of the way to 195');
  assert.ok(t.exp > 0 && t.exp < t.prog, 'ahead of even pace');
});

test('a goal with the same measurement twice gets them merged onto its main one', async () => {
  const { opsMergeDuplicateMeasures, findMeasure } = await import('../src/data/connect.ts');
  const d = base();
  d.goals = d.goals.map((g) => (g.id === 'weight' ? { ...g, type: 'number', measurement_type_id: 'w1' } : g));
  const t = (id: string, goal_id: string | null) => ({ id, name: 'Weight', unit: 'lb', cadence_days: 7, goal_id, archived_at: null });
  d.measurementTypes = [t('w1', null), t('w2', 'weight')];
  const m = (id: string, type_id: string, measured_on: string, value: number) => ({ id, type_id, value, measured_on, source: 'manual', note: '' });
  d.measurements = [m('a', 'w1', '2026-10-25', 195), m('b', 'w2', '2026-10-25', 194), m('c', 'w2', '2026-10-26', 194.5)];
  d.actions = [...d.actions, { ...d.actions[0]!, id: 'weigh', kind: 'measure', measurement_type_id: 'w2' }];
  const out = run(d, opsMergeDuplicateMeasures(d));
  assert.deepEqual(out.measurementTypes.filter((x) => !x.archived_at).map((x) => x.id), ['w1']);
  assert.deepEqual(out.measurements.map((x) => [x.type_id, x.measured_on, x.value]), [['w1', '2026-10-25', 195], ['w1', '2026-10-26', 194.5]]);
  assert.equal(out.actions.find((a) => a.id === 'weigh')!.measurement_type_id, 'w1');
  assert.deepEqual(opsMergeDuplicateMeasures(out), [], 'nothing left to merge');
  assert.equal(findMeasure(out, 'weight', ' weight ', 'LB'), 'w1');
});

test("Today's numbers: a goal's main number by default, extras only when turned on, stopped ones never", async () => {
  const { measureOnToday, measureLabel } = await import('../src/data/connect.ts');
  const d = base();
  d.goals = d.goals.map((g) => (g.id === 'weight' ? { ...g, type: 'number', measurement_type_id: 'w' } : g));
  const t = (id: string, name: string, unit: string, extra: object = {}) => ({ id, name, unit, cadence_days: 7, goal_id: 'weight', archived_at: null, ...extra });
  d.measurementTypes = [t('w', 'Weight', 'lb'), t('bf', 'Body fat', '%'), t('waist', 'Waist', 'in', { on_today: true }), t('old', 'Neck', 'in', { on_today: true, archived_at: '2026-10-25T00:00:00Z' })];
  assert.equal(measureOnToday(d, 'w'), true);
  assert.equal(measureOnToday(d, 'bf'), false);
  assert.equal(measureOnToday(d, 'waist'), true);
  assert.equal(measureOnToday(d, 'old'), false);
  d.measurementTypes[0] = { ...d.measurementTypes[0]!, on_today: false };
  assert.equal(measureOnToday(d, 'w'), false, 'the main number can be turned off too');
  assert.equal(measureLabel(d.measurementTypes[1]!), 'Body fat (%)');
});
