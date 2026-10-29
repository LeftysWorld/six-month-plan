import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GROUP_GRADIENTS, gradientSlots, groupGradient } from '../src/data/palette.ts';

test('two different goal colours make the gradient', () => {
  assert.equal(groupGradient('g1', ['#5B8CFF', '#E86A4F']), 'linear-gradient(100deg, #5b8cff 0%, #e86a4f 100%)');
  assert.equal(groupGradient('g4', ['#5B8CFF', '#5b8cff', '#E86A4F']), groupGradient('g4', ['#5B8CFF', '#E86A4F']), 'duplicates count once');
});

test('fewer than two goal colours: one of the 32 curated three-colour gradients, by slot', () => {
  assert.equal(GROUP_GRADIENTS.length, 32);
  assert.equal(new Set(GROUP_GRADIENTS.map((g) => g.join())).size, 32, 'all different');
  for (const g of GROUP_GRADIENTS) for (const c of g) assert.match(c, /^#[0-9A-F]{6}$/i);
  const [a, b, c] = GROUP_GRADIENTS[3]!;
  assert.equal(groupGradient('x', [], 100, 3), `linear-gradient(100deg, ${a.toLowerCase()} 0%, ${b.toLowerCase()} 50%, ${c.toLowerCase()} 100%)`);
  assert.equal(groupGradient('x', ['#5B8CFF'], 100, 3), groupGradient('x', [], 100, 3), 'one colour is not enough to make its own');
  // No slot: the same one for the same id, every time.
  assert.equal(groupGradient('plan-c', []), groupGradient('plan-c', []));
});

test('slots: groups in the order made, then paths, then the loose and no-path cards; the first 32 never repeat', () => {
  const groups = Array.from({ length: 30 }, (_, i) => ({ id: `g${i}`, created_at: `2026-10-${String(i + 1).padStart(2, '0')}T00:00:00Z` }));
  const paths = [{ id: 'pB', rank: 2 }, { id: 'pA', rank: 1 }];
  const slots = gradientSlots({ groups: [...groups].reverse(), paths });
  assert.equal(slots.get('g0'), 0);
  assert.equal(slots.get('g29'), 29);
  assert.equal(slots.get('pA'), 30);
  assert.equal(slots.get('pB'), 31);
  assert.equal(slots.get('loose'), 0, 'after 32 it starts over');
  const firstThirtyTwo = [...slots.entries()].slice(0, 32).map(([, v]) => v);
  assert.equal(new Set(firstThirtyTwo).size, 32);
});
