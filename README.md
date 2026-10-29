# Six Months

A personal web app for a six-month plan: goals at the top, today's list at the bottom, and an honest "am I on track?" in between. Built with React + TypeScript on a free Supabase database. Manual entry only (no Garmin or Withings).

## What's in it

Six tabs, one job each: **Today** to do, **Goals** to see and shape, **Roadmap** to see and move dates, **Calendar** to see what's on which day, **Habits** for things you keep doing without a goal, **Review** to reflect. On a phone the tab bar shows icons only, with the current tab highlighted.

- **Today** (opens here): the list first. The title and your streak, this week's days, one line of numbers (done of total, time left), then the task cards (to do first, then logged) and **+ Add a task**. Tap the round button on a card to check it off (with Undo), tap the card for the log sheet (done, partial, minimum kept, skip, obstacles, minutes spent, move to another day), or swipe left on a phone to finish it. Everything that supports the list — the morning or evening check (folded to one line), today's numbers, dates on this day, habits, this week's commitment — comes after it. The dock's **Add or log** button adds to the day you're looking at.
  - **By Sunday you'll have** (on today): every goal's week goal in one card, with the goal it belongs to, where it stands (a running total says what this week added and what's needed to stay on pace), a tick to mark it done, and **+ Set this week's goal** for any goal without one; a group's one-line week goal sits above its goals. Ticked here, judged in Saturday's review.
  - **Check-in streak** that survives real life: logging any one thing counts, 2 freezes cover missed days, every 7 check-ins earns a freeze back, and a missed day can be earned back by logging 2 things the next day ("never miss twice").
  - **Morning plan** (before noon, in your time zone): yesterday's leftovers and a capacity check, with "move to tomorrow". **Evening wrap-up** (after 6 pm): tick what you did, roll the rest to tomorrow. Each sits folded to one line until you tap it. Every move has Undo.
  - **+ Add a task** (under the task cards, on today or a coming day), in two kinds:
    - **General**: type what it is, pick a goal or leave it as **No goal**, and about how long. With no goal it's a one-off for that day.
    - **Workout**: do one of your workouts that day (one tap), or make a new one: a name, its exercises (sets, rep range, weight, rest, note, or paste a plan), a goal or none, and about how long. It logs like any workout, set by set.
    - Anything added with no goal can be linked later: tap it, then **Link to a goal** (it keeps its log; the message has Undo).
  - **Quick add** in plain words: "guitar 20m mon wed fri #guitar", "call mom tomorrow !", "stretch 10m daily".
- **Goals**: where you are in the plan (day, timeline, 3-month checkpoint), a setup checklist for new plans, goals that need you first with **why** in a line (catch-up math, an unset week/month goal, a passed date, a stale weigh-in), each goal with real numbers and this week's goal, and what's coming up.
- **One page per goal**, in order of how often you need it:
  - **Header**: the title, one line with its season, group and status, and *why it matters* as a quote you can tap to edit.
  - **Progress**: the only place the goal's numbers appear. Where it is, a track across the whole season with a tick at even pace, what done is and when, and the one next step as a button (**Log today's weight**, **Add 1 this week**, **Set this week's goal**, or the next milestone). Number goals open their trend chart and recent readings here, and log today's reading here. The chart zooms like a scale app's: **1W / 1M / 3M / All**, pinch or double-tap to zoom in, drag to move along the dates, tap a day for its reading, 7-day average and plan; the scale fits what's in view, so a week of weigh-ins fills the chart and every day's change shows (a goal's page opens on the last month) (a "Log a number" task for it is checked off too).
  - **This week**: the week goal (tap to edit), then each daily task with a Monday-to-Sunday strip: done, partly done, missed (amber), skipped and planned days. Tap a day to log it or change its log; tap the task to edit it. **+ Add a task** offers the tasks you already have; **Copy last week's tasks** when there are some.
  - **The plan**: this week's goal, the next dates to hit, and the season's finish, soonest first. Tap this week or the season to edit it. (Month and 3-month goals are gone: a goal is what done looks like, the dates on the way, and this week.)
  - **Progress record** (milestones, photos and files, other measurements), the **group**, and **Manage goal** (complete, move, change history, archive), folded away.
  - **Running totals**: a milestone can count itself up from a **Count** task — *250 applications by Dec 15*, counted from *Apply to 25 jobs*. Every log adds its count (a partial adds what you logged); the milestone shows `60 of 250 · 190 to go · 9 a day for 22 days` with a bar and an even-pace tick, the Today card shows the total under the task, and the date ticks itself off the day the total gets there. Same thing for 500 miles, 150 problems, 40 outreach messages. Set it in the milestone's sheet (**Count it up from a task** → **Total to reach**); a milestone named with a number ("250 applications") on a goal with exactly one Count task links itself. The goal's running total then stands in for "x of y milestones" everywhere the goal is summed up: the Goals page row, the group bar, **By … you'll have**, the Progress card, the plan, and **This week** (`60 of 250 · +25 this week · 9/day to land Nov 13`). Needs `supabase/migrations/20261112000000_tallies.sql`.
  - **Remove** on a task (tap it, then Remove) takes it out of this week; a task you've already logged keeps its logged days and stops from today, one you never logged is gone entirely. On a computer these sit in a column on the right.
  - **Catch-up math** next to anything behind: "2 extra a week for the next 2 weeks catches you up", "1.3 lb a week reaches 207.8 by Nov 1".
