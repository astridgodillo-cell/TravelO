-- TravelO — Migration 007 : fournisseur de vols configurable
-- À appliquer manuellement via le SQL Editor du dashboard Supabase.
--
-- Ajoute la clé `flight_provider` à app_config pour permettre au superadmin
-- de basculer entre Travelpayouts (Aviasales) et Kiwi.com (Tequila) sans
-- redéployer la fonction generate-itinerary.

insert into public.app_config (key, value)
values ('flight_provider', '"travelpayouts"'::jsonb)
on conflict (key) do nothing;
