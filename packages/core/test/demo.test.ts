import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cleanLink, exerciseWords, libraryMatch, linkKind, matchExercises, youtubeId, youtubeStart, type LibraryExercise } from '../src/demo.ts';

const ex = (name: string, category = 'strength', equipment: string | null = null): LibraryExercise => ({ id: name.replace(/\W+/g, '_'), name, category, equipment, muscles: [], instructions: [], images: [] });
const LIB = [
  ex('Dumbbell Bench Press', 'strength', 'dumbbell'),
  ex('Decline Dumbbell Bench Press', 'strength', 'dumbbell'),
  ex('Romanian Deadlift', 'strength', 'barbell'),
  ex('Barbell Squat', 'strength', 'barbell'),
  ex('Pullups', 'strength', 'body only'),
  ex('Cable Rear Delt Fly', 'strength', 'cable'),
  ex('Triceps Overhead Extension with Rope', 'strength', 'cable'),
  ex('Cable Seated Lateral Raise', 'strength', 'cable'),
  ex('Lateral Bound', 'plyometrics', 'body only'),
  ex('Split Jerk', 'olympic weightlifting', 'barbell'),
  ex('Frog Hops', 'stretching', null),
  ex('Split Squats', 'stretching', null),
  ex('Pelvic Tilt Into Bridge', 'stretching', null),
  ex('Hamstring Stretch', 'stretching', null),
  ex('Front Leg Raises', 'stretching', 'body only'),
  ex("Child's Pose", 'stretching', null),
];

test('names are compared as words, with gym shorthand spelled out', () => {
  assert.deepEqual(exerciseWords('Flat DB Bench Press (slow)'), ['dumbbell', 'bench', 'press']);
  assert.deepEqual(exerciseWords('RDL'), ['romanian', 'deadlift']);
  assert.deepEqual(exerciseWords('Pull-ups'), ['pullup']);
  assert.deepEqual(exerciseWords('Frog Stretch'), ['frog'], '"stretch" names nothing');
});

test('a lift shows by itself only when it is plainly the same exercise', () => {
  assert.equal(libraryMatch('Flat DB Bench Press', LIB, 'strength').sure?.name, 'Dumbbell Bench Press');
  assert.equal(libraryMatch('RDL', LIB, 'strength').sure?.name, 'Romanian Deadlift');
  assert.equal(libraryMatch('Pull-ups', LIB, 'strength').sure?.name, 'Pullups');
  assert.equal(libraryMatch('Barbell Back Squat', LIB, 'strength').sure?.name, 'Barbell Squat');
});

test('a cable or machine version is never assumed, and a different position is not the same exercise', () => {
  const fly = libraryMatch('Seated Rear-Delt Fly', LIB, 'strength');
  assert.equal(fly.sure, null);
  assert.deepEqual(fly.options.map((x) => x.name), ['Cable Rear Delt Fly']);
  assert.equal(libraryMatch('Seated Overhead Triceps Extension', LIB, 'strength').sure, null);
  // The name says cable, but the library's is seated on a bench: offered, not shown as sure.
  const lateral = libraryMatch('Cable Lateral Raise', LIB, 'strength');
  assert.equal(lateral.sure, null);
  assert.deepEqual(lateral.options.map((x) => x.name), ['Cable Seated Lateral Raise'], 'no "Lateral Bound"');
  // A dumbbell name never gets a cable picture.
  assert.ok(!matchExercises('DB Rear Delt Fly', LIB, 6, 'strength').some((m) => m.exercise.equipment === 'cable'));
});

test('a stretch gets a picture only when the library really has it; otherwise nothing', () => {
  for (const hold of ['Frog Stretch', 'Side Split', 'Front Split, Left Leg Forward', 'Bridge Holds', 'Sphinx to Cobra', 'Puppy Pose (Melting Heart)', 'Lying Butterfly']) {
    const m = libraryMatch(hold, LIB, 'stretch');
    assert.equal(m.sure, null, hold);
    assert.deepEqual(m.options, [], hold);
  }
  assert.equal(libraryMatch('Hamstring Stretch', LIB, 'stretch').sure?.name, 'Hamstring Stretch');
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