- **Review**: one page per review.
  - **Weekly** (opens Saturday, about two minutes): did last week's change happen; hit / partly / missed for each goal's week goal, with its pace; any readings due; one change for next week. Save. **Plan next week in detail** is folded underneath when you want it: patterns (most-missed weekday, top obstacle), suggested changes, next week's goal per goal (prefilled with this week's), a time check against what you've actually been doing, and where each task lands.
  - **Suggested changes**: pause a task nothing happened on for 3 weeks, move a weekday that keeps getting missed, lower or raise how often, or add a minimum version.
  - **Month**: how each goal is pacing and the dates it hit, went well / got in the way (optional), one change for next month. **3-month checkpoint**: the same, plus keep, adjust (new target and redrawn path) or drop each goal. **Retrospective**: Then vs now first, then achieved / partly / not for each six-month goal, what worked, what didn't, what carries over, and the next season with the goals you carry. A missed review stays open until the next one of its kind opens.
  - Goals has four views, left to right: **Paths**, **Backlog**, **Goals** and **Completed** (press P for paths, B for the backlog). The backlog has two buckets, **Selected for next** on top. **Backlog**: write an idea in a line, drag it to order it, tap it to add why it matters and what done looks like. **Selected for next**: the few you've refined and mean to start — an idea crosses over (Select, or drag it there) only once it has its why and its done-means; order those by dragging too, and press **Make it a goal** when there's room. **Back to backlog** un-selects. On a goal's page, **Manage goal → Back to the backlog** abandons it: the goal is archived (history kept) and its idea returns to the top of the backlog. Discarded ideas are kept, folded away. Needs `supabase/migrations/20261114000000_backlog_selected.sql`.
  - **Make a goal** is one page: the goal and what done looks like (a target and date for a number, dates to hit for something to finish), why it matters, its season, its own start and finish inside it, this week's goal, and its first daily task (or a task it shares with another goal). With no season running, one starts that day and runs six months.
  - Goals start in the backlog or straight from **Make a goal** on the Goals page.
  - **Archive** a goal from its page (with Undo) to hide it everywhere. Archived goals are listed under **Completed → Archived**, where each one can be **restored** or **deleted for good** (its own tasks, logs, photos, path and milestones go too; tasks it shares with other goals keep running for them).
  - **Moving goals between seasons**: drag a goal, or a whole group by its handle, onto a season's line at the top of the Goals page, use **Add goals** in a season's menu, or **Move to…** on the goal's page. A sheet confirms it. Daily tasks, logs, readings, dates and this week's goal all stay; only the season whose reviews cover it changes.
  - Each goal shows once on the Goals page. Adding an idea with the same name as a goal or a waiting idea says so instead of making a copy.
  - Mark a goal complete from its page (with a note on how it ended) or rate it Achieved in the retrospective; it moves to Completed with what it took, and can be reopened.
  - The Review tab shows the weekly review (with an honest time estimate) or, once done, next week at a glance; the change you committed to (also on Today, with an On it / Slipping check); a goals × weeks scorecard with week-goal results; insights with fixes (such as moving tasks off a weekday that keeps getting missed) and where your time went; the changes you've tried and whether they stuck; the next review; and past reviews.
  - A plan that starts Friday to Sunday folds its first few days into week 2 for review counts, averages and trends.
