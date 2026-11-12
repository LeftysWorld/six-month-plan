// Calendar sync, served by the app on Vercel: /api/calendar/sync (the signed-in person's calendars,
// called by the app when it opens or comes back into view) and /api/calendar/cron (everyone's, once
// a day from Vercel's cron with CRON_SECRET). Bundled into apps/web/api/calendar/[route].js by
// apps/web/scripts/build-agent-api.mjs.
//
// Settings in Vercel: SUPABASE_SERVICE_ROLE_KEY (already there for the coach) and CRON_SECRET.

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { syncCalendars, type CalendarStore } from './calendar_sync.ts';

declare const process: { env: Record<string, string | undefined> };

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });

function store(sb: SupabaseClient): CalendarStore {
  const check = <T>(r: { data: T; error: { message: string } | null }): T => {
    if (r.error) throw new Error(r.error.message);
    return r.data;
  };
  return {
    async feeds(userId) {
      let q = sb.from('calendar_feeds').select('id, user_id, name, url');
      if (userId) q = q.eq('user_id', userId);
      return check(await q) ?? [];
    },
    async existing(feedId, fromIso, fromDate) {
      const out: { id: string; key: string }[] = [];
      for (const part of [
        () => sb.from('calendar_events').select('id, key').eq('feed_id', feedId).eq('all_day', false).gte('ends_at', fromIso),
        () => sb.from('calendar_events').select('id, key').eq('feed_id', feedId).eq('all_day', true).gte('end_date', fromDate),
      ]) {
        for (let from = 0; ; from += 1000) {
          const page = check(await part().order('key').range(from, from + 999)) ?? [];
          out.push(...page);
          if (page.length < 1000) break;
        }
      }
      return out;
    },
    async upsert(rows) {
      check(await sb.from('calendar_events').upsert(rows, { onConflict: 'feed_id,key' }));
    },
    async remove(ids) {
      check(await sb.from('calendar_events').delete().in('id', ids));
    },
    async markFeed(id, patch) {
      check(await sb.from('calendar_feeds').update({ ...patch, updated_at: new Date().toISOString() }).eq('id', id));
    },
  };
}

async function handle(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204 });
  const url = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return json({ error: 'setup', message: 'Add SUPABASE_SERVICE_ROLE_KEY in Vercel → Settings → Environment Variables, then redeploy.' }, 503);
  const sb = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const route = new URL(req.url).pathname.split('/').filter(Boolean).at(-1);
  const bearer = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '');

  if (route === 'cron') {
    const secret = process.env.CRON_SECRET;
    if (!secret || bearer !== secret) return json({ error: 'unauthorized' }, 401);
    const feeds = await syncCalendars(store(sb), null, Date.now());
    return json({ ok: true, feeds: feeds.map(({ id, ok, events, error }) => ({ id, ok, events, error })) });
  }

  if (route === 'sync' && req.method === 'POST') {
    if (!bearer) return json({ error: 'unauthorized', message: 'Sign in first.' }, 401);
    const { data, error } = await sb.auth.getUser(bearer);
    if (error || !data.user) return json({ error: 'unauthorized', message: 'Your sign-in expired. Sign in again.' }, 401);
    const feeds = await syncCalendars(store(sb), data.user.id, Date.now());
    return json({ ok: feeds.every((f) => f.ok), feeds });
  }

  return json({ error: 'not_found' }, 404);
}

export const GET = handle;
export const POST = handle;
export const OPTIONS = handle;
