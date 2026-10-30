# Workout coach: the app side

The workout coach is a weekly AI review of your workouts. It lives in its own repo
(`LeftysWorld/workout-coach`, Python). This app gives it exactly one way in: the `workout-agent`
Edge Function, which can read your workout history and save one coach report. Nothing in your plan
changes until you decide.

## What's in this repo

| Piece | Where | What it does |
|---|---|---|
| Plan history | `supabase/migrations/20261116000000_workout_coach.sql` | `workout_plan_versions`: a database trigger records every version of every workout plan, with the day it took effect. Your current plans become the first versions. |
| Effort, pain and notes | `supabase/migrations/20261124000000_workout_effort.sql`; `apps/web/src/components/Effort.tsx` | Under each exercise: a 1–10 effort slider (by reps left on the last set), "Hurt or felt wrong" and where, a note. Finishing asks for an optional 1–10 for the whole workout. Stored in `workout_exercises` and `sessions.effort`. (The 20261116 migration's `workout_sets.rir`/`pain` columns are no longer written.) |
| The snapshot and the report | `supabase/functions/_shared/workout_history.ts` | One pure function builds the snapshot (JSON, schema `2`) from your data up to a date; another renders it as the report you read. The app and the Edge Function run the same code. |
| Workout report page | `apps/web/src/screens/WorkoutReport.tsx` (`#/workouts/report`, linked from Review and Settings) | **Generate report** (3, 6, 12 or 24 months, as of any date), copy or download it, and the coach's reports with **Applied / Partly / Declined** and a note. |
| The agent's door | `supabase/functions/_shared/workout_agent.ts`, served by the app on Vercel at `/api/workout-agent` (`apps/web/api/workout-agent/[route].js`, bundled from `apps/web/api-src/workout-agent.ts` by `apps/web/scripts/build-agent-api.mjs`) | `GET /history` (JSON or `format=md`) and `POST /reports`. The coach's key (made in Settings, stored only as a hash) or your sign-in. The Supabase Edge Function in `supabase/functions/workout-agent` runs the same code, if you'd rather deploy it there. |
| Coach reports | `workout_reports` table | One per as-of date. A re-run replaces it until you mark it. |
| Body weight and measurements | Settings → Workout coach | On by default: the report includes your weight (weekly averages, 4-week trend) and body measurements you track (waist, chest, arms, shoulders, neck, thighs…: any measurement in inches, cm or % with a body-part name). Flexibility tests and other measurements are never shared. Turn it off and the agent sees none of it. |

## Set it up (no command line)

1. **Run the migrations.** Supabase → SQL Editor: paste and run, in order,
   `supabase/migrations/20261116000000_workout_coach.sql`, `supabase/migrations/20261124000000_workout_effort.sql`
   and `supabase/migrations/20261125000000_coach_key.sql`. Each is safe to run twice. (The editor warns
   about "destructive operations": that's a `drop … if exists` that's immediately recreated; nothing is deleted.)
2. **In the app: Settings → Workout coach → Set up the weekly coach.** It walks through the rest:
   the server's database key (one value pasted into Vercel's Environment Variables, then Redeploy), a
   connection test, the coach's key (one button), and what to paste into the workout-coach repo's
   GitHub secrets, each with a Copy button.

## What the agent can and can't do

- It can **read**: workout tasks (title, days, plan, warm-up notes), their plan history, logged workout
  sessions and sets (weight, reps), each exercise's effort, pain and note, the whole workout's effort,
  body weight and body measurements (unless turned off) and past coach reports with your verdicts.
- It can **write**: one coach report per as-of date, at most 5 saves a day, checked against a schema.
  It can't replace a report you've already marked.
- It **can't** touch anything else: no goals, habits, reviews, photos, other measurements, settings or
  plans. It never sees the Supabase service key; the function keeps it and filters every query to you.

## The snapshot contract (schema 2: what you did, not what was planned)

`meta` (as_of, months, units, fingerprint) · `program` (workouts with days, exercises, estimated minutes,
plan versions, program age, last structural and target change: for writing changes against) ·
`sessions` (logged workouts only, last 8 weeks: sets, the workout's effort, each exercise's effort,
pain, where and note) · `history` (every week in range: best set, estimated max, volume, effort, pain
per exercise) · `metrics` (per exercise, with no plan targets: the last 6 workouts of it as done,
estimated max now vs 3 weeks ago, weeks since a gain, stalled, workouts at the current weight, effort,
pain flags, next step as a % jump; overall: workouts done in 4 weeks, days since the last, every week
of the last 8 with workouts, sets and effort) · `comments` (plan notes, warm-up notes, session and
exercise notes) · `bodyweight` · `body_measurements` · `decisions` (last 12 coach decisions, what you
marked and what your plan history says happened) · `since_last`.

Change the shape only with a new `SCHEMA_VERSION`, and update `coach/snapshot.py` in the agent repo.
