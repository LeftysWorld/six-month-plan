import { test } from 'node:test';
import assert from 'node:assert/strict';
import { byOrder, placeAmong } from '../src/data/order.ts';

const items = [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }];

test('byOrder puts hand-placed items first, then the rest as given', () => {
  assert.deepEqual(byOrder([{ id: 'a' }, { id: 'b', sort_order: 1 }, { id: 'c', sort_order: 0 }, { id: 'd' }]).map((x) => x.id), ['c', 'b', 'a', 'd']);
});

test('placeAmong moves an item before another, or to the end, and numbers every sibling', () => {
  const ops = placeAmong('goals', items, 'd', 'b');
  const order = (list: typeof items, o: typeof ops) => byOrder(list.map((x) => ({ ...x, sort_order: (o.find((op) => op.kind === 'update' && op.id === x.id) as { patch?: { sort_order?: number } } | undefined)?.patch?.sort_order ?? null })));
  assert.deepEqual(order(items, ops).map((x) => x.id), ['a', 'd', 'b', 'c']);
  assert.deepEqual(order(items, placeAmong('goals', items, 'a', null)).map((x) => x.id), ['b', 'c', 'd', 'a']);
  assert.deepEqual(placeAmong('goals', items, 'a', 'a'), []);
  assert.deepEqual(placeAmong('goals', items, 'zz', 'a'), []);
});
