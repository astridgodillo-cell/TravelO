-- TravelO — Migration 004 : listes personnelles d'affaires à ne pas oublier
-- À appliquer manuellement via le SQL Editor du dashboard Supabase.

create table if not exists public.user_packing_lists (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  items text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists user_packing_lists_user_idx
  on public.user_packing_lists(user_id, created_at desc);

alter table public.user_packing_lists enable row level security;

drop policy if exists "packing_lists_owner_select" on public.user_packing_lists;
create policy "packing_lists_owner_select" on public.user_packing_lists
  for select using (auth.uid() = user_id);

drop policy if exists "packing_lists_owner_insert" on public.user_packing_lists;
create policy "packing_lists_owner_insert" on public.user_packing_lists
  for insert with check (auth.uid() = user_id);

drop policy if exists "packing_lists_owner_update" on public.user_packing_lists;
create policy "packing_lists_owner_update" on public.user_packing_lists
  for update using (auth.uid() = user_id);

drop policy if exists "packing_lists_owner_delete" on public.user_packing_lists;
create policy "packing_lists_owner_delete" on public.user_packing_lists
  for delete using (auth.uid() = user_id);
