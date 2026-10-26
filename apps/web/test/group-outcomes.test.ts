import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyOp, emptyData, type AppData, type Op } from '../src/data/model.ts';
import { View } from '../src/data/derive.ts';
import { goalTrack, groupTrack } from '../src/data/season.ts';
import { opsSetGroupOutcome } from '../src/data/groups.ts';
import { opsDeleteGoal } from '../src/data/ops.ts';
import type { Goal } from '@six/core';

const run = (data: AppData, ops: Op[]) => ops.reduce(applyOp, data);
const goal = (id: string, extra: Partial<Goal> = {}): Goal => ({ id, title: id, type: 'finish', why: '', done_means: `${id} done`, unit: null, baseline_value: null, baseline_date: null, target_value: null, target_date: null, color: '#000', measurement_type_id: null, archived_at: null, group_id: 'grp', ...extra });

function base(): AppData {
  const d = emptyData();
  d.plans = [{ id: 'plan', name: 'Season', start_date: '2026-11-01', end_date: '2027-04-30', block_days: 28, archived_at: null }];
  d.groups = [{ id: 'grp', name: 'Credentials', created_at: '', outcome: '' }];
  d.goals = [goal('jhu'), goal('aigp', { target_date: '2027-01-15' }), goal('iso', { after_goal_id: 'aigp' })];
  d.planGoals = d.goals.map((g) => ({ id: `pg-${g.id}`, plan_id: 'plan', goal_id: g.id }));
  d.milestones = [
    { id: 'm1', goal_id: 'aigp', title: 'Domain I', due_date: '2026-11-15', completed_at: '2026-11-14T10:00:00Z' },
    { id: 'm2', goal_id: 'aigp', title: 'Domain II', due_date: '2027-01-15', completed_at: null },
    { id: 'm3', goal_id: 'jhu', title: 'Module 1', due_date: '2026-11-20', completed_at: null },
  ];
  return d;
}

test('a goal that starts after another is up next and not judged until that one is complete', () => {
  const d = base();
  const view = new View(d, '2026-12-01', 0.5);
  const iso = view.goal('iso')!;
  assert.equal(view.waitingOn(iso)?.id, 'aigp');
  assert.equal(view.goalPace(iso, view.planForGoal(iso)).label, 'none');
  const t = goalTrack(view, iso, view.planForGoal(iso)!);
  assert.equal(t.started, false);
  assert.equal(t.status, 'Up next');
  assert.equal(t.waiting, 'aigp');
  // Once AIGP is complete, ISO runs from that day.
  const done = run(d, [{ kind: 'update', collection: 'goals', id: 'aigp', patch: { completed_at: '2027-01-10T12:00:00Z' } }]);
  const later = new View(done, '2027-01-20', 0.5);
  assert.equal(later.waitingOn(later.goal('iso')!), null);
  assert.equal(later.startFor(later.goal('iso')!, later.plan('plan')!), '2027-01-10');
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
  // aigp 1 of 2 = 50, jhu 0 of 1 = 0, iso waiting = 0 → 17.
  assert.equal(r.prog, 17);
  assert.equal(r.by, '2027-04-30');
  d = run(d, [{ kind: 'update', collection: 'goals', id: 'jhu', patch: { completed_at: '2026-11-30T12:00:00Z' } }]);
  const after = groupTrack(new View(d, '2026-12-01', 0.5), 'grp');
  assert.equal(after.done, 1);
  assert.equal(after.prog, 50);
});

test('the outcome saves only when it changes; deleting a goal frees the ones after it', () => {
  let d = base();
  assert.deepEqual(opsSetGroupOutcome(d.groups[0]!, '  '), []);
  d = run(d, opsSetGroupOutcome(d.groups[0]!, 'Qualified for AI work'));
  assert.equal(d.groups[0]!.outcome, 'Qualified for AI work');
  d = run(d, opsDeleteGoal(d, d.goals.find((g) => g.id === 'aigp')!).ops);
  assert.equal(d.goals.find((g) => g.id === 'iso')!.after_goal_id, null);
});
