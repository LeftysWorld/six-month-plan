# Six Months

A personal web app for a six-month plan: goals at the top, today's list at the bottom, and an honest "am I on track?" in between. Built with React + TypeScript on a free Supabase database. Manual entry only (no Garmin or Withings).

## What's in it

Three places, one job each: **Today** to do, **Goals** to see and shape, **Review** to reflect.

- **Today** (opens here): this week's days, a big done count, the **Up next** task with a start button, a one-line coach note, and your list. Tap the circle to check a task off (with Undo), tap the row for the log sheet (done, partial, minimum kept, skip, obstacles, move to another day, start a timer), or swipe left on a phone to finish it.
  - **Check-in streak** that survives real life: logging any one thing counts, 2 freezes cover missed days, every 7 check-ins earns a freeze back, and a missed day can be earned back by logging 2 things the next day ("never miss twice").
  - **Morning plan** (before noon): yesterday's leftovers and a capacity check, with "move to tomorrow". **Evening wrap-up** (after 6 pm): tick what you did, roll the rest to tomorrow.
  - **Quick add** in plain words: "guitar 20m mon wed fri #guitar", "call mom tomorrow !", "stretch 10m daily".
- **Goals**: where you are in the plan (day, timeline, 3-month checkpoint), a setup checklist for new plans, **Needs attention** (goals to catch up on, unset week/month goals, overdue milestones, stale weigh-ins), each goal with real numbers and this week's goal, and what's coming up.
- **One page per goal**: the goal chain, then this week's daily tasks.
  - **The chain**: the 6-month goal, plus *one* current 3-month goal, *one* month goal and *one* week goal. Only the current period is shown and stored; when a month or week ends, you set the next one (on the goal page, or in the weekly review). Number goals suggest each target from your path.
  - **Catch-up math** next to anything behind: "2 extra a week for the next 2 weeks catches you up", "1.3 lb a week reaches 207.8 by Nov 1".
  - **Daily tasks**: set days, times a week, or one day; for this week, the month, 3 months, the plan or no end date; with an optional "after ___, at ___" cue that shows on Today.
  - Why it matters, the path chart, milestones, measurements and change history.
- **Review**: the weekly review in **three steps** (look back incl. measurements, reflect incl. suggested changes, plan next week incl. next week's goals with "any day" tasks placed on your lightest days), progress tiles (plan pace rings, weight trend, this week, check-ins, plan vs actual), month / 3-month / retrospective reviews, and charts.
- **Workout log** (sets × reps × weight, starts from your last workout) and a **focus timer** for any task (survives reloads).
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
2. In the dashboard, open **SQL Editor** and run each file in `supabase/migrations/` in order: first `20261016000000_initial_schema.sql`, then `20261019000000_goal_breakdown.sql`, then `20261021000000_reminders_and_cues.sql`. (Or with the Supabase CLI: `supabase link` then `supabase db push`.)
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

- The Supabase free plan has no automatic backups. Use **Settings → Export everything** regularly (JSON, plus CSV for sessions and measurements).
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
