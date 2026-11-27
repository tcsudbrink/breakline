-- Breakline crews: share spots and boat positions with the people you fish with.
-- Run once in Supabase > SQL Editor (safe to re-run). Everything is behind row-level security:
-- you only ever see crews you belong to.

create table if not exists public.crews (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  code text not null unique,
  owner uuid not null default auth.uid() references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);
create table if not exists public.crew_members (
  crew_id uuid not null references public.crews (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  name text,
  joined_at timestamptz not null default now(),
  primary key (crew_id, user_id)
);
create table if not exists public.crew_spots (
  id uuid primary key,
  crew_id uuid not null references public.crews (id) on delete cascade,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  by_name text,
  name text not null,
  lat double precision not null,
  lon double precision not null,
  note text,
  created_at timestamptz not null default now(),
  deleted_at timestamptz
);
create table if not exists public.crew_pos (
  crew_id uuid not null references public.crews (id) on delete cascade,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name text,
  lat double precision not null,
  lon double precision not null,
  sog real,
  cog real,
  at timestamptz not null default now(),
  primary key (crew_id, user_id)
);

-- membership check that doesn't trip over its own RLS
create or replace function public.is_crew_member(c uuid) returns boolean
language sql security definer set search_path = public stable as $$
  select exists (select 1 from crew_members where crew_id = c and user_id = auth.uid());
$$;

alter table public.crews enable row level security;
alter table public.crew_members enable row level security;
alter table public.crew_spots enable row level security;
alter table public.crew_pos enable row level security;

drop policy if exists "crews: members read" on public.crews;
create policy "crews: members read" on public.crews for select to authenticated using (public.is_crew_member(id));
drop policy if exists "crews: owner edits" on public.crews;
create policy "crews: owner edits" on public.crews for update to authenticated using (owner = auth.uid()) with check (owner = auth.uid());
drop policy if exists "crews: owner deletes" on public.crews;
create policy "crews: owner deletes" on public.crews for delete to authenticated using (owner = auth.uid());

drop policy if exists "members: crew reads" on public.crew_members;
create policy "members: crew reads" on public.crew_members for select to authenticated using (public.is_crew_member(crew_id));
drop policy if exists "members: leave" on public.crew_members;
create policy "members: leave" on public.crew_members for delete to authenticated using (user_id = auth.uid());

drop policy if exists "spots: crew reads" on public.crew_spots;
create policy "spots: crew reads" on public.crew_spots for select to authenticated using (public.is_crew_member(crew_id));
drop policy if exists "spots: members add" on public.crew_spots;
create policy "spots: members add" on public.crew_spots for insert to authenticated with check (user_id = auth.uid() and public.is_crew_member(crew_id));
drop policy if exists "spots: own edits" on public.crew_spots;
create policy "spots: own edits" on public.crew_spots for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists "pos: crew reads" on public.crew_pos;
create policy "pos: crew reads" on public.crew_pos for select to authenticated using (public.is_crew_member(crew_id));
drop policy if exists "pos: own write" on public.crew_pos;
create policy "pos: own write" on public.crew_pos for insert to authenticated with check (user_id = auth.uid() and public.is_crew_member(crew_id));
drop policy if exists "pos: own update" on public.crew_pos;
create policy "pos: own update" on public.crew_pos for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists "pos: own delete" on public.crew_pos;
create policy "pos: own delete" on public.crew_pos for delete to authenticated using (user_id = auth.uid());

-- make a crew (you become its first member); returns the crew id
create or replace function public.crew_create(p_name text, p_member text) returns uuid
language plpgsql security definer set search_path = public as $$
declare c uuid; k text;
begin
  if auth.uid() is null then raise exception 'sign in first'; end if;
  loop
    k := upper(substr(translate(encode(extensions.gen_random_bytes(6), 'base64'), '+/=0O1Il', ''), 1, 6));
    exit when length(k) = 6 and not exists (select 1 from crews where code = k);
  end loop;
  insert into crews (name, code, owner) values (left(p_name, 60), k, auth.uid()) returning id into c;
  insert into crew_members (crew_id, user_id, name) values (c, auth.uid(), left(p_member, 40));
  return c;
end $$;

-- join with a code; returns the crew id
create or replace function public.crew_join(p_code text, p_member text) returns uuid
language plpgsql security definer set search_path = public as $$
declare c uuid;
begin
  if auth.uid() is null then raise exception 'sign in first'; end if;
  select id into c from crews where code = upper(trim(p_code));
  if c is null then raise exception 'no crew with that code'; end if;
  insert into crew_members (crew_id, user_id, name) values (c, auth.uid(), left(p_member, 40))
    on conflict (crew_id, user_id) do update set name = excluded.name;
  return c;
end $$;

revoke all on function public.crew_create(text, text) from public, anon;
revoke all on function public.crew_join(text, text) from public, anon;
grant execute on function public.crew_create(text, text) to authenticated;
grant execute on function public.crew_join(text, text) to authenticated;
