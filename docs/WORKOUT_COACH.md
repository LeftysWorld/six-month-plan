# Workout coach: the app side

The workout coach is a weekly AI review of your workouts. It lives in its own repo
(`LeftysWorld/workout-coach`, Python). This app gives it exactly one way in: the `workout-agent`
Edge Function, which can read your workout history and save one coach report. Nothing in your plan
changes until you decide.

## What's in this repo

| Piece | Where | What it does |
|---|---|---|
| Plan history | `supabase/migrations/20261116000000_workout_coach.sql` | `workout_plan_versions`: a database trigger records every version of every workout plan, with the day it took effect. Your current plans become the first versions. |
| Effort and pain | same migration; `apps/web/src/components/Workout.tsx` | After ticking a set, one optional tap: "More reps in the tank? 0 · 1 · 2 · 3+". Per exercise: "This hurt or felt wrong". Stored on `workout_sets.rir` and `workout_sets.pain`. |
| The snapshot and the report | `supabase/functions/_shared/workout_history.ts` | One pure function builds the snapshot (JSON, schema `1`) from your data up to a date; another renders it as the report you read. The app and the Edge Function run the same code. |
| Workout report page | `apps/web/src/screens/WorkoutReport.tsx` (`#/workouts/report`, linked from Review and Settings) | **Generate report** (3, 6, 12 or 24 months, as of any date), copy or download it, and the coach's reports with **Applied / Partly / Declined** and a note. |
| The agent's door | `supabase/functions/workout-agent/index.ts` | `GET /history` (JSON or `format=md`) and `POST /reports`. Agent key or your sign-in. |
| Coach reports | `workout_reports` table | One per as-of date. A re-run replaces it until you mark it. |
| Body weight | Settings → Workout coach | On by default: the report includes weekly averages and the 4-week trend of your weight. Turn it off and the agent never sees it. |

## Set it up

1. **Run the migration.** Supabase → SQL Editor: paste `supabase/migrations/20261116000000_workout_coach.sql`
   and run it (the app's banner names it too). Safe to run twice.
2. **Deploy the function** (needs the Supabase CLI once: `npm i -g supabase`, then `supabase login` and
   `supabase link --project-ref YOUR-REF`):

   ```bash
   supabase functions deploy workout-agent --no-verify-jwt
   supabase secrets set WORKOUT_AGENT_KEY="$(openssl rand -hex 32)" WORKOUT_AGENT_USER_ID=YOUR-USER-UUID
   ```

   Your user UUID is under Authentication → Users. Keep the key: the agent repo needs it as a GitHub
   secret. `--no-verify-jwt` is needed because the agent's key isn't a Supabase sign-in; the function
   checks the key (or your sign-in) itself.
3. **Check it** (replace the URL and key):

   ```bash
   curl -s "https://YOUR-REF.supabase.co/functions/v1/workout-agent/history?format=md" -H "x-agent-key: YOUR-KEY" | head -30
   ```

## What the agent can and can't do

- It can **read**: workout tasks (title, days, plan, warm-up notes), their plan history, logged workout
  sessions and sets (weight, reps, effort, pain, notes), weekly body weight (unless turned off) and past
  coach reports with your verdicts.
- It can **write**: one coach report per as-of date, at most 5 saves a day, checked against a schema.
  It can't replace a report you've already marked.
- It **can't** touch anything else: no goals, habits, reviews, photos, other measurements, settings or
  plans. It never sees the Supabase service key; the function keeps it and filters every query to you.

## The snapshot contract (schema 1)

`meta` (as_of, months, units, fingerprint) · `program` (workouts with days, exercises, estimated minutes,
plan versions, program age, last structural and target change) · `sessions` (last 8 weeks, set by set) ·
`history` (every week in range: best set, estimated max, volume, effort, pain per exercise) · `metrics`
(per exercise: estimated max now vs 3 weeks ago, weeks since a gain, stalled, top-of-range streak, effort,
pain flags, next step as a % jump; overall attendance, set completion, minutes, weekly sets) ·
`comments` (plan notes, warm-up notes, session notes) · `bodyweight` · `decisions` (last 12 coach
decisions, what you marked and what your plan history says happened) · `since_last`.

Change the shape only with a new `SCHEMA_VERSION`, and update `coach/snapshot.py` in the agent repo.
