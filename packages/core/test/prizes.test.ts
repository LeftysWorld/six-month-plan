import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bonusDate, daysLate, groupScore, milestoneReached, prizeStatus } from '../src/prizes.ts';

test('prize status from done day and due date', () => {
  assert.equal(prizeStatus(null, '2026-12-13', '2026-12-01'), 'open');
  assert.equal(prizeStatus(null, '2026-12-13', '2026-12-14'), 'due');
  assert.equal(prizeStatus('2026-12-10', '2026-12-13', '2026-12-14'), 'earned');
  assert.equal(prizeStatus('2026-12-13', '2026-12-13', '2026-12-14'), 'earned');
  assert.equal(prizeStatus('2026-12-20', '2026-12-13', '2026-12-21'), 'late');
  assert.equal(prizeStatus('2026-12-20', null, '2026-12-21'), 'earned');
  assert.equal(daysLate('2026-12-13', '2026-12-20'), 7);
});

test('a weight milestone is reached at or below its value; a climbing goal at or above', () => {
  const down = { baseline_value: 194.2, target_value: 155 };
  assert.equal(milestoneReached(down, { value: 184.2 }, 184.2), true);
  assert.equal(milestoneReached(down, { value: 184.2 }, 183.9), true);
  assert.equal(milestoneReached(down, { value: 184.2 }, 184.3), false);
  assert.equal(milestoneReached(down, { value: null }, 100), false);
  const up = { baseline_value: 10, target_value: 50 };
  assert.equal(milestoneReached(up, { value: 20 }, 20), true);
  assert.equal(milestoneReached(up, { value: 20 }, 19), false);
});

test('bonus is judged against the target date as it stood when set', () => {
  assert.equal(bonusDate({ target_date: '2027-04-26', target_date_at_set: '2027-04-16' } as never), '2027-04-16');
  assert.equal(bonusDate({ target_date: '2027-04-26' } as never), '2027-04-26');
});

test('group score: 85% of four goals means all four', () => {
  const g = (completed_at: string | null, archived_at: string | null = null) => ({ completed_at, archived_at });
  const three = groupScore({ prize_threshold: null }, [g('x'), g('x'), g('x'), g(null)]);
  assert.equal(three.done, 3);
  assert.equal(three.earned, false);
  const four = groupScore({ prize_threshold: null }, [g('x'), g('x'), g('x'), g('x')]);
  assert.equal(four.earned, true);
  // dropping a goal removes it from the count rather than failing it
  const dropped = groupScore({ prize_threshold: 1 }, [g('x'), g('x'), g(null, 'x')]);
  assert.equal(dropped.earned, true);
  assert.equal(groupScore({ prize_threshold: null }, []).earned, false);
});
