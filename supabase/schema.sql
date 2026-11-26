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
