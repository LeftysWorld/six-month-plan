import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyOp, emptyData, type AppData, type Op } from '../src/data/model.ts';
import { View } from '../src/data/derive.ts';
import { goalTrack } from '../src/data/season.ts';
import { dateLimits, opsSetGoalDates } from '../src/data/dates.ts';
import type { Goal } from '@six/core';

const run = (data: AppData, ops: Op[]) => ops.reduce(applyOp, data);
const goal = (id: string, extra: Partial<Goal> = {}): Goal => ({ id, title: id, type: 'finish', why: '', done_means: '', unit: null, baseline_value: null, baseline_date: null, target_value: null, target_date: null, color: '#000', measurement_type_id: null, archived_at: null, ...extra });

function base(): AppData {
  const d = emptyData();
  d.plans = [{ id: 'plan', name: 'Season', start_date: '2026-11-01', end_date: '2027-04-30', block_days: 28, archived_at: null }];
  d.goals = [goal('jhu', { start_date: '2026-11-14' }), goal('aigp', { target_date: '2027-01-15' }), goal('iso', { start_date: '2027-01-16' }), goal('weight', { type: 'number', target_date: '2027-04-30' })];
  d.planGoals = d.goals.map((g) => ({ id: `pg-${g.id}`, plan_id: 'plan', goal_id: g.id }));
  return d;
}
const plan = (v: View) => v.plan('plan')!;

test('a goal with its own start date starts then, and says so before it does', () => {
  const v = new View(base(), '2026-11-05', 0.5);
  const jhu = v.goal('jhu')!;
  assert.equal(v.startFor(jhu, plan(v)), '2026-11-14');
  const t = goalTrack(v, jhu, plan(v));
  assert.equal(t.started, false);
  assert.equal(t.status, 'Starts Nov 14');
});

test('a goal with its own start is planned from that start, inside the season', () => {
  const v = new View(base(), '2026-11-05', 0.5);
  assert.deepEqual(v.plannedWindow(v.goal('iso')!, plan(v)), { start: '2027-01-16', end: '2027-04-30' });
  assert.equal(dateLimits(v, v.goal('iso')!, plan(v)).minStart, '2026-11-01');
});

test('saving dates clamps to the window, stores only what differs from the defaults, and logs it', () => {
  let d = base();
  let v = new View(d, '2026-11-05', 0.5);
  const r = opsSetGoalDates(v, v.goal('aigp')!, plan(v), { start: '2026-10-01', end: '2027-02-01' }, '2026-11-05');
  assert.equal(r.clamped, true);
  assert.equal(r.start, '2026-11-01');
  d = run(d, r.ops);
  const aigp = d.goals.find((g) => g.id === 'aigp')!;
  assert.equal(aigp.target_date, '2027-02-01');
  assert.equal(aigp.start_date ?? null, null, 'starting with the window stores nothing');
  assert.match(d.changeLog.at(-1)!.summary, /Dates: Nov 1 – Jan 15 → Nov 1 – Feb 1/);
  // Same dates again: nothing to save.
  v = new View(d, '2026-11-05', 0.5);
  assert.deepEqual(opsSetGoalDates(v, v.goal('aigp')!, plan(v), { start: '2026-11-01', end: '2027-02-01' }, '2026-11-05').ops, []);
});

test("a number goal's end stays with its path; only its start moves", () => {
  let d = base();
  const v = new View(d, '2026-11-05', 0.5);
  const r = opsSetGoalDates(v, v.goal('weight')!, plan(v), { start: '2026-11-10', end: '2027-02-01' }, '2026-11-05');
  d = run(d, r.ops);
  const w = d.goals.find((g) => g.id === 'weight')!;
  assert.equal(w.start_date, '2026-11-10');
  assert.equal(w.target_date, '2027-04-30');
});
