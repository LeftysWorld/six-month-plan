import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyOp, emptyData, type AppData, type Op } from '../src/data/model.ts';
import { View } from '../src/data/derive.ts';
import {
  blankTarget,
  daysLabel,
  defaultMonday,
  goalTotal,
  isPlannedDown,
  ladderPeriods,
  ladderTargets,
  leadingNumber,
  opsCommitTasks,
  opsSaveTargets,
  suggestionsFor,
  targetText,
  targetsAt,
  weekChips,
  type TaskDraft,
} from '../src/data/ladder.ts';
import type { Goal, Plan } from '@six/core';

const TODAY = '2026-10-30'; // a Friday: the week to plan is Mon Nov 2

const plan: Plan = { id: 'p', name: 'Season', start_date: '2026-11-02', end_date: '2027-04-30', block_days: 28, archived_at: null };
const goal = (patch: Partial<Goal> = {}): Goal => ({
  id: 'g',
  title: 'Land a product role',
  type: 'finish',
  why: '',
  done_means: 'Signed offer',
  unit: null,
  baseline_value: null,
  baseline_date: null,
  target_value: null,
  target_date: null,
  color: '#7d6bff',
  measurement_type_id: null,
  archived_at: null,
  ...patch,
});
const run = (data: AppData, ops: Op[]) => ops.reduce(applyOp, data);

function base(g: Goal = goal()): AppData {
  const d = emptyData();
  d.plans = [plan];
  d.goals = [g];
  d.planGoals = [{ id: 'pg', plan_id: 'p', goal_id: g.id }];
  d.milestones = [{ id: 'm150', goal_id: g.id, title: '150 applications', due_date: '2027-04-30', completed_at: null }];
  d.profile = { ...d.profile, available_minutes: [180, 150, 120, 120, 150, 180, 60] };
  return d;
}

test('a title that starts with a number is a running total; a year is not', () => {
  assert.equal(leadingNumber('150 applications'), 150);
  assert.equal(leadingNumber('1,000 km'), 1000);
  assert.equal(leadingNumber('2027 resolution'), null);
  assert.equal(leadingNumber('Offer signed'), null);
  const d = base();
  assert.deepEqual(goalTotal(d, d.goals[0]!, TODAY), { milestone: d.milestones[0], target: 150, unit: 'applications', actionId: null, now: 0 });
});

test('the week to plan is next week from Thursday, and the month is one you could finish', () => {
  const d = base();
  const view = new View(d, TODAY, 0.5);
  const monday = defaultMonday(view, d.goals[0]!, plan);
  assert.equal(monday, '2026-11-02');
  const p = ladderPeriods(view, d.goals[0]!, plan, monday);
  assert.equal(p.week.start, '2026-11-02');
  assert.ok(p.month.end >= '2026-11-22', `the month runs at least three weeks: ${p.month.end}`);
  assert.ok(p.quarter.end > p.month.end);
});

test('targets save one row per slot, update in place, and removing one unlinks its tasks', () => {
  let d = base();
  const view = new View(d, TODAY, 0.5);
  const g = d.goals[0]!;
  const p = ladderPeriods(view, g, plan, '2026-11-02');
  const a = { ...blankTarget(), text: '75 applications', value: 75 };
  const b = { ...blankTarget(), text: '2 AI PRDs in the portfolio' };
  d = run(d, opsSaveTargets(d, g, plan, 'quarter', p.quarter, [a, b, blankTarget()]));
  let rows = targetsAt(d, 'g', 'p', 'quarter', p.quarter.start);
  assert.deepEqual(rows.map((r) => [r.slot, r.target_note, r.target_value]), [[0, '75 applications', 75], [1, '2 AI PRDs in the portfolio', null]]);
  assert.equal(isPlannedDown(new View(d, TODAY, 0.5), g, plan), true);

  // A task linked to the second target; then the second target is removed and the first changed.
  d.actions = [{ id: 'act', title: 'Write the PRD', kind: 'check', planned_minutes: 30, planned_count: null, min_label: '', min_minutes: null, min_count: null, priority: false, step_id: b.id, archived_at: null }];
  d = run(d, opsSaveTargets(d, g, plan, 'quarter', p.quarter, [{ ...a, text: '80 applications', value: 80 }]));
  rows = targetsAt(d, 'g', 'p', 'quarter', p.quarter.start);
  assert.deepEqual(rows.map((r) => [r.id, r.target_note, r.target_value]), [[a.id, '80 applications', 80]]);
  assert.equal(d.actions[0]!.step_id, null, 'the task keeps running, unlinked');
});

test('a week suggestion spreads what is left of the month over the weeks left', () => {
  let d = base();
  const g = d.goals[0]!;
  const view0 = new View(d, TODAY, 0.5);
  const p = ladderPeriods(view0, g, plan, '2026-11-02');
  d = run(d, opsSaveTargets(d, g, plan, 'month', p.month, [{ ...blankTarget(), text: '20 applications', value: 20 }]));
  const view = new View(d, TODAY, 0.5);
  const parents = ladderTargets(d, g, plan, p).month;
  const s = suggestionsFor(view, g, plan, 'week', p, parents);
  const total = s.find((x) => x.key === 'total')!;
  const weeks = Math.ceil((Date.parse(p.month.end) - Date.parse('2026-11-02')) / 864e5 / 7 + 1 / 7);
  assert.equal(total.value, Math.ceil(20 / weeks));
  assert.equal(total.parentId, parents[0]!.id);
  assert.match(total.why, /0 of 20/);
});

