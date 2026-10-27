import { test } from 'node:test';
import assert from 'node:assert/strict';
import { emptyData, type AppData } from '../src/data/model.ts';
import { View } from '../src/data/derive.ts';
import { chapterView, weekRecord, weekTotals } from '../src/data/chapters.ts';
import type { Goal, Plan, Review } from '@six/core';

const plan: Plan = { id: 'p', name: 'Winter', start_date: '2026-10-16', end_date: '2027-04-15', block_days: 28, archived_at: null };
const goal = (id: string, title: string, color: string): Goal => ({ id, title, type: 'finish', why: '', done_means: '', unit: null, baseline_value: null, baseline_date: null, target_value: null, target_date: null, color, measurement_type_id: null, archived_at: null });
const weekly = (monday: string, results: ('hit' | 'partly' | 'missed')[], change = ''): Review =>
  ({ id: 'r' + monday, kind: 'weekly', period_start: monday, period_end: monday, status: 'done', went_well: '', got_in_way: '', change_next: change, obstacles: [], actions_done: 0, actions_planned: 0, completed_at: null, goal_results: results.map((r, i) => ({ goal_id: ['a', 'b'][i]!, level: 'week', step_id: null, note: 'wk', result: r })) }) as Review;

function base(): AppData {
  const d = emptyData();
  d.plans = [plan];
  d.goals = [goal('a', 'Land a PO role', '#5b8cff'), goal('b', 'JHU', '#e86a4f')];
  d.planGoals = [{ id: 'pg1', plan_id: 'p', goal_id: 'a' }, { id: 'pg2', plan_id: 'p', goal_id: 'b' }];
  d.milestones = [
    { id: 'm1', goal_id: 'a', title: 'Mock interview', due_date: '2026-11-03', completed_at: null },
    { id: 'm2', goal_id: 'b', title: 'Module 5', due_date: '2026-12-08', completed_at: '2026-12-01T12:00:00.000Z' },
    { id: 'm3', goal_id: 'b', title: 'Capstone', due_date: '2027-03-02', completed_at: null },
  ];
  d.reviews = [weekly('2026-10-12', ['hit', 'hit']), weekly('2026-10-19', ['hit', 'partly'], 'Prep lunches'), weekly('2026-10-26', ['missed', 'missed'])];
  return d;
}

test('weekRecord colours each week from its review and marks the current one', () => {
  const cells = weekRecord(base(), plan, '2026-11-04');
  assert.equal(cells.length, 27, 'calendar weeks the season touches');
  assert.deepEqual(cells.slice(0, 4).map((c) => c.result), ['hit', 'part', 'miss', 'none']);
  assert.equal(cells[3]!.current, true);
  assert.equal(cells[1]!.change, 'Prep lunches');
  assert.equal(cells[1]!.goals[1]!.goal.title, 'JHU');
  assert.deepEqual(weekTotals(cells), { hit: 1, reviewed: 3, bestRun: 1 });
});

test('chapterView lists what is due in the stretch and how a past one went', () => {
  const d = base();
  const view = new View(d, '2026-11-04', 0.5);
  const now = chapterView(view, d, plan, 1, '2026-11-04')!;
  assert.equal(now.state, 'now');
  assert.equal(now.chapter.phase, 'build');
  assert.deepEqual(now.due.map((x) => x.title), ['Mock interview', 'Module 5']);
  assert.equal(now.due[0]!.status, 'past due');
  assert.equal(now.due[1]!.status, 'done');
  const past = chapterView(view, d, plan, 0, '2026-11-04')!;
  assert.equal(past.state, 'past');
  assert.match(past.went, /weeks hit/);
  const push = chapterView(view, d, plan, 3, '2026-11-04')!;
  assert.equal(push.state, 'future');
  assert.deepEqual(push.due.map((x) => x.title), ['Capstone']);
  const finish = chapterView(view, d, plan, 4, '2026-11-04')!;
  assert.ok(finish.due.some((x) => x.title === 'Retrospective'));
  const middle = chapterView(view, d, plan, 2, '2026-11-04')!;
  assert.ok(middle.due.some((x) => x.title === '3-month checkpoint'), 'the checkpoint sits in the middle');
});