- **Goals page, by season**: a season header at the top. The season's name and *week 7 of 26 · Building · ends Apr 15*; the season as five **chapters** (Start · Build · Middle ◆ · Push · Finish — the same stretches the coaching lines use), the current one filling with the gradient as it passes; under it the **week ribbon**, one cell per week coloured by its weekly review (all week goals hit / partly / missed, this week outlined, a dot where a month review closed) — hover or tap a week for its week goals and the change you committed to; the chapter start dates; and the **chapter panel**: the stretch you're in, *week 5 of 11 · 3 of 4 on pace*, its line, and what's due before it ends (dates to hit with countdowns or running-total rates, goals finishing, the checkpoint, the retrospective). Tap a chapter or use ‹ › to read a past one (how it went) or a coming one (what it asks); **Back to now** returns. The header folds: the name, chapters and ribbon always show; the fold line ("Build · 4 due in this stretch · 4 of 6 weeks hit") opens the dates, panel and next-season line, and remembers which way you left it on this device. The **Next season** line at the bottom shows its goals or plans it; drag a goal onto the chapters or onto that line to move it between seasons. The pencil opens season settings. The **season card** (side column) is the commitment on one page: each goal with what done means, its why, where it is now, its dates and prizes — copy as text or print. Goals not in a group sit in a **Not in a group** tray at the bottom, styled like a group (its own gradient) and orderable the same way. Groups are trays, each with a gradient of its own (its goals' colours; a one-colour group gets a second hue from its id, the same every visit) as a thin band and a light wash on the head, goals are the white rows inside; drag a goal **above or below** a sibling to order it (in a group the whole row reorders; between loose goals the middle still makes a group), and drag a group by its handle above or below another group. Each row shows where it is and the share done, a 7-day strip (done / partly / missed / due today) and the next date due. Order needs `supabase/migrations/20261113000000_goal_order.sql`.
- **Goals page, by season (layout)**: a horizon across the top shows **this season** and **next season** on one line, with today and each season's 3-month checkpoint (◆); tap either half to show that season (or **Plan next season** to create it). Under it: **On pace**, days to the **checkpoint** and the next **review**, then **By Apr 24 you'll have**, what each goal's done looks like, in one list (early finishers show their date, goals behind say "at risk"). Goals sit in **group cards as rows**: name and status, a track of progress across the whole season with a tick where an even pace would put you, and now → target by date; a group with two or more goals also shows one bar for all of them. On a computer the numbers sit in a column on the right. Tapping a group opens its own page (shared tasks, edit, move, ungroup); a goal's page opens with the same progress track.
- **Roadmap** (its own tab, or press M): every goal of the season on one timeline, from its start to its finish, with today marked.
  - Groups come first: the group's row shows one bar across its goals with a **◆ at each goal's finish** (filled when done). Tap the group's name to fold its goals away. Goals not in a group follow.
  - Each goal's bar runs from its own start to its own finish and shows how much is done; a goal that starts later is drawn from that date.
  - **Change dates right on the roadmap**: drag a bar's ends to move its start or finish, or drag the whole bar to shift both (a tip shows the dates as you drag). Tap a bar (or press Enter on it) for exact dates. Dates stay inside the goal's season, the end you didn't grab holds still, and a goal's dates to hit stay inside the goal's own dates; a number goal's finish follows its path, so only its start moves here. Every change is the goal's own date (its page, pace and reviews follow), is written to its change history, and can be undone from the message.
  - **This season / Next season**, and **Timeline / List** (the same dates as a list, each with a Dates button).
  - The goal page's edit sheet has the same **Starts** date.
  - **Dates inside a goal**: above each bar are the dates you add (milestones: "JHU course starts", "Weigh 200 lb", "Exam day"; filled when done). Below it are your **3-month, month and week goals**, each at the day it's due (bigger square for 3 months, smallest for the week); hover or tap one for what it says, like "207.8 lb · Lock in the eating window".
  - **Add a date right on the roadmap**: **+ Add a date** at the top (pick the goal), **+ Date** on a goal's row, or tap an empty spot on a row (the date you tapped is filled in). **Drag** a date along the row to move it (arrow keys move it a day), or **tap** it to rename it, change its date, mark it done or delete it (each with Undo). A folded group shows its goals' dates on its own row.
  - The **List** view lists each goal's dates as chips under it, with **+ Date**.
  - The same dates show on the **Calendar** and on the goal's page (Progress record → Milestones; tap one there to change it). Every goal can have them, not just finish goals. The group's row also marks where each of its goals starts.
- **Calendar** (its own tab, or press C): a month at a glance with everything that happens on a date. One-day tasks (an exam, a class), one-offs, milestones, goals starting or due on their own dates, goals completed, and the season's start, 3-month checkpoint and end. On a phone each day shows dots; on a computer, short labels.
  - It also shows when each week goal is due (an outlined square).
  - **Tap a day to open it**: the same view as Today, for that date (‹ Calendar goes back to the same month). Its tasks are there to check off or add to, and **On this day** lists its dates: dates to hit (tick them off, tap to change), 3-month/month/week goals due, goals starting or due, season dates, with **+ Date to hit** to add one.
  - **Repeating** shows a count of the goal tasks and habits that repeat on each day, kept off by default so dated things stand out.
- **Habits** (its own tab, or press H): things you keep doing for their own sake, not for a goal, like *Clean house* every day or *Read before bed* 4 times a week.
  - Each habit has a check for today, its **streak** (days, or weeks for times-a-week habits; a skip doesn't break it, and today doesn't until the day is over), its best streak, how often it got done in the last 30 days, and a 15-week grid.
  - **New habit**: set days or times a week, a start date, about how long, an optional last day, and when or where. Tap a habit's name to edit it or **Stop this habit** (its history stays; **Show stopped habits** lists it).
  - Habits also show on **Today** in their own **Habits** section (check them off there), and **All habits** takes you to the tab. They aren't counted in Today's task total.
