-- Breakline accounts: run this once in the Supabase SQL editor (Dashboard -> SQL Editor -> New query -> paste -> Run).
-- Every table has row-level security on, so a signed-in user can only ever read or change their own rows.

-- Settings that follow the account: home port, lat/long vs Loran, Loran chain + offsets, species, run limit
create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  settings jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

-- Saved spots. The app makes the id itself so spots saved offline sync later without duplicates.
-- Deleting a spot sets deleted_at instead of removing the row, so the delete reaches the user's other devices.
create table if not exists public.spots (
  id uuid primary key,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name text not null,
  lat double precision not null check (lat between -90 and 90),
  lon double precision not null check (lon between -180 and 180),
  td text,               -- Loran TDs at save time, e.g. "XY:26950.2/41210.7"
  sst real,              -- water temp (F) at save time
  fm integer,            -- depth (fathoms) at save time
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index if not exists spots_user_idx on public.spots (user_id, updated_at);

-- Subscription status. Only the server (Stripe webhook, using the service-role key) writes here;
-- users can read their own row but never change it.
create table if not exists public.subscriptions (
  user_id uuid primary key references auth.users (id) on delete cascade,
  plan text not null default 'free',          -- free | pro
  status text not null default 'inactive',    -- Stripe status: active, trialing, past_due, canceled...
  current_period_end timestamptz,
  stripe_customer_id text unique,
  stripe_subscription_id text unique,
  updated_at timestamptz not null default now()
);

alter table public.profiles enable row level security;
alter table public.spots enable row level security;
alter table public.subscriptions enable row level security;

drop policy if exists "own profile" on public.profiles;
create policy "own profile" on public.profiles for all
  using (id = auth.uid()) with check (id = auth.uid());

drop policy if exists "own spots" on public.spots;
create policy "own spots" on public.spots for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists "read own subscription" on public.subscriptions;
create policy "read own subscription" on public.subscriptions for select
  using (user_id = auth.uid());

-- A profile row for every new sign-up
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id) values (new.id) on conflict do nothing;
  return new;
end $$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------- Access: 5-day free trial, then a subscription; free_accounts overrides both ----------
-- To make someone free: Table Editor -> free_accounts -> Insert row (their email). Works before they sign up.
-- No policies on this table, so nobody can read or change it through the app; only you in the dashboard.
create table if not exists public.free_accounts (
  email text primary key,
  note text,
  added_at timestamptz not null default now()
);
alter table public.free_accounts enable row level security;

-- What the signed-in user can do right now: free | pro | trial | expired
create or replace function public.my_access() returns json
language sql stable security definer set search_path = public as $$
  select json_build_object(
    'status', case
      when exists (select 1 from public.free_accounts f where lower(f.email) = lower(u.email)) then 'free'
      when exists (select 1 from public.subscriptions s where s.user_id = u.id and s.plan = 'pro'
                   and s.status in ('active', 'trialing', 'past_due')) then 'pro'
      when u.created_at > now() - interval '5 days' then 'trial'
      else 'expired' end,
    'trial_ends', u.created_at + interval '5 days',
    'renews', (select s.current_period_end from public.subscriptions s where s.user_id = u.id))
  from auth.users u where u.id = auth.uid();
$$;
revoke execute on function public.my_access() from public, anon;
grant execute on function public.my_access() to authenticated;

-- ---------- Who signed up: name + phone from the sign-up form (user_metadata), kept on profiles ----------
alter table public.profiles add column if not exists full_name text;
alter table public.profiles add column if not exists phone text;
alter table public.profiles add column if not exists email text;
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, full_name, phone, email)
  values (new.id, new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'phone', new.email)
  on conflict (id) do update set full_name = coalesce(excluded.full_name, profiles.full_name),
    phone = coalesce(excluded.phone, profiles.phone), email = excluded.email;
  return new;
end $$;
-- backfill existing accounts
insert into public.profiles (id, email) select id, email from auth.users on conflict (id) do update set email = excluded.email;
-- ---------- v39: first/last name, home port and ad source from the sign-up form; follow-up list ----------
alter table public.profiles add column if not exists first_name text;
alter table public.profiles add column if not exists last_name text;
alter table public.profiles add column if not exists home_port text;
alter table public.profiles add column if not exists signup_source jsonb;     -- UTM tags / Google Ads click id from track.js
alter table public.profiles add column if not exists created_at timestamptz not null default now();
alter table public.subscriptions add column if not exists cancel_at_period_end boolean not null default false;
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare m jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
begin
  insert into public.profiles (id, full_name, first_name, last_name, phone, home_port, signup_source, email)
  values (new.id, m->>'full_name', m->>'first_name', m->>'last_name', m->>'phone', m->>'home_port',
          case when jsonb_typeof(m->'src') = 'object' then m->'src' end, new.email)
  on conflict (id) do update set full_name = coalesce(excluded.full_name, profiles.full_name),
    first_name = coalesce(excluded.first_name, profiles.first_name), last_name = coalesce(excluded.last_name, profiles.last_name),
    phone = coalesce(excluded.phone, profiles.phone), home_port = coalesce(excluded.home_port, profiles.home_port),
    signup_source = coalesce(excluded.signup_source, profiles.signup_source), email = excluded.email;
  return new;
