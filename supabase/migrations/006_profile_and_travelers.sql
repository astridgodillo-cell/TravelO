-- TravelO — Migration 006 : profil utilisateur enrichi + voyageurs + lieux
-- À appliquer manuellement via le SQL Editor du dashboard Supabase.

-- ============================================================
-- 1) PROFILES : nouvelles colonnes pour l'onboarding et les listes
-- ============================================================
alter table public.profiles
  add column if not exists onboarding_completed boolean not null default false,
  add column if not exists visited_places jsonb not null default '[]'::jsonb,
  add column if not exists wishlist_places jsonb not null default '[]'::jsonb,
  add column if not exists personal_info jsonb not null default '{}'::jsonb;

-- Format attendu (informatif) :
--   visited_places  : array de { name: string, year?: number, notes?: string }
--   wishlist_places : array de { name: string, notes?: string, priority?: 'low'|'med'|'high' }
--   personal_info   : { languages?: string[], dietary?: string[], allergies?: string,
--                       mobility?: string, notes?: string }

-- ============================================================
-- 2) PREFERENCE_TEMPLATES devient "profils de voyage" (personas)
--    Ajout d'un flag is_default pour le persona à présélectionner.
-- ============================================================
alter table public.preference_templates
  add column if not exists is_default boolean not null default false;

-- Un seul persona par défaut par utilisateur.
create unique index if not exists preference_templates_one_default_per_user
  on public.preference_templates(user_id)
  where is_default = true;

-- ============================================================
-- 3) TRAVELERS : carnet de voyageurs récurrents
--    (conjoint, enfants, parents…) avec contraintes santé.
-- ============================================================
create table if not exists public.travelers (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  relation text,                 -- ex: 'conjoint', 'enfant', 'parent', 'ami'…
  birth_year int,                -- pour calculer l'âge automatiquement
  dietary text[] not null default '{}',   -- ['végétarien', 'sans gluten', 'halal'…]
  allergies text,
  mobility text,                 -- ex: 'fauteuil roulant', 'difficultés escaliers'
  languages text[] not null default '{}',
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists travelers_user_idx
  on public.travelers(user_id, created_at desc);

alter table public.travelers enable row level security;

drop policy if exists "travelers_owner_select" on public.travelers;
create policy "travelers_owner_select" on public.travelers
  for select using (auth.uid() = user_id);

drop policy if exists "travelers_owner_insert" on public.travelers;
create policy "travelers_owner_insert" on public.travelers
  for insert with check (auth.uid() = user_id);

drop policy if exists "travelers_owner_update" on public.travelers;
create policy "travelers_owner_update" on public.travelers
  for update using (auth.uid() = user_id);

drop policy if exists "travelers_owner_delete" on public.travelers;
create policy "travelers_owner_delete" on public.travelers
  for delete using (auth.uid() = user_id);
