import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  activeProjects,
  burnup,
  evenMilestones,
  forecastFinish,
  lessons,
  projectStats,
  readyAfter,
  rollup,
  shiftSuggestion,
  shiftedDates,
  waitingFor,
  wipLimit,
  wouldCycle,
} from '../src/projects.ts';
import type { Goal, Milestone } from '../src/types.ts';

const goal = (id: string, extra: Partial<Goal> = {}): Goal => ({
  id,
  title: id,
  type: 'finish',
  why: '',
  done_means: '',
  unit: null,
  baseline_value: null,
  baseline_date: null,
  target_value: null,
  target_date: null,
  color: '#000',
  measurement_type_id: null,
  archived_at: null,
  ...extra,
});
const project = (id: string, extra: Partial<Goal> = {}) => goal(id, { parent_id: 'outcome', ...extra });
const ms = (id: string, due: string, completed: string | null = null, created: string | null = null): Milestone => ({ id, goal_id: 'p', title: id, due_date: due, completed_at: completed ? `${completed}T12:00:00Z` : null, created_at: created ? `${created}T12:00:00Z` : null });
const window = { start: '2026-11-01', end: '2027-04-30' };

test('the forecast waits for a week and a first finish, then uses the recent rate', () => {
  const list = [ms('a', '2026-11-08'), ms('b', '2026-11-15'), ms('c', '2026-11-22'), ms('d', '2026-11-29')];
  assert.equal(forecastFinish(list, '2026-11-01', '2026-11-04').reason, 'too_early');
  assert.equal(forecastFinish(list, '2026-11-01', '2026-11-10').reason, 'no_rate');
  // 2 done in 14 days → 1 a week, 2 left → 14 more days.
  const two = [ms('a', '2026-11-08', '2026-11-07'), ms('b', '2026-11-15', '2026-11-14'), ms('c', '2026-11-22'), ms('d', '2026-11-29')];
  const f = forecastFinish(two, '2026-11-01', '2026-11-15');
  assert.equal(f.reason, 'rate');
  assert.equal(f.ratePerWeek, 1);
  assert.equal(f.date, '2026-11-29');
  assert.deepEqual(forecastFinish([], '2026-11-01', '2026-11-15').reason, 'no_milestones');
});

test('a forecast follows the last 4 weeks when there is enough in them', () => {
  // Slow start (1 in the first 6 weeks), then 3 in the last 4 weeks.
  const list = [
    ms('a', '2026-11-10', '2026-11-10'),
    ms('b', '2026-12-20', '2026-12-20'),
    ms('c', '2026-12-27', '2026-12-27'),
    ms('d', '2027-01-03', '2027-01-03'),
    ms('e', '2027-01-20'),
    ms('f', '2027-01-30'),
    ms('g', '2027-02-10'),
  ];
  const f = forecastFinish(list, '2026-11-01', '2027-01-05');
  // 3 in 28 days → 3 left takes 28 days.
  assert.equal(f.date, '2027-02-02');
});

test('a forecast too far out says so instead of giving a date', () => {
  const list = [ms('a', '2026-11-10', '2026-11-08'), ...Array.from({ length: 200 }, (_, i) => ms(`x${i}`, '2027-04-01'))];
  const f = forecastFinish(list, '2026-11-01', '2027-02-01');
  assert.equal(f.reason, 'too_slow');
  assert.equal(f.date, null);
});

test('project stats: pace by milestones due before today, at risk when the forecast passes the deadline', () => {
  const p = project('p', { start_date: '2026-11-01', target_date: '2026-11-29', deadline: '2026-12-06', started_at: '2026-11-01T09:00:00Z', baseline_end: '2026-11-29' });
  const onPace = [ms('a', '2026-11-08', '2026-11-07'), ms('b', '2026-11-15', '2026-11-14'), ms('c', '2026-11-22'), ms('d', '2026-11-29')];
  const s = projectStats(p, onPace, [p], '2026-11-15', window);
  assert.equal(s.label, 'ahead', '2 done, 1 due before today');
  assert.equal(s.state, 'active');
  assert.equal(s.buffer, 'ok');
  assert.equal(s.varianceDays, 0);
  assert.equal(s.neededPerWeek, 1);
  // Only one done by the 22nd: 1 a week over 3 weeks → 3 left takes 21 days → Dec 13, past the deadline.
  const slow = [ms('a', '2026-11-08', '2026-11-07'), ms('b', '2026-11-15'), ms('c', '2026-11-22'), ms('d', '2026-11-29')];
  const r = projectStats(p, slow, [p], '2026-11-22', window);
  assert.equal(r.state, 'at_risk');
  assert.equal(r.buffer, 'over');
  assert.ok(r.varianceDays! > 0);
});

test('a forecast inside the buffer is "using buffer", not at risk', () => {
  const p = project('p', { start_date: '2026-11-01', target_date: '2026-11-28', deadline: '2026-12-31', started_at: '2026-11-01T09:00:00Z' });
  const list = [ms('a', '2026-11-08', '2026-11-08'), ms('b', '2026-11-12', '2026-11-15'), ms('c', '2026-11-20'), ms('d', '2026-11-28')];
  const s = projectStats(p, list, [p], '2026-11-15', window);
  assert.equal(s.forecast.date, '2026-11-29');
  assert.equal(s.buffer, 'using');
  assert.notEqual(s.state, 'at_risk');
});

