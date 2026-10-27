import { test } from 'node:test';
import assert from 'node:assert/strict';
import { groupGradient } from '../src/data/palette.ts';

test('two different goal colours make the gradient; one colour gets a second stop of its own, stably', () => {
  assert.match(groupGradient('g1', ['#5B8CFF', '#E86A4F']), /^linear-gradient\(100deg, #5b8cff 0%, #e86a4f 100%\)$/);
  const one = groupGradient('g2', ['#5B8CFF']);
  assert.match(one, /^linear-gradient\(100deg, #5b8cff 0%, #[0-9a-f]{6} 100%\)$/);
  assert.notEqual(one, 'linear-gradient(100deg, #5b8cff 0%, #5b8cff 100%)');
  assert.equal(groupGradient('g2', ['#5B8CFF']), one, 'same group, same gradient');
  assert.notEqual(groupGradient('g3', ['#5B8CFF']), one, 'another group with the same colour gets a different one');
  assert.equal(groupGradient('g4', ['#5B8CFF', '#5b8cff']), groupGradient('g4', ['#5B8CFF']), 'duplicates count once');
  assert.match(groupGradient('g5', []), /^linear-gradient\(100deg, #[0-9a-f]{6} 0%, #[0-9a-f]{6} 100%\)$/);
});
