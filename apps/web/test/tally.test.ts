import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyOp, emptyData, type AppData, type Op } from '../src/data/model.ts';
import { View } from '../src/data/derive.ts';
import { opsSettleTallies, talliesFor, tallyFor } from '../src/data/tally.ts';
import { opsLogSession } from '../src/data/ops.ts';
import type { Goal, Session } from '@six/core';

const goal = (id: string, title: string): Goal => ({ id, title, type: 'finish', why: '', done_means: '', unit: null, baseline_value: null, baseline_date: null, target_value: null, target_date: null, color: '#000', measurement_type_id: null, archived_at: null });
const run = (data: AppData, ops: Op[]) => ops.reduce(applyOp, data);
const session = (id: string, date: string, status: Session['status'], actual: number | null = null): Session =>
  ({ id, action_id: 'apply', date, week_start: date, slot: 0, title: 'Apply to 25 jobs', priority: false, planned_minutes: 60, planned_count: 25, status, actual_minutes: null, actual_count: actual, note: '', obstacles: [], origin: 'scheduled' }) as Session;

function base(): AppData {
  const d = emptyData();
  d.goals = [goal('po', 'Land an AI product owner role')];
  d.actions = [{ id: 'apply', title: 'Apply to 25 jobs', kind: 'count', planned_minutes: 60, planned_count: 25, min_label: '', min_minutes: null, min_count: null, priority: false, archived_at: null }];
  d.actionGoals = [{ id: 'ag1', action_id: 'apply', goal_id: 'po' }];
  d.schedules = [{ id: 's1', action_id: 'apply', rule: 'days', days: [1, 2, 3, 4, 5], per_week: null, effective_from: '2026-10-19', effective_to: null }];
  d.milestones = [{ id: 'm1', goal_id: 'po', title: '250 applications', due_date: '2026-11-13', completed_at: null, value: 250, prize: '', count_action_id: 'apply' }];
  d.sessions = [session('a', '2026-10-19', 'done'), session('b', '2026-10-20', 'done'), session('c', '2026-10-21', 'partial', 10), session('d', '2026-10-22', 'planned')];
  return d;
}

test('a running total reads the task logs and paces them to the date', () => {
  const d = base();
  const view = new View(d, '2026-10-22', 0.5);
  assert.deepEqual(talliesFor(d, 'apply').map((m) => m.id), ['m1']);
  const t = tallyFor(view, d.milestones[0]!, '2026-10-22')!;
  assert.equal(t.total, 60);
  assert.equal(t.left, 190);
  assert.equal(t.daysLeft, 22);
  assert.equal(t.perDay, 9);
  assert.equal(tallyFor(view, { ...d.milestones[0]!, count_action_id: null }, '2026-10-22'), null, 'a plain date has no total');
});

test('logging the count that reaches the target ticks the date off on that day', () => {
  let d = base();
  d.milestones[0]!.value = 80;
  assert.deepEqual(opsSettleTallies(d), [], 'not there yet at 60');
  d = run(d, opsLogSession(d.sessions[3]!, { status: 'done', actual_count: 25 }));
  const ops = opsSettleTallies(d);
  assert.equal(ops.length, 1);
  d = run(d, ops);
  assert.equal(d.milestones[0]!.completed_at, '2026-10-22T12:00:00.000Z');
  assert.deepEqual(opsSettleTallies(d), [], 'settled once');
});
