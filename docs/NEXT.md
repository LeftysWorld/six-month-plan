# The model, after the October 2026 review

The `review/fix-everything` branch did two things: it fixed every bug found in the review, and then
it cut the model down to what one person needs. This is what the app is now, and what is still open.

## What a goal is now

- A **goal** has a name, why it matters, what done looks like (a target and date for a number, dates
  to hit for something to finish), its own **start** and **finish**, and belongs to one **season**.
- A **season** is the review calendar: month reviews, a 3-month checkpoint, a retrospective. Every
  goal shares it; each goal keeps its own dates inside it. There are no own clocks, no batches, no
  "starts after": a goal that follows another just starts later.
- A goal is broken down two ways only: **dates to hit** (milestones) and **this week's goal**.
  Month and 3-month notes are gone from the app (rows from before stay in the database as history).
- **Groups** hold goals that work together and share tasks; a group with two or more goals shows one
  bar. Group outcomes are gone.
- The **backlog** is one ordered list. **Make it a goal** opens one page: goal, when, this week,
  first task. No selected column, no limit, no readiness rule, no prepare-then-commit.
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

## Still open

- `week_plans` is written and never read: drop the table and the RPC branch.
- `plans.block_days` is always 28: drop it and spread path points on month ends.
- Reviews snapshot `actions_planned` on Saturday without Sat/Sun (`core/review.ts`); the scorecard
  recomputes live and disagrees with the stored row.
- `pace.ts inPeriod` and `review.ts sessionsInPeriod` count a straddling week's tray differently.
- Morning/evening dismissals, review drafts and the midweek check are per device (`localStorage`).
  A `device_state` jsonb column on `profiles` would sync them.
- Multi-tab: two tabs with pending changes overwrite each other's outbox.
- `plan_steps` month/quarter rows and `plans.solo` could be dropped in a later migration once you're
  sure you won't want to look at them.

## How this branch was verified

Built in a container that could not reach npm, so `npm run dev` / `vite build` were not run here:

- `tsc --strict --noUnusedLocals` over the whole web app with typed stubs for React, react-dom and
  supabase-js in place of `node_modules`: **0 errors**.
- `packages/core` tests **34/34**; `apps/web` tests **51/51**, run with Node's own TypeScript support.
- SQL migrations were read, not executed. Run them on a copy if you can.
- Everything visual needs your eyes in a browser: Today's order, the flat backlog, Make a goal, the
  one-page reviews, Then vs now, Paths.
