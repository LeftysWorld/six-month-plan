import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyOp, emptyData, type AppData, type Op } from '../src/data/model.ts';
import { View } from '../src/data/derive.ts';
import { blankTask, scheduleFor } from '../src/data/breakdown.ts';
import { calendarItems, opsAddOnDate } from '../src/data/calendar.ts';
import { blankHabit, habitsOf, isHabit, opsCreateHabit, opsStopHabit } from '../src/data/habits.ts';
import type { Goal } from '@six/core';

const run = (data: AppData, ops: Op[]) => ops.reduce(applyOp, data);
const goal = (id: string, extra: Partial<Goal> = {}): Goal => ({ id, title: id, type: 'finish', why: '', done_means: '', unit: null, baseline_value: null, baseline_date: null, target_value: null, target_date: null, color: '#000', measurement_type_id: null, archived_at: null, ...extra });
const TODAY = '2026-10-26';

function base(): AppData {
  const d = emptyData();
  d.plans = [{ id: 'plan', name: 'Season', start_date: '2026-10-19', end_date: '2027-04-19', block_days: 28, archived_at: null }];
  d.goals = [goal('jhu', { start_date: '2026-11-14' }), goal('aigp', { target_date: '2027-01-15' })];
  d.planGoals = d.goals.map((g) => ({ id: `pg-${g.id}`, plan_id: 'plan', goal_id: g.id }));
  d.milestones = [{ id: 'ms', goal_id: 'jhu', title: 'Class begins', due_date: '2026-11-14', completed_at: null }];
  return d;
}
const week = { start_date: '2026-10-26', end_date: '2026-11-01' } as never;

test('a repeating task can start later and stop on a date', () => {
  const input = { ...blankTask(week, TODAY), title: 'Coursework', days: [1, 2, 3, 4, 5, 6, 7], start: '2026-11-14', through: '2027-01-30' };
  const s = scheduleFor('a', input, TODAY);
  assert.equal(s.effective_from, '2026-11-14');
  assert.equal(s.effective_to, '2027-01-30');
  // An end before the start is pulled up to the start, never left inverted.
  const odd = scheduleFor('a', { ...input, through: '2026-11-01' }, TODAY);
  assert.equal(odd.effective_to, '2026-11-14');
  // No start (or one in the past) means from today.
  assert.equal(scheduleFor('a', { ...input, start: '2026-10-01' }, TODAY).effective_from, TODAY);
});

test('habits are tasks with no goal; stopping one keeps its history', () => {
  const d = base();
  const { ops, id } = opsCreateHabit(d, { ...blankHabit(TODAY), title: 'Clean house' }, TODAY);
  const after = run(d, ops);
  assert.ok(isHabit(after, id));
  assert.equal(habitsOf(after, TODAY).length, 1);
  assert.ok(after.sessions.some((s) => s.action_id === id && s.date === TODAY), 'today is on the list');
  const stopped = run(after, opsStopHabit(after, after.actions.find((a) => a.id === id)!, TODAY));
  assert.equal(habitsOf(stopped, TODAY).filter((h) => h.running).length, 0);
});

test('the calendar shows milestones, goal starts and things added on a date', () => {
  let d = base();
  d = run(d, opsAddOnDate(d, { title: 'AIGP exam', date: '2027-01-15', goalId: 'aigp' }, TODAY));
  d = run(d, opsAddOnDate(d, { title: 'Dentist', date: '2026-11-03', goalId: null }, TODAY));
  const items = calendarItems(new View(d, TODAY, 0.5), '2026-10-19', '2027-04-19');
  const on = (date: string) => (items.get(date) ?? []).map((i) => `${i.kind}:${i.title}`);
  assert.ok(on('2026-11-14').includes('milestone:Class begins'));
  assert.ok(on('2026-11-14').includes('start:jhu'));
  assert.ok(on('2027-01-15').includes('task:AIGP exam'));
  assert.ok(on('2027-01-15').includes('finish:aigp'));
  assert.ok(on('2026-11-03').includes('oneoff:Dentist'));
  // The exam is a task for its goal, not a habit.
  const exam = d.actions.find((a) => a.title === 'AIGP exam')!;
  assert.equal(isHabit(d, exam.id), false);
});
