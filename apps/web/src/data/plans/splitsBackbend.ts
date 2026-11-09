import type { StretchHold, StretchPlan } from '@six/core';

/**
 * The Splits & Backbend Plan (months 1–9, applied from Fri Oct 30 2026; updated Nov 9), right after
 * every lifting session: Mon, Tue, Thu, Fri, Sat. Wed and Sun are rest days. All on the floor;
 * gear: bands and blocks.
 *
 * Every session is the Daily Eight (about 24 minutes), then a focus slot of 3–8 minutes that
 * changes by day: hamstrings (Mon), backbend (Tue, Fri), twists (Thu), side split + twist (Sat).
 * Mon, Thu, Sat are push days (7–8 out of 10 with contract-relax rounds); Tue and Fri are easy
 * days (passive, 5–6 out of 10) and the big backbend days.
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
    name: 'Supported Reclined Butterfly (with blocks)',
    dose: '2 min',
    knee,
    part: 'daily',
    how: 'The yoga name is supta baddha konasana. Set a block lengthwise under your upper back and one under your head, like supported fish pose, then put the soles of your feet together and let your knees fall open. It stretches your inner thighs and opens your chest at the same time. Passive: just breathe after the side split, and don’t press your knees down.',
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

const SUPINE_TWIST: StretchHold = {
  name: 'Supine Spinal Twist',
  dose: '2 min each side',
  knee,
  part: 'focus',
  how: 'Lie on your back, arms out wide. Pull one knee up and across your body toward the floor on the other side, keeping both shoulders down. Turn your head away from the knee if it’s comfortable. Breathe into your lower back. Put a block under the knee if it doesn’t reach the floor or the knee complains.',
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
          name: 'Supported Fish Pose, Legs Straight (with blocks)',
          dose: '3 min',
          part: 'focus',
          how: 'Sit with legs straight and together, place one block lengthwise along your spine just below the shoulder blades (lowest height to start) and a second block behind it for your head. Lie back over them, arms resting out to the sides. Keep the legs straight today: that stretches the hip flexors your bridge needs, which the daily butterfly version doesn’t. Raise the blocks one height after a few weeks.',
        },
        BRIDGES,
      ],
      finish: HUG,
    },
  },
  {
    day: 4,
    title: 'Thu · Stretch: push + twists',
    minutes: 31,
    plan: {
      day: 'push',
      intensity: '7–8 out of 10 (twists easy)',
      focus: 'Twists',
      holds: [
        ...DAILY_EIGHT,
        SUPINE_TWIST,
        {
          name: 'Seated Spinal Twist',
          dose: '1.5 min each side',
          knee,
          part: 'focus',
          how: 'Sit with both legs straight. Cross your right foot over your left knee and plant it on the floor. Hug the right knee with your left arm, sit tall, and twist toward the right, right hand on the floor behind you. Lengthen on each inhale, twist a little more on each exhale. Switch sides. Skip it if the bent knee bothers you.',
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
          name: 'Side-Lying Open Book',
          dose: '1.5 min each side',
          part: 'focus',
          how: 'Lie on your side, knees bent and stacked at hip height, arms straight out in front of you, palms together. Keeping your knees together, sweep the top arm up and over to the other side and let it rest open toward the floor behind you, following it with your eyes. This twists your upper back and opens your chest for the backbend. On the left-arm side, keep the arm low and relaxed while your shoulder settles.',
        },
        BRIDGES,
      ],
      finish: HUG,
    },
  },
  {
    day: 6,
    title: 'Sat · Stretch: push + side split + twist',
    minutes: 32,
    plan: {
      day: 'push',
      intensity: '7–8 out of 10 (focus slot easy)',
      focus: 'Side split + twist',
      holds: [
        ...DAILY_EIGHT,
        {
          name: 'Wall Straddle (Legs-Up-the-Wall Straddle)',
          dose: '3–4 min',
          part: 'focus',
          how: 'Lie on your back with your butt against a wall and your legs straight up it. Slowly let them slide apart into a wide V and let gravity do the work. Don’t push. Your legs will sink a little lower every minute. To come out, use your hands to bring your legs together, bend your knees and roll to your side.',
        },
        SUPINE_TWIST,
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
export const FLEX_GOALS: { key: 'front' | 'side' | 'fold' | 'backbend'; title: string; why: string; doneMeans: string; measures: { name: string; unit: string; cadence?: number; weekday?: number }[]; milestones: { title: string; monthsIn: number }[] }[] = [
  {
    key: 'front',
    title: 'Front splits, both sides',
    why: 'Mobility I will keep for decades, and the hip flexors my backbend needs.',
    doneMeans: 'Front splits flat on both sides, hips square. 6–9 months is realistic; expect one side to lag.',
    measures: [
      { name: 'Front split (left): front hip to floor', unit: 'in', cadence: 7, weekday: 1 },
      { name: 'Front split (right): front hip to floor', unit: 'in', cadence: 7, weekday: 1 },
    ],
    milestones: [],
  },
  {
    key: 'side',
    title: 'Side (center) split',
    why: 'The hardest of the four; daily time is what moves it.',
    doneMeans: 'Within about 4 inches (10 cm) of the floor by month 9, then keep going. Most adults take 12+ months to go flat.',
    measures: [{ name: 'Center split', unit: 'in', cadence: 7, weekday: 1 }],
    milestones: [],
  },
  {
    key: 'fold',
    title: 'Chest to shins, seated and standing',
    why: 'The same hamstrings as the front split, plus folding strength: each makes the other faster.',
    doneMeans: 'Chest on shins in the seated pike fold and the standing fold. 6–9 months is realistic.',
    measures: [
      { name: 'Seated fold: chest to knees', unit: 'in', cadence: 7, weekday: 1 },
      { name: 'Standing fold: chest to knees', unit: 'in', cadence: 7, weekday: 1 },
    ],
    milestones: [],
  },
  {
    key: 'backbend',
    title: 'Full backbend',
    why: 'Upper back and shoulders open first, then a floor bridge, a straight-arm bridge, and later walking down a wall. Being 39 doesn’t stop it.',
    doneMeans: 'A full bridge (wheel) in 4–8 months; a drop-back is a 12–24 month aim.',
    measures: [],
    milestones: [{ title: 'Full bridge (wheel) held 20–30 s', monthsIn: 6 }],
  },
];

/** The monthly check: first Monday of each month. */
export const MONTHLY_CHECK = {
  title: 'Monthly flexibility check',
  minutes: 15,
  details: [
    'Phone on a tripod at hip height, same spot and distance every month. Use the remote so you can take the photo while holding the position.',
    'Front splits: side-view photo of each side.',
    'Center split: front-view photo.',
    'Chest to shins: side photo of the seated and standing folds.',
    'Backbend: side photo of your best bridge.',
    'Add the photos to this task. The numbers go in Today’s numbers every Monday.',
  ].join('\n'),
};
