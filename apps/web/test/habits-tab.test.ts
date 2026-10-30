import { test } from 'node:test';
import assert from 'node:assert/strict';
import { missingSessionsForWeek } from '@six/core';
import { applyOp, emptyData, type AppData, type Op } from '../src/data/model.ts';
import { blankHabit, habitsOf, keptAndStopped, opsCreateHabit, opsPauseHabit, opsSmallToday, opsStopHabit, opsTapDay, readyToGraduate, slippingHabits, usualRate, weekCells, weekKept } from '../src/data/habits.ts';

const run = (d: AppData, ops: Op[]) => ops.reduce(applyOp, d);
const THU = '2026-10-29';

/** A habit that started `weeksBack` weeks ago, with every past week's sessions generated. */
function habitFrom(weeksBack: number, input: Partial<ReturnType<typeof blankHabit>> = {}) {
  const start = addDays('2026-10-26', -7 * weeksBack);
  let d = emptyData();
  const made = opsCreateHabit(d, { ...blankHabit(start), title: 'Guitar', minLabel: '2 minutes', ...input }, start);
  d = run(d, made.ops.filter((o) => o.kind !== 'insert' || o.collection !== 'sessions'));
  for (let w = 0; w <= weeksBack; w++) {
    const monday = addDays(start, 7 * w);
    const extra = missingSessionsForWeek(d.actions, d.schedules, d.sessions, monday, () => crypto.randomUUID());
    d = { ...d, sessions: [...d.sessions, ...extra] };
  }
  return { d, id: made.id };
}
function addDays(iso: string, n: number) {
  const t = new Date(`${iso}T00:00:00Z`);
  t.setUTCDate(t.getUTCDate() + n);
  return t.toISOString().slice(0, 10);
}
/** Mark every dated session before `until` done, except the days in `skip`. */
function keepAll(d: AppData, id: string, until: string, skip: string[] = []): AppData {
  return { ...d, sessions: d.sessions.map((s) => (s.action_id === id && s.date && s.date < until && !skip.includes(s.date) ? { ...s, status: 'done' as const, logged_at: `${s.date}T20:00:00Z` } : s)) };
}

test('Tapping a day cycles done → small version → clear, and logs an extra on a day off', () => {
  const { d, id } = habitFrom(0, { days: [1, 3, 5] });
  const action = d.actions.find((a) => a.id === id)!;
  const tue = '2026-10-27';
  const mon = '2026-10-26';
  let x = run(d, opsTapDay(d, action, mon, THU));
  assert.equal(weekCells(x, id, mon, THU)[0]!.state, 'done');
  x = run(x, opsTapDay(x, action, mon, THU));
  assert.equal(weekCells(x, id, mon, THU)[0]!.state, 'small');
  x = run(x, opsTapDay(x, action, mon, THU));
  assert.equal(weekCells(x, id, mon, THU)[0]!.state, 'missed');
  // Tuesday isn't a habit day: tapping logs an extra; tapping through clears it away.
  x = run(x, opsTapDay(x, action, tue, THU));
  assert.equal(weekCells(x, id, mon, THU)[1]!.state, 'done');
  x = run(run(x, opsTapDay(x, action, tue, THU)), opsTapDay(run(x, opsTapDay(x, action, tue, THU)), action, tue, THU));
  assert.equal(weekCells(x, id, mon, THU)[1]!.state, 'none');
  // The future can't be tapped.
  assert.deepEqual(opsTapDay(x, action, '2026-10-31', THU), []);
});

test('Times a week: tapping a day uses one of the week\'s open sessions, and clearing puts it back', () => {
  const { d, id } = habitFrom(0, { when: 'per_week', perWeek: 3 });
  const action = d.actions.find((a) => a.id === id)!;
  const x = run(d, opsTapDay(d, action, '2026-10-27', THU));
  const w = weekKept(x, id, '2026-10-26', THU);
  assert.equal(w.kept, 1);
  assert.equal(w.planned, 3);
  const back = run(x, opsTapDay(x, action, '2026-10-27', THU));
  const again = run(back, opsTapDay(back, action, '2026-10-27', THU));
  assert.equal(weekKept(again, id, '2026-10-26', THU).kept, 0);
  assert.equal(again.sessions.filter((s) => s.action_id === id && !s.date).length, 3);
});

test('Slipping: well below the usual pace this week, or the last two days missed', () => {
  const { d, id } = habitFrom(4);
  let x = keepAll(d, id, '2026-10-26');
  assert.ok((usualRate(x, id, THU) ?? 0) > 0.9);
  assert.equal(slippingHabits(x, THU).length, 1, 'Mon–Wed missed this week');
  assert.match(slippingHabits(x, THU)[0]!.why, /0 of 3 so far this week · you usually keep 100%/);
  x = keepAll(x, id, THU);
  assert.equal(slippingHabits(x, THU).length, 0);
  // The small version for today counts as kept.
  const action = x.actions.find((a) => a.id === id)!;
  const y = run(x, opsSmallToday(x, action, THU));
  assert.equal(weekCells(y, id, '2026-10-26', THU)[3]!.state, 'small');
});

test('Graduating after eight strong weeks; Kept vs Stopped; pausing for a week', () => {
  const { d, id } = habitFrom(9);
  const strong = keepAll(d, id, '2026-10-26');
  assert.equal(readyToGraduate(strong, id, THU), true);
  assert.equal(readyToGraduate(d, id, THU), false);
  const action = strong.actions.find((a) => a.id === id)!;
  const graduated = run(strong, opsStopHabit(strong, action, THU));
  assert.deepEqual(keptAndStopped(graduated, THU).kept.map((a) => a.id), [id]);
  // A habit with a thin record (only its first week kept) stops into Stopped, not Kept.
  const thin = keepAll(d, id, addDays('2026-10-26', -7 * 8));
  const weak = run(thin, opsStopHabit(thin, thin.actions.find((a) => a.id === id)!, THU));
  assert.deepEqual(keptAndStopped(weak, THU).stopped.map((a) => a.id), [id]);
  // Pause: nothing due for a week, then it's back, still running.
  const paused = run(strong, opsPauseHabit(strong, action, THU));
  assert.ok(!paused.sessions.some((s) => s.action_id === id && s.date && s.date >= THU && s.status === 'planned'));
  assert.ok(paused.schedules.some((s) => s.action_id === id && s.effective_from === '2026-11-05'));
  assert.equal(habitsOf(paused, THU).find((h) => h.action.id === id)!.running, true);
});
