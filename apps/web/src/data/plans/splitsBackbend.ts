import type { StretchHold, StretchPlan } from '@six/core';

/**
 * The Splits & Backbend Plan (months 1–9, starting Fri Oct 30 2026), right after every lifting
 * session: Mon, Tue, Thu, Fri, Sat. Wed and Sun are rest days. All on the floor; gear: bands and blocks.
 *
 * Every session is the Daily Eight (about 24 minutes), then a focus slot of 3–6 minutes that
 * changes by day. Mon, Thu, Sat are push days (7–8 out of 10 with contract-relax rounds); Tue and
 * Fri are easy days (passive, 5–6 out of 10) and the big backbend days.
 */

export const PLAN_START = '2026-10-30';
export const PLAN_NAME = 'Splits & Backbend Plan';

const knee = true;
const cr = true;

const DAILY_EIGHT: StretchHold[] = [
  {
    name: 'Seated Chest to Shins (Pike Fold)',
    dose: '2.5 min',
    cr,
    part: 'daily',
    how: 'Sit with legs together and straight, toes pointing up. Loop a band around your feet and hold it short. Fold from the hips with a long, flat back, chest heading for your knees, not your head. Pull gently on the band to go deeper.',
    push: '3 rounds of contract-relax: press your heels into the floor for 5–10 s, then fold deeper for 20–30 s.',
  },
  {
    name: 'Front Split, Left Leg Forward',
    dose: '3 min',
    cr,
    knee,
    part: 'daily',
    how: 'Back knee on a folded mat, a block under each hand, and a third block under your front hip if needed. Slide the front heel forward and the back knee back until you hit 7/10. Hips square, back leg’s glute squeezed. This also stretches the hip flexors your backbend needs. Lower the block height as you improve.',
    push: 'Press the front heel down into the floor for 5–10 s, then slide deeper for 20–30 s. 3 rounds.',
  },
  {
    name: 'Front Split, Right Leg Forward',
    dose: '3 min',
    cr,
    knee,
    part: 'daily',
    how: 'Same setup on the other side: back knee on a folded mat, blocks under your hands and front hip, hips square, back glute squeezed.',
    push: 'Press the front heel into the floor for 5–10 s, then slide deeper for 20–30 s. 3 rounds. If one side is tighter, give that side an extra minute.',
  },
  {
    name: 'Frog Stretch',
    dose: '3.5–4 min',
    knee,
    part: 'daily',
    how: 'On forearms, knees wide on a folded mat, shins parallel behind you, ankles in line with knees. Get into position slowly, then stay still and let your hips sink back toward your heels. No rocking. This prepares your inner thighs for the side split right after. Start at 3.5 minutes and add 30 seconds a week up to 4 if your knees feel fine.',
  },
  {
    name: 'Side Split',
    dose: '5 min',
    cr,
    part: 'daily',
    how: 'Face forward, legs out wide to the sides, kneecaps and toes pointing up at the ceiling (this protects your knees). Hands or forearms on blocks in front of you. Slide wider only as far as stays at 7/10. Hold the full 5 minutes: the last 2 minutes are where your body lets go.',
    push: 'During minutes 2–4, 3 rounds of contract-relax: squeeze your legs toward each other into the floor for 5–10 s, then slide wider for 20–30 s.',
  },
  {
    name: 'Lying Butterfly',
    dose: '2 min',
    knee,
    part: 'daily',
    how: 'On your back, soles of the feet together, knees falling open, a block under each knee so they’re supported. Passive: just breathe and let the inner thighs relax after the side split. Don’t press your knees down.',
  },
  {
    name: 'Standing Chest to Shins (Standing Fold)',
    dose: '2 min',
    part: 'daily',
    how: 'Feet together, knees straight but not locked. Fold from the hips with hands on blocks in front of your feet. Let your head hang and your chest move toward your shins. As you improve, lower the blocks, then grab behind your ankles and pull your chest in.',
  },
  {
    name: 'Sphinx to Cobra',
    dose: '3 × 45 s',
    rest: '15 s',
    part: 'daily',
    how: 'Face down, forearms on the floor. Squeeze your glutes and pull your belly button in. 3 holds of 45 s with about 15 s lying flat between. A daily backbend balances all the forward folding.',
    push: 'Sphinx, sphinx, then cobra (arms straight) for the third.',
    easy: 'Keep all three as sphinx.',
  },
];

