# Six Months

A personal web app for a six-month plan: goals at the top, today's list at the bottom, and an honest "am I on track?" in between. Built with React + TypeScript on a free Supabase database. Manual entry only (no Garmin or Withings).

## What's in it

Three places, one job each: **Today** to do, **Goals** to see and shape, **Review** to reflect.

- **Today** (opens here): this week's days, a big done count, a one-line coach note, and one list of task cards (to do first, then logged). Tap the round button on a card to check it off (with Undo), tap the card for the log sheet (done, partial, minimum kept, skip, obstacles, minutes spent, move to another day), or swipe left on a phone to finish it.
  - **Check-in streak** that survives real life: logging any one thing counts, 2 freezes cover missed days, every 7 check-ins earns a freeze back, and a missed day can be earned back by logging 2 things the next day ("never miss twice").
  - **Morning plan** (before noon): yesterday's leftovers and a capacity check, with "move to tomorrow". **Evening wrap-up** (after 6 pm): tick what you did, roll the rest to tomorrow.
  - **Quick add** in plain words: "guitar 20m mon wed fri #guitar", "call mom tomorrow !", "stretch 10m daily".
- **Goals**: where you are in the plan (day, timeline, 3-month checkpoint), a setup checklist for new plans, **Needs attention** (goals to catch up on, unset week/month goals, overdue milestones, stale weigh-ins), each goal with real numbers and this week's goal, and what's coming up.
- **One page per goal**: the goal chain, then this week's daily tasks.
  - **The chain**: the 6-month goal, plus *one* current 3-month goal, *one* month goal and *one* week goal. Only the current period is shown and stored; when a month or week ends, you set the next one (on the goal page, or in the weekly review). Number goals suggest each target from your path.
  - **Catch-up math** next to anything behind: "2 extra a week for the next 2 weeks catches you up", "1.3 lb a week reaches 207.8 by Nov 1".
  - **Daily tasks**: set days, times a week, or one day; for this week, the month, 3 months, the plan or no end date; with an optional "after ___, at ___" cue that shows on Today.
  - Why it matters, the path chart, milestones, measurements and change history.
