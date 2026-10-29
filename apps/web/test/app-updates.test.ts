import { test } from 'node:test';
import assert from 'node:assert/strict';
import { missingSessionsForWeek, type Action, type ActionSchedule, type Goal } from '@six/core';
import { applyOp, emptyData, type AppData, type Op } from '../src/data/model.ts';
import { opsEnsureWeek } from '../src/data/ops.ts';
import { applyUpdate, docStudyUpdate } from '../src/data/updates.ts';

// Thursday Oct 29 2026: the course is bought; study starts Monday Nov 2.
const TODAY = '2026-10-29';
const run = (d: AppData, ops: Op[]) => ops.reduce(applyOp, d);
const goal: Goal = { id: 'doc', title: 'Learn to make documentaries', type: 'finish', why: '', done_means: '', unit: null, baseline_value: null, baseline_date: null, target_value: null, target_date: null, color: '#000', measurement_type_id: null, archived_at: null, group_id: null };
const action = (id: string, title: string, minutes: number): Action => ({ id, title, kind: 'minutes', planned_minutes: minutes, planned_count: null, min_label: '', min_minutes: null, min_count: null, priority: false, archived_at: null });
const sched = (id: string, days: number[], from: string, to: string | null = null): ActionSchedule => ({ id: `s-${id}`, action_id: id, rule: 'days', days, per_week: null, effective_from: from, effective_to: to });

function base(): AppData {
  const d = emptyData();
  d.goals = [goal];
  d.actions = [action('compare', 'Compare documentary courses and buy one', 45), action('course', 'Documentary Fundamentals course', 45), action('shoot', 'Shoot or edit', 90), action('clips', 'Log every clip from the shoot', 15)];
  d.schedules = [sched('compare', [3], '2026-10-28', '2026-10-28'), sched('course', [1, 2, 3, 4, 5], '2026-11-02', '2026-11-30'), sched('shoot', [6, 7], '2026-11-07'), sched('clips', [7], '2026-11-08')];
  d.actionGoals = d.actions.map((a) => ({ id: `ag-${a.id}`, action_id: a.id, goal_id: 'doc' }));
  d.milestones = [
    { id: 'm1', goal_id: 'doc', title: 'Course bought', due_date: '2026-11-01', completed_at: null, value: null, prize: '', prize_claimed_at: null },
    { id: 'm2', goal_id: 'doc', title: 'DFA modules 1–7 done', due_date: '2026-11-30', completed_at: null, value: null, prize: '', prize_claimed_at: null },
  ];
  d.sessions = [...missingSessionsForWeek(d.actions, d.schedules, [], '2026-10-26', () => crypto.randomUUID()), ...missingSessionsForWeek(d.actions, d.schedules, [], '2026-11-02', () => crypto.randomUUID())];
  return d;
}
const on = (d: AppData, date: string) => d.sessions.filter((s) => s.date === date && s.status !== 'moved').map((s) => `${s.title}:${s.planned_minutes}`).sort();

test('an hour of Doc Film Academy every day from Monday, the purchase ticked, practice paused', () => {
  const d = base();
  const p = docStudyUpdate.preview(d, TODAY);
  assert.equal(p.done, false);
  assert.equal(p.lines.length, 3);
  assert.deepEqual(p.options.map((o) => `${o.id}:${o.on}`), ['pausePractice:true', 'clearMilestones:false']);
  const { ops, undo } = applyUpdate(docStudyUpdate, d, TODAY, { pausePractice: true });
  let after = run(d, ops);
  for (const monday of ['2026-11-02', '2026-11-30', '2026-12-07']) after = run(after, opsEnsureWeek(after, monday));
  for (const date of ['2026-11-02', '2026-11-04', '2026-11-07', '2026-11-08', '2026-12-01', '2026-12-13']) assert.deepEqual(on(after, date), ['Doc Film Academy: study:60'], date);
  assert.deepEqual(on(after, '2026-11-01'), []);
  assert.equal(after.sessions.find((s) => s.action_id === 'compare')!.status, 'done');
  assert.ok(after.milestones.find((m) => m.id === 'm1')!.completed_at);
  assert.ok(after.milestones.some((m) => m.id === 'm2'));
  assert.equal(docStudyUpdate.preview(after, TODAY).done, true);
  const norm = (x: AppData) => JSON.stringify(Object.fromEntries(Object.entries(x).map(([k, v]) => [k, Array.isArray(v) ? v.map((r) => JSON.stringify(r)).sort() : v])));
  assert.equal(norm(run(after = run(d, ops), undo)), norm(d));
});

test('keeping the practice tasks', () => {
  const d = base();
  let after = run(d, applyUpdate(docStudyUpdate, d, TODAY, { pausePractice: false }).ops);
  after = run(after, opsEnsureWeek(after, '2026-11-02'));
  assert.deepEqual(on(after, '2026-11-07'), ['Doc Film Academy: study:60', 'Shoot or edit:90']);
});

test('no study task yet: one is made', () => {
  const d = base();
  const noCourse = { ...d, actions: d.actions.filter((a) => a.id !== 'course'), schedules: d.schedules.filter((s) => s.action_id !== 'course'), sessions: d.sessions.filter((s) => s.action_id !== 'course') };
  let after = run(noCourse, applyUpdate(docStudyUpdate, noCourse, TODAY, {}).ops);
  after = run(after, opsEnsureWeek(after, '2026-11-02'));
  assert.ok(on(after, '2026-11-03').includes('Doc Film Academy: study:60'));
  assert.ok(after.actionGoals.some((x) => x.goal_id === 'doc' && after.actions.find((a) => a.id === x.action_id)?.title === 'Doc Film Academy: study'));
});

test('clearing the drafted milestones keeps the one you just ticked', () => {
  const d = base();
  const after = run(d, applyUpdate(docStudyUpdate, d, TODAY, { pausePractice: true, clearMilestones: true }).ops);
  assert.deepEqual(after.milestones.map((m) => m.id), ['m1']);
});
