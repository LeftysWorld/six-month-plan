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
import { blankTask, opsAddTask, opsCreateBreakdown, stepAt, stepsForGoal, withOps } from './breakdown.ts';

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
  const jhu = goal({ title: 'JHU AI certificate', type: 'finish', color: '#C9A227', why: 'Credibility for AI product roles.', done_means: 'All modules passed' });
  const aigp = goal({ title: 'Pass the AIGP exam', type: 'finish', color: '#C9A227', why: 'AI governance credibility.', done_means: 'Exam passed' });
  data.goals = [weight, strength, guitar, splits, career, jhu, aigp];
  data.planGoals = [
    ...[weight, strength, guitar, splits, career, jhu].map((g) => ({ id: id(), plan_id: plan.id, goal_id: g.id })),
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

  // Past weekly reviews
  for (let monday = weekStart(start); addDays(monday, 6) < today; monday = addDays(monday, 7)) {
    const inWeek = sessions.filter((s) => s.week_start === monday);
    data.reviews.push({
      id: id(),
      kind: 'weekly',
      period_start: monday,
      period_end: addDays(monday, 6),
      status: 'done',
      went_well: 'Kept JHU study going every weekday.',
      got_in_way: 'Evenings after study were too tired for guitar.',
      change_next: 'Guitar in the morning.',
      obstacles: ['Energy'],
      actions_done: inWeek.filter((s) => s.status === 'done' || s.status === 'minimum').length,
      actions_planned: inWeek.length,
      completed_at: `${addDays(monday, 6)}T18:00:00.000Z`,
    });
  }
  // ---- Breakdown: 6 months → 3 months → months → weeks, with notes at each level ----
  for (const [g, p] of [
    [weight, plan],
    [strength, plan],
    [guitar, plan],
    [splits, plan],
    [career, plan],
    [jhu, plan],
    [aigp, plan2],
  ] as const) {
    Object.assign(data, withOps(data, opsCreateBreakdown(data, g, p)));
  }
  const notes: [Goal, string, string][] = [
    [weight, 'First 3 months', 'Eating window 12–8, protein first, weigh in every morning'],
    [weight, 'Month 1', 'Lock in the eating window; no weekday drinks'],
    [strength, 'First 3 months', 'Bench 205 × 5, pull-ups +35 × 5, arm +0.5 in'],
    [strength, 'Last 3 months', 'Bench 225 × 3, arm +1 in, chest +2 in'],
    [strength, 'Month 1', 'Five sessions a week; learn the push/pull/legs split'],
    [guitar, 'First 3 months', 'Record song 1 start to finish'],
    [guitar, 'Last 3 months', 'Three songs, plus improvise over a backing track'],
    [guitar, 'Month 1', 'Clean G–C–D–Em changes at 60 bpm'],
    [guitar, 'Month 2', 'Song 1 verse and chorus, no stopping'],
    [guitar, 'Month 3', 'Record song 1, share it with one person'],
    [splits, 'First 3 months', '6 in from the floor'],
    [splits, 'Month 1', '10 in from the floor, stretch after every workout'],
    [career, 'First 3 months', '10+ interviews, 2 final rounds'],
    [career, 'Month 1', 'Resume and LinkedIn rewritten for AI product roles; 60 applications'],
    [jhu, 'First 3 months', 'Modules 1–6 passed'],
  ];
  for (const [g, title, note] of notes) {
    const step = data.planSteps.find((x) => x.goal_id === g.id && x.title === title);
    if (step) step.target_note = note;
  }
  const weekOf = (g: Goal) => stepAt(stepsForGoal(data, g.id).filter((x) => x.level === 'week'), today)!;
  const guitarWeek = weekOf(guitar);
  guitarWeek.target_note = 'G–C–D changes at 60 bpm; 5 minutes is enough on hard days';
  const within = (d: string, w: { end_date: string }) => (d > w.end_date ? w.end_date : d);
  const demoTasks: [Goal, Partial<ReturnType<typeof blankTask>>][] = [
    [guitar, { title: 'Record a baseline video', kind: 'check', minutes: 15, when: 'once', date: within(addDays(today, 2), guitarWeek) }],
    [weight, { title: 'Meal prep for the week', kind: 'minutes', minutes: 60, when: 'days', days: [7], through: data.planSteps.find((x) => x.goal_id === weight.id && x.title === 'Month 2')?.end_date ?? end }],
    [career, { title: 'Coffee chat with a product manager', kind: 'check', minutes: 30, when: 'once', date: within(addDays(today, 3), weekOf(career)) }],
  ];
  for (const [g, patch] of demoTasks) {
    const week = weekOf(g);
    Object.assign(data, withOps(data, opsAddTask(data, g, week, { ...blankTask(week, today), ...patch }, today)));
  }
  return data;
}
