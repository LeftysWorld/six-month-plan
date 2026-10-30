// The workout coach's door, served by the app itself on Vercel: /api/workout-agent/history and
// /api/workout-agent/reports. Bundled into apps/web/api/workout-agent/[route].js by
// apps/web/scripts/build-agent-api.mjs (run it after changing this or ../../../supabase/functions/_shared/*).
//
// One setting in Vercel (Project → Settings → Environment Variables): SUPABASE_SERVICE_ROLE_KEY.
// The project URL comes from VITE_SUPABASE_URL, which the app already has. The coach's key is made
// in the app (Settings → Workout coach).

import { createClient } from '@supabase/supabase-js';
import { handleWorkoutAgent, json } from '../../../supabase/functions/_shared/workout_agent.ts';

declare const process: { env: Record<string, string | undefined> };

const env = (name: string) => process.env[name];

async function handle(req: Request): Promise<Response> {
  const url = env('SUPABASE_URL') ?? env('VITE_SUPABASE_URL');
  const key = env('SUPABASE_SERVICE_ROLE_KEY');
  const missing = [!url && 'VITE_SUPABASE_URL', !key && 'SUPABASE_SERVICE_ROLE_KEY'].filter(Boolean);
  if (missing.length) return json({ error: 'setup', missing, message: `Add ${missing.join(' and ')} in Vercel → Settings → Environment Variables, then redeploy.` }, 503);
  const sb = createClient(url!, key!, { auth: { persistSession: false, autoRefreshToken: false } });
  return handleWorkoutAgent(req, sb, env);
}

export const GET = handle;
export const POST = handle;
export const OPTIONS = handle;
