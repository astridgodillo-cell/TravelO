-- TravelO — Migration 013 : partage d'albums (autonomes) entre utilisateurs.
-- Calqué sur 008_shared_lists.sql. À appliquer manuellement via le SQL Editor
-- du dashboard Supabase.
-- (Les albums créés DANS un voyage sont partagés via le partage du voyage,
--  voir 009_shared_itineraries.sql — rien à faire ici pour ceux-là.)

-- 1) Table des partages / invitations d'albums
create table if not exists public.album_shares (
  id uuid primary key default gen_random_uuid(),
  album_id uuid not null references public.albums(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  owner_email text,
  recipient_id uuid not null references auth.users(id) on delete cascade,
  recipient_email text,
  album_title text,
  status text not null default 'pending'
    check (status in ('pending', 'accepted', 'refused')),
  created_at timestamptz not null default now(),
  responded_at timestamptz,
  unique (album_id, recipient_id)
);

create index if not exists album_shares_recipient_idx
  on public.album_shares(recipient_id, status);
create index if not exists album_shares_owner_idx
  on public.album_shares(owner_id);

alter table public.album_shares enable row level security;

-- 2) Politiques RLS sur album_shares
drop policy if exists "album_shares_owner_select" on public.album_shares;
create policy "album_shares_owner_select" on public.album_shares
  for select using (auth.uid() = owner_id);

drop policy if exists "album_shares_recipient_select" on public.album_shares;
create policy "album_shares_recipient_select" on public.album_shares
  for select using (auth.uid() = recipient_id);

drop policy if exists "album_shares_recipient_update" on public.album_shares;
create policy "album_shares_recipient_update" on public.album_shares
  for update using (auth.uid() = recipient_id)
  with check (auth.uid() = recipient_id);

drop policy if exists "album_shares_owner_delete" on public.album_shares;
create policy "album_shares_owner_delete" on public.album_shares
  for delete using (auth.uid() = owner_id);

drop policy if exists "album_shares_recipient_delete" on public.album_shares;
create policy "album_shares_recipient_delete" on public.album_shares
  for delete using (auth.uid() = recipient_id);

-- L'insertion passe uniquement par la fonction ci-dessous (SECURITY DEFINER).

-- 3) Fonction d'invitation par email (résout l'email -> compte)
create or replace function public.share_album_by_email(p_album_id uuid, p_email text)
returns public.album_shares
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_album_title text;
  v_owner_email text;
  v_rid uuid;
  v_remail text;
  v_row public.album_shares;
begin
  if v_uid is null then
    raise exception 'Non connecté';
  end if;

  select title into v_album_title from public.albums
    where id = p_album_id and user_id = v_uid;
  if v_album_title is null then
    raise exception 'Album introuvable ou non autorisé';
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

  insert into public.album_shares
    (album_id, owner_id, owner_email, recipient_id, recipient_email, album_title, status)
  values
    (p_album_id, v_uid, v_owner_email, v_rid, v_remail, v_album_title, 'pending')
  on conflict (album_id, recipient_id) do update
    set status = 'pending',
        responded_at = null,
        created_at = now(),
        album_title = excluded.album_title
  returning * into v_row;

  return v_row;
end;
$$;

grant execute on function public.share_album_by_email(uuid, text) to authenticated;

-- 4) Accès partagé : un destinataire ayant accepté peut lire & modifier l'album
drop policy if exists "albums_shared_select" on public.albums;
create policy "albums_shared_select" on public.albums
  for select using (
    exists (
      select 1 from public.album_shares s
      where s.album_id = albums.id
        and s.recipient_id = auth.uid()
        and s.status = 'accepted'
    )
  );

drop policy if exists "albums_shared_update" on public.albums;
create policy "albums_shared_update" on public.albums
  for update using (
    exists (
      select 1 from public.album_shares s
      where s.album_id = albums.id
        and s.recipient_id = auth.uid()
        and s.status = 'accepted'
    )
  )
  with check (
    exists (
      select 1 from public.album_shares s
      where s.album_id = albums.id
        and s.recipient_id = auth.uid()
        and s.status = 'accepted'
    )
  );

-- 5) Temps réel : diffuser les changements de ces tables
do $$
begin
  alter publication supabase_realtime add table public.album_shares;
exception when duplicate_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.albums;
exception when duplicate_object then null;
end $$;