test('the 3-month suggestion follows the pace curve', () => {
  const even = base();
  const ramp = base(goal({ pace_curve: 'ramp' }));
  const at = (d: AppData) => {
    const view = new View(d, TODAY, 0.5);
    const p = ladderPeriods(view, d.goals[0]!, plan, '2026-11-02');
    return suggestionsFor(view, d.goals[0]!, plan, 'quarter', p, []).find((x) => x.key === 'total')!.value!;
  };
  assert.ok(at(ramp) < at(even), `${at(ramp)} < ${at(even)}`);
  assert.ok(Math.abs(at(even) - 75) <= 3);
});

test('starting the plan makes each task on its days, linked to its week goal, and counting into the total', () => {
  let d = base();
  const g = d.goals[0]!;
  const p = ladderPeriods(new View(d, TODAY, 0.5), g, plan, '2026-11-02');
  d = run(d, opsSaveTargets(d, g, plan, 'week', p.week, [{ ...blankTarget(), text: '5 applications', value: 5 }, { ...blankTarget(), text: 'Resume rewritten' }]));
  const week = targetsAt(d, 'g', 'p', 'week', p.week.start);
  const drafts: TaskDraft[] = [
    { key: 'apply', title: 'Apply to 1 role', minutes: 45, days: [1, 2, 3, 4, 5], kind: 'count', count: 1, target: 0, repeat: 'month' },
    { key: 'resume', title: 'Rewrite summary', minutes: 60, days: [1], kind: 'check', count: null, target: 1, repeat: 'week' },
  ];
  const { ops, undo, made } = opsCommitTasks(d, g, p, week, drafts, TODAY);
  assert.equal(made, 2);
  const after = run(d, ops);
  const apply = after.actions.find((a) => a.title === 'Apply to 1 role')!;
  assert.equal(apply.step_id, week[0]!.id);
  assert.equal(apply.planned_count, 1);
  const sched = after.schedules.find((s) => s.action_id === apply.id)!;
  assert.equal(sched.effective_from, '2026-11-02');
  assert.equal(sched.effective_to, p.month.end);
  const resume = after.actions.find((a) => a.title === 'Rewrite summary')!;
  assert.equal(after.schedules.find((s) => s.action_id === resume.id)!.effective_to, '2026-11-08');
  const sessions = after.sessions.filter((s) => s.week_start === '2026-11-02');
  assert.equal(sessions.filter((s) => s.action_id === apply.id).length, 5);
  assert.equal(sessions.filter((s) => s.action_id === resume.id).map((s) => s.date).join(), '2026-11-02');
  assert.equal(after.milestones[0]!.count_action_id, apply.id, 'the total now counts from the new task');
  // Undo puts everything back.
  const back = run(after, undo);
  assert.equal(back.actions.length, 0);
  assert.equal(back.sessions.length, 0);
  assert.equal(back.milestones[0]!.count_action_id ?? null, null);
});

test('the week grid shows planned tasks on their days next to what is already there', () => {
  const d = base();
  d.goals.push({ ...goal(), id: 'other', title: 'Other' });
  d.planGoals.push({ id: 'pg2', plan_id: 'p', goal_id: 'other' });
  d.actions = [{ id: 'gym', title: 'Gym', kind: 'check', planned_minutes: 60, planned_count: null, min_label: '', min_minutes: null, min_count: null, priority: false, archived_at: null }];
  d.actionGoals = [{ id: 'ag', action_id: 'gym', goal_id: 'other' }];
  d.schedules = [{ id: 's', action_id: 'gym', rule: 'days', days: [4], per_week: null, effective_from: '2026-10-01', effective_to: null }];
  const view = new View(d, TODAY, 0.5);
  const chips = weekChips(view, d.goals[0]!, '2026-11-02', [], [{ key: 'x', title: 'Edits', minutes: 40, days: [4], kind: 'check', count: null, target: null, repeat: 'week' }]);
  const thu = chips.filter((c) => c.date === '2026-11-05');
  assert.deepEqual(thu.map((c) => [c.title, c.mine]).sort(), [['Edits', true], ['Gym', false]]);
});

test('targets read as one line and days read as a run', () => {
  const g = goal({ type: 'number', unit: 'lb' });
  assert.equal(targetText(g, { target_note: 'Lock in the eating window', target_value: 207.8 }), '207.8 lb · Lock in the eating window');
  assert.equal(targetText(g, { target_note: '207.8 lb', target_value: 207.8 }), '207.8 lb');
  assert.equal(daysLabel([1, 2, 3, 4, 5]), 'Mon–Fri');
  assert.equal(daysLabel([1, 3, 5]), 'Mon, Wed, Fri');
  assert.equal(daysLabel([]), 'No day yet');
});
