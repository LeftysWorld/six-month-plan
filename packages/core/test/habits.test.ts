import { test } from 'node:test';
import assert from 'node:assert/strict';
import { habitDays, habitStats } from '../src/habits.ts';
import type { Session, SessionStatus } from '../src/types.ts';

let n = 0;
const s = (date: string | null, status: SessionStatus, week = '2026-10-26'): Session => ({ id: `s${n++}`, action_id: 'h', week_start: week, slot: n, date, title: 'Clean house', priority: false, planned_minutes: 15, planned_count: null, status, actual_minutes: null, actual_count: null, note: '', obstacles: [], origin: 'scheduled', source: 'manual', moved_from: null, logged_at: null });

test('a daily habit: skips do not break the streak, a missed day does, today waits', () => {
  const list = [
    s('2026-10-20', 'done'),
    s('2026-10-21', 'planned'), // missed
    s('2026-10-22', 'done'),
    s('2026-10-23', 'done'),
    s('2026-10-24', 'skipped'),
    s('2026-10-25', 'done'),
    s('2026-10-26', 'planned'), // today, not over yet
  ];
  const st = habitStats(list, '2026-10-26');
  assert.equal(st.unit, 'day');
  assert.equal(st.streak, 3);
  assert.equal(st.best, 3);
  assert.equal(st.dueDays, 5, 'the skip and today are left out');
  assert.equal(st.doneDays, 4);
  assert.equal(st.rate, 0.8);
});

test('the grid shows each day', () => {
  const days = habitDays([s('2026-10-24', 'done'), s('2026-10-25', 'planned'), s('2026-10-27', 'planned')], '2026-10-23', '2026-10-27', '2026-10-26');
  assert.deepEqual(days.map((d) => d.state), ['none', 'done', 'missed', 'none', 'planned']);
});

test('a times-a-week habit keeps its streak in weeks', () => {
  const list = [
    s(null, 'done', '2026-10-05'), s(null, 'done', '2026-10-05'),
    s(null, 'done', '2026-10-12'), s(null, 'planned', '2026-10-12'),
    s('2026-10-20', 'done', '2026-10-19'), s(null, 'done', '2026-10-19'),
    s(null, 'planned', '2026-10-26'), // this week, still open
  ];
  const st = habitStats(list, '2026-10-28');
  assert.equal(st.unit, 'week');
  assert.equal(st.streak, 1);
  assert.equal(st.best, 1);
});

test('nothing due yet gives no rate', () => {
  assert.equal(habitStats([s('2026-10-26', 'planned')], '2026-10-26').rate, null);
});
