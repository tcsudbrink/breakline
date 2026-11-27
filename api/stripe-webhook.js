// POST /api/stripe-webhook: Stripe tells us when a subscription starts, renews, lapses or is cancelled.
// Stripe -> Developers -> Webhooks -> endpoint https://www.breaklinefishing.com/api/stripe-webhook with events:
//   checkout.session.completed, customer.subscription.created, customer.subscription.updated, customer.subscription.deleted
import { env, json, stripe, saveSubscription, verifyStripe } from './_lib.js';

const periodEnd = (s) => {
  const t = s.current_period_end ?? s.items?.data?.[0]?.current_period_end;   // moved onto the item in newer API versions
  return t ? new Date(t * 1000).toISOString() : null;
};
async function record(sub, userId) {
  const uid = userId || sub.metadata?.user_id;
  if (!uid) { console.warn('subscription without user_id', sub.id); return; }
  await saveSubscription({
    user_id: uid,
    plan: 'pro',
    status: sub.status,                       // active, trialing, past_due, canceled, unpaid...
    current_period_end: periodEnd(sub),
    stripe_customer_id: typeof sub.customer === 'string' ? sub.customer : sub.customer?.id,
    stripe_subscription_id: sub.id,
    cancel_at_period_end: !!(sub.cancel_at_period_end || sub.cancel_at),   // cancelled, still paid up until then
  });
}

export async function POST(request) {
  if (!env.STRIPE_WEBHOOK_SECRET || !env.STRIPE_SECRET_KEY || !env.SUPABASE_SECRET_KEY) return json({ error: 'not_configured' }, 503);
  const raw = await request.text();
  if (!verifyStripe(raw, request.headers.get('stripe-signature'), env.STRIPE_WEBHOOK_SECRET)) return json({ error: 'bad signature' }, 400);
  const ev = JSON.parse(raw), o = ev.data?.object || {};
  try {
    if (ev.type === 'checkout.session.completed' && o.mode === 'subscription' && o.subscription) {
      const sub = await stripe(`subscriptions/${o.subscription}`, null, 'GET');
      await record(sub, o.client_reference_id || o.metadata?.user_id);
    } else if (/^customer\.subscription\.(created|updated|deleted)$/.test(ev.type)) {
      await record(ev.type.endsWith('deleted') ? { ...o, status: 'canceled' } : o);
    }
    return json({ received: true });
  } catch (e) {
    console.error('webhook', ev.type, e);
    return json({ error: 'failed' }, 500);             // Stripe retries
  }
}
