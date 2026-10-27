/**
 * Elliot's six months, Oct 26 2026 → Apr 26 2027, as a Six Months import file.
 *
 *   npx tsx apps/web/scripts/my-plan.ts > my-plan.json
 *   npx tsx apps/web/scripts/my-plan.ts --weight 194.2 --goal 155 --today 2026-10-26 > my-plan.json
 *
 * Then Settings → Import from a file. It REPLACES everything in the app, so export first if there's
 * anything you want to keep. Change any line below and run it again; the file is built with the
 * same code the app uses when you make a goal by hand, so what you get is what the UI would have made.
 */
import { addDays, type ISODate, type PlannedExercise } from '@six/core';
import { applyOp, emptyData, type AppData, type Op } from '../src/data/model.ts';
import { View } from '../src/data/derive.ts';
import { blankTask, opsAddTask, withOps } from '../src/data/breakdown.ts';
import { chainFor } from '../src/data/chain.ts';
import { opsCreateGroup } from '../src/data/groups.ts';
import { opsMakeGoal, opsStartSeason, type NewGoalInput } from '../src/data/newGoal.ts';
import { blankPath, opsCreatePath } from '../src/data/paths.ts';
import { opsAddIdea } from '../src/data/backlog.ts';
import { opsAddPhotoTracker } from '../src/data/tracking.ts';
import { blankHabit, opsCreateHabit } from '../src/data/habits.ts';
import { opsSetGroupPrize } from '../src/data/prizes.ts';
// Goal colours (the same set as components/ui.tsx).
const GOAL_COLORS = ['#5B8CFF', '#22B07D', '#FF7A45', '#E8559B', '#8B6CF6', '#3FB6C9'];

// ---------- Settings you may want to change ----------

const arg = (name: string, fallback: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1]! : fallback;
};
const TODAY = arg('today', '2026-10-26') as ISODate;
/** Your weight today and where you're going, in lb (194.2 → 155 is 39 lb at about 1.5 lb a week). */
const WEIGHT_NOW = Number(arg('weight', '194.2'));
const WEIGHT_GOAL = Number(arg('goal', '155'));

const SEASON_NAME = 'Oct 26 – Apr 26';
const JHU_PREREQS_DONE = '2026-11-13' as ISODate;
const JHU_STARTS = '2026-11-14' as ISODate;
const JHU_ENDS = addDays(JHU_STARTS, 22 * 7 - 1); // 22 weeks → 2027-04-16
const AIGP_EXAM = '2027-01-29' as ISODate;
const AIGP_STUDY_STARTS = '2026-12-01' as ISODate; // no AIGP study before December 1
const DOC_COURSE_STARTS = '2026-11-02' as ISODate; // choose and buy the course this week, start it next Monday
const ISO_COURSE_STARTS = '2027-02-15' as ISODate;
const ISO_EXAM = '2027-02-22' as ISODate;
const JOB_BY = '2027-01-31' as ISODate;

// ---------- Build ----------

let data: AppData = emptyData();
data.profile = {
  ...data.profile,
  display_name: 'Elliot',
  timezone: 'America/New_York',
  units: 'lb',
  // Minutes a day these goals can have: weekdays are full days right now.
  available_minutes: [480, 480, 480, 480, 480, 300, 180],
};
const run = (ops: Op[]) => {
  data = ops.reduce(applyOp, data);
};
const view = () => new View(data, TODAY, 0.5);

const season = opsStartSeason(SEASON_NAME, TODAY);
run(season.ops);
const plan = season.plan;

// Odyssey paths. Groups keep goals that share a timeline together; paths say which life they're bets on.
const pathAI = { ...blankPath(data, TODAY), name: 'AI product & governance', headline: 'AI product owner now; independent governance consultant later', why: 'Twelve years of delivery plus the credentials to be trusted with AI governance. The shortest path to good work, and the base for independence.', color: '#5B8CFF', rank: 0,
  years: ['JHU certificate, AIGP, ISO 42001 LI; an AI product owner role by January', 'Ship one AI feature people use; first paid governance readiness check on the side', 'Senior PO/PM; a repeatable 90-day governance offer with two clients', 'Choose: lead product on an AI team, or go independent with three clients', 'A known name in one narrow niche of AI governance'],
  gauges: { resources: 4, likability: 3, confidence: 4, coherence: 4 }, gauge_log: [{ on: TODAY, gauges: { resources: 4, likability: 3, confidence: 4, coherence: 4 } }],
  questions: [
    { id: crypto.randomUUID(), text: 'Will companies hire a delivery lead as a technical AI product owner before I have shipped an AI product?', answer: '', answered_at: null },
    { id: crypto.randomUUID(), text: 'Would anyone pay for a 90-day AI governance readiness check?', answer: '', answered_at: null },
  ] };
