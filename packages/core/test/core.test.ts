import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  addDays,
  cascadeRanges,
  isoWeekday as weekdayOf,
  monthRanges,
  weekRanges,
  blockIndex,
  blockRange,
  daysBetween,
  daysSince,
  goalsOnPace,
  isoWeekday,
  milestoneProgress,
  missingSessionsForWeek,
  numberGoalStatus,
  paceLabel,
  planWeekNumber,
  plannedMinutesByDate,
  progressFor,
  quarterRange,
  reviewSuggestions,
  sessionCredit,
  sevenDayTrend,
  slotsForWeek,
  suggestPath,
  valueOnPath,
  weekStart,
  type Action,
  type ActionSchedule,
  type Goal,
  type Measurement,
  type Milestone,
  type Plan,
  type Session,
} from '../src/index.ts';

const plan: Plan = {
  id: 'p1',
  name: 'Next six months',
  start_date: '2026-10-02',
  end_date: '2027-04-02',
  block_days: 28,
  archived_at: null,
};

function action(over: Partial<Action> = {}): Action {
  return {
    id: 'a1',
    title: 'Guitar practice',
    kind: 'minutes',
    planned_minutes: 30,
    planned_count: null,
    min_label: '',
    min_minutes: null,
    min_count: null,
    priority: false,
    step_id: null,
    archived_at: null,
    ...over,
  };
}

function schedule(over: Partial<ActionSchedule> = {}): ActionSchedule {
  return {
    id: 's1',
    action_id: 'a1',
    rule: 'days',
    days: [1, 3, 5],
    per_week: null,
    effective_from: '2026-10-01',
    effective_to: null,
    ...over,
  };
}

let counter = 0;
const makeId = () => `id-${++counter}`;

function session(over: Partial<Session> = {}): Session {
  return {
    id: makeId(),
    action_id: 'a1',
    week_start: '2026-10-12',
    slot: 0,
    date: '2026-10-12',
    title: 'Guitar practice',
    priority: false,
    planned_minutes: 30,
    planned_count: null,
    status: 'planned',
    actual_minutes: null,
    actual_count: null,
    note: '',
    obstacles: [],
    origin: 'scheduled',
    source: 'manual',
    moved_from: null,
    logged_at: null,
    ...over,
  };
}

test('dates: weekdays, week start and day counts', () => {
  assert.equal(isoWeekday('2026-10-16'), 5); // Friday
  assert.equal(weekStart('2026-10-16'), '2026-10-12');
  assert.equal(weekStart('2026-10-18'), '2026-10-12'); // Sunday belongs to the week before
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(daysBetween('2026-10-02', '2026-10-16'), 14);
});

test('plan: week numbers, blocks and the 3-month checkpoint', () => {
  assert.equal(planWeekNumber(plan, '2026-10-16'), 3);
  assert.equal(blockIndex(plan, '2026-10-16'), 0);
  assert.deepEqual(blockRange(plan, 0), { start: '2026-10-02', end: '2026-10-29' });
  assert.equal(blockIndex(plan, '2026-10-30'), 1);
  assert.equal(quarterRange(plan, '2026-10-16').end, '2026-12-31');
  assert.equal(quarterRange(plan, '2027-02-01').start, '2027-01-01');
});

test('cascade: suggested path ends on the target and interpolates', () => {
  const path = suggestPath(212, 182, '2026-10-02', '2027-04-02', 28);
  assert.equal(path[path.length - 1]!.value, 182);
  assert.equal(path[0]!.date, '2026-10-30');
  assert.ok(path[0]!.value < 212 && path[0]!.value > 207);
  const start = { date: '2026-10-02', value: 212 };
  assert.equal(valueOnPath(start, path, '2026-10-02'), 212);
  assert.equal(valueOnPath(start, path, '2027-05-01'), 182);
  const mid = valueOnPath(start, path, '2026-10-16');
  assert.ok(mid < 212 && mid > path[0]!.value);
});

test('schedule: fixed days produce dated slots, per-week produces the tray', () => {
  const fixed = slotsForWeek(schedule(), '2026-10-12');
  assert.deepEqual(
    fixed.map((s) => s.date),
    ['2026-10-12', '2026-10-14', '2026-10-16'],
  );
  const flexible = slotsForWeek(schedule({ rule: 'per_week', per_week: 5, days: [] }), '2026-10-12');
  assert.equal(flexible.length, 5);
  assert.ok(flexible.every((s) => s.date === null));
  // Starting on Thursday: 4 of 7 days left → ceil(5 × 4 / 7) = 3 sessions
  const midWeek = slotsForWeek(
    schedule({ rule: 'per_week', per_week: 5, days: [], effective_from: '2026-10-15' }),
    '2026-10-12',
  );
  assert.equal(midWeek.length, 3);
});

