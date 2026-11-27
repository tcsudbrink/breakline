// Shared helpers for the payment functions (files starting with _ are not deployed as endpoints).
// Secrets live in Vercel -> Project -> Settings -> Environment Variables, never in the repo:
//   STRIPE_SECRET_KEY      sk_live_... (or sk_test_... while testing)
//   STRIPE_PRICE_YEARLY    price_... for the $100/year plan (optional: defaults to PRICE_YEARLY below, the test-mode price;
//                          set it to the live price when Stripe goes live)
//   STRIPE_WEBHOOK_SECRET  whsec_... from the webhook endpoint
//   SUPABASE_SECRET_KEY    sb_secret_... (Supabase -> Project Settings -> API Keys -> Secret keys)
import crypto from 'node:crypto';

export const SB_URL = 'https://uydsbqqjuxhbhhujhsgd.supabase.co';
const SB_PUBLISHABLE = 'sb_publishable_qQLZTM_1THgVTToQZAhiYA_IY5IEdL9';
export const env = process.env;
export const PRICE_YEARLY = env.STRIPE_PRICE_YEARLY || 'price_1UgPrGCnMDwUU9Cw4kUQi8wC';   // $100/year, Stripe test mode
export const ready = () => !!(env.STRIPE_SECRET_KEY && PRICE_YEARLY && env.SUPABASE_SECRET_KEY);
export const json = (body, status = 200) => Response.json(body, { status });

// The signed-in Breakline user behind a request (from the app's Supabase session token)
export async function userFrom(request) {
  const auth = request.headers.get('authorization') || '';
  if (!/^Bearer \S+/.test(auth)) return null;
  const r = await fetch(`${SB_URL}/auth/v1/user`, { headers: { apikey: SB_PUBLISHABLE, Authorization: auth } });
  if (!r.ok) return null;
  const u = await r.json();
  return u?.id ? u : null;
}

// Supabase with the secret key (bypasses row-level security: server only)
export async function sbAdmin(path, init = {}) {
  const r = await fetch(`${SB_URL}/rest/v1/${path}`, {
    ...init,
    headers: { apikey: env.SUPABASE_SECRET_KEY, 'Content-Type': 'application/json', ...(init.headers || {}) },
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`supabase ${r.status}: ${text.slice(0, 200)}`);
  return text ? JSON.parse(text) : null;
}
export async function subscriptionRow(userId) {
  const rows = await sbAdmin(`subscriptions?user_id=eq.${encodeURIComponent(userId)}&select=*`);
  return rows?.[0] || null;
}
export async function saveSubscription(row) {
  return sbAdmin('subscriptions?on_conflict=user_id', {
    method: 'POST',
    headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify({ ...row, updated_at: new Date().toISOString() }),
  });
}

// Stripe's REST API (form-encoded), no SDK needed
export async function stripe(path, params, method = 'POST') {
  const body = params ? new URLSearchParams(flatten(params)).toString() : undefined;
  const r = await fetch(`https://api.stripe.com/v1/${path}${method === 'GET' && body ? `?${body}` : ''}`, {
    method,
    headers: { Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: method === 'GET' ? undefined : body,
  });
  const j = await r.json();
  if (!r.ok) throw new Error(j?.error?.message || `stripe ${r.status}`);
  return j;
}
function flatten(o, pre = '', out = {}) {
  for (const [k, v] of Object.entries(o)) {
    const key = pre ? `${pre}[${k}]` : k;
    if (v == null) continue;
    if (typeof v === 'object') flatten(v, key, out); else out[key] = String(v);
  }
  return out;
}

// Stripe webhook signature check (t=...,v1=... over "t.body", 5-minute tolerance)
export function verifyStripe(raw, header, secret) {
  const parts = Object.fromEntries((header || '').split(',').map((p) => p.split('=')).filter((p) => p.length === 2).map(([k, v]) => [k.trim(), v]));
  const sigs = (header || '').split(',').filter((p) => p.startsWith('v1=')).map((p) => p.slice(3));
  const t = +parts.t;
  if (!t || !sigs.length || Math.abs(Date.now() / 1000 - t) > 300) return false;
  const want = crypto.createHmac('sha256', secret).update(`${t}.${raw}`).digest('hex');
  return sigs.some((s) => s.length === want.length && crypto.timingSafeEqual(Buffer.from(s), Buffer.from(want)));
}

export const origin = (request) => new URL(request.url).origin;
