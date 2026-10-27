import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyOp, emptyData, type AppData, type Op } from '../src/data/model.ts';
import { View } from '../src/data/derive.ts';
import { blankPath, opsAddQuestion } from '../src/data/paths.ts';
import { experimentsOf, opsAddExperiment, opsFinishExperiment, pathReport, timeByPath } from '../src/data/experiments.ts';
import { calendarItems } from '../src/data/calendar.ts';
import { weeklyDigest } from '../src/data/digest.ts';
import type { Goal } from '@six/core';

const run = (data: AppData, ops: Op[]) => ops.reduce(applyOp, data);
const TODAY = '2026-10-26';
const goal = (id: string, extra: Partial<Goal> = {}): Goal => ({ id, title: id, type: 'finish', why: '', done_means: `${id} done`, unit: null, baseline_value: null, baseline_date: null, target_value: null, target_date: null, color: '#000', measurement_type_id: null, archived_at: null, ...extra });

function base(): AppData {
  const d = emptyData();
  d.plans = [{ id: 'plan', name: 'Season', start_date: '2026-10-19', end_date: '2027-04-19', block_days: 28, archived_at: null }];
  d.goals = [goal('aigp', { path_id: 'b' }), goal('guitar', { path_id: 'a' })];
  d.planGoals = d.goals.map((g) => ({ id: `pg-${g.id}`, plan_id: 'plan', goal_id: g.id }));
  d.actions = [
    { id: 'study', title: 'Study', kind: 'minutes', planned_minutes: 30, planned_count: null, min_label: '', min_minutes: null, min_count: null, priority: false, archived_at: null },
    { id: 'play', title: 'Play', kind: 'minutes', planned_minutes: 30, planned_count: null, min_label: '', min_minutes: null, min_count: null, priority: false, archived_at: null },
  ];
  d.actionGoals = [{ id: 'ag', action_id: 'study', goal_id: 'aigp' }, { id: 'ag2', action_id: 'play', goal_id: 'guitar' }];
  const s = (id: string, action_id: string, date: string, status: 'done' | 'planned', actual_minutes: number | null) => ({ id, action_id, week_start: '2026-10-19', slot: 0, date, title: action_id, priority: false, planned_minutes: 30, planned_count: null, status, actual_minutes, actual_count: null, note: '', obstacles: [], origin: 'scheduled' as const, source: 'manual' as const, moved_from: null, logged_at: null });
  d.sessions = [s('s1', 'study', '2026-10-20', 'done', 90), s('s2', 'play', '2026-10-21', 'done', 30), s('s3', 'study', '2026-10-28', 'planned', null)];
  d.paths = [
    { ...blankPath(d, TODAY), id: 'a', name: 'Music', rank: 0, color: '#111', gauge_log: [{ on: '2026-07-01', gauges: { resources: 2, likability: 5 } }, { on: TODAY, gauges: { resources: 3, likability: 5 } }], gauges: { resources: 3, likability: 5 } },
    { ...blankPath(d, TODAY), id: 'b', name: 'Governance', rank: 1, color: '#222' },
  ];
  return d;
}

test('an experiment is added against a question, shows on its day, and finishing it answers the question', () => {
  let d = base();
  d = run(d, opsAddQuestion(d.paths[1]!, 'Would anyone pay?'));
  const q = d.paths[1]!.questions[0]!;
  const { ops, id } = opsAddExperiment('b', 'Ask one lawyer', '2026-11-05', q.id, 'The one from the meetup');
  d = run(d, ops);
  assert.equal(experimentsOf(d, 'b').length, 1);
  const view = new View(d, TODAY, 0.5);
  const items = calendarItems(view, '2026-11-05', '2026-11-05').get('2026-11-05') ?? [];
  assert.ok(items.some((x) => x.kind === 'experiment' && x.experimentId === id && x.sub === 'Governance'));
  d = run(d, opsFinishExperiment(d, d.experiments[0]!, 'Yes, two said they would.', '2026-11-04'));
  assert.ok(d.experiments[0]!.completed_at);
  assert.equal(d.paths[1]!.questions[0]!.answer, 'Yes, two said they would.');
  assert.ok(d.paths[1]!.questions[0]!.answered_at);
});

test('time by path splits logged minutes by the path of the goal the task serves', () => {
  const d = base();
  const { rows, total } = timeByPath(d, { start: '2026-10-19', end: '2026-10-26' });
  assert.equal(total, 120);
  assert.deepEqual(rows.map((r) => [r.path?.name, r.minutes, Math.round(r.share * 100)]), [['Governance', 90, 75], ['Music', 30, 25]]);
});

test('the path report says where the hours went and which gauges moved', () => {
  const d = base();
  const view = new View(d, TODAY, 0.5);
  const r = pathReport(d, view, d.paths[0]!, { start: '2026-10-19', end: TODAY });
  assert.equal(r.minutes, 30);
  assert.deepEqual(r.moved, [{ key: 'resources', from: 2, to: 3 }]);
  assert.match(r.summary, /resources 2 → 3/);
  assert.match(r.summary, /25% of your goal time/);
});

test('the weekly digest reads as a few plain lines', () => {
  const d = base();
  const view = new View(d, TODAY, 0.5);
  const digest = weeklyDigest(d, view, d.plans[0]!, '2026-10-19');
  assert.equal(digest.title, 'Week 1 of 27 · Oct 19 – Oct 25');
  assert.match(digest.lines[0]!, /^Showed up 2 of 7 days/);
  assert.ok(digest.lines.some((l) => l.startsWith('aigp:')));
  assert.match(digest.text, /^Week 1 of 27/);
});
