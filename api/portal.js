// POST /api/portal -> { url } of Stripe's page for changing the card or cancelling
import { ready, json, userFrom, subscriptionRow, stripe, origin } from './_lib.js';

export async function POST(request) {
  if (!ready()) return json({ error: 'not_configured' }, 503);
  const user = await userFrom(request);
  if (!user) return json({ error: 'Sign in first.' }, 401);
  try {
    const sub = await subscriptionRow(user.id);
    if (!sub?.stripe_customer_id) return json({ error: 'No subscription found on this account.' }, 404);
    const s = await stripe('billing_portal/sessions', { customer: sub.stripe_customer_id, return_url: `${origin(request)}/app` });
    return json({ url: s.url });
  } catch (e) {
    console.error('portal', e);
    return json({ error: 'Could not open the subscription page. Try again in a minute.' }, 500);
  }
}