const pathDoc = { ...blankPath(data, TODAY), name: 'Documentarian: Adventure Music', headline: 'He goes somewhere hard, finds the music, you hear the whole song', why: 'The life I would pick if money and image did not matter. Curiosity, travel, music, and one promise a viewer can say in a sentence.', color: '#FF7A45', rank: 1,
  years: ['Learn the craft: DFA course, practice films, two published episodes (a Session and an Appalachian Search), Valledupar shot', 'Weekly Unique Lives podcast; one expedition a quarter; the accordion Thread begins', 'Georgia or Mongolia; the bagpipe Thread; a small, loyal audience', 'The channel pays for its own expeditions', 'A body of work: fifty full performances recorded where the songs are from'],
  gauges: { resources: 2, likability: 5, confidence: 2, coherence: 4 }, gauge_log: [{ on: TODAY, gauges: { resources: 2, likability: 5, confidence: 2, coherence: 4 } }],
  questions: [
    { id: crypto.randomUUID(), text: 'Can I record a full performance I would be proud to publish?', answer: '', answered_at: null },
    { id: crypto.randomUUID(), text: 'Will people watch the uncut song at the end?', answer: '', answered_at: null },
    { id: crypto.randomUUID(), text: 'Can I work through a fixer and get written consent in Spanish?', answer: '', answered_at: null },
  ] };
const pathCamp = { ...blankPath(data, TODAY), name: 'Glamping: build, sell, do it again abroad', headline: 'Build a campground, sell it, rebuild it somewhere I choose', why: 'Land, hospitality and a place people recover in; a business you can see and walk through. Build one, learn everything, sell it, and do the second one in a country of my choice.', color: '#22B07D', rank: 2,
  years: ['Land bought (the AI group prize) and the site designed: 3–4 units, zoning and permits cleared, financing in place', 'Build and open: first guests, the booking and cleaning systems written down so they run without me', 'Full seasons, profitable; a manager in place; scout the second country and its rules on foreign ownership', 'Sell the campground to an operator on a clean set of books; bank the proceeds and the playbook', 'Open the second site abroad, smaller and better, with everything the first one taught me'],
  gauges: { resources: 2, likability: 5, confidence: 3, coherence: 3 }, gauge_log: [{ on: TODAY, gauges: { resources: 2, likability: 5, confidence: 3, coherence: 3 } }],
  questions: [
    { id: crypto.randomUUID(), text: 'Can a 3–4 unit site near Asheville or Greenville cash-flow by its second season, without me on site every day?', answer: '', answered_at: null },
    { id: crypto.randomUUID(), text: 'What do small glamping operations actually sell for, and what makes one sellable (books, systems, bookings)?', answer: '', answered_at: null },
    { id: crypto.randomUUID(), text: 'Which country would let me own and run a campground as a foreigner, and would we want to live there for the years it takes?', answer: '', answered_at: null },
  ] };
run([...opsCreatePath(pathAI), ...opsCreatePath(pathDoc), ...opsCreatePath(pathCamp)]);

const round1 = (n: number) => Math.round(n * 10) / 10;

/** Make a goal with sensible defaults; returns its id. */
function goal(input: Partial<NewGoalInput> & Pick<NewGoalInput, 'title' | 'type' | 'doneMeans'>, color: string): string {
  const full: NewGoalInput = {
    why: '', planId: plan.id, start: null, finish: null, unit: '', measureName: '', baseline: null, target: null, targetDate: '', pathEdits: {}, milestones: [], weekGoal: '', task: null, shareActionIds: [], groupWithGoalId: null, pathId: null, ideaId: null,
    ...input,
    color,
  };
  const made = opsMakeGoal(data, plan, full, TODAY);
  run(made.ops);
  return made.goalId;
}

