-- TravelO — Migration 002 : partage public + templates de préférences
-- À appliquer manuellement via le SQL Editor du dashboard Supabase.

-- 1) PARTAGE PUBLIC : ajoute is_public + public_slug à itineraries
alter table public.itineraries
  add column if not exists is_public boolean not null default false,
  add column if not exists public_slug text;

create unique index if not exists itineraries_public_slug_unique
  on public.itineraries(public_slug)
  where public_slug is not null;

-- Politique RLS : tout le monde peut lire les itinéraires publics
drop policy if exists "itineraries_public_select" on public.itineraries;
create policy "itineraries_public_select" on public.itineraries
  for select using (is_public = true);

-- Fonction utilitaire : génère un slug unique court (8 caractères base62)
create or replace function public.generate_short_slug() returns text
language plpgsql as $$
declare
  candidate text;
  attempts int := 0;
begin
  loop
    candidate := substring(
      replace(replace(replace(encode(gen_random_bytes(8), 'base64'), '/', ''), '+', ''), '=', ''),
      1, 8
    );
    if not exists (select 1 from public.itineraries where public_slug = candidate) then
      return candidate;
    end if;
    attempts := attempts + 1;
    if attempts > 10 then
      raise exception 'Impossible de générer un slug unique';
    end if;
  end loop;
end;
$$;

-- 2) TEMPLATES DE PRÉFÉRENCES
create table if not exists public.preference_templates (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  preferences jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists preference_templates_user_id_idx
  on public.preference_templates(user_id, created_at desc);

alter table public.preference_templates enable row level security;

drop policy if exists "templates_owner_select" on public.preference_templates;
create policy "templates_owner_select" on public.preference_templates
  for select using (auth.uid() = user_id);

drop policy if exists "templates_owner_insert" on public.preference_templates;
create policy "templates_owner_insert" on public.preference_templates
  for insert with check (auth.uid() = user_id);

drop policy if exists "templates_owner_update" on public.preference_templates;
create policy "templates_owner_update" on public.preference_templates
  for update using (auth.uid() = user_id);

drop policy if exists "templates_owner_delete" on public.preference_templates;
create policy "templates_owner_delete" on public.preference_templates
  for delete using (auth.uid() = user_id);
