import test from 'node:test';
import assert from 'node:assert/strict';
import { sessionCount, tallyOf, tallyReachedOn, tallyStatus, tallyText } from '../src/tally.ts';
import type { Session } from '../src/types.ts';

const s = (id: string, date: string, status: Session['status'], planned: number, actual: number | null = null): Session =>
  ({ id, action_id: 'apply', week_start: date, slot: 0, date, title: 'Apply to 25 jobs', priority: false, planned_minutes: 60, planned_count: planned, status, actual_minutes: null, actual_count: actual, note: '', obstacles: [], origin: 'scheduled' }) as Session;

test('a ticked-done count task adds its planned count; a partial adds what was logged; skipped adds nothing', () => {
  assert.equal(sessionCount(s('a', '2026-10-20', 'done', 25)), 25);
  assert.equal(sessionCount(s('b', '2026-10-21', 'partial', 25, 12)), 12);
  assert.equal(sessionCount(s('c', '2026-10-22', 'done', 25, 30)), 30);
  assert.equal(sessionCount(s('d', '2026-10-23', 'skipped', 25)), 0);
  assert.equal(sessionCount(s('e', '2026-10-24', 'planned', 25)), 0);
});

test('tallyOf sums the task through a date and finds the day a target was reached', () => {
  const logs = [s('a', '2026-10-20', 'done', 25), s('b', '2026-10-21', 'partial', 25, 12), s('c', '2026-10-22', 'done', 25), s('d', '2026-10-23', 'planned', 25)];
  assert.equal(tallyOf(logs, 'apply'), 62);
  assert.equal(tallyOf(logs, 'apply', '2026-10-21'), 37);
  assert.equal(tallyOf(logs, 'other'), 0);
  assert.equal(tallyReachedOn(logs, 'apply', 50), '2026-10-22');
  assert.equal(tallyReachedOn(logs, 'apply', 250), null);
});

test('tallyStatus paces the total against an even spread to the due date', () => {
  const m = { value: 250, due_date: '2026-12-15' };
  // 20 days into a 56-day run: 89 expected; 182 logged is well ahead.
  const ahead = tallyStatus(m, 182, '2026-10-20', '2026-11-08');
  assert.equal(ahead.expected, 89);
  assert.equal(ahead.left, 68);
  assert.equal(ahead.daysLeft, 37);
  assert.equal(ahead.perDay, 2);
  assert.equal(ahead.label, 'ahead');
  assert.equal(tallyText(ahead), '182 of 250 · 68 to go · 2 a day for 37 days');
  const behind = tallyStatus(m, 40, '2026-10-20', '2026-11-08');
  assert.equal(behind.label, 'behind');
  const done = tallyStatus(m, 250, '2026-10-20', '2026-11-08');
  assert.equal(done.reached, true);
  assert.equal(tallyText(done), '250 of 250 · done');
  const late = tallyStatus(m, 200, '2026-10-20', '2026-12-20');
  assert.equal(late.perDay, null);
  assert.match(tallyText(late), /past due/);
});