type Extra = Partial<ReturnType<typeof blankTask>> & { title: string };
/** Add more daily tasks to a goal (the first one comes with the goal). */
function tasks(goalId: string, list: Extra[]) {
  for (const t of list) {
    const g = data.goals.find((x) => x.id === goalId)!;
    const from = t.start && t.start > TODAY ? t.start : TODAY;
    const week = chainFor(data, g, plan, from).week.step ?? chainFor(withOps(data, []), g, plan, TODAY).week.step!;
    run(opsAddTask(data, g, week, { ...blankTask(week, TODAY), through: null, ...t }, TODAY));
  }
}

// ---------- Group: AI (Plan A) ----------

const jhu = goal(
  {
    title: 'JHU AI & Agentic AI Engineering certificate',
    type: 'finish',
    why: 'The technical depth a real AI product owner needs, with proof.',
    doneMeans: 'Certificate earned: prerequisites done by Nov 13, all 22 weeks of coursework submitted',
    finish: JHU_ENDS,
    pathId: pathAI.id,
    weekGoal: 'Prerequisites: first half done',
    task: { title: 'JHU prerequisites', days: [1, 2, 3, 4, 5, 6], minutes: 60 },
    milestones: [
      { title: 'Prerequisites done', due_date: JHU_PREREQS_DONE },
      { title: 'Course starts', due_date: JHU_STARTS },
      { title: 'Week 4 done', due_date: addDays(JHU_STARTS, 27) },
      { title: 'Week 8 done', due_date: addDays(JHU_STARTS, 55) },
      { title: 'Halfway: week 11 done', due_date: addDays(JHU_STARTS, 76) },
      { title: 'Week 16 done', due_date: addDays(JHU_STARTS, 111) },
      { title: 'Course complete: week 22', due_date: JHU_ENDS },
    ],
  },
  GOAL_COLORS[0]!,
);
// The prerequisites end the day before class; coursework is 10 hours a week from then on.
{
  const prereq = data.actions.find((a) => a.title === 'JHU prerequisites')!;
  const sched = data.schedules.find((s) => s.action_id === prereq.id)!;
  run([{ kind: 'update', collection: 'schedules', id: sched.id, patch: { effective_to: JHU_PREREQS_DONE } }]);
}
tasks(jhu, [{ title: 'JHU coursework', kind: 'minutes', minutes: 120, days: [1, 2, 3, 4, 5], start: JHU_STARTS, through: JHU_ENDS, cue: 'Mornings, before applications' }]);

const aigp = goal(
  {
    title: 'Pass the AIGP exam',
    type: 'finish',
    why: 'The governance credential people recognise. Credibility for the consulting path.',
    doneMeans: 'AIGP passed, exam taken by the end of January',
    start: AIGP_STUDY_STARTS,
    finish: addDays(AIGP_EXAM, 2),
    pathId: pathAI.id,
    weekGoal: 'Study plan set; Body of Knowledge domain I read',
    task: { title: 'AIGP study', days: [1, 3, 5, 6, 7], minutes: 60 },
    milestones: [
      { title: 'Exam booked', due_date: '2026-12-15' },
      { title: 'Body of Knowledge read once', due_date: '2026-12-20' },
      { title: 'Practice exam ≥ 70%', due_date: '2027-01-10' },
      { title: 'Practice exam ≥ 80%', due_date: '2027-01-24' },
      { title: 'Exam day', due_date: AIGP_EXAM },
    ],
  },
  GOAL_COLORS[4]!,
);
{
  const study = data.actions.find((a) => a.title === 'AIGP study')!;
  const sched = data.schedules.find((s) => s.action_id === study.id)!;
  run([{ kind: 'update', collection: 'schedules', id: sched.id, patch: { effective_to: AIGP_EXAM } }]);
}

