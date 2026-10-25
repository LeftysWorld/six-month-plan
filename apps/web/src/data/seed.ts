import {
  addDays,
  missingSessionsForWeek,
  suggestPath,
  todayIn,
  weekStart,
  type Action,
  type ActionSchedule,
  type Goal,
  type Session,
  type SessionStatus,
} from '@six/core';
import { defaultProfile, emptyData, type AppData } from './model.ts';
import { blankTask, opsAddTask, withOps } from './breakdown.ts';
import { chainFor, opsStartChain } from './chain.ts';

const id = () => crypto.randomUUID();

function goal(over: Partial<Goal> & Pick<Goal, 'title' | 'type' | 'color'>): Goal {
  return {
    id: id(),
    why: '',
    done_means: '',
    unit: null,
    baseline_value: null,
    baseline_date: null,
    target_value: null,
    target_date: null,
    measurement_type_id: null,
    archived_at: null,
    ...over,
  };
}

function action(over: Partial<Action> & Pick<Action, 'title' | 'kind'>): Action {
  return {
    id: id(),
    planned_minutes: 30,
    planned_count: null,
    min_label: '',
    min_minutes: null,
    min_count: null,
    priority: false,
    archived_at: null,
    ...over,
  };
}

/**
 * A plan that started two weeks ago, with six goals, daily weigh-ins and a realistic
 * mix of done, minimum, partial and skipped sessions.
 */
