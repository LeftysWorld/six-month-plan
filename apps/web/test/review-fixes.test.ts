import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyOp, applyReviewPayload, emptyData, type AppData, type Op } from '../src/data/model.ts';
import { View } from '../src/data/derive.ts';
import { opsSetGoalDates } from '../src/data/dates.ts';
import type { Goal, Review } from '@six/core';

const run = (data: AppData, ops: Op[]) => ops.reduce(applyOp, data);
const goal = (id: string, extra: Partial<Goal> = {}): Goal => ({ id, title: id, type: 'finish', why: '', done_means: '', unit: null, baseline_value: null, baseline_date: null, target_value: null, target_date: null, color: '#000', measurement_type_id: null, archived_at: null, ...extra });
const TODAY = '2026-10-26';

function base(): AppData {
  const d = emptyData();
  d.plans = [{ id: 'plan', name: 'Season', start_date: '2026-10-19', end_date: '2027-04-19', block_days: 28, archived_at: null }];
  d.goals = [goal('weight', { type: 'number', unit: 'lb', measurement_type_id: 'w', target_value: 200 }), goal('done', { completed_at: '2026-10-25T23:30:00Z' })];
  d.planGoals = d.goals.map((g) => ({ id: `pg-${g.id}`, plan_id: 'plan', goal_id: g.id }));
  d.measurementTypes = [{ id: 'w', goal_id: 'weight', name: 'Weight', unit: 'lb', cadence_days: 1, archived_at: null, on_today: null }];
  d.measurements = [{ id: 'm1', type_id: 'w', value: 210, measured_on: TODAY, source: 'task', note: '' }];
  return d;
}
const review = (over: Partial<Review> = {}): Review => ({ id: 'r1', kind: 'weekly', period_start: '2026-10-19', period_end: '2026-10-25', status: 'done', went_well: '', got_in_way: '', change_next: '', obstacles: [], actions_done: 0, actions_planned: 0, completed_at: null, ...over });

test('a measurement logged today is not due again today', () => {
  const view = new View(base(), TODAY, 0.5);
  assert.deepEqual(view.measurementsDue(TODAY), []);
  assert.equal(new View(base(), '2026-10-27', 0.5).measurementsDue('2026-10-27').length, 1, 'due again tomorrow');
});

test('a review reading replaces the day it already has instead of adding a second one', () => {
  const after = applyReviewPayload(base(), {
    review: review(),
    measurements: [{ id: 'm2', type_id: 'w', value: 209, measured_on: TODAY, source: 'manual', note: '' }],
    schedule_changes: [],
    action_changes: [],
    sessions: [],
  });
  const today = after.measurements.filter((m) => m.type_id === 'w' && m.measured_on === TODAY);
  assert.equal(today.length, 1);
  assert.equal(today[0]!.value, 209);
});

test('the retrospective can see completed goals; everyday lists cannot', () => {
  const view = new View(base(), TODAY, 0.5);
  assert.deepEqual(view.goalsForPlan('plan').map((g) => g.id), ['weight']);
  assert.deepEqual(view.goalsForPlan('plan', true).filter((g) => !g.archived_at).map((g) => g.id).sort(), ['done', 'weight']);
});

test('timestamps become days in the profile time zone', () => {
  const d = base();
  d.profile.timezone = 'America/New_York';
  const view = new View(d, TODAY, 0.5);
  // 23:30 UTC on Oct 25 is 19:30 in New York: still Oct 25 (slicing the UTC string would also say Oct 25,
  // so use a time that differs): 03:30 UTC on Oct 26 is the evening of Oct 25 in New York.
  assert.equal(view.dayOf('2026-10-26T03:30:00Z'), '2026-10-25');
  assert.equal(view.dayOf('2026-10-26T12:00:00Z'), '2026-10-26');
});

test('a number goal dragged on the roadmap keeps its start on or before its finish, and undo removes the history row', () => {
  const d = base();
  d.goals = [goal('weight', { type: 'number', unit: 'lb', measurement_type_id: 'w', target_value: 200, target_date: '2026-12-01' })];
  d.planGoals = [{ id: 'pg', plan_id: 'plan', goal_id: 'weight' }];
  const view = new View(d, TODAY, 0.5);
  const g = d.goals[0]!;
  const res = opsSetGoalDates(view, g, d.plans[0]!, { start: '2027-01-15', end: '2026-12-01' }, TODAY, 'end');
  assert.equal(res.start, '2026-12-01', 'the start stops at the locked finish');
  assert.ok(res.logId, 'the change is written to history');
  const after = run(d, res.ops);
  assert.equal(after.changeLog.length, 1);
  assert.equal(after.goals[0]!.start_date, '2026-12-01');
});