const iso = goal(
  {
    title: 'ISO/IEC 42001 Lead Implementer',
    type: 'finish',
    why: 'The implementation credential that turns governance knowledge into billable work.',
    doneMeans: 'Week-long course done and the Lead Implementer exam passed, right after the AIGP',
    start: addDays(AIGP_EXAM, 1),
    finish: '2027-02-28',
    pathId: pathAI.id,
    weekGoal: 'Course booked for the week of Feb 15',
    task: { title: 'ISO 42001 course and exam prep', days: [1, 2, 3, 4, 5], minutes: 60 },
    milestones: [
      { title: 'Course booked', due_date: '2027-02-05' },
      { title: 'Course week starts', due_date: ISO_COURSE_STARTS },
      { title: 'Lead Implementer exam', due_date: ISO_EXAM },
    ],
  },
  GOAL_COLORS[5]!,
);
{
  const prep = data.actions.find((a) => a.title === 'ISO 42001 course and exam prep')!;
  const sched = data.schedules.find((s) => s.action_id === prep.id)!;
  run([{ kind: 'update', collection: 'schedules', id: sched.id, patch: { effective_to: ISO_EXAM } }]);
}

const job = goal(
  {
    title: 'Land an AI product owner role',
    type: 'finish',
    why: 'Income, and the seat where the AI work actually happens.',
    doneMeans: 'Offer accepted for an AI product owner or product manager role by the end of January',
    finish: JOB_BY,
    // "?" marks a suggestion to swap for your own on the goal page (Prizes → Change).
    prize: 'Start the process for my wife’s US visa',
    pathId: pathAI.id,
    weekGoal: 'Resume and LinkedIn rewritten for AI product roles; 125 applications out',
    task: { title: 'Applications sent', days: [1, 2, 3, 4, 5], minutes: 150 },
    milestones: [
      { title: 'Resume and LinkedIn rewritten for AI product roles', due_date: '2026-10-30' },
      { title: '250 applications out', due_date: '2026-11-13' },
      { title: 'First-round interviews happening', due_date: '2026-12-04' },
      { title: 'A final round', due_date: '2027-01-15' },
      { title: 'Offer accepted', due_date: JOB_BY },
    ],
  },
  GOAL_COLORS[2]!,
);
// 25 a day is a count, not a check: logging asks how many.
{
  const apps = data.actions.find((a) => a.title === 'Applications sent')!;
  run([{ kind: 'update', collection: 'actions', id: apps.id, patch: { kind: 'count', planned_count: 25, min_label: '10 applications', min_count: 10 } }]);
  for (const s of data.sessions.filter((x) => x.action_id === apps.id)) run([{ kind: 'update', collection: 'sessions', id: s.id, patch: { planned_count: 25 } }]);
}
tasks(job, [{ title: 'One networking message or coffee chat', kind: 'check', minutes: 20, days: [2, 4], through: JOB_BY, cue: 'After applications' }]);

{
  const grp = opsCreateGroup(data, 'AI', [jhu, aigp, iso, job]);
  run(grp.ops);
  // All four AI goals finished: buy the land for the glamping site.
  run(opsSetGroupPrize(data.groups.find((g) => g.id === grp.groupId)!, 'Buy land for the glamping site', 1));
}

// ---------- The workouts (5-Day Upper Body Plan, Mon–Fri, weights only, knee-safe) ----------

