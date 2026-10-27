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

test('seasonChapters tile the season and agree with seasonArc', async () => {
  const { seasonChapters, chapterAt, seasonArc } = await import('../src/arc.ts');
  const plan = { id: 'p', name: 'S', start_date: '2026-10-16', end_date: '2027-04-15', archived_at: null } as unknown as import('../src/types.ts').Plan;
  const ch = seasonChapters(plan);
  assert.deepEqual(ch.map((c) => c.phase), ['start', 'build', 'middle', 'push', 'finish']);
  assert.equal(ch[0]!.start, '2026-10-16');
  assert.equal(ch[4]!.end, '2027-04-15');
  for (let i = 1; i < ch.length; i++) assert.ok(ch[i]!.start > ch[i - 1]!.end, 'no gaps or overlaps');
  // Every chapter's days get the same phase from seasonArc.
  for (const c of ch) {
    for (const d of [c.start, c.end]) assert.equal(seasonArc(plan, d).phase, c.phase, `${d} should be ${c.phase}`);
  }
  assert.equal(chapterAt(plan, '2026-12-01')!.phase, 'build');
  assert.equal(chapterAt(plan, '2026-10-01'), null);
});
