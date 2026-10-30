import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bestMatch, cleanLink, exerciseWords, linkKind, matchExercises, youtubeId, youtubeStart, type LibraryExercise } from '../src/demo.ts';

const ex = (name: string, category = 'strength'): LibraryExercise => ({ id: name.replace(/\W+/g, '_'), name, category, equipment: null, muscles: [], instructions: [], images: [] });
const LIB = [
  ex('Dumbbell Bench Press'),
  ex('Decline Dumbbell Bench Press'),
  ex('Romanian Deadlift'),
  ex('Barbell Squat'),
  ex('Pullups'),
  ex('Split Jerk', 'olympic weightlifting'),
  ex('Hamstring Stretch', 'stretching'),
  ex('Side Leg Raises', 'stretching'),
  ex('Front Leg Raises', 'stretching'),
  ex("Child's Pose", 'stretching'),
];

test('names are compared as words, with gym shorthand spelled out', () => {
  assert.deepEqual(exerciseWords('Flat DB Bench Press (slow)'), ['flat', 'dumbbell', 'bench', 'press']);
  assert.deepEqual(exerciseWords('RDL'), ['romanian', 'deadlift']);
  assert.deepEqual(exerciseWords('Pull-ups'), ['pullup']);
  assert.deepEqual(exerciseWords('Side-Lying Leg Raise, 2 × 8 each leg'), ['side', 'lying', 'leg', 'raise', '2', '8']);
});

test('lifts find their library exercise', () => {
  assert.equal(matchExercises('Flat DB Bench Press', LIB, 1, 'strength')[0]!.exercise.name, 'Dumbbell Bench Press');
  assert.equal(bestMatch('RDL', LIB, 'strength')!.exercise.name, 'Romanian Deadlift');
  assert.equal(bestMatch('Pull-ups', LIB, 'strength')!.confident, true);
  const squat = bestMatch('Barbell Back Squat', LIB, 'strength')!;
  assert.equal(squat.exercise.name, 'Barbell Squat');
  assert.equal(squat.confident, false, 'a word missing: shown with "Is this it?"');
});

test('a stretch is matched among stretches only, and a wrong guess is not shown as sure', () => {
  assert.equal(bestMatch('Side Split', LIB, 'stretch')?.exercise.name !== 'Split Jerk', true);
  const front = bestMatch('Front Split, Left Leg Forward', LIB, 'stretch');
  assert.ok(!front || !front.confident, 'Front Leg Raises is not a front split');
  assert.equal(bestMatch('Sphinx to Cobra', LIB, 'stretch'), null);
});

test('video links: YouTube in any form, plain videos and pictures, anything else as a link', () => {
  for (const url of ['https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=42s', 'https://youtu.be/dQw4w9WgXcQ?t=42', 'https://youtube.com/shorts/dQw4w9WgXcQ', 'https://m.youtube.com/watch?feature=share&v=dQw4w9WgXcQ']) {
    assert.equal(youtubeId(url), 'dQw4w9WgXcQ', url);
  }
  assert.equal(youtubeStart('https://youtu.be/dQw4w9WgXcQ?t=1m30s'), 90);
  assert.equal(linkKind('https://example.com/a/frog.GIF'), 'image');
  assert.equal(linkKind('https://example.com/clip.mp4?x=1'), 'video');
  assert.equal(linkKind('https://www.instagram.com/p/abc/'), 'link');
  assert.equal(cleanLink(' javascript:alert(1) '), null);
  assert.equal(cleanLink('https://youtu.be/dQw4w9WgXcQ '), 'https://youtu.be/dQw4w9WgXcQ');
});
