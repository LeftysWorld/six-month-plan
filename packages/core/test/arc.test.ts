import { test } from 'node:test';
import assert from 'node:assert/strict';
import { seasonArc } from '../src/arc.ts';

const plan = { id: 'p', name: 'S', start_date: '2026-10-26', end_date: '2027-04-26', block_days: 30, archived_at: null };

test('season arc phases follow the calendar', () => {
  assert.equal(seasonArc(plan, '2026-10-20').phase, 'before');
  const d1 = seasonArc(plan, '2026-10-26');
  assert.equal(d1.phase, 'start');
  assert.equal(d1.week, 1);
  assert.equal(d1.weeks, 27);
  assert.equal(seasonArc(plan, '2026-11-20').phase, 'build');
  assert.equal(seasonArc(plan, '2027-01-20').phase, 'middle');
  assert.equal(seasonArc(plan, '2027-03-20').phase, 'push');
  assert.equal(seasonArc(plan, '2027-04-20').phase, 'finish');
  assert.equal(seasonArc(plan, '2027-04-26').daysLeft, 1);
  assert.equal(seasonArc(plan, '2027-05-01').phase, 'after');
});
