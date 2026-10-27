import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyOp, emptyData, type AppData, type Op } from '../src/data/model.ts';
import { opsAbandonGoal, opsPlaceIdea, opsSetStatus } from '../src/data/backlog.ts';
import { bucketOf, column, ideaReady, type Goal, type GoalIdea } from '@six/core';

const run = (data: AppData, ops: Op[]) => ops.reduce(applyOp, data);
const idea = (id: string, rank: number, extra: Partial<GoalIdea> = {}): GoalIdea => ({ id, title: id, note: '', status: 'backlog', rank, goal_id: null, created_at: '2026-10-01T00:00:00.000Z', started_at: null, ...extra });

test('selected is a backlog idea with shortlisted_at; the database never sees a new status', () => {
  let d = emptyData();
  d.ideas = [idea('a', 1, { note: 'why', done_means: 'done' }), idea('b', 2), idea('c', 3)];
  assert.equal(ideaReady(d.ideas[0]!), true);
  assert.equal(ideaReady(d.ideas[1]!), false);
  const ops = opsSetStatus(d, d.ideas[0]!, 'selected', 'end');
  assert.equal((ops[0] as { patch: { status: string } }).patch.status, 'backlog');
  d = run(d, ops);
  assert.equal(bucketOf(d.ideas[0]!), 'selected');
  assert.deepEqual(column(d.ideas, 'backlog').map((i) => i.id), ['b', 'c']);
  assert.deepEqual(column(d.ideas, 'selected').map((i) => i.id), ['a']);
  d = run(d, opsSetStatus(d, d.ideas[0]!, 'backlog', 'top'));
  assert.deepEqual(column(d.ideas, 'backlog').map((i) => i.id), ['a', 'b', 'c']);
});

test('opsPlaceIdea orders within a bucket and moves between buckets', () => {
  let d = emptyData();
  d.ideas = [idea('a', 1), idea('b', 2), idea('c', 3), idea('s', 1, { shortlisted_at: 'x', note: 'w', done_means: 'd' })];
  d = run(d, opsPlaceIdea(d, d.ideas[2]!, 'backlog', 0));
  assert.deepEqual(column(d.ideas, 'backlog').map((i) => i.id), ['c', 'a', 'b']);
  d = run(d, opsPlaceIdea(d, d.ideas.find((i) => i.id === 'b')!, 'selected', 0));
  assert.deepEqual(column(d.ideas, 'selected').map((i) => i.id), ['b', 's']);
  assert.ok(d.ideas.find((i) => i.id === 'b')!.shortlisted_at);
  d = run(d, opsPlaceIdea(d, d.ideas.find((i) => i.id === 's')!, 'backlog', 2));
  assert.deepEqual(column(d.ideas, 'backlog').map((i) => i.id), ['c', 'a', 's']);
  assert.equal(d.ideas.find((i) => i.id === 's')!.shortlisted_at, null);
});

test('abandoning a goal archives it and puts its idea back at the top of the backlog', () => {
  let d = emptyData();
  const goal: Goal = { id: 'g', title: 'Documentary', type: 'finish', why: 'because', done_means: 'published', unit: null, baseline_value: null, baseline_date: null, target_value: null, target_date: null, color: '#000', measurement_type_id: null, archived_at: null };
  d.goals = [goal];
  d.ideas = [idea('a', 1), idea('orig', 9, { status: 'started', goal_id: 'g', started_at: 'x' })];
  d = run(d, opsAbandonGoal(d, goal).ops);
  assert.ok(d.goals[0]!.archived_at);
  const back = d.ideas.find((i) => i.id === 'orig')!;
  assert.equal(back.status, 'backlog');
  assert.equal(back.goal_id, null);
  assert.deepEqual(column(d.ideas, 'backlog').map((i) => i.id), ['orig', 'a']);
  // A goal that never came from an idea gets one written from it.
  let e = emptyData();
  e.goals = [{ ...goal, id: 'h' }];
  e = run(e, opsAbandonGoal(e, e.goals[0]!).ops);
  assert.equal(e.ideas.length, 1);
  assert.equal(e.ideas[0]!.note, 'because');
});