- **Tasks with dates**: in a goal's task editor,
  - **Starts** lets a repeating task begin later, like coursework that starts the day class begins. Until then the goal's week shows it under **Coming up** with its dates.
  - **Repeat** runs it to the end of the week, month, 3 months or plan, **When the goal is due** (for goals that finish early), **No end date**, or **Until a date I pick…**, like prework that stops the day before class.
  - **One day** tasks can be on any date (**Or any date**), not just this week, for a test or a class. They show on the Calendar.
- **Each goal has its own dates inside its season**: a season is the review calendar (month reviews, a 3-month checkpoint, a retrospective) that every goal shares; a goal's own **Starts** and **Finish by** sit inside it.
  - **Finish by** (in a goal's edit sheet, for goals that aren't numbers): an earlier end than the season's, for a course or an exam that ends sooner. The goal's track and pace run to that date.
  - A goal that follows another (an exam after a course) simply gets a later **Starts** date; until then it shows **Starts Jan 16**, isn't counted as behind, and its tasks begin that day.
  - Finish goals show **At this pace: done Jan 4** under their track, from how fast their milestones get done (the last 4 weeks when two or more were done in them; quiet for the first week and until one is done). **+ Split into steps** on Milestones adds evenly spaced steps ("Module 1 … 7") up to the goal's finish date.
