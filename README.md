# TravelO

Application web de génération d'itinéraires touristiques ultra-détaillés (à la manière d'un tour opérateur). L'utilisateur renseigne ses préférences ; TravelO produit un programme jour par jour avec hébergements, repas, excursions, transports et budget prévisionnel.

## Stack

- **Frontend** : React + Vite + Tailwind CSS
- **Backend / BDD** : Supabase (PostgreSQL + Auth + Edge Functions)
- **Déploiement** : Vercel
- **Versioning** : GitHub

## Démarrage local

```bash
npm install
cp .env.example .env   # puis renseigner les variables
npm run dev
```

Ouvrir http://localhost:5173.

## Variables d'environnement

| Variable | Description |
|---|---|
| `VITE_SUPABASE_URL` | URL du projet Supabase |
| `VITE_SUPABASE_ANON_KEY` | Clé anonyme Supabase (publique) |
| `SUPABASE_SERVICE_ROLE_KEY` | Clé service (jamais exposée côté client, uniquement pour Edge Functions / scripts) |

## Base de données

Le schéma initial se trouve dans [`supabase/schema.sql`](./supabase/schema.sql).
À appliquer manuellement via le **SQL editor** du dashboard Supabase.

Tables : `profiles`, `itineraries` — RLS activée, chaque utilisateur ne voit que ses propres données.

## Génération d'itinéraires

La fonction `generateItinerary` dans [`src/lib/ai.js`](./src/lib/ai.js) appelle une Edge Function Supabase nommée `generate-itinerary`. Si l'Edge Function n'est pas encore déployée, un fallback local produit un programme d'exemple cohérent — l'app reste utilisable sans backend IA.

## Scripts

- `npm run dev` — serveur de développement Vite
- `npm run build` — build de production dans `dist/`
- `npm run preview` — prévisualisation du build
- `npm run lint` — ESLint

## Déploiement Vercel

Le projet contient un [`vercel.json`](./vercel.json) configuré pour Vite (SPA fallback inclus).
Sur Vercel, ajouter les variables d'environnement `VITE_SUPABASE_URL` et `VITE_SUPABASE_ANON_KEY` dans les **Project Settings**.

## Conventions

- Composants React en `PascalCase`
- Utilitaires et hooks en `camelCase`
- Appels Supabase centralisés dans `src/lib/supabase.js`
- Appels IA centralisés dans `src/lib/ai.js`
- Branche principale : `main`
