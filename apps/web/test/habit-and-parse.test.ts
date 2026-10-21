import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseQuickAdd } from '../src/data/parse.ts';
import { checkInStreak } from '../src/data/habit.ts';
const today = '2026-10-21'; // Wednesday
test('repeating days and minutes', () => {
  const p = parseQuickAdd('guitar 20m mon wed fri', today);
  assert.equal(p.title, 'Guitar'); assert.equal(p.minutes, 20); assert.deepEqual(p.days, [1, 3, 5]); assert.equal(p.date, null);
});
test('tomorrow and priority', () => {
  const p = parseQuickAdd('call mom tomorrow !', today);
  assert.equal(p.title, 'Call mom'); assert.equal(p.date, '2026-10-22'); assert.equal(p.priority, true); assert.deepEqual(p.days, []);
});
test('daily with goal tag and hours', () => {
  const p = parseQuickAdd('stretch 1.5h daily #splits', today);
  assert.equal(p.title, 'Stretch'); assert.equal(p.minutes, 90); assert.equal(p.days.length, 7); assert.equal(p.goalTag, 'splits');
});
test('single day name is the next such day', () => {
  const p = parseQuickAdd('apply to 3 jobs fri', today);
  assert.equal(p.title, 'Apply to 3 jobs'); assert.equal(p.date, '2026-10-23');
  assert.equal(parseQuickAdd('every fri run', today).days.join(), '5');
});
test('numbers that are not minutes stay in the title', () => {
  assert.equal(parseQuickAdd('read 20 pages', today).title, 'Read 20 pages');
});
const s = (date: string, status = 'done') => ({ id: date + status, date, status } as never);
test('streak: freezes cover missed days, then reset', () => {
  // logged 14..20 except 18 (frozen); today 21 not yet logged
  const days = ['2026-10-14', '2026-10-15', '2026-10-16', '2026-10-17', '2026-10-19', '2026-10-20'].map((d) => s(d));
  const st = checkInStreak(days, today);
  assert.equal(st.days, 6); assert.equal(st.checkedInToday, false); assert.equal(st.missedYesterday, false);
  assert.equal(st.freezes, 1);
  // three misses in a row with 2 freezes and no earn-back: resets
  // 10, 11 logged; 12-13 frozen; 14 missed with no freezes and no earn-back → reset; 15 starts again at 1
  const gap = checkInStreak([s('2026-10-10'), s('2026-10-11'), s('2026-10-15'), s('2026-10-16'), s('2026-10-17'), s('2026-10-18'), s('2026-10-19'), s('2026-10-20')], today);
  assert.equal(gap.days, 6);
  // earn back: miss with no freezes left but 2 logs next day
  // 15 logged; 16-17 frozen; 18 missed with no freezes, but 19 has two logs (earned back); 20 logged
  const eb = checkInStreak([s('2026-10-15'), s('2026-10-19'), s('2026-10-19', 'partial'), s('2026-10-20')], today);
  assert.equal(eb.days, 3);
});
test('streak: yesterday missed → never miss twice', () => {
  const st = checkInStreak([s('2026-10-18'), s('2026-10-19')], today);
  assert.equal(st.missedYesterday, true); assert.equal(st.days, 2);
});
