-- TravelO — Migration 009 : partage d'itinéraires entre utilisateurs (temps réel)
-- À appliquer manuellement via le SQL Editor du dashboard Supabase.

-- 1) Table des partages / invitations d'itinéraires
create table if not exists public.itinerary_shares (
  id uuid primary key default gen_random_uuid(),
  itinerary_id uuid not null references public.itineraries(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  owner_email text,
  recipient_id uuid not null references auth.users(id) on delete cascade,
  recipient_email text,
  title text,
  status text not null default 'pending'
    check (status in ('pending', 'accepted', 'refused')),
  created_at timestamptz not null default now(),
  responded_at timestamptz,
  unique (itinerary_id, recipient_id)
);

create index if not exists itinerary_shares_recipient_idx
  on public.itinerary_shares(recipient_id, status);
create index if not exists itinerary_shares_owner_idx
  on public.itinerary_shares(owner_id);

alter table public.itinerary_shares enable row level security;

-- 2) Politiques RLS sur itinerary_shares
drop policy if exists "itin_shares_owner_select" on public.itinerary_shares;
create policy "itin_shares_owner_select" on public.itinerary_shares
  for select using (auth.uid() = owner_id);

drop policy if exists "itin_shares_recipient_select" on public.itinerary_shares;
create policy "itin_shares_recipient_select" on public.itinerary_shares
  for select using (auth.uid() = recipient_id);

drop policy if exists "itin_shares_recipient_update" on public.itinerary_shares;
create policy "itin_shares_recipient_update" on public.itinerary_shares
  for update using (auth.uid() = recipient_id)
  with check (auth.uid() = recipient_id);

drop policy if exists "itin_shares_owner_delete" on public.itinerary_shares;
create policy "itin_shares_owner_delete" on public.itinerary_shares
  for delete using (auth.uid() = owner_id);

drop policy if exists "itin_shares_recipient_delete" on public.itinerary_shares;
create policy "itin_shares_recipient_delete" on public.itinerary_shares
  for delete using (auth.uid() = recipient_id);

-- 3) Fonction d'invitation par email (résout l'email -> compte)
create or replace function public.share_itinerary_by_email(p_itinerary_id uuid, p_email text)
returns public.itinerary_shares
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_title text;
  v_owner_email text;
  v_rid uuid;
  v_remail text;
  v_row public.itinerary_shares;
begin
  if v_uid is null then
    raise exception 'Non connecté';
  end if;

  select title into v_title from public.itineraries
    where id = p_itinerary_id and user_id = v_uid;
  if v_title is null then
    raise exception 'Itinéraire introuvable ou non autorisé';
  end if;

  select id, email into v_rid, v_remail from public.profiles
    where lower(email) = lower(trim(p_email)) limit 1;
  if v_rid is null then
    raise exception 'Aucun utilisateur avec cet email';
  end if;
  if v_rid = v_uid then
    raise exception 'Vous ne pouvez pas partager avec vous-même';
  end if;

  select email into v_owner_email from public.profiles where id = v_uid;

  insert into public.itinerary_shares
    (itinerary_id, owner_id, owner_email, recipient_id, recipient_email, title, status)
  values
    (p_itinerary_id, v_uid, v_owner_email, v_rid, v_remail, v_title, 'pending')
  on conflict (itinerary_id, recipient_id) do update
    set status = 'pending',
        responded_at = null,
        created_at = now(),
        title = excluded.title
  returning * into v_row;

  return v_row;
end;
$$;

grant execute on function public.share_itinerary_by_email(uuid, text) to authenticated;

-- 4) Accès partagé : un destinataire ayant accepté peut lire & modifier l'itinéraire
drop policy if exists "itineraries_shared_select" on public.itineraries;
create policy "itineraries_shared_select" on public.itineraries
  for select using (
    exists (
      select 1 from public.itinerary_shares s
      where s.itinerary_id = id
        and s.recipient_id = auth.uid()
        and s.status = 'accepted'
    )
  );

drop policy if exists "itineraries_shared_update" on public.itineraries;
create policy "itineraries_shared_update" on public.itineraries
  for update using (
    exists (
      select 1 from public.itinerary_shares s
      where s.itinerary_id = id
        and s.recipient_id = auth.uid()
        and s.status = 'accepted'
    )
  )
  with check (
    exists (
      select 1 from public.itinerary_shares s
      where s.itinerary_id = id
        and s.recipient_id = auth.uid()
        and s.status = 'accepted'
    )
  );

-- 5) Temps réel : diffuser les changements de ces tables
do $$
begin
  alter publication supabase_realtime add table public.itinerary_shares;
exception when duplicate_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.itineraries;
exception when duplicate_object then null;
end $$;
