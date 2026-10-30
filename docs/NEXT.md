# The model, after the October 2026 review

The `review/fix-everything` branch did two things: it fixed every bug found in the review, and then
it cut the model down to what one person needs. This is what the app is now, and what is still open.

## What a goal is now

- A **goal** has a name, why it matters, what done looks like (a target and date for a number, dates
  to hit for something to finish), its own **start** and **finish**, and belongs to one **season**.
- A **season** is the review calendar: month reviews, a 3-month checkpoint, a retrospective. Every
  goal shares it; each goal keeps its own dates inside it. There are no own clocks, no batches, no
  "starts after": a goal that follows another just starts later.
- A goal is broken down by **Plan this goal** (`screens/PlanGoal.tsx`, `data/ladder.ts`,
  `packages/core/src/ladder.ts`): 6 months (the goal) → 3 months → this month → this week → the
  week's tasks, top down. Each level is up to three `plan_steps` rows for the period (`slot` 0–2),
  each pointing at a target above it (`parent_id`); a task points at the week target it serves
  (`actions.step_id`). `goals.pace_curve` shapes the suggestions for a running total. **Dates to
  hit** (milestones) still sit alongside. The October cut had dropped the month and 3-month levels;
  this brings them back as the spine of the app, kept light: you plan all five once, then Saturday
  redoes the week and its tasks, and each month review the month.
- **Groups** hold goals that work together and share tasks; a group with two or more goals shows one
  bar. Group outcomes are gone.
- The **backlog**: a title is enough to add an idea; **Select for next** needs why and done means.
  **Make it a goal** runs Plan this goal on the idea (`IdeaLadder` in `screens/PlanGoal.tsx`, step 1 in
  `screens/PlanWhat.tsx`, data in `data/ideaPlan.ts`) and is gated: the goal is made only once the
  6-month, 3-month and month levels are set. The plan screens read a preview (the data as it will be
  once the goal is made, built in memory from the idea's `plan_draft`), so suggestions and hours work
  before the goal exists. The old one-page Make a goal form (`GoalNew.tsx`) is gone.
- **Odyssey paths** sit above the seasons: three five-year lives, each with a headline, a line per
  year, four gauges and open questions. Goals and ideas point at a path; a path's progress is rolled
  up from its goals. The 3-month checkpoint re-rates the gauges; the retrospective asks what the
  season taught you about each path.
- The **weekly review** is two minutes: did last week's change happen, hit / partly / missed per
  goal, readings due, one change. "Plan next week in detail" is folded underneath.

## Migrations

Run in order; each is safe to run twice:

- `20261107000000_review_fixes.sql` — reviews carry their window, one reading per day,
  `goals.reflection` for Then vs now.
- `20261108000000_one_window_per_goal.sql` — folds own clocks and "starts after" into each goal's
  start/finish and archives the clocks; flattens the backlog (selected → backlog, drops `prep`);
  drops `goal_groups.outcome`. **This one drops columns.** Take a backup (Settings → Export) first.
- `20261109000000_odyssey_paths.sql` — the `paths` table, `goals.path_id`, `goal_ideas.path_id`.
- `20261112000000_tallies.sql` — `milestones.count_action_id`: a date to hit that is a running total of a
  count task's logs (`packages/core/src/tally.ts`, `apps/web/src/data/tally.ts`).
- `20261113000000_goal_order.sql` — `goals.sort_order`, `goal_groups.sort_order`: hand order on the Goals page
  (`apps/web/src/data/order.ts`).
- `20261114000000_backlog_selected.sql` — `goal_ideas.shortlisted_at`: the Selected for next bucket (status stays
  'backlog'; `bucketOf` in core/backlog.ts).
- `20261122000000_plan_ladder.sql` — `plan_steps.slot`, `plan_steps.done_means`, `goals.pace_curve`: Plan this goal
  (up to three targets per level, each with a done-means line; the pace for suggestions).
- `20261123000000_idea_plans.sql` — `goal_ideas.plan_draft`: an idea's plan before it's a goal.

## Still open

- `week_plans` is written and never read: drop the table and the RPC branch.
- `plans.block_days` is always 28: drop it and spread path points on month ends.
- Reviews snapshot `actions_planned` on Saturday without Sat/Sun (`core/review.ts`); the scorecard
  recomputes live and disagrees with the stored row.
- `pace.ts inPeriod` and `review.ts sessionsInPeriod` count a straddling week's tray differently.
- Morning/evening dismissals, review drafts and the midweek check are per device (`localStorage`).
  A `device_state` jsonb column on `profiles` would sync them.
- Multi-tab: two tabs with pending changes overwrite each other's outbox.
- `plans.solo` could be dropped in a later migration. (`plan_steps` month/quarter rows are in use again.)
- Plan this goal: the task drafts for a week live on the device until **Start the plan**; a
  `device_state` column would carry them between phone and computer. Moving a task that's already
  running to another day is done on Today (the planner moves only the tasks you're planning).

## How this branch was verified

Built in a container that could not reach npm, so `npm run dev` / `vite build` were not run here:

- `tsc --strict --noUnusedLocals` over the whole web app with typed stubs for React, react-dom and
  supabase-js in place of `node_modules`: **0 errors**.
- `packages/core` tests **34/34**; `apps/web` tests **51/51**, run with Node's own TypeScript support.
- SQL migrations were read, not executed. Run them on a copy if you can.
- Everything visual needs your eyes in a browser: Today's order, the flat backlog, Make a goal, the
  one-page reviews, Then vs now, Paths.
