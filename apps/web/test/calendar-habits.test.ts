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

test('dates inside a goal: milestones change and undo; set 3-month, month and week goals show as checkpoints', async () => {
  const { checkpointsOf, opsUpdateMilestone, opsDeleteMilestone, opsRestoreMilestone } = await import('../src/data/dated.ts');
  let d = base();
  d.goals[0]!.unit = 'lb';
  const ms = d.milestones[0]!;
  d = run(d, opsUpdateMilestone(ms, { title: ' JHU course starts ', due_date: '2026-11-16' }));
  assert.deepEqual([d.milestones[0]!.title, d.milestones[0]!.due_date], ['JHU course starts', '2026-11-16']);
  assert.equal(opsUpdateMilestone(d.milestones[0]!, { title: 'JHU course starts' }).length, 0, 'no change, no op');
  d = run(d, opsRestoreMilestone(d, ms));
  assert.equal(d.milestones[0]!.due_date, '2026-11-14', 'undo puts the date back');
  const gone = run(d, opsDeleteMilestone(ms));
  assert.equal(gone.milestones.length, 0);
  assert.equal(run(gone, opsRestoreMilestone(gone, ms)).milestones.length, 1, 'undo brings it back');

  const step = (id: string, level: 'quarter' | 'month' | 'week', end: string, note: string, value: number | null = null) => ({ id, goal_id: 'jhu', plan_id: 'plan', parent_id: null, level, idx: 0, title: '', start_date: '2026-10-19', end_date: end, target_value: value, target_note: note, completed_at: null });
  d.planSteps = [step('q', 'quarter', '2027-01-17', 'Modules 1–6', 197), step('m', 'month', '2026-11-15', ''), step('w0', 'week', '2026-10-25', 'old week'), step('w1', 'week', '2026-11-01', 'Module 2 quiz')];
  const cps = checkpointsOf(d, d.goals[0]!, '2026-10-26');
  assert.deepEqual(cps.map((c) => [c.level, c.date, c.text]), [['week', '2026-11-01', 'Module 2 quiz'], ['quarter', '2027-01-17', '197 lb · Modules 1–6']], 'unset steps and past weeks left out');
  assert.equal(checkpointsOf(d, d.goals[0]!).length, 3, 'the calendar keeps past weeks');
  const items = calendarItems(new View(d, TODAY, 0.5), '2026-10-19', '2027-04-19');
  assert.ok((items.get('2027-01-17') ?? []).some((i) => i.kind === 'checkpoint' && i.title === '3-month goal: 197 lb · Modules 1–6'));
});

test('a one-off added on Today can be linked to a goal later, without a second copy', async () => {
  const { opsLinkOneOff, opsUnlinkOneOff } = await import('../src/data/calendar.ts');
  const { opsGenerateThisWeek } = await import('../src/data/breakdown.ts');
  let d = base();
  d = run(d, opsAddOnDate(d, { title: 'Read the syllabus', date: TODAY, goalId: null, minutes: 20 }, TODAY));
  const s = d.sessions.find((x) => x.title === 'Read the syllabus')!;
  d = run(d, [...d.sessions.filter((x) => x.id === s.id).map(() => ({ kind: 'update' as const, collection: 'sessions' as const, id: s.id, patch: { status: 'done', actual_minutes: 25 } }))]);
  const linked = run(d, opsLinkOneOff(d, d.sessions.find((x) => x.id === s.id)!, 'jhu'));
  const now = linked.sessions.find((x) => x.id === s.id)!;
  assert.ok(now.action_id, 'now a task');
  assert.equal(now.status, 'done', 'keeps its log');
  assert.deepEqual(linked.actionGoals.filter((ag) => ag.action_id === now.action_id).map((ag) => ag.goal_id), ['jhu']);
  assert.equal(new View(linked, TODAY, 0.5).goalsForAction(now.action_id).length, 1);
  const again = run(linked, opsGenerateThisWeek(linked, TODAY));
  assert.equal(again.sessions.filter((x) => x.action_id === now.action_id).length, 1, 'no duplicate session generated');
  const back = run(linked, opsUnlinkOneOff(s, now.action_id!, linked));
  assert.equal(back.sessions.find((x) => x.id === s.id)!.action_id, null);
  assert.equal(back.actions.length, d.actions.length, 'undo removes the task it made');
});
