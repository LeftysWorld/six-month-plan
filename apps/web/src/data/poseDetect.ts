import type { PhotoPoint } from '@six/core';
import { toFrame } from './photoAlign.ts';

/**
 * Finds the eyes and hips on a progress photo with Google's MediaPipe pose model, run in the
 * browser. The library and model load from their CDNs the first time "Auto-align" is used, so the
 * app's own bundle doesn't grow; nothing about the photo leaves the device.
 */
const VERSION = '0.10.14';
const LIB = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${VERSION}/vision_bundle.mjs`;
const WASM = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${VERSION}/wasm`;
const MODEL = 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task';

interface Landmark {
  x: number;
  y: number;
  visibility?: number;
}
interface Landmarker {
  detect(image: HTMLImageElement): { landmarks: Landmark[][] };
}

let loading: Promise<Landmarker> | null = null;

function landmarker(): Promise<Landmarker> {
  loading ??= (async () => {
    const vision = (await import(/* @vite-ignore */ LIB)) as {
      FilesetResolver: { forVisionTasks(path: string): Promise<unknown> };
      PoseLandmarker: { createFromOptions(files: unknown, options: Record<string, unknown>): Promise<Landmarker> };
    };
    const files = await vision.FilesetResolver.forVisionTasks(WASM);
    return vision.PoseLandmarker.createFromOptions(files, { baseOptions: { modelAssetPath: MODEL }, runningMode: 'IMAGE', numPoses: 1 });
  })();
  loading.catch(() => (loading = null));
  return loading;
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('The photo didn’t load'));
    img.src = src;
  });
}

/** Loads the pose model (once); throws if it can't be fetched. */
export function loadPoseModel(): Promise<unknown> {
  return landmarker();
}

/** The midpoint between the eyes and between the hips, in % of the photo's 3:4 frame; null if no body is found. */
export async function findMarks(src: string): Promise<{ eyes: PhotoPoint; hips: PhotoPoint } | null> {
  const [model, img] = await Promise.all([landmarker(), loadImage(src)]);
  const pose = model.detect(img).landmarks[0];
  if (!pose) return null;
  const mid = (a: number, b: number) => ({ x: (pose[a]!.x + pose[b]!.x) / 2, y: (pose[a]!.y + pose[b]!.y) / 2 });
  // MediaPipe pose: 2 and 5 are the eyes, 23 and 24 the hips.
  if (!pose[2] || !pose[5] || !pose[23] || !pose[24]) return null;
  const w = img.naturalWidth || img.width;
  const h = img.naturalHeight || img.height;
  return { eyes: toFrame(mid(2, 5), w, h), hips: toFrame(mid(23, 24), w, h) };
}
