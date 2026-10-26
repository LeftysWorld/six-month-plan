import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyOp, emptyData, type AppData, type Op } from '../src/data/model.ts';
import { View } from '../src/data/derive.ts';
import { newGoalGaps, opsMakeGoal, opsStartSeason, type NewGoalInput } from '../src/data/newGoal.ts';
import { buildDemoData } from '../src/data/seed.ts';
import { chainFor } from '../src/data/chain.ts';

const run = (data: AppData, ops: Op[]) => ops.reduce(applyOp, data);
const TODAY = '2026-10-26';

function input(over: Partial<NewGoalInput> = {}): NewGoalInput {
  return {
    title: 'Comfortable on guitar',
    type: 'practice',
    why: 'Play for myself',
    doneMeans: '3 songs recorded',
    color: '#5B8CFF',
    planId: 'season',
    start: null,
    finish: null,
    unit: '',
    measureName: '',
    baseline: null,
    target: null,
    targetDate: '',
    pathEdits: {},
    milestones: [],
    weekGoal: 'G–C–D at 60 bpm',
    task: { title: 'Guitar practice', days: [1, 3, 5], minutes: 20 },
    shareActionIds: [],
    groupWithGoalId: null,
    pathId: null,
    ideaId: null,
    ...over,
  };
}

test('a goal is made in one step: goal, season, week goal, first task, idea started', () => {
  let d = emptyData();
  const season = opsStartSeason('My six months', TODAY);
  d = run(d, season.ops);
  d.ideas = [{ id: 'idea', title: 'Comfortable on guitar', note: '', status: 'backlog', rank: 1, goal_id: null, created_at: '2026-10-01T00:00:00Z', started_at: null }];
  const { ops, goalId } = opsMakeGoal(d, season.plan, input({ planId: season.plan.id, ideaId: 'idea', start: '2026-11-02', finish: '2027-01-31' }), TODAY);
  d = run(d, ops);
  const view = new View(d, TODAY, 0.5);
  const g = view.goal(goalId)!;
  assert.equal(g.title, 'Comfortable on guitar');
  assert.equal(g.start_date, '2026-11-02');
  assert.equal(g.target_date, '2027-01-31');
  assert.equal(view.planForGoal(g)?.id, season.plan.id);
  assert.equal(chainFor(d, g, season.plan, '2026-11-02').week.step?.target_note, 'G–C–D at 60 bpm');
  const task = view.actionsForGoal(goalId)[0]!;
  assert.equal(task.title, 'Guitar practice');
  assert.equal(d.schedules.find((s) => s.action_id === task.id)?.effective_from, '2026-11-02', 'the task starts with the goal');
  assert.equal(d.ideas[0]!.status, 'started');
  assert.equal(d.ideas[0]!.goal_id, goalId);
  assert.equal(d.planSteps.filter((s) => s.level !== 'week').length, 0, 'no month or 3-month steps are made');
});

test('what a new goal still needs', () => {
  assert.deepEqual(newGoalGaps(input({ title: ' ' }), TODAY), ['a name']);
  assert.deepEqual(newGoalGaps(input({ task: null }), TODAY), ['a daily task, or one to share']);
  assert.deepEqual(newGoalGaps(input({ task: null, shareActionIds: ['lift'] }), TODAY), []);
  assert.deepEqual(newGoalGaps(input({ type: 'number', doneMeans: '', task: null, target: null }), TODAY), ['a target and a date']);
  assert.deepEqual(newGoalGaps(input({ type: 'number', doneMeans: '', task: null, target: 180, targetDate: '2027-02-01' }), TODAY), []);
});

test('the demo data fits the model: one season, no own clocks, a plain backlog, week-only chain', () => {
  const d = buildDemoData();
  assert.ok(d.plans.length >= 1);
  assert.ok(d.plans.every((p) => !('solo' in p) || !(p as { solo?: boolean }).solo));
  assert.ok(d.ideas.every((i) => i.status === 'backlog'));
  assert.ok(d.goals.every((g) => !('after_goal_id' in g)));
  assert.ok(d.planSteps.every((s) => s.level === 'week'));
});