const WARMUP = 'Before every session (5 min): 2 × 15 band pull-aparts or light cable face pulls · 10 shoulder dislocates · one or two feeder sets of the first exercise at ~50%.\nEnd each set with 1–2 reps in the tank (0–1 on the last set of curls, raises, pushdowns). Lower for ~2 s, full stretch. Stay at a weight until every set hits the top of the range, then add 5 lb per dumbbell (one plate on a machine) and drop to the bottom of the range.';
const ex = (name: string, sets: number, reps: string, weight: string, rest: string, note = '', per_side = false): PlannedExercise => {
  const [lo, hi] = reps.split('–').map(Number);
  const single = /^(\d+(?:\.\d+)?)$/.exec(weight);
  return { name, sets, reps_min: lo!, reps_max: hi ?? lo!, ...(per_side ? { per_side: true } : {}), weight: single ? Number(single[1]) : null, weight_note: single ? '' : weight, rest, note };
};
const WORKOUTS: [number, string, PlannedExercise[]][] = [
  [1, 'Chest & Back A', [
    ex('Flat DB Bench Press', 3, '8–12', '50', '2–3 min'),
    ex('Lat Pulldown', 4, '8–12', '100', '2–3 min', 'Elbows down to your back pockets. Full stretch at the top.'),
    ex('Incline DB Press', 3, '8–12', '35', '2 min', 'Upper chest. Rest the full 2 min.'),
    ex('Chest-Supported DB Row', 3, '8–12', '35', '90 sec'),
    ex('Straight-Arm Cable Pulldown', 3, '12–15', '35', '60 sec', 'Arms nearly straight, sweep bar to thighs. Lats only.'),
    ex('Seated Lateral Raise', 3, '12–15', '12.5', '60 sec', 'Lead with the elbows, stop at shoulder height. Last set can go close to failure.'),
  ]],
  [2, 'Shoulders & Arms A', [
    ex('Seated DB Shoulder Press', 3, '8–12', '35', '2 min'),
    ex('Seated Lateral Raise', 4, '12–15', '12.5', '60 sec', 'Lead with the elbows, stop at shoulder height.'),
    ex('Seated DB Curl', 3, '10–12', '25', '90 sec'),
    ex('Cable Triceps Pushdown', 4, '12–15', '57.5', '60 sec'),
    ex('Seated Hammer Curl', 3, '10–12', '20', '60 sec', 'Builds the brachialis, which pushes the biceps up.'),
    ex('Sit-Up Bench Crunch (knee test)', 3, '12–15', 'bodyweight', '45 sec', 'Flat or lowest decline. Curl ribs toward hips, short range. First set at bodyweight: any knee pain where the feet hook in, stop and skip it.'),
  ]],
  [3, 'Chest & Back B', [
    ex('Seated Cable Row', 4, '6–10', '100', '2–3 min', 'Heavier, lower reps: your back-strength lift. Chest up, pause at the belly.'),
    ex('Machine Chest Press', 3, '10–12', '50', '2 min'),
    ex('Single-Arm DB Row', 3, '8–12', '40', '90 sec', 'Chest on incline bench, no knee on the bench. Pull your elbow toward your hip.', true),
    ex('Low-Incline DB Fly', 3, '12–15', '20–25 lb', '60 sec', 'Bench one notch up from flat. Slight elbow bend, lower to a deep chest stretch, hug the weights together.'),
    ex('Hammer Strength Back Extension', 4, '10–15', 'bodyweight', '90 sec', 'Round down slowly, squeeze up until straight, no arching past that. Hold a plate on your chest once 15 reps are easy.'),
  ]],
  [4, 'Shoulders & Arms B', [
    ex('Seated DB Arnold Press', 3, '8–12', '35', '2 min'),
    ex('Seated Rear-Delt Fly', 3, '12–15', '10–15 lb', '60 sec', 'Chest on incline bench or the reverse pec deck.'),
    ex('Seated Incline DB Curl', 3, '10–12', '15', '90 sec', 'Arms hang behind you; biceps work in a stretch.'),
    ex('Seated Overhead Triceps Extension', 4, '10–15', '35', '90 sec', 'Let the dumbbell sink deep behind your head.'),
    ex('Cable Lateral Raise', 3, '12–15', 'light, find it', '60 sec', 'One arm at a time, next to the stack.', true),
    ex('Sit-Up Bench Crunch (knee test)', 3, '12–15', 'bodyweight', '45 sec', 'First set at bodyweight: any knee pain, stop and skip it.'),
  ]],
  [5, 'Chest & Back C', [
    ex('Wide-Grip Lat Pulldown', 4, '10–12', '90', '2 min', 'Lats first while you are fresh.'),
    ex('Incline DB Press', 3, '8–12', '35', '2 min'),
    ex('Flat DB Bench Press', 2, '8–12', '50', '2 min', 'Same weight as Monday; when Monday goes up, this goes up too.'),
    ex('Single-Arm Cable Pulldown', 3, '10–12', 'find it', '60 sec', 'Seated, one handle. Elbow down to your side, then let the arm stretch all the way up.', true),
    ex('Arm Superset: Cable Curl + Overhead Cable Triceps Extension', 2, '12–15', 'find it', '90 sec after each round', 'One set of curls, then right away one set of extensions (sit on a bench, back to the stack). Rest, repeat.'),
    ex('Hammer Strength Glute/Ham Hip Extension (knee test)', 3, '10–12', 'bodyweight', '90 sec', 'Hips on the pad, legs straight. Bend at the hips, squeeze glutes and hamstrings to come up. Not the knee-bending glute-ham raise.'),
  ]],
];

// ---------- Group: Body ----------

