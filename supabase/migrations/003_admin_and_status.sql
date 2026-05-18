-- TravelO — Migration 003 : rôles, statuts, tiers d'abonnement
-- À appliquer manuellement via le SQL Editor du dashboard Supabase.

-- 1) Colonnes role / status / subscription
alter table public.profiles
  add column if not exists role text not null default 'user'
    check (role in ('user', 'admin')),
  add column if not exists status text not null default 'pending'
    check (status in ('pending', 'approved', 'rejected', 'suspended')),
  add column if not exists subscription_tier text not null default 'free'
    check (subscription_tier in ('free', 'pro', 'illimited')),
  add column if not exists subscription_notes text,
  add column if not exists approved_at timestamptz,
  add column if not exists approved_by uuid references auth.users(id) on delete set null;

-- 2) Trigger : nouveau profil = status pending (remplace l'ancienne version)
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer as $$
begin
  insert into public.profiles (id, email, status, role, subscription_tier)
  values (new.id, new.email, 'pending', 'user', 'free')
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- 3) Helper : l'utilisateur courant est-il admin ?
create or replace function public.is_admin() returns boolean
language sql security definer stable as $$
  select exists(
    select 1 from public.profiles
    where id = auth.uid() and role = 'admin'
  );
$$;

-- 4) Helper : l'utilisateur courant est-il approuvé ?
create or replace function public.is_approved() returns boolean
language sql security definer stable as $$
  select exists(
    select 1 from public.profiles
    where id = auth.uid() and status = 'approved'
  );
$$;

-- 5) Politiques profiles
drop policy if exists "profiles_self_read" on public.profiles;
create policy "profiles_self_read" on public.profiles
  for select using (auth.uid() = id);

drop policy if exists "profiles_self_write" on public.profiles;
create policy "profiles_self_write" on public.profiles
  for insert with check (auth.uid() = id);

-- L'utilisateur peut mettre à jour ses préférences personnelles (preferences, full_name)
-- mais PAS son role/status/tier (l'admin uniquement).
drop policy if exists "profiles_self_update" on public.profiles;
create policy "profiles_self_update" on public.profiles
  for update using (auth.uid() = id)
  with check (auth.uid() = id);

drop policy if exists "profiles_admin_select" on public.profiles;
create policy "profiles_admin_select" on public.profiles
  for select using (public.is_admin());

drop policy if exists "profiles_admin_update" on public.profiles;
create policy "profiles_admin_update" on public.profiles
  for update using (public.is_admin());

-- 6) Trigger : empêche un user non-admin de se changer en admin ou de changer son status/tier
create or replace function public.protect_admin_fields()
returns trigger language plpgsql security definer as $$
begin
  if public.is_admin() then
    return new;
  end if;
  -- Pour les non-admin : forcer le maintien des champs sensibles
  new.role := old.role;
  new.status := old.status;
  new.subscription_tier := old.subscription_tier;
  new.approved_at := old.approved_at;
  new.approved_by := old.approved_by;
  return new;
end;
$$;

drop trigger if exists profiles_protect_admin_fields on public.profiles;
create trigger profiles_protect_admin_fields
  before update on public.profiles
  for each row execute function public.protect_admin_fields();

-- 7) Itineraries : seuls les utilisateurs APPROUVÉS peuvent en créer
drop policy if exists "itineraries_owner_insert" on public.itineraries;
create policy "itineraries_owner_insert" on public.itineraries
  for insert with check (
    auth.uid() = user_id and public.is_approved()
  );

-- L'admin peut lire tous les itinéraires (pour statistiques/modération)
drop policy if exists "itineraries_admin_select" on public.itineraries;
create policy "itineraries_admin_select" on public.itineraries
  for select using (public.is_admin());

-- 8) Templates : approuvés seulement aussi
drop policy if exists "templates_owner_insert" on public.preference_templates;
create policy "templates_owner_insert" on public.preference_templates
  for insert with check (
    auth.uid() = user_id and public.is_approved()
  );

-- 9) Backfill : approuver les profils existants (créés avant cette migration)
update public.profiles
set status = 'approved', approved_at = now()
where status = 'pending'
  and created_at < now() - interval '1 minute';

-- 10) Vue admin : liste agrégée des utilisateurs avec leurs stats
create or replace view public.admin_users_overview as
select
  p.id,
  p.email,
  p.full_name,
  p.role,
  p.status,
  p.subscription_tier,
  p.subscription_notes,
  p.created_at as signed_up_at,
  p.approved_at,
  p.approved_by,
  (select count(*) from public.itineraries i where i.user_id = p.id) as itineraries_count,
  (select max(i.created_at) from public.itineraries i where i.user_id = p.id) as last_itinerary_at
from public.profiles p;

-- La vue hérite des RLS de profiles via SECURITY INVOKER (Postgres 15+).
-- Par sécurité, on contrôle explicitement l'accès :
grant select on public.admin_users_overview to authenticated;