export function buildDemoData(): AppData {
  const profile = { ...defaultProfile(), display_name: 'Elliot' };
  const today = todayIn(profile.timezone);
  const start = addDays(today, -14);
  const end = addDays(start, 182);
  const data = emptyData();
  data.profile = profile;

  const plan = { id: id(), name: 'My next six months', start_date: start, end_date: end, block_days: 28, archived_at: null };
  const plan2Start = addDays(today, 31);
  const plan2 = {
    id: id(),
    name: 'Career & credentials',
    start_date: plan2Start,
    end_date: addDays(plan2Start, 182),
    block_days: 28,
    archived_at: null,
  };
  data.plans = [plan, plan2];

  // ---- Goals ----
  const weightType = { id: id(), name: 'Weight', unit: 'lb', cadence_days: 1, goal_id: null as string | null, archived_at: null };
  const weight = goal({
    title: 'Lose 30 lb',
    type: 'number',
    color: '#5B8CFF',
    unit: 'lb',
    baseline_value: 212.2,
    baseline_date: start,
    target_value: 182,
    target_date: end,
    why: 'Feel strong and light again.',
    done_means: 'Scale at 182, weekly waist and photos',
    measurement_type_id: weightType.id,
  });
  weightType.goal_id = weight.id;
  const strength = goal({ title: 'Bigger arms, chest and lats', type: 'practice', color: '#22B07D', why: 'Look and feel strong.', done_means: 'Arm +1 in, chest +2 in' });
  const guitar = goal({ title: 'Comfortable on guitar', type: 'practice', color: '#FF7A45', why: 'Play for myself at the end of the day.', done_means: '3 songs recorded start to finish' });
  const splits = goal({ title: 'Near full splits', type: 'practice', color: '#E8559B', why: 'Move without stiffness.', done_means: 'Under 3 in from the floor' });
  const career = goal({ title: 'Land a product role', type: 'practice', color: '#8B6CF6', why: 'Work on AI products I care about.', done_means: 'Signed offer' });
  const jhu = goal({ title: 'JHU AI certificate', type: 'finish', color: '#3FB6C9', why: 'Credibility for AI product roles.', done_means: 'All modules passed' });
  const aigp = goal({ title: 'Pass the AIGP exam', type: 'finish', color: '#3FB6C9', why: 'AI governance credibility.', done_means: 'Exam passed' });
  // A goal already finished early in the plan, so Completed has something to show.
  const finishedAt = `${addDays(today, -2)}T18:00:00.000Z`;
  const course = goal({ title: 'Finish the agents course', type: 'finish', color: '#94A3B8', why: 'Hands-on with agents and evals.', done_means: 'All lessons and the capstone done', completed_at: finishedAt, completion_note: 'Done two weeks early. Short evening sessions worked better than weekend marathons.' });
  data.goals = [weight, strength, guitar, splits, career, jhu, aigp, course];
  data.planGoals = [
    ...[weight, strength, guitar, splits, career, jhu, course].map((g) => ({ id: id(), plan_id: plan.id, goal_id: g.id })),
    { id: id(), plan_id: plan2.id, goal_id: jhu.id },
    { id: id(), plan_id: plan2.id, goal_id: aigp.id },
    { id: id(), plan_id: plan2.id, goal_id: career.id },
  ];
  data.goalTargets = suggestPath(212.2, 182, start, end, 28).map((p) => ({
    id: id(),
    goal_id: weight.id,
    target_date: p.date,
    target_value: p.value,
    effective_from: start,
    superseded_at: null,
  }));
  data.milestones = [
    ...[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11].map((n) => ({
      id: id(),
      goal_id: jhu.id,
      title: `Module ${n}`,
      due_date: addDays(start, n * 14),
      completed_at: n === 1 ? new Date().toISOString() : null,
    })),
    { id: id(), goal_id: guitar.id, title: 'Record song 1 start to finish', due_date: addDays(start, 42), completed_at: null },
    { id: id(), goal_id: aigp.id, title: 'Book the exam', due_date: addDays(plan2Start, 30), completed_at: null },
  ];

  // ---- Measurements ----
  const armType = { id: id(), name: 'Arm (flexed)', unit: 'in', cadence_days: 7, goal_id: strength.id, archived_at: null };
  const splitsType = { id: id(), name: 'Splits floor gap', unit: 'in', cadence_days: 14, goal_id: splits.id, archived_at: null };
  const waistType = { id: id(), name: 'Waist', unit: 'in', cadence_days: 7, goal_id: weight.id, archived_at: null };
  data.measurementTypes = [weightType, armType, splitsType, waistType];
  const weights = [212.2, 211.6, 212.0, 211.1, 210.8, 211.2, 210.4, 210.1, 209.6, 209.9, 209.0, 208.6, 208.9, 208.1, 207.5];
  data.measurements = [
    ...weights.map((v, i) => ({ id: id(), type_id: weightType.id, value: v, measured_on: addDays(start, i), source: 'manual', note: '' })),
    { id: id(), type_id: armType.id, value: 15, measured_on: start, source: 'manual', note: '' },
    { id: id(), type_id: armType.id, value: 15.25, measured_on: addDays(start, 7), source: 'manual', note: '' },
    { id: id(), type_id: splitsType.id, value: 14, measured_on: start, source: 'manual', note: '' },
    { id: id(), type_id: splitsType.id, value: 12, measured_on: addDays(start, 14), source: 'manual', note: '' },
    { id: id(), type_id: waistType.id, value: 38, measured_on: start, source: 'manual', note: '' },
    { id: id(), type_id: waistType.id, value: 37.25, measured_on: addDays(start, 7), source: 'manual', note: '' },
  ];

  // ---- Actions and schedules ----
  const workout = action({ title: 'Workout', kind: 'workout', planned_minutes: 45, min_label: '20 min, 2 lifts', min_minutes: 20 });
  const guitarA = action({ title: 'Guitar practice', kind: 'minutes', planned_minutes: 30, min_label: '5 minutes', min_minutes: 5 });
  const splitsA = action({ title: 'Splits stretching', kind: 'minutes', planned_minutes: 20 });
  const apps = action({ title: 'Tailored applications', kind: 'count', planned_minutes: 45, planned_count: 3, min_label: '1 application', min_count: 1, priority: true });
  const study = action({ title: 'JHU coursework', kind: 'study', planned_minutes: 60, min_label: '15 minutes', min_minutes: 15, priority: true });
  data.actions = [workout, guitarA, splitsA, apps, study];
  data.actionGoals = [
    { id: id(), action_id: workout.id, goal_id: strength.id },
    { id: id(), action_id: workout.id, goal_id: weight.id },
    { id: id(), action_id: guitarA.id, goal_id: guitar.id },
    { id: id(), action_id: splitsA.id, goal_id: splits.id },
    { id: id(), action_id: apps.id, goal_id: career.id },
    { id: id(), action_id: study.id, goal_id: jhu.id },
  ];
  const sched = (a: Action, rule: 'days' | 'per_week', days: number[], perWeek: number | null): ActionSchedule => ({
    id: id(),
    action_id: a.id,
    rule,
    days,
    per_week: perWeek,
    effective_from: start,
    effective_to: null,
  });
  data.schedules = [
    sched(workout, 'per_week', [], 5),
    sched(guitarA, 'per_week', [], 7),
    sched(splitsA, 'days', [2, 4, 6], null),
    sched(apps, 'days', [1, 2, 3, 4, 5], null),
    sched(study, 'days', [1, 2, 3, 4, 6], null),
  ];

  // ---- Sessions: generate each week, then log the past ----
  // Fixed patterns (not random) so the demo always shows the same mix:
  // workouts, applications and study mostly done; guitar and splits falling short.
  const patterns: Record<string, SessionStatus[]> = {
    [workout.id]: ['done', 'done', 'done', 'minimum', 'done', 'done'],
    [guitarA.id]: ['done', 'done', 'skipped', 'done', 'minimum', 'done', 'skipped'],
    [splitsA.id]: ['done', 'skipped', 'minimum', 'skipped', 'done'],
    [apps.id]: ['done', 'done', 'done', 'partial', 'done', 'done', 'done', 'done'],
    [study.id]: ['done', 'done', 'done', 'done', 'minimum', 'done'],
  };
  const counters: Record<string, number> = {};
  const sessions: Session[] = [];
  for (let monday = weekStart(start); monday <= weekStart(today); monday = addDays(monday, 7)) {
    const fresh = missingSessionsForWeek(data.actions, data.schedules, sessions, monday, id);
    // Place flexible sessions on days for the demo: spread across the week.
    const byAction = new Map<string, Session[]>();
    for (const s of fresh) {
      if (s.date) continue;
      byAction.set(s.action_id!, [...(byAction.get(s.action_id!) ?? []), s]);
    }
    for (const list of byAction.values()) {
      const days = [0, 1, 2, 3, 4, 5, 6].map((d) => addDays(monday, d)).filter((d) => d >= start);
      list.forEach((s, i) => {
        const date = days[Math.floor((i * days.length) / list.length)] ?? null;
        // keep this week's not-yet-due flexible sessions in the tray
        s.date = date && date <= today ? date : monday === weekStart(today) ? null : date;
      });
    }
    sessions.push(...fresh);
  }
  const loggedAt = (date: string) => `${date}T19:00:00.000Z`;
  for (const s of sessions) {
    if (!s.date || s.date > today) continue;
    if (s.date === today) {
      if (s.action_id === guitarA.id) {
        Object.assign(s, { status: 'done', actual_minutes: 32, logged_at: new Date().toISOString() });
      }
      continue;
    }
    const pattern = patterns[s.action_id ?? ''] ?? ['done'];
    const n = counters[s.action_id ?? ''] ?? 0;
    counters[s.action_id ?? ''] = n + 1;
    const status: SessionStatus = pattern[n % pattern.length]!;
    s.status = status;
    s.logged_at = loggedAt(s.date);
    if (status === 'done') {
      s.actual_minutes = s.planned_minutes + ((n % 5) - 2) * 2;
      s.actual_count = s.planned_count;
    } else if (status === 'partial') {
      s.actual_count = 2;
      s.actual_minutes = 30;
    } else if (status === 'minimum') {
      s.actual_minutes = 5;
    } else {
      s.obstacles = [n % 3 === 0 ? 'Schedule' : 'Energy'];
    }
  }
  data.sessions = sessions;

  // Workout sets for finished workouts
  for (const s of sessions.filter((x) => x.action_id === workout.id && x.status === 'done')) {
    for (const [exercise, w, reps] of [
      ['Bench press', 185, 8],
      ['Weighted pull-up', 25, 6],
      ['Incline DB press', 65, 10],
    ] as const) {
      for (let set = 1; set <= 3; set++) {
        data.workoutSets.push({ id: id(), session_id: s.id, exercise, set_no: set, weight: w, reps, done: true });
      }
    }
  }

  // Past weekly reviews: different notes each week, whether the last change stuck, and week-goal results.
  const reviewNotes = [
    { went: 'Showed up for every workout.', got: 'Late nights made mornings hard.', change: 'Lights out by 11 on weeknights.' },
    { went: 'Kept JHU study going every weekday.', got: 'Evenings after study were too tired for guitar.', change: 'Guitar in the morning, before email.' },
    { went: 'Meal prep on Sunday made the eating window easy.', got: 'Tuesday stretching keeps getting skipped.', change: 'Stretch right after the workout, not later.' },
  ];
  const kept = ['yes', 'partly', 'no'] as const;
  let n = 0;
  for (let monday = weekStart(start); addDays(monday, 6) < today; monday = addDays(monday, 7), n++) {
    const inWeek = sessions.filter((s) => s.week_start === monday);
    const note = reviewNotes[n % reviewNotes.length]!;
    data.reviews.push({
      id: id(),
      kind: 'weekly',
      period_start: monday,
      period_end: addDays(monday, 6),
      status: 'done',
      went_well: note.went,
      got_in_way: note.got,
      change_next: note.change,
      obstacles: ['Energy'],
      actions_done: inWeek.filter((s) => s.status === 'done' || s.status === 'minimum').length,
      actions_planned: inWeek.length,
      completed_at: `${addDays(monday, 6)}T18:00:00.000Z`,
      commitment_kept: n === 0 ? null : kept[(n - 1) % kept.length]!,
      goal_results: [
        { goal_id: weight.id, level: 'week', step_id: null, note: '', result: 'hit' },
        { goal_id: strength.id, level: 'week', step_id: null, note: '', result: 'hit' },
        { goal_id: guitar.id, level: 'week', step_id: null, note: '', result: n % 2 ? 'partly' : 'missed' },
        { goal_id: splits.id, level: 'week', step_id: null, note: '', result: 'missed' },
        { goal_id: career.id, level: 'week', step_id: null, note: '', result: n % 2 ? 'hit' : 'partly' },
        { goal_id: jhu.id, level: 'week', step_id: null, note: '', result: 'hit' },
      ],
      goal_decisions: [],
      carry_forward: '',
      minutes_planned: 0,
      minutes_done: 0,
    });
  }
  // ---- Goal chains: each goal's current 3-month, month and week goal ----
  const chainNotes: [Goal, string, string, string][] = [
    [weight, 'Eating window 12–8, protein first, weigh in every morning', 'Lock in the eating window; no weekday drinks', 'Eating window every day, two meal-prep Sundays'],
    [strength, 'Bench 205 × 5, pull-ups +35 × 5, arm +0.5 in', 'Five sessions a week; learn the push/pull/legs split', 'All five workouts, add 5 lb to bench'],
    [guitar, 'Record song 1 start to finish', 'Clean G–C–D–Em changes at 60 bpm', 'G–C–D changes at 60 bpm; 5 minutes is enough on hard days'],
    [splits, '6 in from the floor', '10 in from the floor, stretch after every workout', 'Stretch after every workout, measure on Sunday'],
    [career, '10+ interviews, 2 final rounds', 'Resume and LinkedIn rewritten for AI product roles; 60 applications', '15 tailored applications and one coffee chat'],
    [jhu, 'Modules 1–6 passed', 'Modules 1–2 passed', 'Module 2 quiz done by Sunday'],
  ];
  for (const [g, quarter, month, week] of chainNotes) {
    Object.assign(data, withOps(data, opsStartChain(data, g, plan, today, { quarter, month, week })));
  }
  Object.assign(data, withOps(data, opsStartChain(data, aigp, plan2, plan2.start_date, { quarter: 'Pass the AIGP exam', month: 'Read the body of knowledge, domains I–II', week: '' })));
  const weekOf = (g: Goal) => chainFor(data, g, plan, today).week.step!;
  const guitarWeek = weekOf(guitar);
  const within = (d: string, w: { end_date: string }) => (d > w.end_date ? w.end_date : d);
  const demoTasks: [Goal, Partial<ReturnType<typeof blankTask>>][] = [
    [guitar, { title: 'Record a baseline video', kind: 'check', minutes: 15, when: 'once', date: within(addDays(today, 2), guitarWeek), cue: 'After dinner, in the music corner' }],
    [weight, { title: 'Meal prep for the week', kind: 'minutes', minutes: 60, when: 'days', days: [7], through: chainFor(data, weight, plan, today).quarter.node.end }],
    [career, { title: 'Coffee chat with a product manager', kind: 'check', minutes: 30, when: 'once', date: within(addDays(today, 3), weekOf(career)) }],
  ];
  for (const [g, patch] of demoTasks) {
    const week = weekOf(g);
    Object.assign(data, withOps(data, opsAddTask(data, g, week, { ...blankTask(week, today), ...patch }, today)));
  }

  // The finished course: its task (archived when the goal was completed) and the sessions done.
  const courseTask = { id: id(), title: 'Course lesson', kind: 'minutes' as const, planned_minutes: 40, planned_count: null, min_label: '', min_minutes: null, min_count: null, priority: false, step_id: null, archived_at: finishedAt };
  data.actions.push(courseTask);
  data.actionGoals.push({ id: id(), action_id: courseTask.id, goal_id: course.id });
  for (let i = 1; i <= 9; i++) {
    const date = addDays(today, -2 - Math.round((i - 1) * 1.5));
    if (date < start) break;
    data.sessions.push({ id: id(), action_id: courseTask.id, week_start: weekStart(date), slot: 900 + i, date, title: courseTask.title, priority: false, planned_minutes: 40, planned_count: null, status: 'done', actual_minutes: 40 + (i % 3) * 5, actual_count: null, note: '', obstacles: [], origin: 'scheduled', source: 'manual', moved_from: null, logged_at: `${date}T20:00:00.000Z` });
  }

  // The goal backlog: two ideas selected for the next commitment, the rest waiting in order.
  const ideas: [string, string, string, 'selected' | 'backlog', number][] = [
    ['Run a half marathon', 'Builds on the cardio from the weight goal.', 'Finish a half marathon in under 2 hours', 'selected', 40],
    ['Pass the PMP exam', 'Prerequisites are done; the exam is what is left.', 'PMP passed', 'selected', 25],
    ['Build an AI side project end to end', 'Ship something small with an agent and evals.', '', 'backlog', 30],
    ['Conversational Spanish', '', '', 'backlog', 12],
    ['Read 12 books', 'One a month, mostly product and history.', '12 books read, a note on each', 'backlog', 70],
    ['Cook 30 new recipes', '', '', 'backlog', 5],
  ];
  data.ideas = ideas.map(([title, note, done_means, status, age], i) => ({
    id: id(),
    title,
    note,
    done_means,
    status,
    rank: i + 1,
    goal_id: null,
    created_at: `${addDays(today, -age)}T12:00:00.000Z`,
    selected_at: status === 'selected' ? `${addDays(today, -3)}T12:00:00.000Z` : null,
    started_at: null,
  }));
  return data;
}
