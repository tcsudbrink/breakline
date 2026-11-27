// POST /api/signup-notify { user_id }: emails the owner when someone creates a Breakline account.
// Supabase calls this from a database trigger (pg_net) the moment a profile row is created.
// No shared secret: it only ever emails about a real account made in the last 15 minutes, and only once
// (profiles.notified_at), so a stranger calling it can't spam or learn anything.
// Vercel env vars: RESEND_API_KEY (Resend), NOTIFY_TO (comma-separated addresses), optional NOTIFY_FROM.
import { env, json, sbAdmin } from './_lib.js';

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export async function POST(request) {
  if (!env.SUPABASE_SECRET_KEY) return json({ error: 'not_configured' }, 503);
  let id;
  try { id = (await request.json()).user_id; } catch (e) { return json({ error: 'bad request' }, 400); }
  if (!/^[0-9a-f-]{36}$/i.test(id || '')) return json({ error: 'bad id' }, 400);
  const p = (await sbAdmin(`profiles?id=eq.${id}&select=first_name,last_name,full_name,email,phone,home_port,signup_source,created_at,notified_at`))?.[0];
  if (!p) return json({ error: 'no such account' }, 404);
  if (p.notified_at) return json({ ok: true, already: true });
  if (Date.now() - Date.parse(p.created_at) > 15 * 60e3) return json({ error: 'too old' }, 409);
  if (!env.RESEND_API_KEY || !env.NOTIFY_TO) { console.warn('signup-notify: RESEND_API_KEY / NOTIFY_TO not set'); return json({ error: 'email not configured' }, 503); }

  const name = [p.first_name, p.last_name].filter(Boolean).join(' ') || p.full_name || '(no name)';
  const src = p.signup_source || {};
  const from = [src.utm_source, src.utm_campaign, src.utm_term].filter(Boolean).join(' / ') || (src.gclid ? 'Google Ads' : src.ref || 'direct');
  const rows = [['Name', name], ['Email', p.email], ['Phone', p.phone], ['Home port', p.home_port], ['Came from', from], ['Landing page', src.landing],
    ['Signed up', new Date(p.created_at).toLocaleString('en-US', { timeZone: 'America/New_York', dateStyle: 'medium', timeStyle: 'short' }) + ' ET']];
  const html = `<h2 style="font-family:Arial,sans-serif">New Breakline sign-up</h2><table style="font-family:Arial,sans-serif;font-size:15px;border-collapse:collapse">${
    rows.filter(([, v]) => v).map(([k, v]) => `<tr><td style="padding:4px 14px 4px 0;color:#666">${k}</td><td style="padding:4px 0"><b>${esc(v)}</b></td></tr>`).join('')
  }</table><p style="font-family:Arial,sans-serif;font-size:13px;color:#666">Their 5-day trial started now. Everyone who lapses or cancels shows up in Supabase &gt; Table Editor &gt; follow_up.</p>`;
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: env.NOTIFY_FROM || 'Breakline <signups@breaklinefishing.com>',
      to: env.NOTIFY_TO.split(',').map((s) => s.trim()).filter(Boolean),
      subject: `New Breakline sign-up: ${name}${p.home_port ? ` (${p.home_port})` : ''}`,
      html,
      text: rows.filter(([, v]) => v).map(([k, v]) => `${k}: ${v}`).join('\n'),
    }),
  });
  if (!r.ok) { const t = await r.text(); console.error('resend', r.status, t.slice(0, 300)); return json({ error: 'send failed' }, 502); }
  await sbAdmin(`profiles?id=eq.${id}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ notified_at: new Date().toISOString() }) });
  return json({ ok: true });
}
