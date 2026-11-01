import { test } from 'node:test';
import assert from 'node:assert/strict';
import { boxOf, clampFit, fitTo, place, toFrame } from '../src/data/photoAlign.ts';

// Two of the real progress photos: eyes and navel in % of the 3:4 frame. Oct 30 was taken from
// further back, so it has to be zoomed in and moved down to sit on Oct 26.
const oct26 = { eyes: { x: 50.5, y: 38.1 }, hips: { x: 48.2, y: 70.3 } };
const oct30 = { eyes: { x: 49.0, y: 31.7 }, hips: { x: 48.5, y: 51.8 } };
const near = (a: number, b: number, tol = 0.6) => Math.abs(a - b) <= tol;

test('a photo is fitted so its eyes and hips land on the first photo’s', () => {
  const f = fitTo(oct26, oct30);
  assert.ok(f.s > 1.5 && f.s < 1.7, `zoomed in, got ${f.s}`);
  const eyes = place(oct30.eyes, f);
  const hips = place(oct30.hips, f);
  assert.ok(near(eyes.y, 38.1) && near(hips.y, 70.3), `eyes ${eyes.y}, hips ${hips.y}`);
  assert.ok(near(eyes.x, 50.5, 1.5) && near(hips.x, 48.2, 1.5));
});

test('the first photo fitted to itself stays put', () => {
  assert.deepEqual(fitTo(oct26, oct26), { s: 1, tx: 0, ty: 0 });
});

test('a fit becomes a plain box in the frame', () => {
  assert.deepEqual(boxOf({ s: 1.5, tx: 2, ty: -4 }), { left: '-23%', top: '-29%', width: '150%', height: '150%' });
  assert.deepEqual(boxOf(null), { left: '0%', top: '0%', width: '100%', height: '100%' });
});

test('pose points are moved into the 3:4 frame the photo is cropped to', () => {
  // A 4:3 landscape photo shows only its middle: its centre stays the centre, its edges fall outside.
  assert.deepEqual(toFrame({ x: 0.5, y: 0.5 }, 1600, 1200), { x: 50, y: 50 });
  assert.ok(toFrame({ x: 0.2, y: 0.5 }, 1600, 1200).x < 0);
  // A photo already 3:4 maps straight across.
  assert.deepEqual(toFrame({ x: 0.25, y: 0.75 }, 900, 1200), { x: 25, y: 75 });
});

test('dragging and zooming stay within bounds', () => {
  assert.deepEqual(clampFit({ s: 9, tx: -200, ty: 80 }), { s: 2.5, tx: -60, ty: 60 });
});
