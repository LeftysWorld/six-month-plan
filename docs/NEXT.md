# What's next: the cuts that need a decision

The `review/fix-everything` branch fixes every bug found in the October 2026 review, removes the
stranded code, restructures Today around the list, and adds the missing *Then vs now* page. It does
**not** change the data model, because the changes below delete concepts you have data in. They are
the right next step; they need you to say yes first.

## 1. One way to say when a goal runs

Today a goal's dates come from four places: its season (`plans` with `solo=false`), its own clock
(`plans` with `solo=true`), its own `start_date` / `target_date`, and `after_goal_id`. Most of the
review-model bugs (shared reviews across own clocks, stale checkpoints after a move, pace judged
from the wrong start) came from here.

Proposal: a goal has a `start` and an `end`, full stop. The **season** is just the review calendar
(month, 3-month, retrospective) and every goal is reviewed on it. Delete `plans.solo`, the
`plan_goals` join, `after_goal_id`, and the Move-to sheet. "Starts after X" becomes a one-time
helper that sets `start = X.end + 1`.

Migration: for each own clock, copy its start/end onto its goal, link the goal to the season that
contains most of it, archive the clock. Roughly 400 lines removed (`move.ts`, `MoveSheet`, half of
`season.ts`, batch menus on the Goals page).

## 2. One decomposition vocabulary

Week / month / 3-month `plan_steps`, `milestones` ("dates to hit"), group `outcome`, and the
`goal_ideas.prep` copy of the first three all describe "what should be true by when".

Proposal: keep **this week's goal** (one line, set in the weekly review) and **milestones**. Drop
month and 3-month notes (they are rarely set, the app nags about them, and a move drops them),
group outcomes, and Prepare's copy. Month and 3-month reviews then ask "are the milestones on
pace?" instead of "did you write a month goal?".

## 3. A plain backlog

Four columns, a WIP limit of 3, a readiness rule, rank math and a Prepare → Commit ceremony for a
person who will commit about six goals in six months.

Proposal: one ordered list. "Make it a goal" opens goal creation directly. `goal_ideas` keeps
`title`, `note`, `done_means`, `rank`, `status in (idea, started, discarded)`.

## 4. A two-minute weekly review

The weekly review is three steps, suggestions, a time-fit and placements. Proposal: hit / partly /
missed per goal, one change for next week, Done. Suggestions and the next-week planner move behind
"Plan next week in detail".

## 5. Smaller things worth doing

- `week_plans` is written and never read: drop the table and the RPC branch.
- `plans.block_days` is always 28 and contradicts the cascade months: drop it and spread path points
  on month ends.
- Reviews snapshot `actions_planned` on Saturday excluding Sat/Sun (`core/review.ts:55`); the
  scorecard recomputes live and disagrees with the stored row. Snapshot the full week.
- `pace.ts inPeriod` and `review.ts sessionsInPeriod` count a straddling week's tray differently.
- Morning/evening dismissals, review drafts and the midweek check are per device
  (`localStorage`). A `device_state` jsonb column on `profiles` would sync them.
- Multi-tab: two tabs with pending changes overwrite each other's outbox. Use `BroadcastChannel`
  or a tab id in the key.

## Verification notes for this branch

The branch was built in a container that could not reach npm, so `npm run dev` / `vite build`
were not run. Instead:

- `tsc --strict` was run against the whole web app with typed stubs for React, react-dom and
  supabase-js in place of `node_modules`: **0 errors**, including `--noUnusedLocals`.
- `packages/core` tests: **36/36**. `apps/web` tests: **45/45**, run with Node's own TypeScript
  support (the data layer no longer imports React, which is what made that possible).
- The SQL migration was read, not executed. Run it on a copy first if you can:
  `supabase/migrations/20261107000000_review_fixes.sql` dedupes readings and adds a unique index.
- Everything visual (Today's new order, the ritual fold, Then vs now) needs your eyes in a browser.