const BRIDGES: StretchHold = {
  name: 'Bridge Holds',
  dose: '3 × 20–30 s',
  rest: '30 s',
  knee,
  part: 'focus',
  how: 'On your back, feet flat and hip-width apart close to your hips. Squeeze your glutes and press your hips up. Start with a glute bridge (shoulders on the floor). Once that’s easy, put your hands by your ears and press up into a full bridge (wheel pose), pushing your chest toward the wall behind you. Rest 30 s between holds. Knee check: bridges bend the knee under load. If your knee complains, stay with glute bridges and keep the feet a bit further away.',
};

const PIKE_LIFTS: StretchHold = {
  name: 'Seated Pike Leg Lifts',
  dose: '2 × 8–10',
  part: 'focus',
  how: 'Sit with legs together and straight, hands on blocks beside your knees. Keeping both legs straight, lift your heels a few inches off the floor using your hip flexors, hold 2 s, lower. This builds the strength that pulls your chest to your shins. Small lifts count.',
};

const HUG = 'Finish with 30 seconds hugging both knees to your chest to settle your lower back.';

/** The five sessions, Monday to Saturday (Wednesday off), each with its weekday (1 = Mon … 7 = Sun). */
export const STRETCH_DAYS: { day: number; title: string; minutes: number; plan: StretchPlan }[] = [
  {
    day: 1,
    title: 'Mon · Stretch: push + hamstrings',
    minutes: 27,
    plan: {
      day: 'push',
      intensity: '7–8 out of 10',
      focus: 'Hamstrings',
      holds: [
        ...DAILY_EIGHT,
        {
          name: 'Lying Band Hamstring Stretch',
          dose: '1.5 min each leg',
          cr,
          part: 'focus',
          how: 'On your back, band around one foot, leg straight up, other leg flat on the floor. Hold 15 s, then 2 rounds of contract-relax: press your heel into the band for 5–10 s, then pull the leg closer for 20–30 s. Then the other leg.',
        },
      ],
    },
  },
  {
    day: 2,
    title: 'Tue · Stretch: easy + backbend',
    minutes: 30,
    plan: {
      day: 'easy',
      intensity: '5–6 out of 10 (backbend at 7–8)',
      focus: 'Backbend (big)',
      holds: [
        ...DAILY_EIGHT,
        {
          name: 'Supported Fish Pose (with blocks)',
          dose: '3 min',
          part: 'focus',
          how: 'Sit with legs straight, place one block lengthwise along your spine just below the shoulder blades (lowest height to start) and a second block behind it for your head. Lie back over them, arms out to the sides or overhead. Let your chest lift and your upper back drape. Raise the blocks one height after a few weeks.',
        },
        BRIDGES,
      ],
      finish: HUG,
    },
  },
  {
    day: 4,
    title: 'Thu · Stretch: push + folding strength',
    minutes: 28,
    plan: {
      day: 'push',
      intensity: '7–8 out of 10',
      focus: 'Folding strength',
      holds: [
        ...DAILY_EIGHT,
        PIKE_LIFTS,
        {
          name: 'Active Leg Raise',
          dose: '2 × 8 each leg',
          part: 'focus',
          how: 'On your back, lift one straight leg as high as you can without hands, pause 3 s at the top, lower slowly. Strength in the hamstring range you’re building, so your body lets you keep it.',
        },
      ],
    },
  },
  {
    day: 5,
    title: 'Fri · Stretch: easy + backbend',
    minutes: 30,
    plan: {
      day: 'easy',
      intensity: '5–6 out of 10 (backbend at 7–8)',
      focus: 'Backbend (big)',
      holds: [
        ...DAILY_EIGHT,
        {
          name: 'Puppy Pose (Melting Heart)',
          dose: '3 min',
          knee,
          part: 'focus',
          how: 'Start on hands and knees with a folded mat under your knees, hips stacked over your knees. Walk your hands forward and let your chest melt toward the floor, arms straight overhead, forehead or chin resting on a block. Keep your hips high. This opens the shoulders and upper back for the overhead part of a backbend.',
        },
        BRIDGES,
      ],
      finish: HUG,
    },
  },
  {
    day: 6,
    title: 'Sat · Stretch: push + split strength',
    minutes: 28,
    plan: {
      day: 'push',
      intensity: '7–8 out of 10',
      focus: 'Split strength',
      holds: [
        ...DAILY_EIGHT,
        {
          name: 'Side-Lying Leg Raise',
          dose: '2 × 10 each leg',
          part: 'focus',
          how: 'On your side, bottom knee bent for balance, top leg straight. Lift it as high as you can, toes pointing forward, pause 2 s, lower slowly. Strength at the edge of your side split.',
        },
        PIKE_LIFTS,
      ],
    },
  },
];