test('not started projects wait on unfinished predecessors; dropped ones release them', () => {
  const aigp = project('aigp', { started_at: '2026-11-01T00:00:00Z' });
  const iso = project('iso', { depends_on: ['aigp'] });
  assert.deepEqual(waitingFor(iso, [aigp, iso]), ['aigp']);
  assert.equal(projectStats(iso, [], [aigp, iso], '2026-11-10', window).state, 'waiting');
  assert.deepEqual(waitingFor(iso, [{ ...aigp, dropped_at: '2026-12-01T00:00:00Z' }, iso]), []);
  const done = { ...aigp, completed_at: '2027-01-20T00:00:00Z' };
  assert.deepEqual(readyAfter('aigp', [done, iso]).map((g) => g.id), ['iso']);
});

test('dependencies cannot loop', () => {
  const a = project('a');
  const b = project('b', { depends_on: ['a'] });
  const c = project('c', { depends_on: ['b'] });
  assert.equal(wouldCycle('a', 'c', [a, b, c]), true, 'a → c → b → a');
  assert.equal(wouldCycle('c', 'a', [a, b, c]), false);
  assert.equal(wouldCycle('a', 'a', [a]), true);
});

test('a predecessor running late suggests moving only a flexible start', () => {
  const iso = project('iso', { start_date: '2027-02-01', target_date: '2027-04-15', deadline: '2027-04-30', depends_on: ['aigp'] });
  assert.deepEqual(shiftSuggestion(iso, ['2027-02-10']), { start: '2027-02-11', days: 10 });
  assert.equal(shiftSuggestion(iso, ['2027-01-20']), null, 'finishes in time');
  assert.equal(shiftSuggestion({ ...iso, fixed_start: true }, ['2027-02-10']), null);
  assert.deepEqual(shiftedDates(iso, 10), { start_date: '2027-02-11', target_date: '2027-04-25', deadline: '2027-05-10' });
  assert.equal(shiftedDates({ ...iso, fixed_deadline: true }, 10).deadline, '2027-04-30', 'a fixed deadline stays');
});

test('the burn-up shows scope growth and stops the done line at today', () => {
  const list = [ms('a', '2026-11-08', '2026-11-07'), ms('b', '2026-11-15'), ms('c', '2026-11-22', null, '2026-11-10')];
  const pts = burnup(list, '2026-11-01', '2026-11-29', '2026-11-12');
  assert.equal(pts[0]!.date, '2026-11-01');
  assert.equal(pts[0]!.scope, 2, 'c was added later');
  assert.equal(pts.at(-1)!.date, '2026-11-29');
  assert.equal(pts.at(-1)!.scope, 3);
  assert.equal(pts.at(-1)!.done, null, 'no done line in the future');
  assert.equal(pts.find((p) => p.date === '2026-11-12')!.done, 1);
});

test('a goal rolls up its projects equally, ignoring dropped ones', () => {
  const p1 = project('p1', { started_at: '2026-11-01T00:00:00Z', completed_at: '2026-12-01T00:00:00Z', start_date: '2026-11-01', target_date: '2026-12-01' });
  const p2 = project('p2', { started_at: '2026-11-01T00:00:00Z', start_date: '2026-11-01', target_date: '2027-03-01' });
  const p3 = project('p3', { dropped_at: '2026-11-20T00:00:00Z' });
  const today = '2026-12-15';
  const s1 = projectStats(p1, [ms('a', '2026-11-20', '2026-11-20')], [p1, p2, p3], today, window);
  const s2 = projectStats(p2, [ms('b', '2026-12-01', '2026-12-01'), ms('c', '2027-01-01'), ms('d', '2027-02-01'), ms('e', '2027-03-01')], [p1, p2, p3], today, window);
  const s3 = projectStats(p3, [], [p1, p2, p3], today, window);
  const r = rollup([s1, s2, s3]);
  assert.equal(r.count, 2);
  assert.equal(r.done, 1);
  assert.equal(r.fraction, (1 + 0.25) / 2);
  assert.equal(r.label, 'on_track', 'both exactly on their milestones');
  assert.equal(rollup([s1, s2], true).label, 'none');
});

test('WIP counts active projects only, and the limit defaults to 4', () => {
  const list = [project('a', { started_at: 'x' }), project('b', { started_at: 'x', completed_at: 'y' }), project('c'), goal('g', { started_at: 'x' })];
  assert.deepEqual(activeProjects(list).map((g) => g.id), ['a']);
  assert.equal(wipLimit(null), 4);
  assert.equal(wipLimit(3), 3);
});

test('even milestones spread to the end date', () => {
  const list = evenMilestones('Module', 7, '2026-11-01', '2026-11-29');
  assert.equal(list.length, 7);
  assert.equal(list[0]!.title, 'Module 1');
  assert.equal(list.at(-1)!.due_date, '2026-11-29');
  assert.ok(list.every((m, i) => i === 0 || m.due_date >= list[i - 1]!.due_date));
});

test('lessons come from close-outs, newest first', () => {
  const a = project('a', { closeout: { worked: 'w', didnt: '', carry: 'Book the exam first', closed_on: '2027-01-10' } });
  const b = project('b', { closeout: { worked: '', didnt: '', carry: 'Shoot weekly', closed_on: '2027-03-01' } });
  const c = project('c', { closeout: { worked: '', didnt: '', carry: '', closed_on: '2027-03-05' } });
  assert.deepEqual(lessons([a, b, c]).map((l) => l.carry), ['Shoot weekly', 'Book the exam first']);
});