const weight = goal(
  {
    title: `Down to ${WEIGHT_GOAL} lb`,
    type: 'number',
    why: `Strong, light, and clear-headed for everything else on this list. ${Math.round(WEIGHT_NOW - WEIGHT_GOAL)} lb at 1.5 a week.`,
    doneMeans: '',
    unit: 'lb',
    measureName: 'Weight',
    baseline: WEIGHT_NOW,
    target: WEIGHT_GOAL,
    targetDate: plan.end_date,
    // Four steps down, a treat on each; the first reading at or below the number ticks it off.
    // Dates follow the 1.5 lb/week path. "?" marks a suggestion to swap for your own.
    milestones: [
      { title: '10 lb down', due_date: '2026-12-13', value: round1(WEIGHT_NOW - 10), prize: 'Canon RF 16mm lens' },
      { title: '20 lb down', due_date: '2027-01-31', value: round1(WEIGHT_NOW - 20), prize: 'A nice burr grinder' },
      { title: '30 lb down', due_date: '2027-03-14', value: round1(WEIGHT_NOW - 30), prize: 'A new phone' },
    ],
    prize: 'A long weekend somewhere new?',
    weekGoal: 'All five workouts (week 4 of the plan); weight and a photo every morning; no alcohol, keto every day',
    task: null,
  },
  GOAL_COLORS[1]!,
);
{
  // Weight is the goal's own number, so it sits in "Today's numbers" every day (logged there, charted on
  // the goal) — no separate weigh-in task, which would hide it from that card. A daily progress photo
  // sits beside it with a camera button; photos collect on the goal, labelled by day, and Then vs now
  // shows the first against the latest.
  const g = data.goals.find((x) => x.id === weight)!;
  run(opsAddPhotoTracker(data, g.id, 'Progress photo', [1, 2, 3, 4, 5, 6, 7], TODAY));
  // The 5-Day Upper Body Plan (Oct 13 version), one workout a day Mon–Fri, each with its exercises.
  tasks(weight, WORKOUTS.map(([day, title, plan]): Extra => ({ title, kind: 'workout', minutes: 60, days: [day], priority: true, workoutPlan: plan, details: WARMUP })));
}

// ---------- Habits (every day, for their own sake; they have their own tab with streaks) ----------

run(opsCreateHabit(data, { ...blankHabit(TODAY), title: 'No alcohol', kind: 'check', minutes: 0 }, TODAY).ops);
run(opsCreateHabit(data, { ...blankHabit(TODAY), title: 'Keto / carnivore eating', kind: 'check', minutes: 0, minLabel: 'No sugar, no bread' }, TODAY).ops);
run(opsCreateHabit(data, { ...blankHabit(TODAY), title: 'Guitar', kind: 'minutes', minutes: 30 }, TODAY).ops);

const splits = goal(
  {
    title: 'Front and side splits',
    type: 'practice',
    why: 'Mobility I will keep for decades. If I get there, hurray; if not, I will be closer.',
    doneMeans: 'Front splits and side splits flat on the floor, or as close as six months of daily stretching gets me',
    weekGoal: 'Stretch every day; measure the gap on Sunday',
    task: { title: 'Stretch', days: [1, 2, 3, 4, 5, 6, 7], minutes: 25 },
    milestones: [
      { title: 'Baseline gap measured', due_date: addDays(TODAY, 6) },
      { title: 'Gap halved', due_date: '2027-01-24' },
      { title: 'Splits day: front and side, as low as they go', due_date: plan.end_date },
    ],
  },
  GOAL_COLORS[3]!,
);
tasks(splits, [{ title: 'Measure the splits gap', kind: 'measure', minutes: 5, days: [7], newMeasure: { name: 'Splits gap', unit: 'in' } }]);
{
  const grp = opsCreateGroup(data, 'Body', [weight, splits]);
  run(grp.ops);
  // 155 lb and both splits: the big one.
  run(opsSetGroupPrize(data.groups.find((g) => g.id === grp.groupId)!, 'Take IPPI Level 1, 2 and 3', 1));
}

// ---------- Group: Documentarian (Plan B) ----------

