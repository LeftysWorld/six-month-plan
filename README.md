# Six Months

A personal web app for a six-month plan: goals at the top, today's list at the bottom, and an honest "am I on track?" in between. Built with React + TypeScript on a free Supabase database. Manual entry only (no Garmin or Withings).

## What's in it

- **Home**: status headline, today's next task, the weight path chart (plan line, daily readings, 7-day trend), plan vs actual for today / week / 4-week block / 3 months / 6 months, and goal pace.
- **Today**: one-tap check-off with Undo, a log sheet (done, partial, minimum kept, skip, obstacles, note, move to another day), "not placed yet" sessions, quick-add tasks, and logging extra activity.
- **Workout log** (sets × reps × weight, starts from your last workout) and **study timer** (survives reloads, manual minutes, milestones).
- **Plans**: overlapping six-month plans, plan detail with horizon tabs, goals that can be shared between plans, archive instead of delete.
- **Goal breakdown**: every goal flows 6 months → two 3-month stages → six months → weeks → daily tasks. Each level is connected and editable on its own (describe it, set a number target, spread a target down to the levels beneath). Daily tasks can be set days, times a week, or one day, and repeat for a week, a month, 3 months or the rest of the plan. They appear on Today automatically.
- **Goals**: three types (reach a number, build a practice, finish something), suggested path in 4-week blocks you can edit, milestones, measurements, history of changes.
- **Review**: hub with weekly, block, 3-month and retrospective reviews; a 5-step weekly review (look back, measure, reflect, adjust, plan next week) that saves in one database transaction; drafts survive interruptions.
- **Welcome back** after 2+ days away (continue, make this week lighter, or review the plan).
- **Settings**: name, time zone, units, minutes available per weekday, export JSON/CSV.
- **Demo mode**: runs entirely in the browser with example data, no account needed.
- Works offline: changes queue up and save when the connection returns.

## Run it locally (demo mode, 2 minutes)

Requirements: Node.js 20 or newer.

```bash
npm install
npm run dev
```

Open http://localhost:5173. With no Supabase settings, the app runs in demo mode with a sample plan that started two weeks ago. Settings → Demo lets you reload the example or start empty.

## Connect Supabase (your real data)

1. Create a free project at https://supabase.com.
2. In the dashboard, open **SQL Editor** and run each file in `supabase/migrations/` in order: first `20261016000000_initial_schema.sql`, then `20261019000000_goal_breakdown.sql`. (Or with the Supabase CLI: `supabase link` then `supabase db push`.)
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
│   ├── src/plan.ts                      weeks, blocks, 3-month checkpoint, suggested path, goal breakdown ranges
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

Number goals compare the 7-day average with the path; finish goals compare milestones completed with milestones due. "6 months · goals on pace" is on track when two-thirds or more of goals are on pace. No labels appear during a plan's first week.

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Start the app at http://localhost:5173 |
| `npm test` | Run the core unit tests |
| `npm run typecheck` | Type-check both packages |
| `npm run build` | Type-check and build the web app into `apps/web/dist` |

## Not in this version

Photos and recordings (the private storage bucket is already created), push notifications, dark mode, drag-and-drop week planning (days are picked from a menu), and device sync.
