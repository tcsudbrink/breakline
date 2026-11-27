// POST /api/checkout -> { url } of a Stripe Checkout page for the $100/year plan
import { ready, json, userFrom, subscriptionRow, stripe, env, origin, PRICE_YEARLY } from './_lib.js';

export async function POST(request) {
  if (!ready()) return json({ error: 'not_configured' }, 503);
  const user = await userFrom(request);
  if (!user) return json({ error: 'Sign in first.' }, 401);
  try {
    const sub = await subscriptionRow(user.id);
    const base = origin(request);
    const session = await stripe('checkout/sessions', {
      mode: 'subscription',
      line_items: { 0: { price: PRICE_YEARLY, quantity: 1 } },
      client_reference_id: user.id,
      ...(sub?.stripe_customer_id ? { customer: sub.stripe_customer_id } : { customer_email: user.email }),
      subscription_data: { metadata: { user_id: user.id } },
      metadata: { user_id: user.id },
      allow_promotion_codes: 'true',
      billing_address_collection: 'required',
      phone_number_collection: { enabled: 'true' },
      success_url: `${base}/app?paid=1`,
      cancel_url: `${base}/app`,
    });
    return json({ url: session.url });
  } catch (e) {
    console.error('checkout', e);
    return json({ error: 'Could not open the payment page. Try again in a minute.' }, 500);
  }
}