test('schedule: generating sessions twice adds nothing the second time', () => {
  const actions = [action()];
  const schedules = [schedule()];
  const first = missingSessionsForWeek(actions, schedules, [], '2026-10-12', makeId);
  assert.equal(first.length, 3);
  const second = missingSessionsForWeek(actions, schedules, first, '2026-10-12', makeId);
  assert.equal(second.length, 0);
  const archived = missingSessionsForWeek([action({ archived_at: 'x' })], schedules, [], '2026-10-12', makeId);
  assert.equal(archived.length, 0);
});

test('credit: done and minimum count 1, partial is proportional, skipped is 0', () => {
  assert.equal(sessionCredit(session({ status: 'done' })), 1);
  assert.equal(sessionCredit(session({ status: 'minimum' })), 1);
  assert.equal(sessionCredit(session({ status: 'partial', actual_minutes: 15 })), 0.5);
  assert.equal(
    sessionCredit(session({ status: 'partial', planned_count: 3, actual_count: 2 })),
    2 / 3,
  );
  assert.equal(sessionCredit(session({ status: 'skipped' })), 0);
});

test('pace labels use the 90% and 110% thresholds', () => {
  assert.equal(paceLabel(11, 10), 'ahead');
  assert.equal(paceLabel(9, 10), 'on_track');
  assert.equal(paceLabel(8.9, 10), 'behind');
  assert.equal(paceLabel(0, 0), 'none');
});

test('progress: expected counts past days fully and today partly', () => {
  const sessions = [
    session({ date: '2026-10-12', status: 'done' }),
    session({ date: '2026-10-14', status: 'skipped' }),
    session({ date: '2026-10-16', status: 'planned' }),
    session({ date: '2026-10-18', status: 'planned' }),
    session({ date: null, status: 'planned' }), // tray
    session({ date: '2026-10-13', status: 'moved' }), // replaced by its copy
  ];
  const week = { start: '2026-10-12', end: '2026-10-18' };
  const p = progressFor(sessions, week, { today: '2026-10-16', dayFraction: 0.5 });
  assert.equal(p.planned, 5);
  // 2 past + 0.5 today + tray (4.5 / 7 of the week)
  assert.equal(p.expected, Math.round((2 + 0.5 + 4.5 / 7) * 10) / 10);
  assert.equal(p.actual, 1);
  assert.equal(p.label, 'behind');
  assert.equal(progressFor(sessions, week, { today: '2026-10-16', dayFraction: 0.5, tooEarly: true }).label, 'none');
  // A single day ignores sessions that aren't placed on a day yet
  const day = progressFor(sessions, { start: '2026-10-16', end: '2026-10-16' }, { today: '2026-10-16', dayFraction: 0.5 });
  assert.equal(day.planned, 1);
});

test('number goal: trend vs path decides ahead or behind, in the goal direction', () => {
  const goal: Goal = {
    id: 'g1',
    title: 'Lose 30 lb',
    type: 'number',
    why: '',
    done_means: '',
    unit: 'lb',
    baseline_value: 212,
    baseline_date: '2026-10-02',
    target_value: 182,
    target_date: '2027-04-02',
    color: '#2B63A6',
    measurement_type_id: 't1',
    archived_at: null,
  };
  const path = suggestPath(212, 182, '2026-10-02', '2027-04-02', 28);
  const readings: Measurement[] = [
    { id: 'm1', type_id: 't1', value: 212, measured_on: '2026-10-02', source: 'manual', note: '' },
    { id: 'm2', type_id: 't1', value: 208, measured_on: '2026-10-14', source: 'manual', note: '' },
    { id: 'm3', type_id: 't1', value: 207, measured_on: '2026-10-16', source: 'manual', note: '' },
  ];
  const status = numberGoalStatus(goal, path, readings, '2026-10-16', plan.start_date);
  assert.equal(status.trend, 207.5);
  assert.ok(status.aheadBy! > 0);
  assert.equal(status.label, 'ahead');
  assert.equal(status.changeSoFar, -5);
  assert.equal(sevenDayTrend([], '2026-10-16'), null);
});

test('milestones, goals on pace and days since activity', () => {
  const ms: Milestone[] = [
    { id: '1', goal_id: 'g', title: 'Module 1', due_date: '2026-10-10', completed_at: '2026-10-09' },
    { id: '2', goal_id: 'g', title: 'Module 2', due_date: '2026-10-20', completed_at: null },
  ];
  const p = milestoneProgress(ms, '2026-10-16');
  assert.deepEqual([p.planned, p.expected, p.actual, p.label], [2, 1, 1, 'on_track']);
  const g = goalsOnPace(['ahead', 'on_track', 'behind', 'none']);
  assert.deepEqual([g.actual, g.expected, g.label], [2, 3, 'on_track']);
  assert.equal(goalsOnPace(['ahead', 'behind', 'behind']).label, 'behind');
  assert.equal(daysSince(['2026-10-11', '2026-10-13', null], '2026-10-16'), 3);
  assert.equal(daysSince([], '2026-10-16'), null);
});