/** Shown in each stretching task's details. */
export const STRETCH_DETAILS = [
  'Right after lifting. Same eight holds every session, then the day’s focus slot.',
  'Push days (Mon, Thu, Sat): 7–8 out of 10 with contract-relax. Easy days (Tue, Fri): the same holds, passive at 5–6; the big backbend days. Wed and Sun: rest, no stretching.',
  'Sore or tweaky: run every day as an easy day that week.',
  'No change for 6 weeks on a goal: add 1 minute to that hold on push days and a fourth contract-relax round. Blocks feel too high: lower them one setting.',
  'Stretching should feel strong, never sharp. Not medical advice: get the knee checked, and tell your doctor or PT you’re training splits.',
].join('\n');

/** The four goals the plan serves. `key` matches a goal you may already have. */
export const FLEX_GOALS: { key: 'front' | 'side' | 'fold' | 'backbend'; title: string; why: string; doneMeans: string; measures: { name: string; unit: string }[]; milestones: { title: string; monthsIn: number }[] }[] = [
  {
    key: 'front',
    title: 'Front splits, both sides',
    why: 'Mobility I will keep for decades, and the hip flexors my backbend needs.',
    doneMeans: 'Front splits flat on both sides, hips square. 6–9 months is realistic; expect one side to lag.',
    measures: [
      { name: 'Front split (left): front hip to floor', unit: 'in' },
      { name: 'Front split (right): front hip to floor', unit: 'in' },
    ],
    milestones: [],
  },
  {
    key: 'side',
    title: 'Side (center) split',
    why: 'The hardest of the four; daily time is what moves it.',
    doneMeans: 'Within about 4 inches (10 cm) of the floor by month 9, then keep going. Most adults take 12+ months to go flat.',
    measures: [{ name: 'Side split: crotch to floor', unit: 'in' }],
    milestones: [],
  },
  {
    key: 'fold',
    title: 'Chest to shins, seated and standing',
    why: 'The same hamstrings as the front split, plus folding strength: each makes the other faster.',
    doneMeans: 'Chest on shins in the seated pike fold and the standing fold. 6–9 months is realistic.',
    measures: [
      { name: 'Seated fold: chest to knees', unit: 'in' },
      { name: 'Standing fold: chest to knees', unit: 'in' },
    ],
    milestones: [],
  },
  {
    key: 'backbend',
    title: 'Full backbend',
    why: 'Upper back and shoulders open first, then a floor bridge, a straight-arm bridge, and later walking down a wall. Being 39 doesn’t stop it.',
    doneMeans: 'A full bridge (wheel) in 4–8 months; a drop-back is a 12–24 month aim.',
    measures: [{ name: 'Bridge: hands to heels', unit: 'in' }],
    milestones: [{ title: 'Full bridge (wheel) held 20–30 s', monthsIn: 6 }],
  },
];

/** The monthly check: first Monday of each month. */
export const MONTHLY_CHECK = {
  title: 'Monthly flexibility check',
  minutes: 15,
  details: [
    'Phone on a tripod at hip height, same spot and distance every month. Use the remote so you can take the photo while holding the position.',
    'Front splits: side-view photo of each side; measure front hip to floor.',
    'Side split: front-view photo; measure crotch to floor.',
    'Chest to shins: side photos of the seated and standing folds; measure chest to knees.',
    'Backbend: side photo of your best bridge; measure hands to heels (fingertips to the back of your heels, on the floor).',
    'Add the photos to this task, and the measurements on each goal’s page.',
  ].join('\n'),
};
