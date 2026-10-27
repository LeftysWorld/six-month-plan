// send-digests: mails each saved weekly review's digest to the user's accountability partner.
// Called hourly by pg_cron (see supabase/cron.sql). The app writes reviews.digest when a weekly
// review is saved; this function sends any digest not yet sent to profiles.partner_email, through
// Resend (https://resend.com), and stamps digest_sent_at. Nothing is composed here: the words are
// the same ones the person saw on the review.
//
// Secrets: supabase secrets set RESEND_API_KEY=re_... DIGEST_FROM="Six Months <digest@yourdomain>" CRON_SECRET=...
// Deploy:  supabase functions deploy send-digests --no-verify-jwt
import { createClient } from 'jsr:@supabase/supabase-js@2';

interface ReviewRow {
  id: string;
  user_id: string;
  period_start: string;
  period_end: string;
  digest: string;
  completed_at: string | null;
}
interface ProfileRow {
  user_id: string;
  display_name: string | null;
  partner_email: string | null;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let out = 0;
  for (let i = 0; i < a.length; i++) out |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return out === 0;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

/** The digest text as simple HTML: title, then one line per bullet. */
function html(name: string, digest: string): string {
  const [title, ...rest] = digest.split('\n');
  const items = rest
    .filter((l) => l.trim())
    .map((l) => `<li style="margin:0 0 6px">${escapeHtml(l.replace(/^•\s*/, ''))}</li>`)
    .join('');
  return `<div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;max-width:560px;color:#222;line-height:1.45">
<p style="margin:0 0 12px;font-size:13px;color:#666">${escapeHtml(name)}’s week</p>
<h2 style="margin:0 0 14px;font-size:20px">${escapeHtml(title ?? '')}</h2>
<ul style="padding-left:18px;margin:0">${items}</ul>
<p style="margin:18px 0 0;font-size:12px;color:#888">Sent by their six-month plan because they asked you to see it. Reply and ask how it went.</p>
</div>`;
}

Deno.serve(async (req) => {
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  const cronSecret = Deno.env.get('CRON_SECRET') ?? '';
  const resendKey = Deno.env.get('RESEND_API_KEY') ?? '';
  const from = Deno.env.get('DIGEST_FROM') ?? '';
  const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
  const allowed = token.length > 0 && ((cronSecret !== '' && safeEqual(token, cronSecret)) || safeEqual(token, serviceKey));
  if (!allowed) return json({ error: 'unauthorized' }, 401);
  if (!resendKey || !from) return json({ error: 'RESEND_API_KEY and DIGEST_FROM must be set' }, 500);

  const sb = createClient(Deno.env.get('SUPABASE_URL') ?? '', serviceKey, { auth: { persistSession: false } });
  const result = { checked: 0, sent: 0, errors: [] as string[] };

  const { data: reviews, error } = await sb
    .from('reviews')
    .select('id, user_id, period_start, period_end, digest, completed_at')
    .eq('kind', 'weekly')
    .eq('status', 'done')
    .is('digest_sent_at', null)
    .neq('digest', '')
    .order('completed_at', { ascending: true })
    .limit(200);
  if (error) return json({ error: `reviews: ${error.message}` }, 500);
  const rows = (reviews ?? []) as ReviewRow[];
  if (rows.length === 0) return json(result);

  const userIds = [...new Set(rows.map((r) => r.user_id))];
  const { data: profData, error: profError } = await sb.from('profiles').select('user_id, display_name, partner_email').in('user_id', userIds);
  if (profError) return json({ error: `profiles: ${profError.message}` }, 500);
  const profiles = new Map(((profData ?? []) as ProfileRow[]).map((p) => [p.user_id, p]));

  for (const r of rows) {
    result.checked++;
    const profile = profiles.get(r.user_id);
    const to = profile?.partner_email?.trim();
    // No partner: mark it so it isn't checked again (setting a partner later applies to later weeks).
    if (!to) {
      await sb.from('reviews').update({ digest_sent_at: new Date().toISOString() }).eq('id', r.id);
      continue;
    }
    const name = profile?.display_name?.trim() || 'Your friend';
    const subject = `${name}’s week: ${r.digest.split('\n')[0] ?? `${r.period_start} – ${r.period_end}`}`;
    try {
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ from, to: [to], subject, text: r.digest, html: html(name, r.digest) }),
      });
      if (!res.ok) {
        result.errors.push(`resend ${r.id}: ${res.status} ${await res.text()}`);
        continue;
      }
      const { error: upErr } = await sb.from('reviews').update({ digest_sent_at: new Date().toISOString() }).eq('id', r.id);
      if (upErr) result.errors.push(`update ${r.id}: ${upErr.message}`);
      else result.sent++;
    } catch (e) {
      result.errors.push(`send ${r.id}: ${(e as Error).message}`);
    }
  }
  return json(result);
});
