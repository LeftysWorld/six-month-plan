import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Action, ActionSchedule, Session } from '@six/core';
import { applyOp, emptyData, type AppData, type Op } from '../src/data/model.ts';
import { opsEnsureWeek, opsMoveSession } from '../src/data/ops.ts';

// Week of Mon Oct 26 2026: Wednesday's workout moved to Thursday, Thursday's to Friday, Friday's to Saturday.
const MONDAY = '2026-10-26';
const WED = '2026-10-28';
const THU = '2026-10-29';
const FRI = '2026-10-30';
const SAT = '2026-10-31';

const run = (data: AppData, ops: Op[]) => ops.reduce(applyOp, data);
const workout = (id: string): Action => ({ id, title: id, kind: 'workout', planned_minutes: 60, planned_count: null, min_label: '', min_minutes: null, min_count: null, priority: true, archived_at: null });
const onDay = (actionId: string, day: number): ActionSchedule => ({ id: `s-${actionId}`, action_id: actionId, rule: 'days', days: [day], per_week: null, effective_from: '2026-10-01', effective_to: null });

function base(): AppData {
  const d = emptyData();
  d.actions = [workout('wed'), workout('thu'), workout('fri')];
  d.schedules = [onDay('wed', 3), onDay('thu', 4), onDay('fri', 5)];
  return run(d, opsEnsureWeek(d, MONDAY));
}

const workoutsOn = (d: AppData, date: string) => d.sessions.filter((s) => s.date === date && s.status !== 'moved').map((s) => s.action_id).sort();

function moveAll(d: AppData): AppData {
  const find = (id: string) => d.sessions.find((s) => s.action_id === id)!;
  return run(d, [...opsMoveSession(find('wed'), THU), ...opsMoveSession(find('thu'), FRI), ...opsMoveSession(find('fri'), SAT)]);
}

test('a moved workout is not made again on its old day', () => {
  let d = moveAll(base());
  // The next morning the app tops up the week (twice, to be sure it stays put).
  d = run(d, opsEnsureWeek(d, MONDAY));
  d = run(d, opsEnsureWeek(d, MONDAY));
  assert.deepEqual(workoutsOn(d, WED), []);
  assert.deepEqual(workoutsOn(d, THU), ['wed']);
  assert.deepEqual(workoutsOn(d, FRI), ['thu']);
  assert.deepEqual(workoutsOn(d, SAT), ['fri']);
  assert.equal(d.sessions.length, 3);
});

test('a moved workout that you log still covers its old day', () => {
  let d = moveAll(base());
  const moved = d.sessions.find((s) => s.action_id === 'wed')!;
  d = run(d, [{ kind: 'update', collection: 'sessions', id: moved.id, patch: { status: 'done' } }]);
  d = run(d, opsEnsureWeek(d, MONDAY));
  assert.deepEqual(workoutsOn(d, WED), []);
  assert.equal(d.sessions.length, 3);
});

test('a week broken by the old code is repaired: moves remembered, unlogged copies removed', () => {
  // How the data looks after the bug: sessions without scheduled_on, moved, plus the copies the top-up made.
  const strip = (s: Session): Session => {
    const { scheduled_on: _gone, ...rest } = s;
    return rest as Session;
  };
  let d = moveAll(base());
  d = { ...d, sessions: d.sessions.map(strip) };
  // The old code made one copy per moved workout, on its old day, under the next free slot number.
  const oldCopies: Session[] = [
    { ...d.sessions.find((s) => s.action_id === 'wed')!, id: 'copy-wed', slot: 1, date: WED },
    { ...d.sessions.find((s) => s.action_id === 'thu')!, id: 'copy-thu', slot: 1, date: THU },
    { ...d.sessions.find((s) => s.action_id === 'fri')!, id: 'copy-fri', slot: 1, date: FRI },
  ];
  d = { ...d, sessions: [...d.sessions, ...oldCopies] };
  assert.equal(workoutsOn(d, THU).length, 2);
  assert.equal(workoutsOn(d, FRI).length, 2);

  d = run(d, opsEnsureWeek(d, MONDAY));
  assert.deepEqual(workoutsOn(d, WED), []);
  assert.deepEqual(workoutsOn(d, THU), ['wed']);
  assert.deepEqual(workoutsOn(d, FRI), ['thu']);
  assert.deepEqual(workoutsOn(d, SAT), ['fri']);
  assert.equal(d.sessions.find((s) => s.action_id === 'wed')!.scheduled_on, WED);
  // Running it again changes nothing.
  assert.deepEqual(opsEnsureWeek(d, MONDAY), []);
});

test('a copy you already logged is kept', () => {
  let d = moveAll(base());
  d = { ...d, sessions: d.sessions.map((s) => ({ ...s, scheduled_on: undefined })) };
  const wed = d.sessions.find((s) => s.action_id === 'wed')!;
  d = { ...d, sessions: [...d.sessions, { ...wed, id: 'copy-wed', slot: 1, date: WED, status: 'done' }] };
  d = run(d, opsEnsureWeek(d, MONDAY));
  assert.ok(d.sessions.some((s) => s.id === 'copy-wed'));
});
