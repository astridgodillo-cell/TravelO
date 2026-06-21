-- Albums créés de zéro (indépendants d'un voyage).
-- Chaque album appartient à un utilisateur ; son contenu (pages, photos,
-- couverture, etc.) est stocké en JSON dans `content`.

create table if not exists public.albums (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  title text not null default 'Mon album',
  content jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists albums_user_id_idx on public.albums (user_id);

alter table public.albums enable row level security;

-- Chaque utilisateur ne voit et ne modifie que ses propres albums.
drop policy if exists "albums_owner_all" on public.albums;
create policy "albums_owner_all" on public.albums
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
