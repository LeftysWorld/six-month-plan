import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nextReviewWord, nextWeekOf, stageOf } from '../src/data/season.ts';

test('Stages: started is in progress, this week or next is up next, after that is later', () => {
  const thu = '2026-10-29';
  assert.equal(stageOf('2026-10-26', thu), 'now');
  assert.equal(stageOf(thu, thu), 'now');
  assert.equal(stageOf('2026-10-30', thu), 'soon');
  assert.equal(stageOf('2026-11-08', thu), 'soon');
  assert.equal(stageOf('2026-11-09', thu), 'later');
  assert.equal(stageOf('2026-12-01', thu), 'later');
  assert.deepEqual(nextWeekOf(thu), { start: '2026-11-02', end: '2026-11-08' });
  // Sunday still counts the coming Monday as next week's start.
  assert.deepEqual(nextWeekOf('2026-11-01'), { start: '2026-11-02', end: '2026-11-08' });
});

test('The review tile is short: Friday says Sat, not Tomorrow', () => {
  assert.equal(nextReviewWord('2026-10-30'), 'Sat');
  assert.equal(nextReviewWord('2026-10-31'), 'Today');
  assert.equal(nextReviewWord('2026-10-27'), 'Sat');
});