end $$;
-- earlier sign-ups: split the single name field
update public.profiles set first_name = split_part(full_name, ' ', 1),
  last_name = nullif(trim(substr(full_name, length(split_part(full_name, ' ', 1)) + 1)), '')
where first_name is null and full_name is not null;
update public.profiles p set created_at = u.created_at from auth.users u where u.id = p.id;

-- Who to call or email: trials that ended without paying, cancellations (now or at renewal), failed payments.
-- Dashboard only: Table Editor -> follow_up (no one can read it through the app).
create or replace view public.follow_up with (security_invoker = false) as
select p.first_name, p.last_name, p.email, p.phone, p.home_port,
  case
    when s.status = 'past_due' then 'card failed'
    when s.cancel_at_period_end and s.status = 'active' then 'cancelled (ends ' || to_char(s.current_period_end, 'Mon DD') || ')'
    when s.status in ('canceled', 'unpaid') then 'cancelled'
    when coalesce(s.status, '') not in ('active', 'trialing') and u.created_at < now() - interval '5 days' then 'trial ended, never paid'
  end as reason,
  u.created_at as signed_up, s.current_period_end, p.signup_source->>'utm_campaign' as campaign
from public.profiles p
join auth.users u on u.id = p.id
left join public.subscriptions s on s.user_id = p.id
where not exists (select 1 from public.free_accounts f where lower(f.email) = lower(p.email))
  and (s.status in ('past_due', 'canceled', 'unpaid') or (s.cancel_at_period_end and s.status = 'active')
       or (coalesce(s.status, '') not in ('active', 'trialing') and u.created_at < now() - interval '5 days'));
revoke all on public.follow_up from public, anon, authenticated;
-- ---------- v40: Track my day (trips + catches) and the new-sign-up email ----------
-- A day on the water: the GPS track (thinned) and the stops/turns with the answers to "why here?"
create table if not exists public.trips (
  id uuid primary key,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  started_at timestamptz not null,
  ended_at timestamptz,
  nm real,
  track jsonb not null default '[]'::jsonb,     -- [[unix seconds, lat, lon, knots], ...]
  events jsonb not null default '[]'::jsonb,    -- [{type: stop|turn, t, lat, lon, why: [...], note}]
  updated_at timestamptz not null default now()
);
-- Every fish logged, with the water it came out of (temp, color, current, depth, break strength, salinity)
create table if not exists public.catches (
  id uuid primary key,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  trip_id uuid references public.trips (id) on delete set null,
  species text not null,
  n integer not null default 1 check (n between 1 and 500),
  lat double precision not null check (lat between -90 and 90),
  lon double precision not null check (lon between -180 and 180),
  caught_at timestamptz not null,
  why jsonb not null default '[]'::jsonb,
  conditions jsonb,
  note text,
  deleted_at timestamptz,
  updated_at timestamptz not null default now()
);
create index if not exists catches_user_species on public.catches (user_id, species);
alter table public.trips enable row level security;
alter table public.catches enable row level security;
drop policy if exists "own trips" on public.trips;
create policy "own trips" on public.trips for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists "own catches" on public.catches;
create policy "own catches" on public.catches for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

-- New sign-up -> POST to the site, which emails the owner (api/signup-notify.js)
alter table public.profiles add column if not exists notified_at timestamptz;
create extension if not exists pg_net with schema extensions;
create or replace function public.notify_signup() returns trigger
language plpgsql security definer set search_path = public, extensions as $$
begin
  perform net.http_post(
    url := 'https://www.breaklinefishing.com/api/signup-notify',
    body := jsonb_build_object('user_id', new.id),
    headers := '{"Content-Type": "application/json"}'::jsonb);
  return new;
exception when others then
  return new;            -- never block a sign-up over the alert
end $$;
drop trigger if exists on_profile_created_notify on public.profiles;
create trigger on_profile_created_notify after insert on public.profiles
  for each row execute function public.notify_signup();