- **Groups and shared tasks**: the Goals page works like a phone home screen. **Drag one goal onto another** (grab the handle, press and hold on a phone, or drag with a mouse) to make a group, then name it (a name is suggested from what the goals are about, like *Body* or *Learning*) and optionally pick tasks to share. Drop a goal on a group to add it; drag it into **Not in a group** to take it out. A goal is in one group at most. A group can hold a single goal: start one from **+ New group** on the *Not in a group* tray, from the goal's handle menu (*New group with just …*), or from **Add to a group** on the goal's page (not offered once it's in one); an empty group goes away. Tap a group's name to open it: rename it, see its goals and shared tasks, share another task, remove a goal or ungroup. Tapping a goal's handle without dragging opens the same choices. Goals not in a group are listed on their own. A shared task is one task: it shows once on Today with a dot for each goal, logging it once counts for every goal it supports, and its photos appear in each goal's gallery.
  - In a task's editor, **Supports** lists your goals as chips; turn on every goal the task serves. A shared task's editor says which other goals a change affects, and offers **Remove from this goal** (it keeps running for the others) or **Stop everywhere**.
  - **New task** on a goal page starts with **Or use one you already have**: tasks your other goals already run (connected goals first). Typing a title that matches one ("gym" → *Gym on Work out*) offers **Use it** instead of making a duplicate. Any task still running counts, including ones that end with their week.
  - Each goal's page shows its group under the title and in a **Group** card (the other goals, their pace, shared tasks, **Add to a group**). Connections made before groups existed become groups automatically the first time the app opens.
  - In the log sheet, **Counts for: Work out + Lose weight · Change** shows and changes which goals a task counts for, right from Today.
  - Goals that share a task count as connected even without a hand-made link.
  - Goals in a group (and goals that share a task) sit next to each other in the weekly review and the scorecard, labelled with what they share. Time and task totals count a shared task once; each goal's own results count it for that goal.
- **Measure tasks** ("Log a number", e.g. a daily weigh-in): checking it off asks for the number, pre-filled with the last reading, and saves it as that day's reading, so every goal tracking that measurement (its path chart and ahead/behind) updates. Pick an existing measurement or create one in the task editor.
- **Photo tasks** (e.g. a daily body photo): checking it off opens the camera or your photos, saves the photo to that day and marks it done. Tap the card instead to log it without a photo.
- **Photos and files on any task**: in the log sheet, **Add a photo or file** (camera, photo library or any file type, up to 50 MB each). Photos are shrunk to 2048 px before upload. Every file on a goal's tasks shows on the goal page under **Photos and files**, newest first, labelled by day (a daily progress photo becomes a timeline). Files are private: they're stored in your Supabase project's `attachments` bucket, one folder per user, and opened with short-lived links. In demo mode they stay in this browser.
- **Times-a-week tasks** ("5 times a week") show on Today's list once a day, with how many you've done ("2 of 5 this week"); checking one off puts it on today. **A task happens at most once a day**: missed days can't be made up on a single day, so once it's done today it's gone until tomorrow. Moving a task (log sheet, morning plan, evening wrap-up) only offers days that don't already have it; otherwise the choice is to skip.
- **Workouts**: a workout with a plan opens the set-by-set log (see *Workout tasks* below); one without a plan logs like any other task. From the set-by-set log, **Skip today, keep the minimum, or log it without sets** opens the general log sheet, and the general sheet links back. Workout tasks feed the workouts-per-week chart on Progress.
- **Stretching** (a task type of its own, laid out like workouts): the task holds the day's plan, a list of holds in order, each with how long, how to do it, contract-relax on push days and a knee note. The log opens one hold at a time with a row per set (one long hold, Left and Right, 3 × 45 s, or counted reps) and last time's times beside them. Tap ▶ and the timer counts the set down at the bottom of the sheet, calls out the contract-relax rounds on push days, beeps, ticks the set, rests or switches sides, and (hands-free) starts the next hold after 20 s to get into position. The screen stays on while it runs. Flag a hold that hurt; run a push day as an easy day when you're sore. Make one with **Task type → Stretching** in a goal's task editor. Needs `supabase/migrations/20261117000000_stretching.sql` and `20261118000000_stretch_sets.sql`.
  - **Settings → Plans → Splits & Backbend Plan** (also offered on Today) applies the plan from Fri Oct 30 in one reviewed step: four goals (front splits both sides, side split, chest to shins, full backbend) in the Body group, five stretching sessions they share (Mon push + hamstrings, Tue easy + backbend, Thu push + folding strength, Fri easy + backbend, Sat push + split strength), the monthly check on the first Monday of each month with the measurements it records on each goal, the old stretching task and the splits-gap measure stopped (history kept), and workouts moved off Wednesday from the current week (Wed → Thu, Thu → Fri, Fri → Sat), keeping one of each workout that week on its new day. Already applied the earlier version (from Nov 2, own group)? The same step updates it. Each goal gets a distance to measure with a tape (hip to floor, crotch to floor, chest to knees, hands to heels in the bridge). Everything is listed before it changes; one Undo puts it all back. The plan's content is in `apps/web/src/data/plans/splitsBackbend.ts`.
- **Reminders** (see below): a morning push and an evening "keep your streak" push when the site is installed on your home screen, or a calendar feed. Open tasks also show in the browser tab title and on the home-screen icon.
- **On a computer**: two-column layouts and keyboard shortcuts (N add, T Today, G Goals, B backlog, P Paths, M Roadmap, C Calendar, H Habits, R Review, ← → change day).
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

1. Create a project at https://supabase.com (or use one you have). Pick a region near you.
2. **SQL Editor → New query**: paste the whole of `supabase/setup.sql` and run it. It is every migration in order and is safe to run again; on a project that already has some, run only the migration files you haven't yet (`supabase/migrations/`, in order). Regenerate it after adding a migration with `bash scripts/build-setup-sql.sh`. (Or with the CLI: `supabase link` then `supabase db push`.)
3. **Storage**: `setup.sql` creates the private `attachments` bucket for photos; check it's there under Storage.
4. **Authentication → URL Configuration**: Site URL `http://localhost:5173` for now; add your deployed URL under Redirect URLs later. **Authentication → Providers → Email**: leave magic links on.
5. **Project Settings → API**: copy the Project URL and the `anon` `public` key (never the `service_role` key — that one is for Edge Functions only).
6. Create `apps/web/.env.local` (git-ignored):

   ```
   VITE_SUPABASE_URL=https://YOUR-PROJECT-REF.supabase.co
   VITE_SUPABASE_ANON_KEY=YOUR-ANON-PUBLIC-KEY
   # optional, for push reminders (see "Reminders" below):
   # VITE_VAPID_PUBLIC_KEY=
   ```

7. Restart `npm run dev`. The app now shows a sign-in screen instead of demo mode: enter your email, open the magic link.
8. Load your data, one of two ways:
   - **In the app**: Settings → Import → pick `my-plan.json` (made by `npx tsx apps/web/scripts/my-plan.ts > my-plan.json`, or any Settings → Export). Import replaces everything in your account.
   - **As SQL**: `npx tsx apps/web/scripts/plan-to-sql.ts --user YOUR-USER-UUID --wipe > my-plan.sql`, then paste `my-plan.sql` into the SQL Editor. Your user UUID is under Authentication → Users. `--wipe` clears your rows first. Photos are not carried this way (there are none in a fresh plan).
9. Once your account exists, turn off new sign-ups: **Authentication → Providers → Email → Allow new users to sign up** (off). Row-level security already limits every row to its owner.

## Deploy (free)

On Vercel (Hobby plan, personal use):

- Import the repository with **Root Directory `apps/web`** (Vercel picks it). Keep "Include files outside the root directory" on: the app imports `packages/core`.
- `apps/web/vercel.json` sets the build, relative to `apps/web`: framework Vite, install `npm install` (npm installs the whole workspace from the repo root), build `npm run build`, output `dist`, plus the cache headers for the service worker. Leave the dashboard's build settings off override, or make them match; the output directory is `dist`, not `apps/web/dist`.
- Environment variables (Production and Preview): `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, and `VITE_VAPID_PUBLIC_KEY` if you use push reminders. They're baked in at build time, so redeploy after changing one.
- In Supabase → Authentication → URL Configuration, set the Site URL to the Vercel URL and add `https://<project>.vercel.app/**` (and `https://<project>-*.vercel.app/**` for preview deploys) to Redirect URLs.
- Optional: `supabase secrets set APP_URL=https://<project>.vercel.app` for the calendar feed's links.

On Netlify: import the repository; `netlify.toml` at the repo root sets the build (`npm run build`, publish `apps/web/dist`, Node 20), so leave the dashboard's build settings alone. Add the two `VITE_SUPABASE_…` variables under Project configuration → Environment variables, then Deploys → Trigger deploy → Clear cache and deploy (variables are baked in at build time). Any other static host works too (Cloudflare Pages): the app uses `#/` URLs, so no rewrite rules are needed.

**On your iPhone:** open the deployed URL in Safari → Share → **Add to Home Screen**. It opens full screen like an app.

## Backups and the free plan

- The Supabase free plan has no automatic backups. Use **Settings → Export everything** regularly (JSON, plus CSV for sessions and measurements). The export lists your attachments but doesn't include the files; download those from Supabase → Storage → `attachments`.
- **Settings → Add ideas from a file** adds goal ideas to the end of the backlog from a JSON file (`{"ideas": [{"title", "note", "done_means"}]}`; `note` is why it matters). Nothing else changes, and an idea named like a goal or idea you already have is skipped.
- **Settings → Import from a file** replaces everything in the app with a JSON file (an export, or one made for you). You type REPLACE to confirm. Attachments aren't in the file, so they're left out.
- **Workout tasks**: pick *Workout* as the task type and plan each exercise (sets, rep range, weight, rest), or paste a plan as text. On the day the log shows one exercise at a time with a row per set (set · previous · weight · reps · ✓). Each set starts at the plan (weight and top of the rep range) as editable numbers, so ticking a set done as planned is one tap; tap a number and type what you did when it differs, or tap Previous to copy last time. Ticking starts the rest timer. Add an exercise mid-workout (for that day, or kept in the plan from then on), add sets, add a photo with the camera button at the top, or move the workout to another day. A finished exercise folds to what you actually did, and so does the Today card once the workout is logged. Weight starts at last time's, plus 5 once you hit the top of the range on every set. Workout tasks with exercises written in their details get a plan read from them when the app opens. On Supabase, run `supabase/migrations/20261104000000_workout_plans.sql`.
- **Photos to track**: on a goal's Measurements, *+ Track something → A photo* (e.g. a progress photo) on the days you pick. On those days it sits in Today's numbers with a camera button; the photo is saved to the day and collects on the goal. Photo tasks made anywhere show there too.
- **Today's numbers** on Today logs each measurement set to **Show on Today** (a goal's main number by default; turn others on under the goal's Measurements). On Supabase, run `supabase/migrations/20261103000000_measure_on_today.sql`.
- Tasks have an optional **Details** field (a workout's exercises, a study plan). It shows when you tap the task on Today. On Supabase, run `supabase/migrations/20261102000000_task_details.sql` (or `python scripts/run_migration.py`).
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

After pulling a new version, run any migration in `supabase/migrations/` you haven't run yet (each is safe to run more than once). The review overhaul needs `20261025000000_review_overhaul.sql`; until it's run, the app shows a banner and reviews won't keep the new answers. The goal backlog needs `20261026000000_goal_backlog.sql`, completed goals need `20261027000000_completed_goals_and_readiness.sql`, prepare-and-commit needs `20261028000000_idea_prep.sql`, batches and own clocks need `20261029000000_batches_and_own_clocks.sql`, photos and files on tasks need `20261030000000_attachments.sql`, and connected goals plus measure and photo tasks need `20261031000000_connected_goals.sql`, goal groups need `20261101000000_goal_groups.sql`, group outcomes and "starts after" need `20261105000000_group_outcomes.sql`, the roadmap's start dates need `20261106000000_goal_start_dates.sql`, per-window reviews, one-reading-per-day and Then vs now need `20261107000000_review_fixes.sql`, and one window per goal (own clocks and "starts after" folded into each goal's dates, the flat backlog) needs `20261108000000_one_window_per_goal.sql`, and Odyssey paths need `20261109000000_odyssey_paths.sql`, and prizes need `20261110000000_prizes.sql`, and the weekly digest, path experiments and group week goals need `20261111000000_digests_and_experiments.sql`, and running totals on milestones need `20261112000000_tallies.sql`, and your own order of goals and groups needs `20261113000000_goal_order.sql`, and the backlog's Selected for next bucket needs `20261114000000_backlog_selected.sql`; until they're run, the app shows a banner naming the first one to run, and those can't be saved.

## Odyssey paths

**Goals → Paths** (or press P) is the layer above the seasons: the three five-year lives you could live, from *Designing Your Life*. **Path A** is the life you're already heading toward; **Path B** is what you'd do if A vanished tomorrow; **Path C** is what you'd do if money and image didn't matter. Each path has a name, a six-word headline, why this life, a line per year, four **gauges** you rate 1–5 (resources, likability, confidence, coherence), and the **questions** a small experiment would answer.

Goals and backlog ideas point at a path (pick one when you make a goal, on a goal's edit sheet, or on an idea), so a path's progress is measured, not guessed: goals finished, goals running and their pace, time put in, ideas waiting. A season's goals are how you prototype a path: **Prototype this: make a goal** on a path starts one with the path filled in; answer a question with what you learned when it's done. The 3-month checkpoint asks you to re-rate every path's gauges (the log shows them move season by season); the retrospective asks what the season taught you about each path. On Supabase, run `supabase/migrations/20261109000000_odyssey_paths.sql`.

## Prizes

A treat hangs on a **date to hit**, on **finishing a goal**, or on a **group landing**. You are the judge of done (tick the date, press Complete); the app records when, compares it with the date and keeps the ledger. Set them when you make a goal (every date has a prize field; a number goal's dates also take **the number that marks it hit**, so "10 lb down · 184.2 by Dec 13" ticks itself off on the first reading at or below 184.2), or later on the goal page (**Prizes → Change**) and on any date's sheet. A goal has a prize for finishing and an **on-time bonus** for finishing by its date; the bonus is judged against the date as it stood when you set it, so moving the finish later doesn't move the bonus. Hit a date late and its treat is still yours, marked late; only the bonus can be lost. A group's prize (**Goals → the group → Group prize**) needs a share of its goals finished — 85% by default, so all four of four.

When something is earned, Today shows one card: **Claimed** records it, **Later** hides it for the day. Unclaimed prizes sit on the goal and in the month, 3-month and season reviews until you take them; Then vs now lists what each goal earned. On Supabase, run `supabase/migrations/20261110000000_prizes.sql`.

## The season as a program

A to-do list reads the same on day 1 and day 100; a season doesn't. Under Today's title a line says where you are — **Week 3 of 27** — and what that part of a season asks of you (week 1: just show up; the middle: this is where people quit; the last two weeks: finish, don't start). For the first two weeks the Goals page shows the **season start**: five things to have in place (paths pointed at, 3–4 goals, dates on the roadmap, a prize on every goal, a why on every goal), each linking to where it happens. **Season card** (Goals page) puts the whole season on one page — goals, dates, prizes, groups, paths — to copy, print or save as a PDF; Then vs now has **Save as PDF** too.

The **weekly review** opens with your week in a few plain lines (days you showed up, where each goal stands with its ETA at your recent rate, prizes earned or not yet taken, next week's dates, the season line). Copy it, or send it to an **accountability partner** (Settings): their email gets the digest when you save the review — on Supabase, deploy `supabase/functions/send-digests` (Resend; secrets `RESEND_API_KEY`, `DIGEST_FROM`) and add the cron job from `supabase/cron.sql`. A Sunday-evening push, "two minutes to review", comes with reminders (`send-reminders`).

## Pace in words, and the photo timeline

A number goal's progress card says what the numbers mean: how far ahead of or behind the path you are, and — from the straight line through the last four weeks of readings — the day you reach the target at this rate and how far that is from your date. When it's late, two levers: **Move the date to …** (the on-time bonus still judges against the date it was set with) or **Tighten this week**. Every number goal's dates work the way weight does: a value marks a date hit, a prize can hang on it, Today's numbers say "next prize at 184.2 by Dec 13 · 1.6 to go".

**Photos** (a goal's Photos card → Timeline, or the link in Today's numbers) is every progress photo on the goal oldest to newest with that day's number under each: scrub through them, compare with any earlier photo, and **Save before / after** as a JPEG with dates, numbers and the change.

## Paths that do something

Beyond gauges and questions, a path has **experiments**: a small dated thing that answers one of its questions ("call one glamping owner and ask what they sold for", by Nov 20). It shows on Today and the calendar when due; finishing it writes what you learned onto the question. A backlog idea on a path offers **Try it small: an experiment** next to **Make it a goal**. The Paths page shows **where the hours went** — your logged goal time split by path, so what you said matters sits next to where the time actually goes — and each path has a **report**: gauges rating by rating, which gauges moved, questions answered and experiments done, goals finished, its share of your time.

## Roadmap load, and groups

Under the roadmap, **Load, week by week** is one bar per week of planned minutes against the time you've said you have; weeks over it go amber and are named, so overcommitment shows before it arrives. A group's page has **This week** — one line for the group that rolls up its goals' week goals — and says its pace in a sentence ("Body is behind, mostly the splits"). Goal rows on the Goals page show the next prize still open and its date.

## Then vs now

**Review → Then vs now** (also the first thing the retrospective shows) is the page the six months are for: one card per goal of the window, finished goals included — why it mattered, where you started (baseline reading, first photo) against where you are (latest reading, latest photo, milestones done, tasks done on how many days and for how long) — and a box for your own words, saved on the goal. Under the cards: days you showed up, time put in, goals finished.

## Not in this version

Audio recordings, drag-and-drop week planning, AI voice capture, and Garmin/Withings sync.

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

## Tracking

Everything a goal tracks (numbers like a distance or a waist, and photos) sits at the top of the goal page's side column, above milestones: the latest reading, the change since the first, a box to log today's (a second entry the same day replaces the first), every reading, and settings (show on Today, how often, rename, stop). A **group's page** lists everything its goals track, goal by goal, so you can log any of it in one place. **+ Track something** there asks which goal it belongs to, and a measurement's settings can move it to another goal in the group. Code: `apps/web/src/components/Tracking.tsx`.

## App updates

Small changes to your plan ship with the app as one-tap updates (`apps/web/src/data/updates.ts`): Today shows a line while one is waiting, **Review** lists what it changes and any choices, **Apply** makes the change, and Undo puts it back. Settings → Plans lists them all. The first: **Doc Film Academy: an hour a day** — the documentary goal's study task becomes 1 hour every day from Mon Nov 2, the course purchase is ticked, and the shoot/edit practice pauses until you add your own (optionally the drafted milestones go too).

## Goals: Backlog, Now, Roadmap

The bottom bar is Today, Goals, Calendar, Habits, Review. **Goals** has three views of the same goals,
in the order a goal moves: **Backlog** (ideas and Selected for next), **Now** (what's running, grouped
by your groups or by path, each path in a card like a group's) and **Roadmap** (dates, drag to change
them, and backlog ideas planned into a season as dashed bars; `/roadmap` and `/goals/timeline` still work). **Done** and **Paths** are links
under Now. Paths are a lens, not a tab: each goal and idea carries a small path chip, Now can group by
path, the goal page links to its path, and the season start and reviews still walk through them.

## Waiting on

An idea, or a whole group, can **wait on** a goal or one of its milestones: not a date, a condition.
The glamping idea waits on "Land an AI product owner role". While it waits it stays in the backlog with a
"⏳ Waiting · 6 weeks" badge, can't be made a goal without **Start anyway** and a reason (kept on its
note), shows on the Timeline as a dashed lane from when the job is due, and the weekly review lists
it under **Still waiting**. When the goal (or milestone, like "Offer signed") is done, Today asks:
**Prepare it**. Set it in the idea's sheet, or for a group in Edit group. A group waits on one
keystone, not on all of another group, so it fires when the job lands. Needs
`supabase/migrations/20261119000000_waiting_on.sql`.

## Ideas in groups, planned into a season

A group can hold backlog ideas as well as goals, so a whole project can be laid out before any of it
starts. In an idea's sheet, pick its **Group** (or make a new one) and what it's **Planned for**: a
season and rough dates. The backlog shows a group's ideas together under the group's header (what it
waits on, its path, the season it's planned for); the Roadmap shows them on that season as dashed
bars, by group. Ideas in a group wait on whatever the group waits on. **Make it a goal** starts from
the planned season and dates and puts the goal in the group; pick this season instead to pull it
forward. A group with only ideas stays until they're all made goals or discarded. The one-tap
**Glamping Site** update sets this up: Buy land, Build an A-frame, Build 3 domes and Build 3 tarp
glamping sites, filled in, selected for next, on Path C, planned for next season (made if needed),
the group waiting on the AI job. Needs `supabase/migrations/20261120000000_idea_groups_and_plans.sql`.

**Backlog:** **+ New group** makes a group from the backlog: name it, tick the ideas that go in it
(even ones in another group), and what it waits on. An empty group shows at the top of the backlog
until something's in it (with Delete group). Drag an idea **onto** another idea (its middle) to make
a group of the two (you name it), or onto a group (its header, or an empty group) to add it. An idea
that joins a group takes the group's path and the season its ideas are planned for, when they share
one and the idea has none, and waits on what the group waits on. **Arrange by Groups / Paths** shows the ideas by
group (each row shows its path, "Path C") or by path (Path A, B, C, no path; each row shows its
group). A group's page lists its ideas under **In the backlog**.

**Group colours** are kept per group and path (`gradient_slot`, `20261121000000_gradient_slots.sql`).
A new group or path takes the lowest of the 32 gradients not worn by a group still going (a goal
running, or ideas in the backlog) or a path that isn't archived. When a group's goals are all
finished or archived, or a path is archived, its gradient is free again; nobody else's colour shifts.