test('capacity: planned minutes per day ignore moved and undated sessions', () => {
  const by = plannedMinutesByDate(
    [
      session({ date: '2026-10-12', planned_minutes: 45 }),
      session({ date: '2026-10-12', planned_minutes: 30 }),
      session({ date: '2026-10-12', planned_minutes: 30, status: 'moved' }),
      session({ date: null, planned_minutes: 60 }),
    ],
    ['2026-10-12', '2026-10-13'],
  );
  assert.deepEqual(by, { '2026-10-12': 75, '2026-10-13': 0 });
});

test('review suggestions: lower frequency when short repeatedly, minimum when short once', () => {
  const guitar = action({ id: 'gtr' });
  const splits = action({ id: 'spl', title: 'Splits' });
  const schedules = [
    schedule({ id: 'x', action_id: 'gtr', rule: 'per_week', per_week: 7, days: [] }),
    schedule({ id: 'y', action_id: 'spl', rule: 'days', days: [2, 4, 6] }),
  ];
  const sessions: Session[] = [];
  for (const monday of ['2026-09-28', '2026-10-05', '2026-10-12']) {
    for (let i = 0; i < 7; i++) {
      sessions.push(session({ action_id: 'gtr', week_start: monday, slot: i, date: addDays(monday, i), status: i < 4 ? 'done' : 'skipped' }));
    }
  }
  for (let i = 0; i < 3; i++) {
    sessions.push(session({ action_id: 'spl', week_start: '2026-10-12', slot: i, date: addDays('2026-10-12', 1 + i * 2), status: i === 0 ? 'done' : 'skipped' }));
  }
  const out = reviewSuggestions([guitar, splits], schedules, sessions, '2026-10-12');
  const g = out.find((s) => s.actionId === 'gtr');
  const s = out.find((x) => x.actionId === 'spl');
  assert.equal(g?.kind, 'lower_frequency');
  assert.equal(g?.proposedPerWeek, 4);
  assert.equal(s?.kind, 'add_minimum');
});

test('breakdown: two 3-month stages, 3 months each, Monday–Sunday weeks', () => {
  const tree = cascadeRanges(plan);
  assert.equal(tree.length, 2);
  assert.deepEqual([tree[0]!.start, tree[0]!.end], ['2026-10-02', '2026-12-31']);
  assert.equal(tree[1]!.end, '2027-04-02');
  const months = tree.flatMap((q) => q.children);
  assert.equal(months.length, 6);
  assert.deepEqual(months.map((m) => m.title), ['Month 1', 'Month 2', 'Month 3', 'Month 4', 'Month 5', 'Month 6']);
  // months tile the plan with no gaps or overlaps
  for (let i = 1; i < months.length; i++) assert.equal(addDays(months[i - 1]!.end, 1), months[i]!.start);
  // inner month boundaries fall on Sundays
  for (const m of months.slice(0, -1)) if (m.end !== tree[0]!.end) assert.equal(weekdayOf(m.end), 7);
  const weeks = months.flatMap((m) => m.children);
  assert.equal(weeks[0]!.start, '2026-10-02');
  assert.equal(weeks[0]!.end, '2026-10-04'); // partial first week ends Sunday
  assert.equal(weekdayOf(weeks[1]!.start), 1);
  assert.equal(weeks.at(-1)!.end, '2027-04-02');
  for (let i = 1; i < weeks.length; i++) assert.equal(addDays(weeks[i - 1]!.end, 1), weeks[i]!.start);
  assert.equal(weeks.at(-1)!.title, `Week ${weeks.length}`);
});

test('breakdown helpers: week and month ranges', () => {
  assert.deepEqual(weekRanges({ start: '2026-10-14', end: '2026-10-20' }), [
    { start: '2026-10-14', end: '2026-10-18' },
    { start: '2026-10-19', end: '2026-10-20' },
  ]);
  const months = monthRanges({ start: '2026-10-05', end: '2027-01-03' });
  assert.equal(months.length, 3);
  assert.ok(months.every((m) => daysBetween(m.start, m.end) >= 6));
});

test('schedules that start mid-week number their slots apart', () => {
  const s = slotsForWeek(schedule({ days: [3, 5], effective_from: '2026-10-14' }), '2026-10-12');
  assert.deepEqual(s.map((x) => x.slot), [60, 61]);
  assert.deepEqual(slotsForWeek(schedule(), '2026-10-12').map((x) => x.slot), [0, 1, 2]);
});
