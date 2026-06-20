-- TravelO — Migration 011 : espace de stockage des photos de brochure
-- À appliquer manuellement via le SQL Editor du dashboard Supabase.
--
-- Les photos importées par l'utilisateur dans la brochure sont désormais
-- rangées ici (et on ne garde qu'un lien dans le voyage) au lieu d'être
-- stockées « en dur » (base64), ce qui rendait l'enregistrement trop lourd
-- (erreur « canceling statement due to statement timeout »).

insert into storage.buckets (id, name, public)
values ('brochure-photos', 'brochure-photos', true)
on conflict (id) do nothing;

-- Lecture publique des images (nécessaire pour les afficher dans la brochure).
drop policy if exists "brochure_photos_public_read" on storage.objects;
create policy "brochure_photos_public_read"
  on storage.objects for select
  using (bucket_id = 'brochure-photos');

-- Envoi d'images réservé aux utilisateurs connectés.
drop policy if exists "brochure_photos_auth_insert" on storage.objects;
create policy "brochure_photos_auth_insert"
  on storage.objects for insert
  to authenticated
  with check (bucket_id = 'brochure-photos');
