import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Session } from '@six/core';
import { applyOp, emptyData, type AppData } from '../src/data/model.ts';
import { byDayOrder, opsOrderDay } from '../src/data/dayOrder.ts';

const s = (id: string, priority = false, day_order: number | null = null) =>
  ({ id, action_id: id, week_start: '2026-11-02', slot: 0, date: '2026-11-03', title: id, priority, planned_minutes: 30, planned_count: null, status: 'planned', actual_minutes: null, actual_count: null, note: '', obstacles: [], origin: 'scheduled', source: 'manual', moved_from: null, logged_at: null, day_order }) as Session;

test('cards you placed come first in your order; the rest keep priority first', () => {
  const list = [s('a'), s('b', true), s('c', false, 1), s('d', false, 0)];
  assert.deepEqual(byDayOrder(list).map((x) => x.id), ['d', 'c', 'b', 'a']);
});

test('dragging a card numbers the day so the order holds, with one undo', () => {
  let d: AppData = emptyData();
  d.sessions = [s('lift'), s('stretch'), s('jhu'), s('apps')];
  const shown = byDayOrder(d.sessions);
  // Drop JHU before the lift (index 0), then the lift after apps (index 4, the end).
  let r = opsOrderDay(shown, 'jhu', 0);
  d = r.ops.reduce(applyOp, d);
  assert.deepEqual(byDayOrder(d.sessions).map((x) => x.id), ['jhu', 'lift', 'stretch', 'apps']);
  r = opsOrderDay(byDayOrder(d.sessions), 'lift', 4);
  const before = d;
  d = r.ops.reduce(applyOp, d);
  assert.deepEqual(byDayOrder(d.sessions).map((x) => x.id), ['jhu', 'stretch', 'apps', 'lift']);
  assert.deepEqual(byDayOrder(r.undo.reduce(applyOp, d).sessions).map((x) => x.id), byDayOrder(before.sessions).map((x) => x.id));
  // Dropping a card where it already is changes nothing.
  assert.deepEqual(opsOrderDay(byDayOrder(d.sessions), 'stretch', 1).ops, []);
});
