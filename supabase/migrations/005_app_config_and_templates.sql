-- TravelO — Migration 005 : configuration globale + modèles d'itinéraires
-- À appliquer manuellement via le SQL Editor du dashboard Supabase.

-- 1) Table app_config : configuration globale clé/valeur
create table if not exists public.app_config (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null
);

-- Seed du backend par défaut
insert into public.app_config (key, value)
values ('llm_backend', '"gemini"'::jsonb)
on conflict (key) do nothing;

alter table public.app_config enable row level security;

-- Tout utilisateur authentifié peut LIRE la config (l'Edge Function utilise
-- la service_role et bypass de toute façon).
drop policy if exists "app_config_authenticated_read" on public.app_config;
create policy "app_config_authenticated_read" on public.app_config
  for select using (auth.uid() is not null);

-- Seul un admin peut ÉCRIRE
drop policy if exists "app_config_admin_write" on public.app_config;
create policy "app_config_admin_write" on public.app_config
  for all using (public.is_admin())
  with check (public.is_admin());

-- 2) Colonnes "modèle" sur itineraries
alter table public.itineraries
  add column if not exists is_template boolean not null default false,
  add column if not exists template_category text,
  add column if not exists template_description text;

create index if not exists itineraries_template_idx
  on public.itineraries(is_template, created_at desc)
  where is_template = true;

-- Tout utilisateur authentifié peut lire les itinéraires marqués comme modèles
drop policy if exists "itineraries_template_select" on public.itineraries;
create policy "itineraries_template_select" on public.itineraries
  for select using (is_template = true and auth.uid() is not null);
