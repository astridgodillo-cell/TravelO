-- TravelO — Migration 010 : mémoriser les articles cochés d'une liste
-- À appliquer manuellement via le SQL Editor du dashboard Supabase.
--
-- La vue « Cocher la liste » enregistre les cases cochées dans cette colonne.
-- Sans elle, les coches ne sont pas conservées quand on quitte puis revient
-- sur la liste. checked_items contient les positions (index) des articles cochés.

alter table public.user_packing_lists
  add column if not exists checked_items integer[] not null default '{}';
