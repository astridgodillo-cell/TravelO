-- TravelO — schéma initial.
-- À appliquer manuellement via le dashboard Supabase (SQL editor).

create extension if not exists "pgcrypto";

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  full_name text,
  preferences jsonb default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.itineraries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null,
  preferences jsonb not null,
  itinerary jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists itineraries_user_id_idx
  on public.itineraries(user_id, created_at desc);

-- RLS
alter table public.profiles enable row level security;
alter table public.itineraries enable row level security;

drop policy if exists "profiles_self_read" on public.profiles;
create policy "profiles_self_read" on public.profiles
  for select using (auth.uid() = id);

drop policy if exists "profiles_self_write" on public.profiles;
create policy "profiles_self_write" on public.profiles
  for insert with check (auth.uid() = id);

drop policy if exists "profiles_self_update" on public.profiles;
create policy "profiles_self_update" on public.profiles
  for update using (auth.uid() = id);

drop policy if exists "itineraries_owner_select" on public.itineraries;
create policy "itineraries_owner_select" on public.itineraries
  for select using (auth.uid() = user_id);

drop policy if exists "itineraries_owner_insert" on public.itineraries;
create policy "itineraries_owner_insert" on public.itineraries
  for insert with check (auth.uid() = user_id);

drop policy if exists "itineraries_owner_update" on public.itineraries;
create policy "itineraries_owner_update" on public.itineraries
  for update using (auth.uid() = user_id);

drop policy if exists "itineraries_owner_delete" on public.itineraries;
create policy "itineraries_owner_delete" on public.itineraries
  for delete using (auth.uid() = user_id);

-- Création automatique d'un profil à chaque inscription
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer as $$
begin
  insert into public.profiles (id, email)
  values (new.id, new.email)
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