- **Review**: one flow for every review, each with its own last step.
  - **Weekly** (opens Saturday): look back (did last week's planned change happen, hit / partly / missed for each week goal, tasks and time done, recent weeks chart, measurements), reflect (patterns such as your most-missed weekday and top obstacle, past wins, what went well, what got in the way, what to change), plan next week (next week's goals, a time check against what you've actually been doing, move any task to any day or take it out).
  - **Suggested changes**: pause a task nothing happened on for 3 weeks, move a weekday that keeps getting missed, lower or raise how often, or add a minimum version.
  - **Month**: the month goals, then set next month's goals. **3-month checkpoint**: keep, adjust (new target and redrawn path) or drop each goal, then set the next 3 months. **Retrospective**: what worked, what didn't, what carries over, then start the next plan with the goals you carry. A missed review stays open until the next one of its kind opens.
  - Goals has three views, left to right: **Backlog**, **Goals** and **Completed** (press B for the backlog). The backlog is Kanban style: write an idea in a line, order it by importance, and pull the top ideas into **Selected for next commitment** (limit 3).
  - Every move is yours: nothing changes column because you filled something in. An idea with *why it matters* and *what done looks like* is **ready**; press **Select**, or drag the card into Selected (press and hold on a phone), and a sheet shows its why before you move it. Selected cards have **← Back to backlog** (or drag them back). A selected idea gets **Prepare**: its timing, what done looks like, its 3-month, month and first-week goals, and a daily task, saved on the idea. **Commit** makes it a goal.
  - Timing: a goal can **join a batch** (a shared window with shared checkpoints; joining part-way through means less than six months, which is fine) or run on **its own clock** (3 or 6 months starting the day you commit, independent of any batch). The Goals page groups goals by batch, with own-clock goals listed together, each with its own day count. The weekly review covers every goal; month and 3-month reviews belong to each batch or own clock.
  - New goals always start in the backlog: the Goals page has an "add a goal idea" box, and creating a plan takes you to the backlog.
  - Mark a goal complete from its page (with a note on how it ended) or rate it Achieved in the retrospective; it moves to Completed with what it took, and can be reopened.
  - The Review tab shows the weekly review (with an honest time estimate) or, once done, next week at a glance; the change you committed to (also on Today, with an On it / Slipping check); a goals × weeks scorecard with week-goal results; insights with fixes (such as moving tasks off a weekday that keeps getting missed) and where your time went; the changes you've tried and whether they stuck; the next review; and past reviews.
  - A plan that starts Friday to Sunday folds its first few days into week 2 for review counts, averages and trends.
- **Connected goals and shared tasks**: goals that work together (say *Work out* and *Lose weight*) can be connected by hand from either goal page (**Connected goals → Connect a goal**, with an optional note), and they can share daily tasks. A shared task is one task: it shows once on Today with a dot for each goal, logging it once counts for every goal it supports, and its photos appear in each goal's gallery.
  - In a task's editor, **Supports** lists your goals as chips; turn on every goal the task serves. A shared task's editor says which other goals a change affects, and offers **Remove from this goal** (it keeps running for the others) or **Stop everywhere**.
  - **New task** on a goal page starts with **Or use one you already have**: tasks your other goals already run (connected goals first). Typing a title that matches one ("gym" → *Gym on Work out*) offers **Use it** instead of making a duplicate. Any task still running counts, including ones that end with their week.
  - **Connect a goal** goes on to **Share tasks between them**: pick tasks from either goal to count for both. **Share a task from …** on a connected goal does the same later.
  - In the log sheet, **Counts for: Work out + Lose weight · Change** shows and changes which goals a task counts for, right from Today.
  - Goals that share a task count as connected even without a hand-made link.
  - Connected goals sit next to each other in the weekly review and the scorecard, labelled with what they share. Time and task totals count a shared task once; each goal's own results count it for that goal.
  - **Prepare** in the backlog can connect the new goal to existing goals and pick their tasks to share; a shared task counts as the daily task needed to commit.
- **Measure tasks** ("Log a number", e.g. a daily weigh-in): checking it off asks for the number, pre-filled with the last reading, and saves it as that day's reading, so every goal tracking that measurement (its path chart and ahead/behind) updates. Pick an existing measurement or create one in the task editor.
- **Photo tasks** (e.g. a daily body photo): checking it off opens the camera or your photos, saves the photo to that day and marks it done. Tap the card instead to log it without a photo.
- **Photos and files on any task**: in the log sheet, **Add a photo or file** (camera, photo library or any file type, up to 50 MB each). Photos are shrunk to 2048 px before upload. Every file on a goal's tasks shows on the goal page under **Photos and files**, newest first, labelled by day (a daily progress photo becomes a timeline). Files are private: they're stored in your Supabase project's `attachments` bucket, one folder per user, and opened with short-lived links. In demo mode they stay in this browser.
- **Times-a-week tasks** ("5 times a week") show on Today's list once a day, with how many you've done ("2 of 5 this week"); checking one off puts it on today. **A task happens at most once a day**: missed days can't be made up on a single day, so once it's done today it's gone until tomorrow. Moving a task (log sheet, morning plan, evening wrap-up) only offers days that don't already have it; otherwise the choice is to skip.
- **Workouts log like every other task**: check them off, or tap the card for the log sheet (done, partial, minutes, note, photos). There are no exercise, sets or reps screens, and no countdown or focus timer. Workout tasks still feed the workouts-per-week chart on Progress.
- **Reminders** (see below): a morning push and an evening "keep your streak" push when the site is installed on your home screen, or a calendar feed. Open tasks also show in the browser tab title and on the home-screen icon.
- **On a computer**: two-column layouts and keyboard shortcuts (N add, T Today, G Goals, R Review, ← → change day).
- **Settings**: name, time zone, units, appearance (match device, dark, light), reminders, minutes available per weekday, export JSON/CSV, start from scratch.
- **Demo mode** runs entirely in the browser with example data. Works offline: changes queue up and save when the connection returns.

## Run it locally (demo mode, 2 minutes)

Requirements: Node.js 20 or newer.

```bash
npm install
npm run dev
```

Open http://localhost:5173. With no Supabase settings, the app runs in demo mode with a sample plan that started two weeks ago. Settings → Demo lets you reload the example or start empty.

## Connect Supabase (your real data)

1. Create a free project at https://supabase.com.
2. In the dashboard, open **SQL Editor** and run each file in `supabase/migrations/` in order: first `20261016000000_initial_schema.sql`, then `20261019000000_goal_breakdown.sql`, then `20261021000000_reminders_and_cues.sql`, then `20261025000000_review_overhaul.sql`, then `20261026000000_goal_backlog.sql`, then `20261027000000_completed_goals_and_readiness.sql`, then `20261028000000_idea_prep.sql`, then `20261029000000_batches_and_own_clocks.sql`, then `20261030000000_attachments.sql`, then `20261031000000_connected_goals.sql`. (Or with the Supabase CLI: `supabase link` then `supabase db push`.)
3. **Authentication → URL Configuration**: set **Site URL** to where the app runs (`http://localhost:5173` for now) and add your deployed URL under **Redirect URLs** later.
4. **Project Settings → API**: copy the project URL and the `anon` public key.
5. Create `apps/web/.env.local`:

   ```
   VITE_SUPABASE_URL=https://YOUR-PROJECT.supabase.co
   VITE_SUPABASE_ANON_KEY=YOUR-ANON-KEY
   ```

6. Restart `npm run dev`, enter your email, and open the magic link.
7. Once your account exists, turn off new sign-ups: **Authentication → Providers → Email → Allow new users to sign up** (off). Row-level security already limits every row to its owner.

## Deploy (free)

On Vercel (Hobby plan, personal use):

- Import the repository, keep the root directory as the repo root.
- Build command: `npm run build` · Output directory: `apps/web/dist`.
- Add the two `VITE_SUPABASE_…` environment variables.
- Add the deployed URL to Supabase **Redirect URLs**.

Any static host works (Netlify, Cloudflare Pages): the app uses `#/` URLs, so no rewrite rules are needed.

**On your iPhone:** open the deployed URL in Safari → Share → **Add to Home Screen**. It opens full screen like an app.

## Backups and the free plan

- The Supabase free plan has no automatic backups. Use **Settings → Export everything** regularly (JSON, plus CSV for sessions and measurements). The export lists your attachments but doesn't include the files; download those from Supabase → Storage → `attachments`.
- Free storage is 1 GB; a shrunk progress photo is usually 300–600 KB, so a daily photo for six months is well under 150 MB.
- Free projects pause after a week without activity. Daily use keeps it awake; if it pauses, restore it from the Supabase dashboard.

## Project structure

```
six-month-plan/
├── package.json                         npm workspaces + root scripts
├── packages/core/                       pure TypeScript rules, no UI, no database
│   ├── src/dates.ts                     calendar dates, weeks, time zones
│   ├── src/plan.ts                      weeks, months, 3-month checkpoint, suggested path, the current goal chain (chainAt)
│   ├── src/schedule.ts                  schedules → sessions, credit for done/partial/minimum
│   ├── src/pace.ts                      plan vs actual, pace labels, number-goal status
│   ├── src/suggest.ts                   weekly review suggestions
│   ├── src/review.ts                    review tallies, weekly trend, patterns, which reviews are due
│   ├── src/types.ts                     row types shared with the database
│   └── test/core.test.ts                unit tests (npm test)
├── apps/web/                            React app (Vite)
│   ├── src/data/                        model, Supabase + demo backends, store, derived views
│   ├── src/screens/                     one file per screen
│   └── src/components/                  shared UI, weight chart, action form
└── supabase/migrations/                 schema, row-level security, review function, goal breakdown
```

## How "on track" works

Expected by now = what the plan scheduled up to yesterday (today's sessions never count against you until the day is over; finishing them early still helps). Done and minimum-kept sessions count 1; partial counts actual ÷ planned.

| Actual ÷ expected | Label |
| --- | --- |
| 110% or more | Ahead |
| 90–110% | On track |
| Under 90% | Behind, with the gap |

Pace is judged by month (no 4-week blocks). Number goals compare the 7-day average with the path; finish goals compare milestones completed with milestones due. "6 months · goals on pace" is on track when two-thirds or more of goals are on pace. No labels appear during a plan's first week.

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Start the app at http://localhost:5173 |
| `npm test` | Run the core unit tests |
| `npm run typecheck` | Type-check both packages |
| `npm run build` | Type-check and build the web app into `apps/web/dist` |

## Updating an existing database

**From PyCharm (or any terminal) instead of the SQL Editor:** `pip install "psycopg[binary]"`, then `python scripts/run_migration.py` runs the newest migration (or name files: `python scripts/run_migration.py supabase/migrations/20261030000000_attachments.sql`). It asks for the connection string from Supabase → **Connect** → **Session pooler** → URI, with your database password filled in.

After pulling a new version, run any migration in `supabase/migrations/` you haven't run yet (each is safe to run more than once). The review overhaul needs `20261025000000_review_overhaul.sql`; until it's run, the app shows a banner and reviews won't keep the new answers. The goal backlog needs `20261026000000_goal_backlog.sql`, completed goals need `20261027000000_completed_goals_and_readiness.sql`, prepare-and-commit needs `20261028000000_idea_prep.sql`, batches and own clocks need `20261029000000_batches_and_own_clocks.sql`, photos and files on tasks need `20261030000000_attachments.sql`, and connected goals plus measure and photo tasks need `20261031000000_connected_goals.sql`; until they're run, the app shows a banner and those can't be saved.

## Not in this version

Photos and recordings (the private storage bucket is already created), drag-and-drop week planning, AI voice capture, and Garmin/Withings sync.

## Reminders, calendar feed and installing on your phone

The app can remind you each morning ("Today: 3 tasks · Start with …") and, at 9 pm, nudge you if nothing is checked off yet. Reminders come from your free Supabase project every 15 minutes; nothing else needs to run. They work on the deployed (https) site, not on `localhost`.

**1. Update the database.** In Supabase → **SQL Editor**, run `supabase/migrations/20261021000000_reminders_and_cues.sql` (or `supabase db push`).

**2. Make your reminder keys** (once, on your computer):

```bash
npx web-push generate-vapid-keys
```

It prints a **Public Key** and a **Private Key**. Also make up a long random password for the scheduler, e.g. `openssl rand -hex 32`; this is your `CRON_SECRET`.

**3. Give the web app the public key.** Add to `apps/web/.env.local` **and** to your hosting environment variables (Vercel → Project → Settings → Environment Variables), then redeploy:

```
VITE_VAPID_PUBLIC_KEY=YOUR-PUBLIC-KEY
```

**4. Deploy the two server functions** with the Supabase CLI (`npx supabase login`, then `npx supabase link` in the repo folder):

```bash
supabase secrets set VAPID_PUBLIC_KEY=YOUR-PUBLIC-KEY VAPID_PRIVATE_KEY=YOUR-PRIVATE-KEY VAPID_SUBJECT=mailto:you@example.com CRON_SECRET=YOUR-CRON-SECRET
supabase functions deploy send-reminders --no-verify-jwt
supabase functions deploy calendar --no-verify-jwt
```

`--no-verify-jwt` is needed because neither caller has a login: `send-reminders` checks your `CRON_SECRET` itself, and `calendar` checks the secret token in its link. Optional: `supabase secrets set APP_URL=https://your-app.vercel.app` adds a link back to the app on each calendar event.

**5. Turn on the 15-minute schedule.** Open `supabase/cron.sql`, replace `YOUR-PROJECT-REF` and `YOUR-CRON-SECRET`, and run it in the SQL Editor. To check it's working: `select * from net._http_response order by created desc limit 5;` should show status 200.

**6. Install the app and turn reminders on.**

- **iPhone (iOS 16.4 or newer):** open the site in **Safari** → **Share** → **Add to Home Screen**. Open it **from the Home Screen icon**, then Settings → Reminders → **Enable** and tap **Allow**. (iPhone only allows web reminders for apps added to the Home Screen.)
- **Android (Chrome):** open the site → menu **⋮** → **Install app** (or **Add to Home screen**). Then Settings → Reminders → **Enable**.
- **Computer:** Chrome, Edge, Firefox and Safari can all show reminders straight from the website.

Each device you enable gets its own reminders; **Turn off** only affects that device. The morning time and the 9 pm "streak saver" are in Settings → Reminders and use your time zone.

**Calendar feed (no push needed).** Settings → Reminders shows a private calendar link. **Add to calendar** opens it in Apple Calendar; for Google Calendar use **Other calendars → + → From URL** and paste the copied link. You get a 30-minute "Check in · N tasks" event each day at your morning time for the next two weeks, with an alert and the day's task list. Calendars refresh subscribed feeds on their own schedule (Google can take several hours). Anyone with the link can see your task titles, so keep it private.

**Troubleshooting.** "Notifications are blocked": allow notifications for the site (iPhone: Settings → Notifications → Six Months). No reminder arriving: check step 5's query, and that your time zone in Settings is right. After changing the VAPID keys, turn reminders off and on again on each device.
