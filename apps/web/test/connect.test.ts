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
  assert.equal(c[0]!.link, null, 'connected through the task, not by hand');
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

test('connected goals are listed next to each other', () => {
  const d = run(base(), opsLinkGoals(base(), 'gym', 'weight', ''));
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
