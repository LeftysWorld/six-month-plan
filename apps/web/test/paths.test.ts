import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyOp, emptyData, type AppData, type Op } from '../src/data/model.ts';
import { View } from '../src/data/derive.ts';
import { blankPath, gaugeAverage, opsAnswerQuestion, opsAddQuestion, opsArchivePath, opsCreatePath, opsMovePath, opsNotePath, opsRatePath, opsRestorePath, opsSetGoalPath, pathLetter, pathProgress, pathsOf } from '../src/data/paths.ts';
import { buildDemoData } from '../src/data/seed.ts';
import type { Goal } from '@six/core';

const run = (data: AppData, ops: Op[]) => ops.reduce(applyOp, data);
const TODAY = '2026-10-26';
const goal = (id: string, extra: Partial<Goal> = {}): Goal => ({ id, title: id, type: 'finish', why: '', done_means: `${id} done`, unit: null, baseline_value: null, baseline_date: null, target_value: null, target_date: null, color: '#000', measurement_type_id: null, archived_at: null, ...extra });

function base(): AppData {
  const d = emptyData();
  d.plans = [{ id: 'plan', name: 'Season', start_date: '2026-10-19', end_date: '2027-04-19', block_days: 28, archived_at: null }];
  d.goals = [goal('aigp', { path_id: 'b' }), goal('iso', { path_id: 'b', completed_at: '2026-10-25T12:00:00Z' }), goal('guitar')];
  d.planGoals = d.goals.map((g) => ({ id: `pg-${g.id}`, plan_id: 'plan', goal_id: g.id }));
  d.milestones = [
    { id: 'm1', goal_id: 'aigp', title: 'Domain I', due_date: '2026-10-24', completed_at: '2026-10-23T10:00:00Z' },
    { id: 'm2', goal_id: 'aigp', title: 'Domain II', due_date: '2027-01-15', completed_at: null },
  ];
  d.actions = [{ id: 'study', title: 'Study', kind: 'minutes', planned_minutes: 30, planned_count: null, min_label: '', min_minutes: null, min_count: null, priority: false, archived_at: null }];
  d.actionGoals = [{ id: 'ag', action_id: 'study', goal_id: 'aigp' }];
  d.sessions = [
    { id: 's1', action_id: 'study', week_start: '2026-10-19', slot: 0, date: '2026-10-20', title: 'Study', priority: false, planned_minutes: 30, planned_count: null, status: 'done', actual_minutes: 40, actual_count: null, note: '', obstacles: [], origin: 'scheduled', source: 'manual', moved_from: null, logged_at: null },
    { id: 's2', action_id: 'study', week_start: '2026-10-19', slot: 1, date: '2026-10-22', title: 'Study', priority: false, planned_minutes: 30, planned_count: null, status: 'planned', actual_minutes: null, actual_count: null, note: '', obstacles: [], origin: 'scheduled', source: 'manual', moved_from: null, logged_at: null },
  ];
  d.ideas = [{ id: 'i1', title: 'Cold call a day', note: '', status: 'backlog', rank: 1, goal_id: null, created_at: '2026-10-01T00:00:00Z', started_at: null, path_id: 'b' }];
  d.paths = [
    { ...blankPath(d, TODAY), id: 'a', name: 'AI product owner', rank: 0 },
    { ...blankPath(d, TODAY), id: 'b', name: 'Governance consultant', rank: 1, gauges: { resources: 3, likability: 4 } },
  ];
  return d;
}

test('a path rolls up its goals: done, running and pace, time logged, ideas waiting', () => {
  const d = base();
  const view = new View(d, TODAY, 0.5);
  const b = view.data.paths[1]!;
  const p = pathProgress(view, b);
  assert.equal(p.goals.length, 2);
  assert.equal(p.finished, 1);
  assert.equal(p.running, 1);
  assert.equal(p.minutes, 40);
  assert.equal(p.days, 1);
  assert.equal(p.waiting.length, 1);
  assert.ok(p.prog > 50 && p.prog <= 100, `finished counts fully, the running goal by its track: ${p.prog}`);
  assert.equal(pathLetter(d, b), 'Path B');
  assert.equal(pathProgress(view, view.data.paths[0]!).goals.length, 0);
  assert.equal(gaugeAverage(b.gauges), 3.5);
  assert.equal(gaugeAverage({}), null);
});

test('rating keeps a log; questions are answered; notes are dated; letting go frees goals and undo restores them', () => {
  let d = base();
  let b = d.paths[1]!;
  d = run(d, opsRatePath(b, { resources: 3, likability: 4, confidence: 2, coherence: 5 }, TODAY));
  b = d.paths.find((p) => p.id === 'b')!;
  assert.equal(b.gauge_log.length, 1);
  assert.deepEqual(opsRatePath(b, b.gauges, TODAY), [], 'same rating: nothing to save');
  d = run(d, opsAddQuestion(b, 'Would anyone pay?'));
  b = d.paths.find((p) => p.id === 'b')!;
  assert.equal(b.questions.length, 1);
  d = run(d, opsAnswerQuestion(b, b.questions[0]!.id, 'Two said yes', TODAY));
  b = d.paths.find((p) => p.id === 'b')!;
  assert.ok(b.questions[0]!.answered_at);
  d = run(d, opsNotePath(b, 'The offer is real; the pricing is not.', '2027-04-19'));
  b = d.paths.find((p) => p.id === 'b')!;
  assert.equal(b.notes[0]!.on, '2027-04-19');
  // Let it go: goals and ideas stay but no longer point at it; undo puts them back.
  const goals = d.goals.filter((g) => g.path_id === 'b');
  const ideas = d.ideas.filter((i) => i.path_id === 'b');
  const gone = run(d, opsArchivePath(d, b, true));
  assert.ok(gone.paths.find((p) => p.id === 'b')!.archived_at);
  assert.ok(gone.goals.every((g) => g.path_id !== 'b'));
  assert.equal(pathsOf(gone).length, 1);
  const back = run(gone, opsRestorePath(b, goals, ideas));
  assert.equal(back.goals.filter((g) => g.path_id === 'b').length, 2);
  assert.equal(pathsOf(back).length, 2);
});

test('paths reorder; a goal moves between paths', () => {
  let d = base();
  d = run(d, opsMovePath(d, d.paths[1]!, 'up'));
  assert.deepEqual(pathsOf(d).map((p) => p.id), ['b', 'a']);
  assert.deepEqual(opsMovePath(d, pathsOf(d)[0]!, 'up'), []);
  d = run(d, opsSetGoalPath(d.goals.find((g) => g.id === 'guitar')!, 'a'));
  assert.equal(d.goals.find((g) => g.id === 'guitar')!.path_id, 'a');
  assert.deepEqual(opsSetGoalPath(d.goals.find((g) => g.id === 'guitar')!, 'a'), []);
});

test('the demo has three paths with goals and ideas on them', () => {
  let d = buildDemoData();
  assert.equal(pathsOf(d).length, 3);
  const view = new View(d, TODAY, 0.5);
  assert.ok(pathsOf(d).some((p) => pathProgress(view, p).goals.length > 0));
  assert.ok(d.ideas.some((i) => i.path_id));
  d = run(d, opsCreatePath({ ...blankPath(d, TODAY), name: 'Fourth' }));
  assert.equal(pathsOf(d).length, 4);
});
