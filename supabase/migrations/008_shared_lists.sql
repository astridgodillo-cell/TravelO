-- TravelO — Migration 008 : partage de listes entre utilisateurs (temps réel)
-- À appliquer manuellement via le SQL Editor du dashboard Supabase.

-- 1) Table des partages / invitations
create table if not exists public.list_shares (
  id uuid primary key default gen_random_uuid(),
  list_id uuid not null references public.user_packing_lists(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  owner_email text,
  recipient_id uuid not null references auth.users(id) on delete cascade,
  recipient_email text,
  list_name text,
  status text not null default 'pending'
    check (status in ('pending', 'accepted', 'refused')),
  created_at timestamptz not null default now(),
  responded_at timestamptz,
  unique (list_id, recipient_id)
);

create index if not exists list_shares_recipient_idx
  on public.list_shares(recipient_id, status);
create index if not exists list_shares_owner_idx
  on public.list_shares(owner_id);

alter table public.list_shares enable row level security;

-- 2) Politiques RLS sur list_shares
drop policy if exists "shares_owner_select" on public.list_shares;
create policy "shares_owner_select" on public.list_shares
  for select using (auth.uid() = owner_id);

drop policy if exists "shares_recipient_select" on public.list_shares;
create policy "shares_recipient_select" on public.list_shares
  for select using (auth.uid() = recipient_id);

-- Le destinataire peut répondre (accepter / refuser)
drop policy if exists "shares_recipient_update" on public.list_shares;
create policy "shares_recipient_update" on public.list_shares
  for update using (auth.uid() = recipient_id)
  with check (auth.uid() = recipient_id);

-- Le propriétaire peut annuler un partage ; le destinataire peut le quitter
drop policy if exists "shares_owner_delete" on public.list_shares;
create policy "shares_owner_delete" on public.list_shares
  for delete using (auth.uid() = owner_id);

drop policy if exists "shares_recipient_delete" on public.list_shares;
create policy "shares_recipient_delete" on public.list_shares
  for delete using (auth.uid() = recipient_id);

-- L'insertion passe uniquement par la fonction ci-dessous (SECURITY DEFINER).

-- 3) Fonction d'invitation par email (résout l'email -> compte)
create or replace function public.share_list_by_email(p_list_id uuid, p_email text)
returns public.list_shares
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_list_name text;
  v_owner_email text;
  v_rid uuid;
  v_remail text;
  v_row public.list_shares;
begin
  if v_uid is null then
    raise exception 'Non connecté';
  end if;

  select name into v_list_name from public.user_packing_lists
    where id = p_list_id and user_id = v_uid;
  if v_list_name is null then
    raise exception 'Liste introuvable ou non autorisée';
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

  insert into public.list_shares
    (list_id, owner_id, owner_email, recipient_id, recipient_email, list_name, status)
  values
    (p_list_id, v_uid, v_owner_email, v_rid, v_remail, v_list_name, 'pending')
  on conflict (list_id, recipient_id) do update
    set status = 'pending',
        responded_at = null,
        created_at = now(),
        list_name = excluded.list_name
  returning * into v_row;

  return v_row;
end;
$$;

grant execute on function public.share_list_by_email(uuid, text) to authenticated;

-- 4) Accès partagé : un destinataire ayant accepté peut lire & modifier la liste
drop policy if exists "packing_lists_shared_select" on public.user_packing_lists;
create policy "packing_lists_shared_select" on public.user_packing_lists
  for select using (
    exists (
      select 1 from public.list_shares s
      where s.list_id = id
        and s.recipient_id = auth.uid()
        and s.status = 'accepted'
    )
  );

drop policy if exists "packing_lists_shared_update" on public.user_packing_lists;
create policy "packing_lists_shared_update" on public.user_packing_lists
  for update using (
    exists (
      select 1 from public.list_shares s
      where s.list_id = id
        and s.recipient_id = auth.uid()
        and s.status = 'accepted'
    )
  )
  with check (
    exists (
      select 1 from public.list_shares s
      where s.list_id = id
        and s.recipient_id = auth.uid()
        and s.status = 'accepted'
    )
  );

-- 5) Temps réel : diffuser les changements de ces tables
do $$
begin
  alter publication supabase_realtime add table public.list_shares;
exception when duplicate_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.user_packing_lists;
exception when duplicate_object then null;
end $$;
