import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyOp, emptyData, type AppData, type Op } from '../src/data/model.ts';
import { View } from '../src/data/derive.ts';
import { opsDeleteGoal } from '../src/data/ops.ts';
import {
  opsCloseProject,
  opsCreateProject,
  opsDropProject,
  opsReopenProject,
  opsSetProjectDates,
  opsStartProject,
  opsSplitIntoMilestones,
  slipsOf,
  wipStatus,
} from '../src/data/projects.ts';
import type { Goal } from '@six/core';

const run = (data: AppData, ops: Op[]) => ops.reduce(applyOp, data);
const TODAY = '2026-11-20';

function base(): { data: AppData; goal: Goal } {
  const d = emptyData();
  const goal: Goal = { id: 'outcome', title: 'Qualified for AI work', type: 'practice', why: '', done_means: '', unit: null, baseline_value: null, baseline_date: null, target_value: null, target_date: null, color: '#3FB6C9', measurement_type_id: null, archived_at: null };
  d.goals = [goal];
  d.plans = [{ id: 'plan', name: 'Season', start_date: '2026-11-01', end_date: '2027-04-30', block_days: 28, archived_at: null }];
  d.planGoals = [{ id: 'pg', plan_id: 'plan', goal_id: 'outcome' }];
  return { data: d, goal };
}

function withProject(d: AppData, goal: Goal, title: string, extra: Partial<{ start: string; end: string; deadline: string; depends: string[] }> = {}) {
  const { ops, id } = opsCreateProject(goal, { title, start_date: extra.start ?? '2026-11-01', target_date: extra.end ?? '2026-12-31', deadline: extra.deadline ?? null, depends_on: extra.depends });
  return { data: run(d, ops), id };
}

test('a project runs in its goal’s window and is left out of the goal lists', () => {
  const { data, goal } = base();
  const { data: d, id } = withProject(data, goal, 'AIGP');
  const view = new View(d, TODAY, 0.5);
  assert.equal(view.planForGoal(view.goal(id)!)?.id, 'plan');
  assert.deepEqual(view.activeGoals.map((g) => g.id), ['outcome']);
  assert.deepEqual(view.goalsForPlan('plan').map((g) => g.id), ['outcome']);
  assert.equal(view.goal(id)!.color, goal.color, 'takes its goal’s colour');
  assert.equal(view.goalLabel(view.goal(id)!), 'AIGP · Qualified for AI work');
});

test('a goal with projects takes its pace from them', () => {
  const { data, goal } = base();
  let { data: d, id } = withProject(data, goal, 'AIGP');
  d = run(d, opsStartProject(d, d.goals.find((g) => g.id === id)!, '2026-11-01'));
  d = run(d, opsSplitIntoMilestones(id, 'Domain', 4, '2026-11-01', '2026-12-31'));
  // Two due before today, one done → behind.
  const first = d.milestones.find((m) => m.title === 'Domain 1')!;
  d = run(d, [{ kind: 'update', collection: 'milestones', id: first.id, patch: { completed_at: '2026-11-10T10:00:00Z' } }]);
  const view = new View(d, '2026-12-05', 0.5);
  const pace = view.goalPace(view.goal('outcome')!, view.planForGoal(view.goal('outcome')!));
  assert.equal(pace.label, 'behind');
  assert.match(pace.summary, /0 of 1 project done · 1 at risk/);
});

test('starting over the WIP limit or before a predecessor is logged as a decision', () => {
  const { data, goal } = base();
  let d = data;
  const ids: string[] = [];
  for (const t of ['A', 'B', 'C', 'D']) {
    const r = withProject(d, goal, t);
    d = run(r.data, opsStartProject(r.data, r.data.goals.find((g) => g.id === r.id)!, TODAY));
    ids.push(r.id);
  }
  assert.equal(wipStatus(d).full, true);
  const e = withProject(d, goal, 'E', { depends: [ids[0]!] });
  const ops = opsStartProject(e.data, e.data.goals.find((g) => g.id === e.id)!, TODAY, { reason: 'Fixed course date', why: 'both' });
  const after = run(e.data, ops);
  const decision = after.raidItems.find((r) => r.goal_id === e.id && r.kind === 'decision')!;
  assert.match(decision.title, /over the WIP limit and before the project it waits on finished/);
  assert.equal(decision.detail, 'Fixed course date');
  assert.equal(after.goals.find((g) => g.id === e.id)!.baseline_end, '2026-12-31');
});

