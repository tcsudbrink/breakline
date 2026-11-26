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

1. Set **Site URL** to `https://breakline-xi.vercel.app`.
2. Add these under **Redirect URLs**:
   - `https://breakline-xi.vercel.app/**`
   - `http://localhost:8791/**`

## 5. Hand over the keys
Go to **Project Settings**, then **API Keys**, and copy two things:

- The **Project URL**, which looks like `https://abcdxyz.supabase.co`.
- The **publishable key** (shown as the **anon public** key on older projects).

The publishable key is meant to sit in the app's code, so it's safe to paste. Never share the **secret** / **service_role** key. It bypasses all the security rules, and only the future Stripe server function will use it, stored as a Vercel environment variable.

## Before launch
- **Email sending limit:** Supabase's built-in email sender only allows a few emails an hour. That's fine for testing but not for real users. Before launch, connect a real email service under **Authentication**, then **Emails**, then **SMTP Settings**. Resend, Postmark and Amazon SES all work, and need a domain you own.
- **Payments:** the `subscriptions` table is ready. Stripe comes next: Checkout for signing up, the customer portal for managing a subscription, and a webhook on Vercel that writes `plan` and `status`. The app already reads them: `ACCT.plan` is `free` or `pro`.