const doc = goal(
  {
    title: 'Learn to make documentaries',
    type: 'finish',
    why: 'Six months of reps so the camera holds and the sound carries. The craft before the channel.',
    doneMeans: 'Two episodes published: a Session with a full uninterrupted performance, and a Search episode at an Appalachian old-time jam; Valledupar prepared',
    pathId: pathDoc.id,
    weekGoal: 'Course chosen and bought (Documentary Fundamentals at docfilmacademy, or better); starts Monday Nov 2',
    task: null,
    milestones: [
      { title: 'Course bought', due_date: '2026-11-01' },
      { title: 'DFA modules 1–7 done; a 2-minute natural-sound film', due_date: '2026-11-30' },
      { title: 'One song recorded in three rooms, best cut', due_date: '2026-12-31' },
      { title: 'First Session published: full performance, 8 min', due_date: '2027-01-31' },
      { title: 'Two-camera performance; a practice Search day', due_date: '2027-02-28' },
      { title: 'First Search episode published: Appalachian jam', due_date: '2027-03-31' },
      { title: 'Valledupar prepared: fixer, agreements, contacts', due_date: plan.end_date },
    ],
  },
  GOAL_COLORS[2]!,
);
tasks(doc, [
  // This week: pick the course. Next week: start it.
  { title: 'Compare documentary courses and buy one', kind: 'minutes', minutes: 45, when: 'once', date: '2026-10-28' as ISODate, cue: 'Documentary Fundamentals (docfilmacademy) is the front-runner' },
  { title: 'Documentary Fundamentals course', kind: 'minutes', minutes: 45, days: [1, 2, 3, 4, 5], start: DOC_COURSE_STARTS, through: '2026-11-30' as ISODate },
  { title: 'Shoot or edit', kind: 'minutes', minutes: 90, days: [6, 7], start: addDays(DOC_COURSE_STARTS, 5), cue: 'Record the song first, then the interview' },
  { title: 'Log every clip from the shoot', kind: 'check', minutes: 15, days: [7], start: addDays(DOC_COURSE_STARTS, 6) },
]);
run(opsCreateGroup(data, 'Documentarian', [doc]).ops);

// ---------- Backlog ----------

const ideas: [string, string, string, string | null][] = [
  ['Buy a field recorder and a stereo pair', 'Zoom F3 plus Line Audio CM4 or Rode NT5: the real music-recording tool, needed before the December three-rooms recording.', 'Recorder and pair bought and used on one recording', pathDoc.id],
  ['Valledupar expedition, April 2027', 'Festival de la Leyenda Vallenata; fixer, two or three accordionists, written agreements. Verify the dates first.', 'Footage and multitrack audio for 3–5 episodes, with signed agreements', pathDoc.id],
  ['Weekly Unique Lives podcast', 'Carries the schedule once 6–8 episodes are banked; every guest answers "what song belongs to your life?"', 'Eight episodes banked, weekly release started', pathDoc.id],
  ['Pass the PMP exam', 'Prerequisites are done; the exam is what is left.', 'PMP passed', pathAI.id],
  ['A 90-day AI governance readiness check', 'The consulting offer, prototyped once with one real conversation.', 'One paid readiness conversation', pathAI.id],
  ['Live in Taiwan or Japan for a year', 'Not a goal yet. A desire worth keeping in sight; the second campground could be how it happens.', '', pathCamp.id],
  ['Glamping site: land search and numbers', 'Shortlist greater Asheville, Tennessee or greater Greenville; land criteria, 3–4 units, financing. Starts in earnest when the AI goals land.', 'A site shortlisted with a model that cash-flows by season two', pathCamp.id],
];
for (const [title, note, done, pathId] of ideas) {
  const added = opsAddIdea(data, title, note);
  run(added.ops);
  run([{ kind: 'update', collection: 'ideas', id: added.idea.id, patch: { done_means: done, ...(pathId ? { path_id: pathId } : {}) } }]);
}

// ---------- Out ----------

// Nothing is logged: today's workout is yours to enter.
const v = view();
process.stderr.write(
  [
    `${data.goals.length} goals in ${data.groups.length} groups, ${data.paths.length} paths, ${data.actions.length} tasks, ${data.milestones.length} dates to hit, ${data.ideas.length} ideas.`,
    `Today: ${v.sessionsOn(TODAY).map((s) => s.title).join(', ')}.`,
    '',
  ].join('\n'),
);
process.stdout.write(JSON.stringify(data, null, 2));
