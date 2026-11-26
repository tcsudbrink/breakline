# Turning on Breakline accounts (Supabase)

The app code is done. Done 2026-11-26: project uydsbqqjuxhbhhujhsgd ("tcsudbrink's Project"), tables + RLS created, Site URL and redirects set, URL + publishable key in `app.js`. Templates need custom SMTP before they can be edited (step 3), so sign-in emails are link-only for now.

## 1. Create the project
1. Sign up at https://supabase.com (the free plan is fine to start).
2. Create a new project named `breakline`, in the East US region. Save the database password in your password manager. The app never uses it.

## 2. Create the tables
1. Open **SQL Editor**, then **New query**.
2. Paste in everything from `supabase/schema.sql` and click **Run**.
3. Check under **Table Editor** that there are three tables: `profiles`, `spots` and `subscriptions`. Each should show RLS as enabled.

## 3. Sign-in emails
Breakline signs people in with a 6-digit code sent to their email. A link alone doesn't work well in the installed phone app, because tapping a link in an email opens the browser instead of the app.

1. Go to **Authentication**, then **Emails**, then **Magic Link**.
2. Set the subject to `Your Breakline sign-in code`.
3. Set the body to:
   ```html
   <h2>Your Breakline code</h2>
   <p style="font-size:28px;letter-spacing:4px"><b>{{ .Token }}</b></p>
   <p>Or tap to sign in on this device: <a href="{{ .ConfirmationURL }}">Sign in to Breakline</a></p>
   <p>The code expires in 1 hour. If you didn't ask for it, ignore this email.</p>
   ```
4. Copy the same body into the **Confirm signup** template.

## 4. Allowed web addresses
Go to **Authentication**, then **URL Configuration**.

1. Set **Site URL** to `https://www.breaklinefishing.com`.
2. Add these under **Redirect URLs**:
   - `https://www.breaklinefishing.com/**` and `https://breaklinefishing.com/**`
   - `http://localhost:8791/**`

## 5. Hand over the keys
Go to **Project Settings**, then **API Keys**, and copy two things:

- The **Project URL**, which looks like `https://abcdxyz.supabase.co`.
- The **publishable key** (shown as the **anon public** key on older projects).

The publishable key is meant to sit in the app's code, so it's safe to paste. Never share the **secret** / **service_role** key. It bypasses all the security rules, and only the future Stripe server function will use it, stored as a Vercel environment variable.

## Before launch
- **Email sending limit:** Supabase's built-in email sender only allows a few emails an hour. That's fine for testing but not for real users. Before launch, connect a real email service under **Authentication**, then **Emails**, then **SMTP Settings**. Resend, Postmark and Amazon SES all work, and need a domain you own.
- **Payments:** the `subscriptions` table is ready. Stripe comes next: Checkout for signing up, the customer portal for managing a subscription, and a webhook on Vercel that writes `plan` and `status`. The app already reads them: `ACCT.plan` is `free` or `pro`.

## Making someone free
Supabase -> **Table Editor** -> `free_accounts` -> **Insert row**: their email (and a note, like "crew" or "beta tester"). It works whether or not they've signed up yet, and they never see a trial countdown or the subscribe screen. Delete the row to put them back on the normal plan. tcsudbrink@gmail.com is already on the list.

## Trial and subscription rules
- New accounts get 5 days free from the moment they sign up (no card).
- After that they need an active subscription ($75/year) unless they're on `free_accounts`.
- The check runs in the database (`my_access()`), so nobody can change it from their browser.
- Until Stripe is set up, `PAYWALL_LIVE` in app.js is `false`: an ended trial still gets in. Flip it to `true` after step 6 below.

## 6. Turning on payments (Stripe)
1. Create a Stripe account at https://stripe.com (yours to do), and leave it in **Test mode** at first.
2. **Product catalog** -> **Add product**: name `Breakline`, price **$75.00**, **Recurring**, **Yearly**. Copy the price ID (`price_...`).
3. **Developers** -> **Webhooks** -> **Add endpoint**:
   - URL: `https://www.breaklinefishing.com/api/stripe-webhook`
   - Events: `checkout.session.completed`, `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted`
   - Copy the signing secret (`whsec_...`).
4. **Settings** -> **Billing** -> **Customer portal**: turn it on (lets people update their card or cancel).
5. In Vercel -> breakline -> **Settings** -> **Environment Variables**, add for Production:
   - `STRIPE_SECRET_KEY` = Stripe secret key (`sk_test_...`, later `sk_live_...`)
   - `STRIPE_PRICE_ID` = the `price_...` from step 2
   - `STRIPE_WEBHOOK_SECRET` = the `whsec_...` from step 3
   - `SUPABASE_SECRET_KEY` = Supabase -> Project Settings -> API Keys -> Secret keys (`sb_secret_...`)
   Then redeploy. These never go in the code or in chat.
6. Test with Stripe's test card 4242 4242 4242 4242, then switch Stripe to live mode, repeat steps 2-3 in live mode, swap the three Stripe values in Vercel, and set `PAYWALL_LIVE = true`.
