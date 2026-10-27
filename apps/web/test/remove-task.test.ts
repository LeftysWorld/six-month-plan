import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyOp, emptyData, type AppData, type Op } from '../src/data/model.ts';
import { opsRemoveTask, tasksInRange } from '../src/data/breakdown.ts';
import type { Goal, Session } from '@six/core';

const goal = (id: string, title: string): Goal => ({ id, title, type: 'practice', why: '', done_means: '', unit: null, baseline_value: null, baseline_date: null, target_value: null, target_date: null, color: '#000', measurement_type_id: null, archived_at: null });
const run = (data: AppData, ops: Op[]) => ops.reduce(applyOp, data);
const week = { start: '2026-10-26', end: '2026-11-01' }; // Mon–Sun
const session = (id: string, date: string, status: Session['status']): Session =>
  ({ id, action_id: 'coffee', date, week_start: '2026-10-26', status, origin: 'scheduled', planned_minutes: 20, actual_minutes: null, note: '', obstacle: '' }) as unknown as Session;

function base(): AppData {
  const d = emptyData();
  d.goals = [goal('po', 'Land an AI product owner role')];
  d.actions = [{ id: 'coffee', title: 'One networking message or coffee chat', kind: 'check', planned_minutes: 20, planned_count: null, min_label: '', min_minutes: null, min_count: null, priority: false, archived_at: null }];
  d.actionGoals = [{ id: 'ag1', action_id: 'coffee', goal_id: 'po' }];
  d.schedules = [{ id: 's1', action_id: 'coffee', rule: 'per_week', days: [], per_week: 1, effective_from: '2026-10-19', effective_to: null }];
  d.sessions = [session('x1', '2026-10-27', 'planned'), session('x2', '2026-10-29', 'planned')];
  return d;
}

test('removing a never-logged task on Tuesday takes it out of this week entirely', () => {
  const d = run(base(), opsRemoveTask(base(), base().actions[0]!, '2026-10-27'));
  assert.equal(d.schedules.length, 0, 'no schedule is left behind');
  assert.ok(d.actions[0]!.archived_at, 'the task is archived');
  assert.equal(d.sessions.filter((s) => s.status === 'planned').length, 0, 'planned days are gone');
  assert.deepEqual(tasksInRange(d, 'po', week), []);
});

test('removing a task that was logged this week keeps it listed, stopped, with its history', () => {
  const start = base();
  start.sessions = [session('x0', '2026-10-26', 'done'), session('x1', '2026-10-29', 'planned')];
  const d = run(start, opsRemoveTask(start, start.actions[0]!, '2026-10-27'));
  assert.equal(d.schedules[0]!.effective_to, '2026-10-26', 'the schedule ends the day before');
  assert.equal(d.actions[0]!.archived_at, null);
  assert.equal(tasksInRange(d, 'po', week).length, 1, 'this week still shows the day that was done');
  assert.deepEqual(tasksInRange(d, 'po', { start: '2026-11-02', end: '2026-11-08' }), [], 'next week does not');
});

test('a task stopped last week with logs only last week is not listed this week', () => {
  const start = base();
  start.sessions = [{ ...session('x0', '2026-10-22', 'done'), week_start: '2026-10-19' } as Session];
  const d = run(start, opsRemoveTask(start, start.actions[0]!, '2026-10-24'));
  assert.deepEqual(tasksInRange(d, 'po', week), []);
});