test('moving a started project’s target later counts as a slip; earlier does not', () => {
  const { data, goal } = base();
  let { data: d, id } = withProject(data, goal, 'AIGP');
  d = run(d, opsStartProject(d, d.goals.find((g) => g.id === id)!, '2026-11-01'));
  const p = () => d.goals.find((g) => g.id === id)!;
  d = run(d, opsSetProjectDates(p(), { target_date: '2027-01-15' }, TODAY));
  d = run(d, opsSetProjectDates(p(), { target_date: '2027-01-10' }, TODAY));
  assert.equal(slipsOf(d, id), 1);
  assert.equal(p().baseline_end, '2026-12-31', 'the baseline stays');
});

test('closing saves the lesson, frees waiting projects; dropping and reopening restore tasks', () => {
  const { data, goal } = base();
  let a = withProject(data, goal, 'AIGP');
  let d = run(a.data, opsStartProject(a.data, a.data.goals.find((g) => g.id === a.id)!, '2026-11-01'));
  const b = withProject(d, goal, 'ISO', { depends: [a.id], start: '2027-01-01', end: '2027-03-31' });
  d = b.data;
  const { ops, ready } = opsCloseProject(d, d.goals.find((g) => g.id === a.id)!, { worked: 'Mornings', didnt: '', carry: 'Book early' }, { question: 'Did it help?', on: '2027-02-01' }, TODAY);
  d = run(d, ops);
  assert.deepEqual(ready.map((g) => g.id), [b.id]);
  assert.equal(d.goals.find((g) => g.id === a.id)!.closeout?.carry, 'Book early');
  // Drop then reopen ISO: its own task comes back.
  d = run(d, [
    { kind: 'insert', collection: 'actions', rows: [{ id: 'study', title: 'Study', kind: 'minutes', planned_minutes: 30, planned_count: null, min_label: '', min_minutes: null, min_count: null, priority: false, archived_at: null }] },
    { kind: 'insert', collection: 'actionGoals', rows: [{ id: 'ag', action_id: 'study', goal_id: b.id }] },
  ]);
  d = run(d, opsDropProject(d, d.goals.find((g) => g.id === b.id)!, 'Not now', TODAY));
  assert.ok(d.goals.find((g) => g.id === b.id)!.dropped_at);
  assert.ok(d.actions.find((x) => x.id === 'study')!.archived_at);
  d = run(d, opsReopenProject(d, d.goals.find((g) => g.id === b.id)!));
  assert.equal(d.goals.find((g) => g.id === b.id)!.dropped_at, null);
  assert.equal(d.actions.find((x) => x.id === 'study')!.archived_at, null);
});

test('deleting a goal deletes its projects and their RAID lines', () => {
  const { data, goal } = base();
  const a = withProject(data, goal, 'AIGP');
  let d = run(a.data, [{ kind: 'insert', collection: 'raidItems', rows: [{ id: 'r1', goal_id: a.id, kind: 'risk', title: 'x', detail: '', status: 'open', created_at: '', closed_at: null }] }]);
  d = run(d, opsSplitIntoMilestones(a.id, 'Step', 2, '2026-11-01', '2026-12-01'));
  d = run(d, opsDeleteGoal(d, d.goals.find((g) => g.id === 'outcome')!).ops);
  assert.equal(d.goals.length, 0);
  assert.equal(d.raidItems.length, 0);
  assert.equal(d.milestones.length, 0);
});
