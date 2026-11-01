import type { PhotoAlign, PhotoPoint } from '@six/core';

/**
 * Lining up progress photos for the overlay. Every photo sits in a 3:4 frame; a fit zooms it about
 * the frame's centre (s) and moves it (tx, ty, in % of the frame). Points are in % of the frame.
 * Pure, so it can be tested.
 */

export type Fit = NonNullable<PhotoAlign['fit']>;
export type Marks = NonNullable<PhotoAlign['marks']>;

export const NO_FIT: Fit = { s: 1, tx: 0, ty: 0 };
/** The frame is 3 wide by 4 tall: a % of its height is 4/3 of a % of its width. */
const Y = 4 / 3;
const r2 = (v: number) => Math.round(v * 100) / 100;

/** Where a point of the photo lands in the frame once it's fitted. */
export function place(p: PhotoPoint, f: Fit): PhotoPoint {
  return { x: 50 + f.s * (p.x - 50) + f.tx, y: 50 + f.s * (p.y - 50) + f.ty };
}

/** The photo's box in the frame, in %, for absolute positioning (no CSS transforms needed). */
export function boxOf(f: Fit | null | undefined): { left: string; top: string; width: string; height: string } {
  const x = f ?? NO_FIT;
  return { left: `${r2(50 - 50 * x.s + x.tx)}%`, top: `${r2(50 - 50 * x.s + x.ty)}%`, width: `${r2(x.s * 100)}%`, height: `${r2(x.s * 100)}%` };
}

function dist(a: PhotoPoint, b: PhotoPoint): number {
  return Math.hypot(a.x - b.x, (a.y - b.y) * Y);
}

/**
 * The fit that puts a photo's eyes and hips on the target's: the zoom that makes the eyes-to-hips
 * distance the same, and the move that puts the two midpoints together.
 */
export function fitTo(target: Marks, marks: Marks): Fit {
  const d = dist(marks.eyes, marks.hips);
  const s = d > 0 ? dist(target.eyes, target.hips) / d : 1;
  const mt = { x: (target.eyes.x + target.hips.x) / 2, y: (target.eyes.y + target.hips.y) / 2 };
  const m = { x: (marks.eyes.x + marks.hips.x) / 2, y: (marks.eyes.y + marks.hips.y) / 2 };
  return { s: r2(s), tx: r2(mt.x - 50 - s * (m.x - 50)), ty: r2(mt.y - 50 - s * (m.y - 50)) };
}

/** A pose point (0–1 of the image) in % of the 3:4 frame the image is cropped into (object-fit: cover). */
export function toFrame(p: { x: number; y: number }, width: number, height: number): PhotoPoint {
  const aspect = width / height;
  if (aspect > 3 / 4) {
    const shown = 3 / 4 / aspect; // the share of the width that's visible
    return { x: ((p.x - (1 - shown) / 2) / shown) * 100, y: p.y * 100 };
  }
  const shown = aspect / (3 / 4);
  return { x: p.x * 100, y: ((p.y - (1 - shown) / 2) / shown) * 100 };
}

/** Clamp a fit to sensible bounds while dragging and zooming. */
export function clampFit(f: Fit): Fit {
  return { ...f, s: Math.min(2.5, Math.max(0.5, r2(f.s))), tx: Math.min(60, Math.max(-60, r2(f.tx))), ty: Math.min(60, Math.max(-60, r2(f.ty))) };
}
