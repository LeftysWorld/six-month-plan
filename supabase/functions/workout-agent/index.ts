// workout-agent as a Supabase Edge Function. The same door the app serves from Vercel
// (apps/web/api/workout-agent); everything it does is in ../_shared/workout_agent.ts.
//
// Deploy (only if you'd rather run it here than on Vercel):
//   supabase functions deploy workout-agent --no-verify-jwt
// The coach's key comes from the app (Settings → Workout coach). SUPABASE_URL and
// SUPABASE_SERVICE_ROLE_KEY are provided by Supabase.

import { createClient } from 'jsr:@supabase/supabase-js@2';
import { handleWorkoutAgent } from '../_shared/workout_agent.ts';

Deno.serve((req) => {
  const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
  return handleWorkoutAgent(req, sb, (k) => Deno.env.get(k));
});
