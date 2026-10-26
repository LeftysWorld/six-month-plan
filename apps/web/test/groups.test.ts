import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyOp, emptyData, type AppData, type Op } from '../src/data/model.ts';
import { View } from '../src/data/derive.ts';
import { goalTrack, groupTrack } from '../src/data/season.ts';
import { opsDeleteGoal } from '../src/data/ops.ts';
import type { Goal } from '@six/core';

const run = (data: AppData, ops: Op[]) => ops.reduce(applyOp, data);
const goal = (id: string, extra: Partial<Goal> = {}): Goal => ({ id, title: id, type: 'finish', why: '', done_means: `${id} done`, unit: null, baseline_value: null, baseline_date: null, target_value: null, target_date: null, color: '#000', measurement_type_id: null, archived_at: null, group_id: 'grp', ...extra });

function base(): AppData {
  const d = emptyData();
  d.plans = [{ id: 'plan', name: 'Season', start_date: '2026-11-01', end_date: '2027-04-30', block_days: 28, archived_at: null }];
  d.groups = [{ id: 'grp', name: 'Credentials', created_at: '' }];
  d.goals = [goal('jhu'), goal('aigp', { target_date: '2027-01-15' }), goal('iso', { start_date: '2027-01-16' })];
  d.planGoals = d.goals.map((g) => ({ id: `pg-${g.id}`, plan_id: 'plan', goal_id: g.id }));
  d.milestones = [
    { id: 'm1', goal_id: 'aigp', title: 'Domain I', due_date: '2026-11-15', completed_at: '2026-11-14T10:00:00Z' },
    { id: 'm2', goal_id: 'aigp', title: 'Domain II', due_date: '2027-01-15', completed_at: null },
    { id: 'm3', goal_id: 'jhu', title: 'Module 1', due_date: '2026-11-20', completed_at: null },
  ];
  return d;
}

test('a goal with a later start is not judged until it starts', () => {
  const d = base();
  const view = new View(d, '2026-12-01', 0.5);
  const iso = view.goal('iso')!;
  assert.equal(view.startFor(iso, view.planForGoal(iso)!), '2027-01-16');
  assert.equal(view.goalPace(iso, view.planForGoal(iso)).label, 'none');
  const t = goalTrack(view, iso, view.planForGoal(iso)!);
  assert.equal(t.started, false);
  assert.equal(t.status, 'Starts Jan 16');
  // Once it has started, it runs from its own start.
  const later = new View(d, '2027-01-20', 0.5);
  assert.equal(goalTrack(later, later.goal('iso')!, later.plan('plan')!).started, true);
});

test('a goal with its own finish-by date is measured to that date', () => {
  const view = new View(base(), '2026-12-01', 0.5);
  const aigp = view.goal('aigp')!;
  assert.equal(goalTrack(view, aigp, view.plan('plan')!).by, '2027-01-15');
});

test('the group rolls its goals up into one bar, finished ones counting fully', () => {
  let d = base();
  const view = new View(d, '2026-12-01', 0.5);
  const r = groupTrack(view, 'grp');
  assert.equal(r.count, 3);
  assert.equal(r.done, 0);
  // aigp 1 of 2 = 50, jhu 0 of 1 = 0, iso not started = 0 → 17.
  assert.equal(r.prog, 17);
  assert.equal(r.by, '2027-04-30');
  d = run(d, [{ kind: 'update', collection: 'goals', id: 'jhu', patch: { completed_at: '2026-11-30T12:00:00Z' } }]);
  const after = groupTrack(new View(d, '2026-12-01', 0.5), 'grp');
  assert.equal(after.done, 1);
  assert.equal(after.prog, 50);
});

test('deleting a goal takes it out of its group and leaves the others alone', () => {
  let d = base();
  d = run(d, opsDeleteGoal(d, d.goals.find((g) => g.id === 'aigp')!).ops);
  assert.ok(!d.goals.some((g) => g.id === 'aigp'));
  assert.equal(d.goals.filter((g) => g.group_id === 'grp').length, 2);
  assert.equal(d.milestones.filter((m) => m.goal_id === 'aigp').length, 0);
});
